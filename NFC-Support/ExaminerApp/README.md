# ExaminerApp

React Native (Android-only) app the examiner uses to provision exam devices
over NFC. The phone emulates an NFC card via Host Card Emulation (HCE); the
device side is a Raspberry Pi running `../reader_script.py` against a PN532
module over I2C.

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

## Run the app

1. Install dependencies:

```bash
npm install
```

2. Start Metro only if you want the debug build with Fast Refresh:

```bash
npm start
```

3. Build/install a standalone Android release on the device:

```bash
npm run android
```

   This requires a connected device/emulator (it builds, installs, and
   launches). To just produce the `.apk` without one:

   ```bash
   cd android && ./gradlew assembleRelease
   ```

   Output: `android/app/build/outputs/apk/release/app-release.apk` (use
   `assembleDebug` for a debug build instead, output under `.../apk/debug/`).

4. If you want to run the debug build instead, use this command and keep
   Metro reachable from the device:

```bash
npm run android:dev
```

5. Keep Metro reachable from device when using the debug build:

```bash
adb reverse tcp:8081 tcp:8081
```

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
claim listener; no `--arm` is needed for this tap.

1. Under **Provision New Device**, enter a **Device Name** (e.g.
   `Sala 101 - PC03`) and tap **Create & Hold for Tap**. This calls
   `POST /device/create` and holds the returned identity on the phone.
2. Tap the phone against the Pi's reader. The Pi writes
   `/etc/pie/device.json` and restarts into the normal session reader loop.
3. **Cancel** discards a held identity that hasn't been tapped yet.

### Provision a session

1. On the Pi, open the hard-lock window (session taps are rejected
   otherwise):

   ```bash
   sudo /opt/nfc-reader/venv/bin/python /opt/nfc-reader/reader_script.py --arm   # default 60 s, max 300 (--window-seconds)
   ```

   `--status` shows the remaining time, `--clear-window` locks immediately.
2. Check the student's card. In the app, fill **Course ID**, **Exam ID**,
   **Session ID**, **Device ID** and **Student NMEC**, then tap **Generate
   Secret & Activate**. The app generates a secret in native code and
   registers it, with the NMEC, via
   `POST /course/{c}/{e}/{s}/device/{d}/provisioning-secret` (valid 5
   minutes). Only that student can then join the session on this device
   (`../../pie-api-main/docs/tap-gated-student-join.md`); to fix a wrong
   NMEC, register and tap again before the student joins.
3. Tap the phone against the Pi's reader. The Pi decrypts the payload,
   confirms it with the server, saves it to `/etc/pie/session.json` and
   updates `apiBaseUrl` in `/etc/pie/device.json`. A successful tap consumes
   the window, so the next device needs a new `--arm`.
4. Tap **Deactivate Secure Provisioning** when done. This also deletes the
   registered secret on the server (best effort) if it wasn't used.

## Android NFC files

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/apduservice.xml`
- `android/app/src/main/res/xml/network_security_config.xml`
- `android/app/src/main/java/com/examinerapp/ExamHceService.kt` — APDU handling
- `android/app/src/main/java/com/examinerapp/NfcCrypto.kt` — envelope encryption
- `android/app/src/main/java/com/examinerapp/NfcHceModule.kt` — React Native bridge
- `android/app/src/main/java/com/examinerapp/NfcHcePackage.kt`
