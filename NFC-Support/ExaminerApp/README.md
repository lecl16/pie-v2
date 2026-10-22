# PIE — Examiner App

React Native app (Android only) that the examiner uses to register PIE
devices and provision them for an exam session over NFC. The phone emulates
an NFC card with Host Card Emulation (HCE); the PIE device's PN532 reader
talks to it (`../reader_script.py`, see [`../README.md`](../README.md)).

The app is the **trusted node** of the provisioning scheme: it logs in to
`pie-api-main` as a teacher, creates the secrets and identities, gives them
to the server over the API, and to the device in the NFC tap. It does two
jobs:

- **Claim a new device** — gives an unclaimed Pi its `deviceId`, device API
  key and the server's `apiBaseUrl`. Once per device. See
  `../../pie-api-main/docs/device-identity-nfc-bootstrap.md`.
- **Provision a session** — gives a claimed Pi a session-scoped secret (plus
  session id, student NMec and the current `apiBaseUrl`), which the Pi then
  confirms with the server before accepting. See
  `../../pie-api-main/docs/examiner-trusted-node-provisioning.md`.

No server address is baked into the app or the exam image: the examiner
types it into the app, and the taps carry it to the Pi. See `../memo.md` for
the design history.

## Protocol

AID: `F045584D41505031`

APDU commands (`ExamHceService.kt` on the phone, `reader_script.py` on the
device):

| INS | Command | Purpose |
|---|---|---|
| `A4` | `SELECT AID` | Select this app's HCE service |
| `CB` | `SET_READER_CHALLENGE` | Reader sends a fresh per-tap P-256 public key (65 bytes, uncompressed) |
| `CC` | `GET_PROVISION_TOKEN` | Phone returns the encrypted session payload |
| `CD` | `GET_DEVICE_IDENTITY` | Phone returns the encrypted device identity (claim tap) |
| `C0` | `GET RESPONSE` | Fetches the rest of a response longer than 240 bytes (ISO 7816-4 `61xx` chaining) |

Any other instruction, including commands of earlier protocol versions such
as the unencrypted `GET_EXAM_DATA` (`CA`), is answered with `6D00` (wrong
instruction).

Both `CC` and `CD` answer with an ECDH P-256 + HKDF-SHA256 + AES-256-GCM
envelope encrypted to the reader's per-tap key (`NfcCrypto.kt` /
`decrypt_envelope()`; layout in section 3 of
`examiner-trusted-node-provisioning.md`). The INS byte is the AAD, so a
claim envelope can't be replayed as a session envelope or vice versa.

Payloads:

- **Claim** (`CD`): `{deviceId, apiKey, apiBaseUrl}`. Single-use on the
  phone — cleared as soon as it's served, whether or not the reader accepts
  it.
- **Session** (`CC`): `{v: 2, sid, nm, k, u, exp}` — session id, NMec, the
  base64url session secret, `apiBaseUrl`, and an expiry 60 s after the tap.

After a session tap the Pi calls
`POST /device/{deviceId}/provisioning-secret/{sessionId}/confirm` with an
HMAC proof of the secret and checks the server's HMAC answer — this is what
proves the tap came from a phone the server trusts and that `apiBaseUrl`
really is that server. Replay protection comes from the per-tap reader key
and the single-use server confirmation.

## Requirements

- Android phone with NFC and HCE support (not an emulator; not iOS)
- USB debugging enabled, for installing the app
- A running `pie-api-main` reachable from the phone, and a teacher/admin
  account on it
- A Pi set up per `../../device-build/README.md` (PN532 over I2C,
  `nfc-reader.service` running `reader_script.py`)

- The deployment's CA certificate (`pie-api-main/certs/ca.crt`, see
  `../../pie-api-main/README.md`) installed on the phone once: copy it to
  the phone, then Settings → Security → Encryption & credentials → Install a
  certificate → CA certificate.

The app talks to the API over HTTPS only. The login refuses `http://` URLs,
and `res/xml/network_security_config.xml` forbids cleartext traffic and
trusts user-installed CAs besides the system ones, so the deployment's own
CA is accepted. The debug build (`src/debug/res/xml/`) also allows plain
HTTP to `localhost`, `127.0.0.1` and `10.0.2.2`, for the Metro bundler.

## Build and install

```bash
npm install
```

**Release build** (what examiners use). With the phone connected over USB
debugging, this builds, installs and launches it:

```bash
npm run android
```

To only produce the APK, for installing by other means:

```bash
cd android && ./gradlew assembleRelease
# android/app/build/outputs/apk/release/app-release.apk
```

