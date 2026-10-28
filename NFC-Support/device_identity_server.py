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

With it, `GET /device-identity` serves `caCert`: the deployment CA that
DevApp-main uses to verify the server's certificate (its only trust
anchor for the API). The Pi fetches it from the server over its TLS-PSK
port, so it comes from the server that holds this device's key — see
pie-api-main/docs/exam-app-tls.md. Until it has one for the current
`apiBaseUrl`, `/device-identity` answers 503 and DevApp-main keeps waiting.

The exam app reaches the server only through this Pi's WireGuard tunnel
(pie-api-main/app/core/tunnel.py): `/device-identity` gives it the server's
address inside the tunnel, not `apiBaseUrl`, and the server tells which
device a request comes from by its tunnel address. The tunnel's private
key is created here and never leaves the Pi; ensure_tunnel() registers its
public key over the TLS-PSK port and configures wg0. Until the tunnel is
set up for the current `apiBaseUrl`, `/device-identity` answers 503.

It also serves `GET /session`: the session this Pi was provisioned for by
the last confirmed tap, and the student the examiner assigned to it, which
the exam app shows before the join. No secret leaves the Pi: the tunnel is
what lets the server tell a join from this device apart from one made on a
student's own machine.

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
import binascii
import grp
import ipaddress
import json
import os
import ssl
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from pie_tls import device_api_url, device_tls_context

# Same file reader_script.py's claim_identity() writes — this server only
# ever reads it, never writes it, so there's no coordination needed beyond
# both processes agreeing on the path.
DEVICE_CONFIG_FILE = Path("/etc/pie/device.json")
# Written by reader_script.py's apply_session_provisioning() after a
# confirmed session tap. Only ever deleted here (expire_ended_session()),
# never written.
SESSION_STATE_FILE = Path("/etc/pie/session.json")

# The deployment CA fetched from the server (see refresh_server_ca()), with
# the apiBaseUrl it was fetched for. Public, so 0644; written only here.
SERVER_CA_FILE = Path("/etc/pie/server-ca.json")
# Re-fetched this often, so a re-created CA reaches the exam app without a
# new tap.
SERVER_CA_REFRESH_SECONDS = 3600

SESSION_CHECK_SECONDS = 30
# How often the loop looks for a session tapped since the last check, so the
# filtering proxy gets the new session's allowlist within seconds.
LOOP_SECONDS = 2
# ...but no more often than this while the server can't be reached.
NEW_SESSION_RETRY_SECONDS = 5

# What the filtering proxy (pie_filter.py, user pie-proxy) enforces: the
# session's allowed links and the assigned student's NMEC, from the server's
# answer about the session. Absent without a session.
FILTER_FILE = Path("/etc/pie/filter.json")
PROXY_GROUP = "pie-proxy"
# The filtering proxy's CA, which the exam OS trusts (GET /proxy-ca).
PROXY_CA_FILE = Path("/var/lib/pie-proxy/mitmproxy-ca-cert.pem")

# The WireGuard tunnel to the server (ensure_tunnel()). The private key and
# wg0's configuration hold the same secret, so both are 0600; the tunnel
# record holds nothing secret.
WG_KEY_FILE = Path("/etc/pie/wg.key")
WG_CONF_FILE = Path("/etc/wireguard/wg0.conf")
TUNNEL_FILE = Path("/etc/pie/tunnel.json")
# Registered again this often, so a server whose tunnel service was reset
# learns this Pi's key again without a new tap.
TUNNEL_REFRESH_SECONDS = 3600

# Bound to all interfaces rather than usb0's specific address (192.168.7.2):
# usb0 may come up after this service starts (it depends on the attached
# host enumerating the gadget first), and binding to a not-yet-present
# address would fail. Who can actually reach this is scoped by the Pi's
# nftables input chain instead (`tcp dport 8100 iifname != "usb0" drop`, see
# device-build/aux-files/apply-pi-gateway-setup.sh), not by this server.
BIND_HOST = "0.0.0.0"
BIND_PORT = 8100


class DeviceIdentityHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/device-identity":
            self._serve_device_identity()
        elif self.path == "/session":
            self._serve_session()
        elif self.path == "/proxy-ca":
            self._serve_proxy_ca()
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
            identity = {"deviceId": config["deviceId"]}
        except Exception:
            self._respond(500, {"error": "device.json unreadable or malformed"})
            return

        tunnel = current_tunnel(config) or ensure_tunnel(throttle=True)
        if not tunnel:
            # The exam app can only reach the server through the tunnel;
            # it retries like it does for "unclaimed".
            self._respond(503, {"error": "tunnel to the server not set up yet"})
            return
        identity["apiBaseUrl"] = tunnel["apiUrl"]

        ca_cert = current_server_ca(config) or refresh_server_ca(throttle=True)
        if not ca_cert:
            # DevApp-main can't reach the server without it; it retries
            # like it does for "unclaimed".
            self._respond(503, {"error": "server CA not fetched yet"})
            return
        identity["caCert"] = ca_cert

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
            body = {
                "sessionId": int(session["sessionId"]),
                "nmec": str(session["nmec"]),
                "name": str(session.get("name", "")),
            }
        except Exception:
            self._respond(500, {"error": "session.json unreadable or malformed"})
            return

        self._respond(200, body)

    def _serve_proxy_ca(self):
        """The filtering proxy's CA, which the exam OS installs for its
        browser at boot: the only thing it needs to know about the
        filtering, which happens here."""
        try:
            pem = PROXY_CA_FILE.read_text(encoding="ascii")
            ssl.PEM_cert_to_DER_cert(pem)
        except (OSError, ValueError):
            self._respond(503, {"error": "proxy CA not created yet"})
            return
        payload = pem.encode("ascii")
        self.send_response(200)
        self.send_header("Content-Type", "application/x-pem-file")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

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
        # The device port (TLS-PSK, see pie_tls.py): the key below only
        # goes to a server that proved it holds this device's key.
        url = f"{device_api_url(config['apiBaseUrl'])}/device/{device_id}/session/{session_id}/status"
        request = urllib.request.Request(url, headers={"X-Device-Key": config["deviceApiKey"]})
        context = device_tls_context(device_id, config["deviceApiKey"])
        with urllib.request.urlopen(request, timeout=5, context=context) as response:
            body = json.loads(response.read().decode("utf-8"))
    except (OSError, ValueError, KeyError, RuntimeError, urllib.error.URLError) as exc:
        print(f"Session status check skipped: {exc}")
        return

    if body.get("active") is False:
        SESSION_STATE_FILE.unlink(missing_ok=True)
        FILTER_FILE.unlink(missing_ok=True)
        print(f"Session {session_id} is no longer active; removed {SESSION_STATE_FILE}.")
    elif body.get("active") is True:
        write_filter(body.get("allowedLinks") or [], str(body.get("nmec") or ""))


def write_filter(allowed_links: list, nmec: str):
    """Updates the proxy's filter if it changed. Readable by the proxy's
    group only: it names the assigned student."""
    content = json.dumps({"allowedLinks": [str(link) for link in allowed_links], "nmec": nmec}, indent=2) + "\n"
    if FILTER_FILE.exists() and FILTER_FILE.read_text(encoding="utf-8") == content:
        return
    tmp_path = FILTER_FILE.with_suffix(".tmp")
    tmp_path.write_text(content, encoding="utf-8")
    try:
        os.chown(tmp_path, 0, grp.getgrnam(PROXY_GROUP).gr_gid)
        os.chmod(tmp_path, 0o640)
    except KeyError:
        os.chmod(tmp_path, 0o644)  # no proxy group on this device
    tmp_path.replace(FILTER_FILE)
    print(f"Filter updated: {len(allowed_links)} allowed links, assigned NMEC {nmec or '(none)'}.")


