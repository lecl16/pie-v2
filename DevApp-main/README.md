# PIE — Exam App

Flutter desktop app (Linux) that students use during a PIE exam. It runs
inside the exam OS, which the laptop boots from its PIE device, as the
system service `devapp.service` (user `student`). It covers the exam from
login to submission:

1. **Waits for the device.** It gets the device's identity, the server's
   address and the deployment's CA from the PIE device over the USB link
   (`GET http://192.168.7.2:8100/device-identity`). Until the device has been
   registered, it shows "Dispositivo não provisionado".
2. **Waits for the examiner.** The examiner checks the student's card and
   taps the phone on the device. The app then gets the session, the
   assigned student and a join key (`GET …/session`). Until then it shows
   "A aguardar o examinador".
3. **Login.** The student logs in with their own account, then enters the
   session's join code. The server accepts the join only from this device,
   for the student the examiner assigned to it. The proof is an HMAC with
   the join key, sent with the request.
4. **Exam.**
   - **The exam:** either a file (downloaded, decrypted and unpacked into
     `~/Desktop/Exam`) or a link, opened in Firefox.
   - **Firefox:** the session's allowed links are written to the proxy's
     whitelist (`/etc/iptables/whitelist.txt`), so only those sites open.
   - **Control:** the teacher's start, extra time and finish messages arrive
     over the server's pub/sub channel.
5. **Monitoring.** Activity logs are sent to the server throughout the exam,
   including USB devices plugged in.
6. **Submission.** The exam folder is uploaded when the student submits or
   the time runs out. **Fechar** on the "Exame Terminado" screen turns the
   laptop off.

The UI is in Portuguese.

## Security

- **API calls** go to the address the PIE device relayed, over HTTPS only.
  Trust is limited to the deployment's CA, which the device also relays
  (`SecurityContext(withTrustedRoots: false)`, `Config.api`). Public CAs are
  not trusted, and there is no plain-HTTP fallback.
  See `pie-api-main/README.md`, "How the exam app trusts the server".
- **Nothing deployment-specific is built in.** The device ID, the server
  address, the CA and the session are fetched at every boot and kept in
  memory only. The exam OS is a live system with no persistence.

## Configuration

`/etc/pie-devapp/config.json` in the exam OS, from
`device-build/pie-system-image-main/config/includes.chroot/etc/pie-devapp/config.json`:

| Key | Default | Meaning |
|---|---|---|
| `piIdentityUrl` | `http://192.168.7.2:8100` | The PIE device's identity service, over the USB link |
| `examDirectory` | `/home/student/Desktop/Exam` | Where the exam file is unpacked, and what is submitted |
| `whitelistFile` | `/etc/iptables/whitelist.txt` | The proxy's whitelist, written when the student joins |
| `logsDirectory` | `/var/log/pie-devapp` | Local logs |

## Build

Requirements: Flutter (Dart SDK 3.6 or later) with Linux desktop support,
on an x86-64 Linux machine.

```bash
flutter pub get
flutter build linux --release
```

The exam OS image ships the release bundle in `/opt/devapp`. To put a new
build in the image, replace the bundle in the image configuration, then
rebuild the ISO (see `device-build/README.md`):

```bash
rm -rf ../device-build/pie-system-image-main/config/includes.chroot/opt/devapp/*
cp -r build/linux/x64/release/bundle/* ../device-build/pie-system-image-main/config/includes.chroot/opt/devapp/
```

## Development

`flutter run -d linux` works on a development machine with a PIE device
attached over USB (the laptop needs the address 192.168.7.1 on that link).
Alternatively, serve `/device-identity` and `/session` at `piIdentityUrl`
yourself. Without either, the app stays on its waiting screens.

```bash
flutter analyze
```

`test/widget_test.dart` is Flutter's template test and does not test this
app.