See [Release signing](#release-signing) before distributing it.

**Debug build** (development, with Fast Refresh). Keep Metro running and
reachable from the phone:

```bash
npm start                         # Metro, in its own terminal
adb reverse tcp:8081 tcp:8081
npm run android:dev
```

## Release signing

`android/app/build.gradle` signs the **release** build with the debug
keystore (`android/app/debug.keystore`, the React Native template's
default). That is enough to install the APK by hand, but anyone can sign an
APK with the same public key. Before distributing the app, create your own
keystore and point `signingConfigs.release` at it, kept out of the
repository (see <https://reactnative.dev/docs/signed-apk-android>). An app
signed with a different key can't be installed over the old one: uninstall
it first, then log in again; the phone re-enrolls with a new key.

## Use the app

### Log in

1. Enter the **PIE API Server URL** (e.g. `https://192.168.1.50:8000`) — the
   address the Pi will also use, so it must be reachable from the exam
   room's network, not just from the phone.
2. Enter a teacher/admin **Email** and **Password** and log in.
3. On the first login the app **enrolls the phone**: it creates a key in the
   Android Keystore and gets a client certificate for it from the server.
   Device creation and session provisioning then go to the server's phone
   port (`8443`) with that certificate. The status box shows "This phone is
   enrolled as phone-N"; until then those actions are disabled. If the
   server rejects the phone (revoked, enrolled by another teacher, or
   enrolled with another server), use **Re-enroll This Phone**. See
   `../../pie-api-main/docs/examiner-phone-enrollment.md`.

### Claim a new device (once per Pi)

A freshly set-up Pi has no `/etc/pie/device.json`, so its reader runs a
claim listener.

1. Under **Provision New Device**, enter a **Device Name** (e.g.
   `Sala 101 - PC03`) and tap **Create & Hold for Tap**. This calls
   `POST /device/create` and holds the returned identity on the phone.
2. Tap the phone against the Pi's reader. The Pi writes
   `/etc/pie/device.json` and restarts into the normal session reader loop.
3. **Cancel** discards a held identity that hasn't been tapped yet.

### Provision a session

Nothing is needed on the Pi: it accepts the tap, and the server's
confirmation decides whether the session is applied.

1. Under **Session**, pick the session from the list of open sessions
   (course · exam · session, with room and date). This fills the course,
   exam and session IDs; **Change Session** goes back to the list, and
   **Enter IDs Manually** is the fallback.
2. Check the student's card. Under **Seat**, type the **Device ID** from the
   device's label and pick the student: search the session's allowed
   students by name, NMEC or email (each row shows the device the student is
   already assigned to, if any). For a session without an allowed-students
   list, type the NMEC instead. Then tap **Generate Secret & Activate**.
   The app generates a secret in native code and
   registers it, with the NMEC, via
   `POST /course/{c}/{e}/{s}/device/{d}/provisioning-secret` (valid 5
   minutes). Only that student can then join the session on this device
   (`../../pie-api-main/docs/tap-gated-student-join.md`); to fix a wrong
   NMEC, register and tap again before the student joins. While a
   student is taking an exam on that device (joined, not finished, session
   not ended), the server refuses a registration for another student or
   session with HTTP 409 "Device in use".
3. Tap the phone against the Pi's reader. The Pi decrypts the payload,
   confirms it with the server, saves it to `/etc/pie/session.json` and
   updates `apiBaseUrl` in `/etc/pie/device.json`.
4. Tap **Deactivate Secure Provisioning** when done. This also deletes the
   registered secret on the server (best effort) if it wasn't used, and
   clears the device and student for the next seat; the session stays
   selected.

## Troubleshooting

| What the app shows | Cause | What to do |
|---|---|---|
| Login fails with a network or certificate error | The phone doesn't trust the deployment's CA, or the address is wrong | Install `ca.crt` (see Requirements); check the address opens `/docs` in Chrome on the phone |
| `Phone not accepted (HTTP 403): … Phone enrolled by another user` | Another teacher enrolled this phone | Log in as the new teacher and tap **Re-enroll This Phone** |
| `… Phone certificate revoked` or `… expired` | The phone was revoked, or its certificate expired | **Re-enroll This Phone** |
| `The server refused this phone's certificate (enrolled with another server?)` | The phone's certificate is from another deployment, or the server's phone CA changed | **Re-enroll This Phone** |
| `HTTP 409 Device in use: student X is taking session Y` | A student joined on this device and hasn't finished, and that session hasn't ended | End that session in the dashboard (or let the student finish); re-tapping for the same session and student is allowed |
| `HTTP 400 Student not allowed in session` | The student's email isn't in the session's allowed students | Add it in the dashboard (**Edit Session**) |
| `HTTP 404 Student not found` | No account with that NMEC, or it isn't a `student` account | Check the account |
| The tap does nothing | The PIE device's reader isn't running, or its PN532 is stuck | See `device-build/README.md`, "Operations" |

## Android NFC files

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/apduservice.xml`
- `android/app/src/main/res/xml/network_security_config.xml`
- `android/app/src/main/java/com/examinerapp/ExamHceService.kt` — APDU handling
- `android/app/src/main/java/com/examinerapp/NfcCrypto.kt` — envelope encryption
- `android/app/src/main/java/com/examinerapp/NfcHceModule.kt` — React Native bridge
- `android/app/src/main/java/com/examinerapp/NfcHcePackage.kt`
