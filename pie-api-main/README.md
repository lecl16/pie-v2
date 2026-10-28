# PIE — API

Backend service of the **Portable Isolated Environment (PIE)** exam system.
It is a [FastAPI](https://fastapi.tiangolo.com/) application that manages
courses, exams, sessions, users and PIE devices. It also:

- provisions devices with the examiner app (the trusted node);
- receives activity logs, pub/sub events and screen-share signaling from the
  exam app;
- serves all of this to the [WebApp](../WebApp-main) dashboard.

This README covers installing and running the server ([Getting
started](#getting-started), [Operating the server](#operating-the-server)),
how its security mechanisms work ([How it works](#how-it-works)), and the
API itself.

## Architecture

| Service | Technology | Purpose |
|---|---|---|
| `caddy` | Caddy 2 | Terminates TLS on ports 8000 and 8443 (forwards to `app`), 3000 (forwards to `webapp`), and 8001 inside the devices' tunnels (forwards to `app`) |
| `wireguard` | WireGuard (host kernel), `wireguard/` | The PIE devices' tunnels: `wg0` on `10.77.0.1`, UDP 51820. Caddy shares its network, so Caddy's ports are published here |
| `app` | FastAPI on Python 3.13 (uvicorn) | REST, WebSocket and SSE endpoints; reachable only through Caddy |
| `device-api` | The same code, `app/device_tls_server.py` | Port 8444: TLS with a per-device pre-shared key, for PIE devices only |
| `webapp` | Next.js, built from `../WebApp-main/webapp` | The dashboard; reachable only through Caddy, on port 3000 ([WebApp README](../WebApp-main/README.md)) |
| `db` | MySQL 8 | Courses, exams, sessions, users, devices, phones, submissions |
| `redis` | Redis | Pub/sub (`/pie`), screen-share signaling, log streams |
| `elasticsearch`, `kibana` | Elasticsearch 7, Kibana 7 | Archive and search of activity logs |
| `clamav` | ClamAV | Scans uploaded exam files and submissions |
| `phpmyadmin` | phpMyAdmin | Database browser, for troubleshooting only |

All services are defined in `docker-compose.yml`. Python 3.13 is required:
the device port uses `ssl`'s TLS-PSK callbacks, which were added in 3.13.

## Getting started

### Requirements

- Docker and Docker Compose
- `openssl`, used by the setup scripts

### First-time setup

```bash
./scripts/setup.sh
```

It creates, once per deployment:

- **`.env`** (mode 600), with random secrets: the JWT signing key, the MySQL
  passwords and `DEVICE_PSK_WRAP_KEY`.
- **`certs/`** (see [TLS](#tls)): the deployment's CA, the server
  certificate and the phone CA.

It is safe to re-run. An existing `.env` or certificate is never
overwritten. A secret added in a later version (such as
`DEVICE_PSK_WRAP_KEY`) is appended to an existing `.env`.

### Start

```bash
docker compose up -d --build
docker compose exec app python -m scripts.create_admin   # first admin, once
```

| Service | Address |
|---|---|
| Dashboard | `https://<server>:3000` |
| API | `https://<server>:8000` |
| Swagger UI | `https://<server>:8000/docs` |
| API, phone port (client certificate required) | `https://<server>:8443` |
| API, device port (TLS-PSK, PIE devices only) | `<server>:8444` |
| Devices' tunnels (WireGuard) | `<server>:51820/udp` |
| API for the exam apps, inside the tunnels only | `http://10.77.0.1:8001` |
| phpMyAdmin | `http://<server>:8080` |
| Kibana | `http://<server>:5601` |

After changing the code, rebuild: `docker compose up -d --build`.

## TLS

Every client reaches the API over TLS, except the exam apps, whose traffic
is protected by their device's tunnel:

| Port | Who | Authentication |
|---|---|---|
| `3000` | The dashboard itself (the `webapp` service) | Server certificate only |
| `8000` | Dashboard, the examiner app's login and enrollment | Server certificate only |
| `8001` | Exam apps, through their PIE device's tunnel only; not published (see [Device tunnels](#device-tunnels)) | Plain HTTP inside the tunnel; the student's token only works from its device's tunnel address |
| `8443` | Enrolled examiner phones: device creation, provisioning secrets, the session and student pickers | Server certificate, plus a client certificate signed by the phone CA (see [Phone enrollment](#phone-enrollment)) |
| `8444` | PIE devices: provisioning confirmation, session status, their tunnel key | TLS-PSK with a per-device key, served by `device-api`, not Caddy (see [Device TLS-PSK](#device-tls-psk)) |

`scripts/generate-certs.sh` creates, in `certs/` (never committed):

| File | Purpose |
|---|---|
| `ca.crt`, `ca.key` | The deployment's private CA. Created once. |
| `server.crt`, `server.key` | The API's certificate, signed by that CA, for this machine's hostname, its IPv4 addresses and `localhost`. |
| `phone-ca.crt`, `phone-ca.key` | A second CA that only signs examiner phones' client certificates. Created once. |

**Clients trust the CA, not the server certificate:**

- **The examiner's phone:** install `ca.crt` once (Settings → Security →
  Encryption & credentials → Install a certificate → CA certificate).
- **The dashboard:** the browser trusts `ca.crt` too, and so does the
  dashboard's Node server (`NODE_EXTRA_CA_CERTS`, see the WebApp README).
- **The exam app:** gets the CA from its PIE device, which fetches it over
  port 8444. Nothing needs to be installed.

**When the server's address changes** (another room or network), re-issue
the server certificate, set the new address in `PIE_API_URL` in `.env`
(the dashboard has it compiled in), and rebuild. Phones, browsers and PIE
devices need no change:

```bash
./scripts/generate-certs.sh 192.168.1.50      # optionally also a hostname
# edit .env: PIE_API_URL=https://192.168.1.50:8000
docker compose up -d --build
```

Check it from another machine:
`curl --cacert certs/ca.crt https://<address>:8000/docs`.

**Keep `certs/ca.key` and `certs/phone-ca.key` private and backed up.**
Losing `ca.key` means a new CA, to be installed again on every phone and
browser. Losing `phone-ca.key` means enrolling every phone again.

## Operating the server

### Accounts

The first admin account is created from the command line, once, with the
server running. It asks for the NMEC, name, email and password (the
password is not echoed):

```bash
docker compose exec app python -m scripts.create_admin
```

The dashboard has no user-management page. Create further accounts
(teachers, students) as an admin, in Swagger UI (`https://<server>:8000/docs`):

1. `POST /users/login` with the admin's email and password; copy the
   `access_token`.
2. **Authorize**, paste the token.
3. `POST /users/create`:
   ```json
   {"name": "Ana Silva", "email": "ana@ua.pt", "nmec": 123456,
    "password": "…", "role": "student"}
   ```
   `nmec` is a unique integer; `role` is `admin`, `teacher`, `student` or
   `auditor`. Students are matched to a session's allowed students by
   **email**.

### Stopping, restarting, updating

```bash
docker compose down              # stop; data is kept
docker compose up -d --build     # start again, or after updating the code (git pull)
```

`setup.sh` does not need to run again after an update. **Never** use
`docker compose down -v`: it deletes the database, the log archive and the
uploaded files.

### Backups

Back up, somewhere off this machine:

- **the database:**
  ```bash
  docker compose exec db sh -c 'mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" --all-databases' > backup-$(date +%F).sql
  ```
- **`.env`:** the database passwords, the JWT key and the key that unwraps
  the devices' TLS keys;
- **`certs/`:** the CAs that phones and browsers trust and that signed
  every phone's certificate. Without them, every phone, browser and PIE
  device has to be set up again.

### Time zone

The containers run in `Europe/Lisbon` (`TZ` in `docker-compose.yml`), so
that session times and log timestamps match local time. Change it there
for another location.

## Configuration

Read from `.env` (generated by `setup.sh`; never committed) by
`app/core/config.py`, and by `docker-compose.yml` for the `db` and
`phpmyadmin` services. `.env.example` lists every variable without real
values.

| Variable | Description |
|---|---|
| `APP_PORT` | Port uvicorn listens on inside the compose network (8000) |
| `JWT_SECRET_KEY`, `JWT_ALGORITHM` | Signing key (generated) and algorithm (HS256) for login tokens |
| `DEVICE_PSK_WRAP_KEY` | 32 bytes, hex (generated). Encrypts the devices' TLS pre-shared keys in the database (see [Device TLS-PSK](#device-tls-psk)) |
| `PIE_API_URL` | The API's address as teachers' browsers reach it (`https://<address>:8000`), compiled into the dashboard. Filled in by `setup.sh` with the machine's main address; rebuild after changing it |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `MYSQL_HOST`, `MYSQL_PORT`, `DATABASE_URL` | MySQL connection (passwords generated) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL` | Redis connection |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | Celery task queue (Redis) |
| `CLAMAV_HOST`, `CLAMAV_PORT` | ClamAV daemon |
| `ELASTICSEARCH_HOST`, `ELASTICSEARCH_PORT`, `ELASTICSEARCH_URL` | Elasticsearch connection |
| `LOG_RETENTION_DAYS`, `LOG_MAX_STREAM_LENGTH` | How long, and how many, log entries Redis streams keep before archival and trimming |

Optional, with defaults that match `generate-certs.sh` and the compose file:
`PHONE_CA_CERT_PATH`,
`PHONE_CA_KEY_PATH` (`certs/phone-ca.*`), `PHONE_CERT_DAYS` (365) and
`PHONE_MTLS_PORT` (8443).

## Authentication and authorization

- **Users** log in with `POST /users/login`, which returns a JWT, sent as
  `Authorization: Bearer <token>`. Roles: `admin`, `teacher`, `student`,
  `auditor`.
- **Examiner phones** add a client certificate on port 8443. The certificate
  must belong to an enrolled, unrevoked phone of the logged-in teacher.
  Without it, device creation and provisioning are refused.
- **PIE devices** authenticate with their device API key (`X-Device-Key`),
  over the TLS-PSK port. Provisioning confirmation uses an HMAC proof of the
  session secret instead.

| Access level | Routes |
|---|---|
| Public | `POST /users/login` |
| Device (key or HMAC proof, no JWT) | `POST /device/{d}/provisioning-secret/{s}/confirm`, `GET /device/{d}/session/{s}/status`, `POST /device/{d}/tunnel` |
| Authenticated | Sessions, session users, submissions, devices (read), screen-share, `/pie` |
| The student themself, through the device they joined on | Writing activity logs (`POST /logs/session/{s}/user/{nmec}`): the student comes from the token, the device from the tunnel, the session must be the one they joined on that device |
| Teacher or admin | Courses, exams, analytics, reading activity logs (every `GET /logs/...`, including the live stream), writing logs for a device (`POST /logs/device/{d}`, `POST /logs/session/{s}/device/{d}`), `/examiner-phone/*`, `POST /device/create`, `POST /device/{d}/rotate-key`, `DELETE /device/{d}` |
| Teacher or admin, from an enrolled phone | Device creation, provisioning-secret registration and removal, the examiner app's session and student lists |
| Admin | `POST /users/create` |

## API overview

Full, current documentation: `/docs` (Swagger UI) and `/redoc`.

| Prefix | Router | Description |
|---|---|---|
| `/users` | `user.py` | Login, logout, user accounts |
| `/course` | `course.py` | Courses |
| `/course/{course_id}` | `exam.py` | Exams of a course |
| `/course/{course_id}/{exam_id}` | `session.py` | Sessions: create, start, end, exam file, submissions; provisioning-secret registration (`…/{session_id}/device/{device_id}/provisioning-secret`) |
| `/session-users` | `session_user.py` | A student joining a session. Accepted only from the device the examiner tapped for that student (see [Joining a session](#joining-a-session)) |
| `/submission` | `submission.py` | Submission uploads and per-student timing |
| `/device` | `device.py` | PIE devices: creation, key rotation, the device-authenticated routes above |
| `/examiner-phone` | `examiner_phone.py` | Phone enrollment, listing, revocation; the examiner app's session and student pickers |
| `/logs` | `logs.py` | Activity log ingestion, queries and live SSE streams |
| `/analytics` | `analytics.py` | Log summaries, time series, course and exam hierarchies |
| `/screenshare` | `screenshare.py` | WebRTC signaling over WebSocket for live screen-share |
| `/pie`, `/pie/{id}` | `pie.py` | Pub/sub: publish (`POST`) and subscribe over SSE (`GET`); session control messages to exam apps |

### Data model

| Table | Holds |
|---|---|
| `User` | `nmec`, name, email, hashed password, role |
| `Course`, `Exam` | A course and its exams |
| `Session` | An exam sitting: join code, room, date, duration, allowed links, allowed students (emails), encrypted exam file and key, start and end state |
| `SessionUser` | A student who joined a session on a device, with join and leave times |
| `Device` | A PIE device: name, hash of its API key, its wrapped TLS pre-shared key, last seen |
| `DeviceProvisioningSecret` | The secret the examiner app registered for a device and session, the assigned student, its expiry and confirmation time |
| `ExaminerPhone` | An enrolled phone: owner, certificate fingerprint and serial, expiry, revocation |
| `Submission` | A submitted file, with size, MIME type and optional grade |

## Real-time features

- **Logs:** written to Redis streams and archived to Elasticsearch
  (`streams_service.py`, `elasticsearch_service.py`). They can be followed
  live over SSE.
- **Pub/sub:** `pubsub_service.py` carries session control messages to the
  exam apps (start, extra time, finish).
- **Screen-share:** `screenshare_service.py` relays WebRTC signaling between
  a student's exam app and the teacher's monitoring page.

## How it works

### Registering a PIE device

1. In the examiner app ("Provision New Device"), the enrolled phone calls
   `POST /device/create`. The server creates the device and returns its ID
   and a new device API key. It stores only a hash of the key, and the
   device's TLS pre-shared key wrapped with `DEVICE_PSK_WRAP_KEY`.
2. The phone holds that identity in memory until the next tap, and serves
   it once. In the tap, it goes encrypted to the PIE device, as in session
   provisioning below.
3. The device saves it (`/etc/pie/device.json`). From then on it talks to
   the server over the device port.

`DELETE /device/{d}` removes a device. `POST /device/{d}/rotate-key` issues
a new key, but no client delivers it to the device yet: the device stops
reaching the server. To replace a device's key:
1. delete the device;
2. on the device, delete `/etc/pie/device.json` and restart `nfc-reader`;
3. register it again with a tap.

### Session provisioning

The examiner app is the **trusted node**: it decides which device gets
which session and student, and the server only accepts what an enrolled
phone registered.

1. **Register.** The app generates a random 32-byte secret and registers
   it for the device, the session and the student it picked:
   `POST /course/{c}/{e}/{s}/device/{d}/provisioning-secret`, on the phone
   port. The secret is valid for 5 minutes until it's confirmed.
   - **Wrong student:** registering again before the student joins
     replaces the secret and the student.
   - **Device in use:** registering a different student or session is
     refused (409) while a student is taking an exam on that device.
   - **Not allowed:** a student not in the session's allowed students is
     refused (400).
2. **Tap.** The PIE device sends a fresh P-256 public key. The phone
   answers with the payload (session, student, secret, server address,
   expiry), encrypted to that key: ECDH P-256, HKDF-SHA256 and
   AES-256-GCM. The command byte is authenticated with it, so a
   registration envelope can't be replayed as a session one.
3. **Confirm.** The device proves it holds the secret with an HMAC
   (`POST /device/{d}/provisioning-secret/{s}/confirm`, device port), and
   checks the server's HMAC answer. Only a server that holds the same secret
   can answer, which also confirms that the server address in the tap is
   genuine. The device then saves the session.
4. A confirmed provisioning stays valid until the session ends; the device
   checks `GET /device/{d}/session/{s}/status` and drops it then.

### Joining a session

There is no student login: the examiner checked the student's card before
the session tap, so the tap already says who sits at the device.
`POST /session-users/join` (no JWT, only the join code) is accepted only
if:
- it arrives through a PIE device's tunnel, on port 8001: Caddy passes the
  client's tunnel address, which identifies the device (see
  [Device tunnels](#device-tunnels));
- that device was provisioned for that session.

The server takes the student from the confirmed tap, never from the
request, and answers with that student's token, which the exam app uses
for the rest of the exam. The token carries the device's tunnel address,
and is refused from anywhere else, so a copied token is useless on another
machine. Nothing secret leaves the device. A machine that was never tapped
can't join. The
exam app shows the assigned student's name and number before the join, so
a student can call the examiner if the tap named someone else.

### Phone enrollment

After the first login, the examiner app:
1. creates a key pair in the Android Keystore;
2. sends a certificate request to `POST /examiner-phone/enroll`, with the
   teacher's JWT, on port 8000;
3. gets a client certificate signed by the phone CA, valid for
   `PHONE_CERT_DAYS`.

On port 8443, Caddy requires that certificate and passes its fingerprint
to the API. The API accepts it only if the phone is enrolled, not revoked,
not expired, and belongs to the logged-in teacher.

A teacher lists their phones with `GET /examiner-phone/` and revokes a lost
one with `DELETE /examiner-phone/{id}`. Revocation takes effect on the
phone's next request.

### Device TLS-PSK

PIE devices reach the server on port 8444, served by `device-api`
(`app/device_tls_server.py`), not Caddy:

- TLS 1.3 with a pre-shared key and no certificate;
- each device has its own key, derived from its API key with HKDF;
- the handshake identity is `pie-device-<id>`;
- only a server that holds the device's key completes the handshake.

The keys are stored wrapped with `DEVICE_PSK_WRAP_KEY`, so a copy of the
database alone doesn't reveal them. The device side is
`NFC-Support/pie_tls.py`.

### Device tunnels

Each PIE device has a WireGuard tunnel to the server (`wireguard` service,
`app/core/tunnel.py`):

- **Keys:** the device creates its own key pair; the private key never
  leaves it. It registers the public key over port 8444
  (`POST /device/{d}/tunnel`) and gets its tunnel address, `10.77.0.0/16`
  plus its id + 1, and the server's key. The server's private key is created
  on the `wireguard` service's first start, in the `tunnel_data` volume.
- **Split tunnel:** only traffic to the server's tunnel address
  (`10.77.0.1`) goes through it. The allowed sites leave through the exam
  room's Wi-Fi, as before.
- **The exam app** reaches the API at `http://10.77.0.1:8001`, through
  the device. Plain HTTP: the tunnel already encrypts and authenticates the
  traffic, and the device received the server's tunnel key over its TLS-PSK
  link, so no other server can be at the other end.
- **The peers** are rewritten from the database by the API
  (`tunnel_data/peers.conf`) whenever a device registers a key, is deleted,
  or has its API key rotated; the `wireguard` service applies them within
  seconds. Devices can't reach each other through the server.
- **Firewall:** open **UDP 51820** on the server. A network that blocks UDP
  blocks the tunnels, and no exam app can reach the server.

## Production notes

- **Published ports.** Besides 3000, 8000, 8443, 8444 and 51820/udp, the compose file
  publishes MySQL (3306), Redis (6379), Elasticsearch (9200), Kibana (5601),
  ClamAV (3310) and phpMyAdmin (8080) on the host. Redis and Elasticsearch
  have no authentication. On any network you don't fully control, block
  these ports with the host firewall, or remove their `ports:` entries.
- **Never run uvicorn exposed without Caddy.** The API trusts the
  `X-Pie-Phone-Cert-Fingerprint` header, which only Caddy may set: it strips
  it on port 8000 and sets it from the verified certificate on 8443.
- **Phone enrollment** needs only the teacher's password. Anyone with a
  teacher's password can enroll a new phone; list and revoke phones under
  `/examiner-phone`.
- **Backups:** the database (`mysql_data` volume), `.env` and `certs/`. See
  [Backups](#backups).

## Development without Docker

```bash
python3.13 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.api.main:app --reload --host 127.0.0.1 --port 8000
```

This serves plain HTTP on localhost and needs your own MySQL, Redis,
Elasticsearch and ClamAV, at the addresses in `.env`. Use it for
development only (see the Caddy note above).

`app/testing/` has standalone HTML clients (`client.html`, `client_v2.html`)
for trying the WebSocket and SSE endpoints without the dashboard.
