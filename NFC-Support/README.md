# PIE — Device Services (NFC-Support)

Software that runs on each **PIE device**: a Raspberry Pi Zero 2 W with a
PN532 NFC reader, plugged into an exam laptop over USB. The Examiner App,
the phone side of the NFC protocol, is in [`ExaminerApp/`](ExaminerApp/README.md).

| File | Runs as | Role |
|---|---|---|
| `reader_script.py` | `nfc-reader.service` (root) | Reads the examiner's taps through the PN532: the registration tap first, then session taps |
| `device_identity_server.py` | `pie-device-identity.service` | Serves the device's identity, the server's CA and the provisioned session to the exam laptop, over the USB link |
| `pie_tls.py` | (library) | TLS with the device's pre-shared key to the server's device port, 8444 |

They are installed on the Pi by `device-build/aux-files/install-nfc-reader.sh`
into `/opt/nfc-reader/`. See [`device-build/README.md`](../device-build/README.md)
for the full setup of a device. They need **Python 3.13 or later**
(Raspberry Pi OS Trixie), for TLS-PSK in `ssl`.

## What the device does

1. **Registration (once per device).** Until `/etc/pie/device.json` exists,
   the reader waits for a registration tap from the Examiner App ("Provision
   New Device"). The tap carries the device ID, the device API key and the
   server's address. The reader saves them and restarts into the normal
   loop. See `pie-api-main/README.md`, "Registering a PIE device".
2. **CA.** `device_identity_server.py` fetches the deployment's CA from the
   server over TLS-PSK and caches it in `/etc/pie/server-ca.json`. It
   refetches every hour, and whenever the server's address changes.
3. **Session tap (each exam).** The examiner picks the session and the
   student and taps the device. The tap is encrypted to a fresh reader key
   (ECDH P-256, HKDF-SHA256, AES-256-GCM). The reader confirms the session
   secret with the server by mutual HMAC
   (`POST /device/{d}/provisioning-secret/{s}/confirm`, port 8444). Only
   then does it save the session in `/etc/pie/session.json`. Nothing needs
   to be done on the device itself. See
   `pie-api-main/README.md`, "Session provisioning".
4. **Exam laptop.** The exam app polls this device over the USB link:
   - `GET /device-identity`: device ID, server address and CA. Answers 404
     until the device is registered, and 503 until the CA is available.
   - `GET /session`: the provisioned session, the assigned student (number
     and name) and the join key. Answers 404 until a session tap.
5. **End of session.** Every 30 s, the identity service asks the server
   whether the session is still active, and deletes `session.json` once it
   has ended.

## Files on the device

| Path | Contents | Mode |
|---|---|---|
| `/etc/pie/device.json` | `deviceId`, `deviceApiKey`, `apiBaseUrl` | 0600 |
| `/etc/pie/session.json` | The provisioned session, its secret and the assigned student | 0600 |
| `/etc/pie/server-ca.json` | The deployment's CA, and the `apiBaseUrl` it was fetched for | 0644 |

**To return a device to "unregistered"**, delete `device.json` (and
`session.json`), restart `nfc-reader`, and delete the device in the
dashboard or the API.

## Network exposure

`device_identity_server.py` binds `0.0.0.0:8100`. The device's nftables
rules allow port 8100 only from `usb0`, the exam laptop's link, and drop
everything not listed. See `device-build/aux-files/apply-pi-gateway-setup.sh`.

## Logs

```bash
journalctl -u nfc-reader -f
journalctl -u pie-device-identity -f
```

| Log line | Meaning |
|---|---|
| `PN532 firmware v1.6 detected` then `Waiting for examiner phone...` | Ready for a session tap |
| `Provisioned exam session:` followed by the session | Tap confirmed by the server |
| `Server rejected provisioning secret: HTTP …` | The server refused the tap (expired, unknown or already used secret) |
| `No I2C device at address: 0x24`, `Errno 110` | The PN532 isn't answering: power the device off and unplug it (see `device-build/README.md`, "Operations") |
| `Session N is no longer active; removed /etc/pie/session.json` | The session ended |

## Other files

- `memo.md`: the design history of the NFC protocol, in Portuguese.
- `nfc-provisioning-readme.md`: an early design proposal, superseded by the
  implemented protocol. Kept for reference only.

## Development

```bash
python3 -m venv venv && source venv/bin/activate
pip install adafruit-circuitpython-pn532 adafruit-blinka cryptography
sudo venv/bin/python reader_script.py
```

This needs a PN532 on the Pi's I2C bus (`dtparam=i2c_arm=on`). Do not load
the kernel's `pn532_i2c` driver; see `device-build/README.md`, "Notes". The
scripts are copied to the device, not linked: after editing them, run
`install-nfc-reader.sh` again, or copy them to `/opt/nfc-reader/` and restart
both services.
