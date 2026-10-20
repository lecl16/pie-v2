"""Per-device TLS pre-shared keys for the Pi ↔ server link — see
docs/device-tls-psk.md.

The PSK is derived from the device API key, which the server only has in
plaintext when it mints one (POST /device/create, /rotate-key). It is
stored wrapped with DEVICE_PSK_WRAP_KEY (.env), so a copy of the database
alone does not give the keys."""

import base64
import secrets

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from app.core.config import config

PSK_LABEL = "pie-device-psk-v1"
IDENTITY_PREFIX = "pie-device-"


def device_identity(device_id: int) -> str:
    """Must match psk_identity() in NFC-Support/pie_tls.py."""
    return f"{IDENTITY_PREFIX}{device_id}"


def parse_identity(identity: str) -> int | None:
    if not identity or not identity.startswith(IDENTITY_PREFIX):
        return None
    suffix = identity[len(IDENTITY_PREFIX):]
    return int(suffix) if suffix.isdigit() else None


def derive_psk(api_key: str, device_id: int) -> bytes:
    """Must match derive_psk() in NFC-Support/pie_tls.py."""
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=f"{PSK_LABEL}|{device_id}".encode("utf-8"),
    ).derive(api_key.encode("utf-8"))


def _wrap_key() -> bytes:
    if not config.DEVICE_PSK_WRAP_KEY:
        raise RuntimeError("DEVICE_PSK_WRAP_KEY is not set; run scripts/setup.sh")
    key = bytes.fromhex(config.DEVICE_PSK_WRAP_KEY)
    if len(key) != 32:
        raise RuntimeError("DEVICE_PSK_WRAP_KEY must be 32 bytes, hex-encoded")
    return key


def wrap_psk(psk: bytes, device_id: int) -> str:
    """AES-256-GCM, with the device identity as associated data, so a
    wrapped key copied onto another device's row does not unwrap."""
    nonce = secrets.token_bytes(12)
    sealed = AESGCM(_wrap_key()).encrypt(nonce, psk, device_identity(device_id).encode("utf-8"))
    return base64.b64encode(nonce + sealed).decode("ascii")


def unwrap_psk(wrapped: str, device_id: int) -> bytes:
    raw = base64.b64decode(wrapped)
    return AESGCM(_wrap_key()).decrypt(raw[:12], raw[12:], device_identity(device_id).encode("utf-8"))


def new_wrapped_psk(api_key: str, device_id: int) -> str:
    return wrap_psk(derive_psk(api_key, device_id), device_id)
