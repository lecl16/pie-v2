# ExaminerApp

React Native Android app that sends a plain exam payload to a PN532 reader over NFC using Host Card Emulation (HCE).

## What It Sends

The app sends exactly these fields as JSON:

- ip
- sessionId
- nmec
- timestamp

Example payload:

```json
{
  "ip": "192.168.1.10",
  "sessionId": "S2026-001",
  "nmec": "123456",
  "timestamp": "2026-04-06T14:20:00.000Z"
}
```

## Protocol

The phone emulates an NFC card with AID `F045584D41505031`.

Supported APDU commands:

- `SELECT AID` (INS `A4`)
- `GET_EXAM_DATA` (INS `CA`) -> returns JSON payload + `9000`

## Requirements

- Android phone with NFC and HCE support
- USB debugging enabled
- PN532 module connected to Raspberry Pi (or another reader host)
- Python 3 + `nfcpy` on the reader host

## Run The App

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

4. If you want to run the debug build instead, use this command and keep Metro reachable from the device:

```bash
npm run android:dev
```

5. Keep Metro reachable from device when using the debug build:

```bash
adb reverse tcp:8081 tcp:8081
```

## Use The App

1. Open ExaminerApp.
2. Fill in `IP`, `Session ID`, `NMec`, and `timestamp`.
3. Optional: tap **Use Current Time**.
4. Tap **Activate NFC Sender**.
5. Tap phone to the PN532 reader.
6. PN532 should send `SELECT AID` and then `GET_EXAM_DATA`.
7. Tap **Deactivate NFC Sender** when done.

<!-- ## Reader Script

A simple PN532 reader script is provided in `reader_phase1.py`.

Run:

```bash
python reader_phase1.py
```

<!-- ## Android NFC Files

- `android/app/src/main/AndroidManifest.xml`
- `android/app/src/main/res/xml/apduservice.xml`
- `android/app/src/main/java/com/examinerapp/ExamHceService.kt`
- `android/app/src/main/java/com/examinerapp/NfcHceModule.kt`
- `android/app/src/main/java/com/examinerapp/NfcHcePackage.kt` -->
