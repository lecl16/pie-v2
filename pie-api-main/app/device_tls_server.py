"""The device port: TLS-PSK for the exam devices (Pis) — see
README.md, "Device TLS-PSK".

Run as `python -m app.device_tls_server` (the `device-api` compose service).
Serves the same FastAPI app as the main listener, but:

- TLS 1.3 with a per-device pre-shared key only, no certificate. The
  handshake fails for an unknown device, a device without a key, or a
  wrong key, before any request is read.
- Only the routes the Pi calls are reachable; everything else is 404.
- The phone-certificate header, which only Caddy may set, is stripped.

Caddy cannot terminate TLS-PSK, so this uvicorn is published directly.
"""

import logging
import os
import re
import ssl
import time

import uvicorn

from app.api.main import app as api_app
from app.core.auth import PHONE_CERT_HEADER
from app.core.database import SessionLocal
from app.core.device_psk import parse_identity, unwrap_psk
from app.models.db.device import Device

logger = logging.getLogger("uvicorn.error")

DEVICE_TLS_PORT = int(os.getenv("DEVICE_TLS_PORT", "8444"))

# A rotated or deleted device stops being accepted within this many seconds.
PSK_CACHE_SECONDS = 30

ALLOWED_ROUTES = [
    ("POST", re.compile(r"^/device/\d+/provisioning-secret/\d+/confirm$")),
    ("GET", re.compile(r"^/device/\d+/session/\d+/status$")),
    ("POST", re.compile(r"^/device/\d+/tunnel$")),
]

_stripped_header = PHONE_CERT_HEADER.lower().encode("latin-1")
_psk_cache: dict[int, tuple[bytes, float]] = {}


def lookup_psk(identity: str) -> bytes:
    """Called by OpenSSL during the handshake. b"" refuses it. Synchronous
    and on the event loop, hence the cache."""
    try:
        device_id = parse_identity(identity)
        if device_id is None:
            return b""
        cached = _psk_cache.get(device_id)
        if cached and time.monotonic() - cached[1] < PSK_CACHE_SECONDS:
            return cached[0]
        db = SessionLocal()
        try:
            device = db.query(Device).filter(Device.id == device_id).first()
            wrapped = device.tls_psk_enc if device is not None else None
        finally:
            db.close()
        psk = unwrap_psk(wrapped, device_id) if wrapped else b""
        _psk_cache[device_id] = (psk, time.monotonic())
        if not psk:
            logger.info("TLS-PSK refused for %r: no key for this device", identity)
        return psk
    except Exception:
        logger.exception("TLS-PSK lookup failed for %r", identity)
        return b""


def psk_server_context() -> ssl.SSLContext:
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.set_psk_server_callback(lookup_psk)
    return context


async def device_only_app(scope, receive, send):
    if scope["type"] == "http":
        allowed = any(
            scope["method"] == method and pattern.match(scope["path"])
            for method, pattern in ALLOWED_ROUTES
        )
        if not allowed:
            body = b'{"detail":"Not Found"}'
            await send({
                "type": "http.response.start",
                "status": 404,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode())],
            })
            await send({"type": "http.response.body", "body": body})
            return
        scope = dict(scope)
        scope["headers"] = [(k, v) for k, v in scope["headers"] if k.lower() != _stripped_header]
    elif scope["type"] == "websocket":
        await send({"type": "websocket.close", "code": 1008})
        return
    await api_app(scope, receive, send)


def main():
    config = uvicorn.Config(device_only_app, host="0.0.0.0", port=DEVICE_TLS_PORT)
    config.load()
    # Set after load(): uvicorn only builds contexts from certificate files.
    config.ssl = psk_server_context()
    uvicorn.Server(config).run()


if __name__ == "__main__":
    main()
