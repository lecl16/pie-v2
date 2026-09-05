# ExaminerApp

React Native (Android-only) app the examiner uses to provision an exam
device over NFC. The phone emulates an NFC card via Host Card Emulation
(HCE) and the device runs a reader (`../reader_script.py`) with a PN532
module. This is **not** a plain data dump — it's a challenge-response
scheme that proves the tap came from whoever holds a shared secret, binds
the response to that specific tap, and rejects replays. See
`../memo.md` for the design history behind this scheme.

## Protocol

AID: `F045584D41505031`

Supported APDU commands (`ExamHceService.kt` on the phone,
`reader_script.py` on the device):

- `SELECT AID` (INS `A4`)
- `SET_READER_CHALLENGE` (INS `CB`) — device sends a random 16-byte
  challenge
- `GET_PROVISION_TOKEN` (INS `CC`) — phone returns a signed token

Tap flow:

1. Device (`reader_script.py`) sends `SELECT AID`, then
   `SET_READER_CHALLENGE` with a fresh random challenge.
2. Phone (`ExamHceService.kt`) builds a token —
   `{v, jti, exp, ch, sid, nm, ts}` (schema version, single-use token id,
   expiry, echoed challenge, session id, nmec, timestamp) — and returns it
   HMAC-SHA256-signed over its own JSON via `GET_PROVISION_TOKEN`:
   `{ "t": <token>, "m": "<base64url MAC>" }`. The signing key is the
   shared secret; it and the signing itself never leave native code.
3. Device verifies the MAC, schema version, that the echoed challenge
   matches, that the token hasn't expired, and that its `jti` hasn't been
   used before (`used_token_ids.json`, survives restarts) — rejecting
   replays.

The device only accepts a tap during an explicitly armed window (hard
lock mode) — see "Arm the reader" below.

## Shared secret

There's no server-mediated exchange yet: `reader_script.py` generates a
random secret on first run, persists it to `provision_secret.txt`, and
prints it to the terminal for the examiner to copy into the app's
**Shared Secret** field by hand. A design for replacing this with an
authenticated fetch through `pie-api-main` (so the secret never needs
manual transcription, and is scoped to one session instead of the
device's whole lifetime) exists at
`../../pie-api-main/docs/device-provisioning-secret-registration.md`
(design only, not implemented).

## Requirements

- Android phone with NFC and HCE support
- USB debugging enabled
- PN532 module connected to the exam device (Raspberry Pi or another
  reader host)
- Python 3 + `nfcpy` on the reader host

## Arm the reader

The device only accepts a tap during an explicitly armed window — run
this on the device before tapping:

```bash
python3 reader_script.py --arm --window-seconds 60   # default 60, max 300
python3 reader_script.py --status                    # check remaining time
python3 reader_script.py --clear-window               # lock immediately
```

Then start the reader loop (this also prints the shared secret if it
doesn't exist yet):

```bash
python3 reader_script.py
```

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

1. Arm the reader on the device (see above).
2. Open ExaminerApp.
3. Paste the **Shared Secret** printed by `reader_script.py`.
4. Fill in **Session ID**, **Student ID (NMec)**, and **Timestamp**
   (optional: tap **Use Current Time**), and **Token TTL** (seconds,
   10-600).
5. Tap **Activate** to enable secure provisioning.
6. Tap the phone to the PN532 reader — it will send
   `SET_READER_CHALLENGE` then `GET_PROVISION_TOKEN`.
7. Tap **Deactivate** when done. The reader consumes the provisioning
   window on a successful tap, so a new `--arm` is needed for the next
   device.

## Android NFC files

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/apduservice.xml`
- `android/app/src/main/java/com/examinerapp/ExamHceService.kt`
- `android/app/src/main/java/com/examinerapp/NfcHceModule.kt`
- `android/app/src/main/java/com/examinerapp/NfcHcePackage.kt`
