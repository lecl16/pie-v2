"""TLS to the PIE API's device port with this device's pre-shared key — see
pie-api-main/docs/device-tls-psk.md.

Standard library only: device_identity_server.py runs on the system
python3, outside the reader's venv. Needs Python 3.13+ (ssl's PSK
callbacks).

The key is derived from the device API key that the registration tap
stored in /etc/pie/device.json; nothing new is stored. Only the real
server knows the same key, so a completed handshake authenticates the
server to this device (and this device to the server) before any request
is sent.
"""

import hashlib
import hmac
import ssl
from urllib.parse import urlsplit, urlunsplit

# Same host as the apiBaseUrl in the taps, this port (pie-api-main's
# device-api service). A protocol constant, like the Pi's piIdentityUrl.
DEVICE_TLS_PORT = 8444

PSK_LABEL = "pie-device-psk-v1"


def psk_identity(device_id: int) -> str:
    """Must match device_identity() in pie-api-main/app/core/device_psk.py."""
    return f"pie-device-{device_id}"


def derive_psk(api_key: str, device_id: int) -> bytes:
    """HKDF-SHA256 (RFC 5869), empty salt, 32 bytes. Must match derive_psk()
    in pie-api-main/app/core/device_psk.py."""
    prk = hmac.new(b"\x00" * 32, api_key.encode("utf-8"), hashlib.sha256).digest()
    info = f"{PSK_LABEL}|{device_id}".encode("utf-8")
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()


def device_tls_context(device_id: int, api_key: str) -> ssl.SSLContext:
    if not getattr(ssl, "HAS_PSK", False):
        raise RuntimeError("This Python has no TLS-PSK support (needs Python 3.13+)")
    identity = psk_identity(device_id)
    psk = derive_psk(api_key, device_id)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    # No certificate is involved: the PSK authenticates the server.
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE
    context.set_psk_client_callback(lambda hint: (identity, psk))
    return context


def device_api_url(api_base_url: str) -> str:
    """https://host:8000/... -> https://host:8444/..."""
    parts = urlsplit(api_base_url.rstrip("/"))
    host = parts.hostname or ""
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    return urlunsplit(("https", f"{host}:{DEVICE_TLS_PORT}", parts.path, "", ""))
