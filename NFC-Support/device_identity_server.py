"""Tiny stdlib-only HTTP endpoint the Pi exposes to the separate x86 host
that boots pie-system-image-main's amd64 Debian image over the g_multi USB
link (device-build/README.md — the Pi acts as a USB dongle: it serves that
image as a virtual USB drive and gives the booted host its network uplink,
it does not run the image itself).

DevApp-main runs on that host, not on this Pi — its own root filesystem is
a `boot=live` RAM overlay wiped every reboot (no persistence configured in
pie-system-image-main/Makefile), so it can never locally cache a deviceId
the way a normal file write would assume. Instead it re-fetches it from
here, over the same usb0 link already used for its network uplink, on every
boot. See pie-api-main/docs/device-identity-nfc-bootstrap.md.

It serves the API server address the same way: the amd64 image carries no
server address at all, only this Pi's fixed usb0 address. `apiBaseUrl`
arrives on the Pi through the examiner app's NFC taps (the claim tap, then
refreshed by every confirmed session tap — see
pie-api-main/docs/examiner-trusted-node-provisioning.md section 5), and
DevApp-main picks it up from here.

It also serves `GET /session` (pie-api-main/docs/tap-gated-student-join.md
section 3): the session this Pi was provisioned for by the last confirmed
tap, the student the examiner assigned to it, and a `joinKey` derived from
the session secret. DevApp-main proves possession of that key when joining,
which is what lets the server tell a join from this device apart from one
made on a student's own machine. The secret itself never leaves the Pi.

A confirmed tap stays valid until its session ends, surviving reboots in
between (tap-gated-student-join.md section 7). A background thread asks the
server every SESSION_CHECK_SECONDS whether the provisioning is still active
and deletes session.json once it isn't, which sends DevApp-main back to
"waiting for the examiner". If the server can't be reached, session.json is
kept, so a network outage mid-exam doesn't lock the student out.

Deliberately a separate process from reader_script.py rather than a thread
inside it: this server has nothing to do with NFC hardware I/O, and staying
independent means the host can still learn an already-claimed deviceId even
while the reader script is mid-restart (e.g. after Restart=always relaunches
it into normal mode right after a claim — see run_claim_listener()).
"""

import base64
import hmac
import json
import threading
import time
import urllib.error
import urllib.request
from hashlib import sha256
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# Same file reader_script.py's claim_identity() writes — this server only
# ever reads it, never writes it, so there's no coordination needed beyond
# both processes agreeing on the path.
DEVICE_CONFIG_FILE = Path("/etc/pie/device.json")
# Written by reader_script.py's apply_session_provisioning() after a
# confirmed session tap. Only ever deleted here (expire_ended_session()),
# never written.
SESSION_STATE_FILE = Path("/etc/pie/session.json")

SESSION_CHECK_SECONDS = 30

JOIN_LABEL = "pie-join-v1"

# Bound to all interfaces rather than usb0's specific address (192.168.7.2):
# usb0 may come up after this service starts (it depends on the attached
# host enumerating the gadget first), and binding to a not-yet-present
# address would fail. Who can actually reach this is scoped by the Pi's
# nftables input chain instead (`tcp dport 8100 iifname != "usb0" drop`, see
# device-build/aux-files/apply-pi-gateway-setup.sh), not by this server.
BIND_HOST = "0.0.0.0"
BIND_PORT = 8100


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64u_decode(encoded: str) -> bytes:
    return base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))


def join_key(secret: bytes, device_id: int, session_id: int) -> bytes:
    """Must match join_key() in pie-api-main/app/api/routes/device.py."""
    message = f"{JOIN_LABEL}|{device_id}|{session_id}".encode("utf-8")
    return hmac.new(secret, message, sha256).digest()


class DeviceIdentityHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/device-identity":
            self._serve_device_identity()
        elif self.path == "/session":
            self._serve_session()
        else:
            self._respond(404, {"error": "not found"})

    def _serve_device_identity(self):

        if not DEVICE_CONFIG_FILE.exists():
            # Not an error — this Pi just hasn't been claimed via an NFC
            # identity-bootstrap tap yet. DevApp-main's polling loop treats
            # this the same as a network hiccup: keep showing "device not
            # yet provisioned" and try again.
            self._respond(404, {"error": "unclaimed"})
            return

        try:
            config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
            identity = {"deviceId": config["deviceId"], "apiBaseUrl": config["apiBaseUrl"]}
        except Exception:
            self._respond(500, {"error": "device.json unreadable or malformed"})
            return

        self._respond(200, identity)

    def _serve_session(self):
        if not DEVICE_CONFIG_FILE.exists() or not SESSION_STATE_FILE.exists():
            # No confirmed session tap yet — DevApp-main keeps showing
            # "waiting for the examiner" and polls again.
            self._respond(404, {"error": "not provisioned"})
            return

        try:
            config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
            session = json.loads(SESSION_STATE_FILE.read_text(encoding="utf-8"))
            device_id = int(config["deviceId"])
            session_id = int(session["sessionId"])
            key = join_key(b64u_decode(session["secret"]), device_id, session_id)
            body = {
                "sessionId": session_id,
                "nmec": str(session["nmec"]),
                "joinKey": b64u_encode(key),
            }
        except Exception:
            self._respond(500, {"error": "session.json unreadable or malformed"})
            return

        self._respond(200, body)

    def _respond(self, status: int, body: dict):
        payload = json.dumps(body).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, format, *args):  # noqa: A002 - matches base class signature
        # Quiets BaseHTTPRequestHandler's default combined-log-format line;
        # journald already timestamps/captures whatever we print here.
        print(f"{self.address_string()} - {format % args}")


def expire_ended_session():
    """Deletes session.json if the server says the provisioning it records
    no longer lets anyone join (session ended, deleted, or the device was
    re-registered) — see pie-api-main's provisioned_session_status(). Only
    an explicit {"active": false} deletes it; any error keeps it."""
    if not DEVICE_CONFIG_FILE.exists() or not SESSION_STATE_FILE.exists():
        return
    try:
        config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
        session = json.loads(SESSION_STATE_FILE.read_text(encoding="utf-8"))
        device_id = int(config["deviceId"])
        session_id = int(session["sessionId"])
        url = f"{config['apiBaseUrl'].rstrip('/')}/device/{device_id}/session/{session_id}/status"
        request = urllib.request.Request(url, headers={"X-Device-Key": config["deviceApiKey"]})
        with urllib.request.urlopen(request, timeout=5) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, KeyError, urllib.error.URLError) as exc:
        print(f"Session status check skipped: {exc}")
        return

    if body.get("active") is False:
        SESSION_STATE_FILE.unlink(missing_ok=True)
        print(f"Session {session_id} is no longer active; removed {SESSION_STATE_FILE}.")


def session_expiry_loop():
    while True:
        expire_ended_session()
        time.sleep(SESSION_CHECK_SECONDS)


def main():
    threading.Thread(target=session_expiry_loop, daemon=True).start()
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), DeviceIdentityHandler)
    print(f"Serving device identity on {BIND_HOST}:{BIND_PORT}...")
    server.serve_forever()


if __name__ == "__main__":
    main()
