# PIE — API

Backend service of the **Portable Isolated Environment (PIE)** exam system.
It is a [FastAPI](https://fastapi.tiangolo.com/) application that manages
courses, exams, sessions, users and PIE devices. It also:

- provisions devices with the examiner app (the trusted node);
- receives activity logs, pub/sub events and screen-share signaling from the
  exam app;
- serves all of this to the [WebApp](../WebApp-main) dashboard.

For a step-by-step installation aimed at the examiner running the server,
see [`docs/deployment.md`](docs/deployment.md). This README is the reference.

## Architecture

| Service | Technology | Purpose |
|---|---|---|
| `caddy` | Caddy 2 | Terminates TLS on ports 8000 and 8443 (forwards to `app`) and 3000 (forwards to `webapp`) |
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
| phpMyAdmin | `http://<server>:8080` |
| Kibana | `http://<server>:5601` |

After changing the code, rebuild: `docker compose up -d --build`.

## TLS

Every client reaches the API over TLS:

| Port | Who | Authentication |
|---|---|---|
| `3000` | The dashboard itself (the `webapp` service) | Server certificate only |
| `8000` | Dashboard, exam app, the examiner app's login and enrollment | Server certificate only |
| `8443` | Enrolled examiner phones: device creation, provisioning secrets, the session and student pickers | Server certificate, plus a client certificate signed by the phone CA ([`docs/examiner-phone-enrollment.md`](docs/examiner-phone-enrollment.md)) |
| `8444` | PIE devices: provisioning confirmation, session status, the CA they relay to the exam app | TLS-PSK with a per-device key, served by `device-api`, not Caddy ([`docs/device-tls-psk.md`](docs/device-tls-psk.md), [`docs/exam-app-tls.md`](docs/exam-app-tls.md)) |

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

## Configuration

Read from `.env` (generated by `setup.sh`; never committed) by
`app/core/config.py`, and by `docker-compose.yml` for the `db` and
`phpmyadmin` services. `.env.example` lists every variable without real
values.

| Variable | Description |
|---|---|
| `APP_PORT` | Port uvicorn listens on inside the compose network (8000) |
| `JWT_SECRET_KEY`, `JWT_ALGORITHM` | Signing key (generated) and algorithm (HS256) for login tokens |
| `DEVICE_PSK_WRAP_KEY` | 32 bytes, hex (generated). Encrypts the devices' TLS pre-shared keys in the database ([`docs/device-tls-psk.md`](docs/device-tls-psk.md)) |
| `PIE_API_URL` | The API's address as teachers' browsers reach it (`https://<address>:8000`), compiled into the dashboard. Filled in by `setup.sh` with the machine's main address; rebuild after changing it |
| `MYSQL_ROOT_PASSWORD`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DB`, `MYSQL_HOST`, `MYSQL_PORT`, `DATABASE_URL` | MySQL connection (passwords generated) |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_URL` | Redis connection |
| `CELERY_BROKER_URL`, `CELERY_RESULT_BACKEND` | Celery task queue (Redis) |
| `CLAMAV_HOST`, `CLAMAV_PORT` | ClamAV daemon |
| `ELASTICSEARCH_HOST`, `ELASTICSEARCH_PORT`, `ELASTICSEARCH_URL` | Elasticsearch connection |
| `LOG_RETENTION_DAYS`, `LOG_MAX_STREAM_LENGTH` | How long, and how many, log entries Redis streams keep before archival and trimming |

Optional, with defaults that match `generate-certs.sh` and the compose file:
`SERVER_CA_CERT_PATH` (`certs/ca.crt`), `PHONE_CA_CERT_PATH`,
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
| Device (key or HMAC proof, no JWT) | `POST /device/{d}/provisioning-secret/{s}/confirm`, `GET /device/{d}/session/{s}/status`, `GET /device/{d}/server-ca` |
| Authenticated | Sessions, session users, submissions, devices (read), logs, screen-share, `/pie` |
| Teacher or admin | Courses, exams, analytics, `/examiner-phone/*`, `POST /device/create`, `POST /device/{d}/rotate-key`, `DELETE /device/{d}` |
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
| `/session-users` | `session_user.py` | A student joining a session. Accepted only from the device the examiner tapped for that student ([`docs/tap-gated-student-join.md`](docs/tap-gated-student-join.md)) |
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

## Design documents (`docs/`)

| Document | Topic |
|---|---|
| [`deployment.md`](docs/deployment.md) | Installing and running the server (operator guide) |
| [`examiner-trusted-node-provisioning.md`](docs/examiner-trusted-node-provisioning.md) | NFC provisioning: the examiner app as trusted node, the tap envelope, the HMAC confirmation |
| [`device-identity-nfc-bootstrap.md`](docs/device-identity-nfc-bootstrap.md) | Registering a new device with a tap |
| [`tap-gated-student-join.md`](docs/tap-gated-student-join.md) | Only the assigned student, on the tapped device, can join |
| [`examiner-phone-enrollment.md`](docs/examiner-phone-enrollment.md) | Phone client certificates and port 8443 |
| [`device-tls-psk.md`](docs/device-tls-psk.md) | TLS-PSK between PIE devices and the server |
| [`exam-app-tls.md`](docs/exam-app-tls.md) | How the exam app trusts the deployment's CA |
| [`device-provisioning-secret-registration.md`](docs/device-provisioning-secret-registration.md) | Earlier provisioning-secret design, kept for reference |

## Production notes

- **Published ports.** Besides 3000, 8000, 8443 and 8444, the compose file
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
  [`docs/deployment.md`](docs/deployment.md).

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
