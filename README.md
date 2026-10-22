# PIE — Portable Isolated Environment

PIE runs digital exams on students' own laptops without trusting the
laptop's installed system. Each seat has a small **PIE device** (a Raspberry
Pi Zero 2 W with an NFC reader). Plugged into the laptop's USB port, the
device presents a read-only exam operating system that the laptop boots
from. The device is also the laptop's only network connection. The
examiner assigns each device to an exam session and a student with a tap of
an Android phone, and follows the exam live from a web dashboard.

PIE is designed to be self-hosted and run by a single examiner: one server
machine, the examiner's phone, and one PIE device per seat. No
infrastructure is needed in the exam room beyond a Wi-Fi network.

## Components

| Directory | What it is | Runs on |
|---|---|---|
| [`pie-api-main`](pie-api-main/README.md) | Backend API (FastAPI) with MySQL, Redis, Elasticsearch, ClamAV, and Caddy for TLS | The server machine (Docker Compose) |
| [`WebApp-main`](WebApp-main/README.md) | Teacher and admin dashboard (Next.js): courses, exams, sessions, live monitoring, analytics | The server machine (in the same Docker Compose stack), used from a browser |
| [`NFC-Support/ExaminerApp`](NFC-Support/ExaminerApp/README.md) | Examiner app (React Native, Android): registers devices and provisions them for a session over NFC | The examiner's Android phone |
| [`NFC-Support`](NFC-Support/README.md) | The PIE device's own services: NFC reader, identity service for the exam host | Each PIE device (Raspberry Pi OS) |
| [`DevApp-main`](DevApp-main/README.md) | Exam app (Flutter, Linux): student login, the exam, logs, submission | Each laptop, inside the exam OS |
| [`device-build`](device-build/README.md) | Builds the exam OS image, and sets up each PIE device | A build machine (Docker), then each device's SD card |

```
                   exam room Wi-Fi
   ┌────────────┐ ───────────────────────────── ┌──────────────────────────────┐
   │ PIE device │  TLS-PSK :8444                │ Server                       │
   │ (Pi + NFC) │ ◀───────────────────────────▶ │  Caddy :3000 / :8000 / :8443 │
   └─────┬──────┘                               │  API, device API :8444       │
     USB │ exam OS image + network              │  MySQL, Redis, ES, ClamAV    │
   ┌─────┴──────┐  HTTPS :8000 (via the device) │                              │
   │  Laptop    │ ────────────────────────────▶ │                              │
   │ (exam OS,  │                               └──────────────────────────────┘
   │  exam app) │                                  ▲ HTTPS :8443    ▲ HTTPS :3000
   └────────────┘                                  │ (client cert)  │
        ▲ NFC tap (to the device's reader)    ┌────┴─────────┐  ┌───┴───────┐
        └──────────────────────────────────── │ Examiner app │  │ Dashboard │
                                              └──────────────┘  └───────────┘
```

## Deployment order

1. **Server and dashboard.** Set up `pie-api-main`: `./scripts/setup.sh`,
   then `docker compose up -d --build`, then create the first admin account.
   This also builds and starts the dashboard, at `https://<server>:3000`.
   See [`pie-api-main/README.md`](pie-api-main/README.md).
2. **Trust.** Install the deployment's CA certificate
   (`pie-api-main/certs/ca.crt`) on the examiner's phone and in the browser
   used for the dashboard.
3. **Examiner app.** Build the APK and install it on the examiner's phone.
   Log in once to enroll the phone.
4. **Exam OS image.** Build the exam app bundle, then the ISO (`device-build`).
5. **PIE devices.** For each device: flash Raspberry Pi OS, copy the ISO
   and the boot configuration, run the two setup scripts, then boot it once
   with network access.
6. **Register each device** with a tap of the examiner app ("Provision New
   Device"). This is done once per device.

## Running an exam

1. In the dashboard: create the course, the exam and a session. Set the
   allowed links and, optionally, the allowed students' emails.
2. Plug a PIE device into each laptop and boot the laptop from it. The exam
   app waits for the examiner ("A aguardar o examinador").
3. At each seat, check the student's card. In the examiner app, pick the
   session and the student, enter the device ID, and tap the phone on the
   device.
4. The student logs in with their own account and enters the session's join
   code. Only the assigned student can join on that device.
5. Follow the session from the dashboard. When the student submits, the exam
   app shows "Exame Terminado", and **Fechar** turns the laptop off.

Shut laptops down from the exam OS, not with the power button: a forced
power-off can leave the PIE device's NFC reader stuck until the device is
unplugged (see `device-build/README.md`, "Operations").

## Security model, in short

- **Provisioning.** The examiner's phone is the trusted node. Each tap is
  encrypted (ECDH P-256 and AES-256-GCM, to a fresh key per tap). The device
  only accepts a session after confirming it with the server by mutual HMAC.
- **Transport.** All three links use TLS:
  - phone and browser to server (API and dashboard): a certificate from the
    deployment's private CA; phones also present a client certificate, one
    per phone;
  - device to server: TLS with a per-device pre-shared key;
  - exam app to server: trusts only the deployment's CA, which the device
    relays.
- **Join.** The server accepts a join only from the device the examiner
  tapped for that student, proven by a key derived from the session secret.
- **Exam host.** The exam OS has no administrator account. Its only network
  is the USB link to the PIE device. Firefox goes through an intercepting
  proxy that allows only the session's links.

Each mechanism is described in the API README's
["How it works"](pie-api-main/README.md#how-it-works) section. The known
limitations of each component are listed in its README.
