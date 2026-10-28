# PIE — Device Services (NFC-Support)

Software that runs on each **PIE device**: a Raspberry Pi Zero 2 W with a
PN532 NFC reader, plugged into an exam laptop over USB. The Examiner App,
the phone side of the NFC protocol, is in [`ExaminerApp/`](ExaminerApp/README.md).

| File | Runs as | Role |
|---|---|---|
| `reader_script.py` | `nfc-reader.service` (root) | Reads the examiner's taps through the PN532: the registration tap first, then session taps |
| `device_identity_server.py` | `pie-device-identity.service` | Serves the device's identity, the server's CA and the provisioned session to the exam laptop, over the USB link |
| `pie_tls.py` | (library) | TLS with the device's pre-shared key to the server's device port, 8444 |
| `pie_filter.py` | `pie-proxy.service` (user `pie-proxy`), a mitmproxy add-on | Filters the exam laptop's web traffic: the session's allowlist, and the eLearning account (see [Filtering proxy](#filtering-proxy)) |

They are installed on the Pi by `device-build/aux-files/install-nfc-reader.sh`
into `/opt/nfc-reader/`. See [`device-build/README.md`](../device-build/README.md)
for the full setup of a device. They need **Python 3.13 or later**
(Raspberry Pi OS Trixie), for TLS-PSK in `ssl`.

## What the device does

1. **Registration (once per device).** Until `/etc/pie/device.json` exists,
   the reader waits for a registration tap from the Examiner App ("Provision
   New Device"). The tap carries the device ID, the device API key, the
   server's address and, if set in the app, the exam room's Wi-Fi. The
   reader saves them, joins that network, and restarts into the normal
   loop. See `pie-api-main/README.md`, "Registering a PIE device".
2. **Tunnel.** `device_identity_server.py` creates the device's WireGuard key (the private key
   never leaves the device), registers the public key with the server over
   TLS-PSK (`POST /device/{d}/tunnel`), and brings up `wg0` with the
   server's answer. Only traffic to the server's tunnel address
   (`10.77.0.1`) goes through it. Registered again every hour and whenever
   the server's address changes; `wg0` is only restarted if something
   changed. Needs `wireguard-tools`.
3. **Session tap (each exam).** The examiner picks the session and the
   student and taps the device. The tap is encrypted to a fresh reader key
   (ECDH P-256, HKDF-SHA256, AES-256-GCM). The reader confirms the session
   secret with the server by mutual HMAC
   (`POST /device/{d}/provisioning-secret/{s}/confirm`, port 8444). Only
   then does it save the session in `/etc/pie/session.json`. If the tap
   carries a Wi-Fi network, the reader joins it before the confirmation,
   and goes back to the previous network if the confirmation fails, so a
   tap the server doesn't confirm can't move the device to another
   network. The network is kept in NetworkManager's `ExamWiFi` profile. Nothing needs
   to be done on the device itself. See
   `pie-api-main/README.md`, "Session provisioning".
4. **Exam laptop.** The exam app polls this device over the USB link:
   - `GET /device-identity`: device ID, the server's address **inside the
     tunnel** (`http://10.77.0.1:8001`; the tunnel protects the traffic).
     Answers 404 until the device is registered, and 503 until the tunnel
     is ready.
     The exam app reaches the server only through this device, which is how
     the server knows the device behind its requests.
   - `GET /session`: the provisioned session, the assigned student (number
     and name). Answers 404 until a session tap. No secret leaves the
     device.
5. **End of session.** Every 30 s, the identity service asks the server
   whether the session is still active, and deletes `session.json` once it
   has ended.

## Files on the device

| Path | Contents | Mode |
|---|---|---|
| `/etc/pie/device.json` | `deviceId`, `deviceApiKey`, `apiBaseUrl` | 0600 |
| `/etc/pie/session.json` | The provisioned session, its secret and the assigned student | 0600 |
| `/etc/pie/wg.key` | The device's WireGuard private key; never leaves the device | 0600 |
| `/etc/wireguard/wg0.conf` | The tunnel to the server (`wg-quick@wg0`), written by the identity service | 0600 |
| `/etc/pie/tunnel.json` | The tunnel's address, the API's address inside it, and the `apiBaseUrl` it was set up for | 0644 |
| `/etc/pie/filter.json` | The session's allowed links and the assigned student's NMEC, for the proxy; written by the identity service, absent without a session | 0640, group `pie-proxy` |
| `/var/lib/pie-proxy/` | The proxy's CA (created on its first start), served to the exam OS | `pie-proxy` |

**To return a device to "unregistered"**, delete `device.json` (and
`session.json`), restart `nfc-reader`, and delete the device in the
dashboard or the API.

## Filtering proxy

The exam laptop's web traffic (TCP 80 and 443, except to the server's
tunnel address) is redirected by the device's nftables rules to
`pie-proxy.service`: mitmproxy in transparent mode, running as its own user
with `pie_filter.py`. Nothing else from the laptop reaches the Wi-Fi: the
proxy makes the connections itself. So the filtering applies whatever
system the laptop boots, and the exam OS has no rules of its own; it only
trusts the proxy's CA, which it fetches at boot (`GET /proxy-ca`).

- **Allowlist:** the session's allowed links, and the exam's link when the
  exam is a web page, from the server's answer about the session (the
  identity service writes them to `filter.json`, within seconds of a tap
  and then every 30 s). An entry allows everything under it; an entry with
  a query string allows that page only; files that an allowed page loads
  are allowed from any host; UA's login hosts are always allowed. Without
  a session, only the login hosts.
- **eLearning account:** every page of `elearning.ua.pt` shows the
  logged-in user as "Name NMEC" in its user menu
  (`<span class="usertext …">`). A page for an account whose NMEC isn't
  the assigned student's is replaced by a "Conta não permitida" page, and
  the proxy logs `Blocked eLearning page for account NMEC …`.

## Network exposure

`device_identity_server.py` binds `0.0.0.0:8100`, and the proxy `8080`. The
device's nftables rules allow both only from `usb0`, the exam laptop's
link, and drop everything not listed. See
`device-build/aux-files/apply-pi-gateway-setup.sh`.

## Logs

```bash
journalctl -u nfc-reader -f
journalctl -u pie-device-identity -f
journalctl -u pie-proxy -f
```

| Log line | Meaning |
|---|---|
| `PN532 firmware v1.6 detected` then `Waiting for examiner phone...` | Ready for a session tap |
| `Provisioned exam session:` followed by the session | Tap confirmed by the server |
| `Server rejected provisioning secret: HTTP …` | The server refused the tap (expired, unknown or already used secret) |
| `No I2C device at address: 0x24`, `Errno 110` | The PN532 isn't answering: power the device off and unplug it (see `device-build/README.md`, "Operations") |
| `Session N is no longer active; removed /etc/pie/session.json` | The session ended |
| `Filter updated: N allowed links, assigned NMEC …` | The proxy's allowlist for the session (identity service) |
| `Blocked page: URL` / `Blocked redirect: URL -> URL` | A page, or a redirect to a page, not on the allowlist (proxy) |
| `Blocked eLearning page for account NMEC X (assigned: Y)` | The student logged in to eLearning with an account that isn't theirs (proxy) |

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