def current_server_ca(config: dict, max_age: float | None = None) -> str | None:
    """The cached CA, if it was fetched for this apiBaseUrl (and, with
    max_age, recently enough)."""
    try:
        cached = json.loads(SERVER_CA_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if cached.get("apiBaseUrl") != config.get("apiBaseUrl"):
        return None
    if max_age is not None and time.time() - float(cached.get("fetchedAt", 0)) > max_age:
        return None
    return cached.get("caCert") or None


_ca_lock = threading.Lock()
_ca_last_failure = 0.0
# DevApp-main polls /device-identity every few seconds; while the server is
# unreachable, don't start a fetch (up to 5 s) on every one of those polls.
CA_RETRY_SECONDS = 10


def refresh_server_ca(throttle: bool = False) -> str | None:
    """Fetches the deployment CA from the server's device port and caches
    it. Returns it, or None if it couldn't be fetched (the cache is kept)."""
    global _ca_last_failure
    with _ca_lock:
        if throttle and time.monotonic() - _ca_last_failure < CA_RETRY_SECONDS:
            return None
        try:
            config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
            device_id = int(config["deviceId"])
            # TLS-PSK (pie_tls.py): only the server holding this device's
            # key completes the handshake, which is what makes this CA
            # trustworthy for the exam app.
            url = f"{device_api_url(config['apiBaseUrl'])}/device/{device_id}/server-ca"
            request = urllib.request.Request(url, headers={"X-Device-Key": config["deviceApiKey"]})
            context = device_tls_context(device_id, config["deviceApiKey"])
            with urllib.request.urlopen(request, timeout=5, context=context) as response:
                ca_cert = json.loads(response.read().decode("utf-8"))["caCert"]
            ssl.PEM_cert_to_DER_cert(ca_cert)  # rejects anything that isn't one PEM certificate
        except (OSError, ValueError, KeyError, TypeError, RuntimeError, urllib.error.URLError) as exc:
            print(f"Server CA fetch failed: {exc}")
            _ca_last_failure = time.monotonic()
            return None

        if ca_cert != current_server_ca(config):
            print(f"Server CA fetched for {config['apiBaseUrl']}.")
        tmp_path = SERVER_CA_FILE.with_suffix(".tmp")
        tmp_path.write_text(json.dumps({
            "apiBaseUrl": config["apiBaseUrl"],
            "caCert": ca_cert,
            "fetchedAt": int(time.time()),
        }) + "\n", encoding="utf-8")
        os.chmod(tmp_path, 0o644)
        tmp_path.replace(SERVER_CA_FILE)
        return ca_cert


def current_tunnel(config: dict, max_age: float | None = None) -> dict | None:
    """The tunnel record, if it was set up for this apiBaseUrl (and, with
    max_age, recently enough) and wg0 is up."""
    try:
        tunnel = json.loads(TUNNEL_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if tunnel.get("apiBaseUrl") != config.get("apiBaseUrl"):
        return None
    if max_age is not None and time.time() - float(tunnel.get("registeredAt", 0)) > max_age:
        return None
    if subprocess.run(["wg", "show", "wg0"], capture_output=True).returncode != 0:
        return None
    return tunnel


def _wireguard_key(value) -> str:
    key = str(value)
    try:
        if len(base64.b64decode(key, validate=True)) == 32:
            return key
    except (binascii.Error, ValueError):
        pass
    raise ValueError("not a WireGuard key")


def _private_key() -> str:
    """This Pi's tunnel key, created on first use; it never leaves the Pi."""
    if WG_KEY_FILE.exists():
        return _wireguard_key(WG_KEY_FILE.read_text(encoding="ascii").strip())
    key = subprocess.run(["wg", "genkey"], capture_output=True, text=True, check=True).stdout.strip()
    WG_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = WG_KEY_FILE.with_suffix(".tmp")
    tmp_path.write_text(key + "\n", encoding="ascii")
    os.chmod(tmp_path, 0o600)
    tmp_path.replace(WG_KEY_FILE)
    return key


_tunnel_lock = threading.Lock()
_tunnel_last_failure = 0.0
TUNNEL_RETRY_SECONDS = 10


def ensure_tunnel(throttle: bool = False) -> dict | None:
    """Registers this Pi's tunnel key with the server over the TLS-PSK port
    and brings up wg0 with what the server answers. Returns the tunnel, or
    None if it couldn't be set up (the previous one is kept)."""
    global _tunnel_last_failure
    with _tunnel_lock:
        if throttle and time.monotonic() - _tunnel_last_failure < TUNNEL_RETRY_SECONDS:
            return None
        try:
            config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
            device_id = int(config["deviceId"])
            private_key = _private_key()
            public_key = subprocess.run(
                ["wg", "pubkey"], input=private_key, capture_output=True, text=True, check=True
            ).stdout.strip()
            url = f"{device_api_url(config['apiBaseUrl'])}/device/{device_id}/tunnel"
            request = urllib.request.Request(
                url,
                data=json.dumps({"publicKey": public_key}).encode("utf-8"),
                headers={"X-Device-Key": config["deviceApiKey"], "Content-Type": "application/json"},
                method="POST",
            )
            context = device_tls_context(device_id, config["deviceApiKey"])
            with urllib.request.urlopen(request, timeout=5, context=context) as response:
                answer = json.loads(response.read().decode("utf-8"))

            # Everything below goes into wg0.conf, so it is checked first.
            address = ipaddress.IPv4Interface(answer["address"])
            server_ip = ipaddress.IPv4Address(answer["serverAddress"])
            server_key = _wireguard_key(answer["serverPublicKey"])
            port = int(answer["endpointPort"])
            api_url = str(answer["apiUrl"])
            if not 0 < port < 65536 or not api_url.startswith(f"https://{server_ip}:"):
                raise ValueError("unexpected tunnel answer")
            host = urlsplit(config["apiBaseUrl"]).hostname or ""
            if ":" in host:
                endpoint = f"[{ipaddress.IPv6Address(host)}]:{port}"
            elif host and all(c.isascii() and (c.isalnum() or c in ".-") for c in host):
                endpoint = f"{host}:{port}"
            else:
                raise ValueError(f"unusable server host {host!r}")

            wg_conf = (
                "[Interface]\n"
                f"PrivateKey = {private_key}\n"
                f"Address = {address}\n"
                "\n"
                "[Peer]\n"
                f"PublicKey = {server_key}\n"
                f"Endpoint = {endpoint}\n"
                # Only the server goes through the tunnel; everything else
                # the exam host reaches leaves through the Wi-Fi as before.
                f"AllowedIPs = {server_ip}/32\n"
                "PersistentKeepalive = 25\n"
            )
            current = WG_CONF_FILE.read_text(encoding="ascii") if WG_CONF_FILE.exists() else ""
            interface_up = subprocess.run(["wg", "show", "wg0"], capture_output=True).returncode == 0
            if wg_conf != current or not interface_up:
                WG_CONF_FILE.parent.mkdir(parents=True, exist_ok=True)
                tmp_path = WG_CONF_FILE.with_suffix(".tmp")
                tmp_path.write_text(wg_conf, encoding="ascii")
                os.chmod(tmp_path, 0o600)
                tmp_path.replace(WG_CONF_FILE)
                subprocess.run(["systemctl", "enable", "wg-quick@wg0"], capture_output=True, check=True)
                subprocess.run(["systemctl", "restart", "wg-quick@wg0"], capture_output=True, check=True)
                print(f"Tunnel up: {address} to {server_ip} via {endpoint}.")
        except (OSError, ValueError, KeyError, TypeError, RuntimeError,
                subprocess.CalledProcessError, urllib.error.URLError) as exc:
            print(f"Tunnel setup failed: {exc}")
            _tunnel_last_failure = time.monotonic()
            return None

        tunnel = {
            "apiBaseUrl": config["apiBaseUrl"],
            "apiUrl": api_url,
            "address": str(address),
            "registeredAt": int(time.time()),
        }
        tmp_path = TUNNEL_FILE.with_suffix(".tmp")
        tmp_path.write_text(json.dumps(tunnel) + "\n", encoding="utf-8")
        os.chmod(tmp_path, 0o644)
        tmp_path.replace(TUNNEL_FILE)
        return tunnel


def session_expiry_loop():
    last_check = 0.0
    while True:
        if not SESSION_STATE_FILE.exists():
            FILTER_FILE.unlink(missing_ok=True)
        # A session tapped since the last check is checked at once, so the
        # proxy gets its allowlist within seconds; otherwise every
        # SESSION_CHECK_SECONDS.
        new_session = (
            SESSION_STATE_FILE.exists()
            and (not FILTER_FILE.exists() or SESSION_STATE_FILE.stat().st_mtime > FILTER_FILE.stat().st_mtime)
        )
        since_check = time.monotonic() - last_check
        if (new_session and since_check >= NEW_SESSION_RETRY_SECONDS) or since_check >= SESSION_CHECK_SECONDS:
            last_check = time.monotonic()
            expire_ended_session()
            if DEVICE_CONFIG_FILE.exists():
                try:
                    config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    config = None
                if config and not current_server_ca(config, max_age=SERVER_CA_REFRESH_SECONDS):
                    refresh_server_ca()
                if config and not current_tunnel(config, max_age=TUNNEL_REFRESH_SECONDS):
                    ensure_tunnel()
        time.sleep(LOOP_SECONDS)


def main():
    threading.Thread(target=session_expiry_loop, daemon=True).start()
    server = ThreadingHTTPServer((BIND_HOST, BIND_PORT), DeviceIdentityHandler)
    print(f"Serving device identity on {BIND_HOST}:{BIND_PORT}...")
    server.serve_forever()


if __name__ == "__main__":
    main()
