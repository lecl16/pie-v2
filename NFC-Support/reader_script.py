import argparse
import base64
import hmac
import json
import os
import secrets
import ssl
import time
import urllib.error
import urllib.request
from hashlib import sha256
from pathlib import Path

import board
import busio
from adafruit_pn532.i2c import PN532_I2C
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from pie_tls import device_api_url, device_tls_context

AID = bytes([0xF0, 0x45, 0x58, 0x4D, 0x41, 0x50, 0x50, 0x31])

INS_SELECT_AID = 0xA4
INS_SET_READER_CHALLENGE = 0xCB
INS_GET_PROVISION_TOKEN = 0xCC
INS_GET_DEVICE_IDENTITY = 0xCD
INS_GET_RESPONSE = 0xC0

SW_SUCCESS = b"\x90\x00"
SW1_MORE_DATA = 0x61  # ISO 7816-4 "61xx": more response bytes, fetch with GET RESPONSE

# Encrypted NFC payloads (examiner-trusted-node-provisioning.md section 3):
# ECDH P-256 between a fresh reader key per tap and a fresh phone key per
# response, HKDF-SHA256 into an AES-256-GCM key. Must match NfcCrypto.kt.
P256_PUBLIC_KEY_BYTES = 65  # uncompressed SEC1 point: 0x04 || X || Y
GCM_NONCE_BYTES = 12
HKDF_INFO = b"PIE-NFC-v2"

# Key-confirmation labels for the post-tap server round trip (same doc,
# section 4). Must match pie-api-main's confirm_provisioning_secret().
CONFIRM_LABEL_DEVICE = "pie-confirm-v2|device"
CONFIRM_LABEL_SERVER = "pie-confirm-v2|server"

# PN532 host commands/status bits used to drive InDataExchange directly, since
# nfcpy has no I2C transport at all (only TTY/USB — see nfc/clf/pn532.py's
# init()/nfc/clf/transport.py upstream) and this reader is wired over I2C.
PN532_INS_INDATAEXCHANGE = 0x40
PN532_TARGET_NUMBER = 0x01
PN532_STATUS_ERROR_MASK = 0x3F
PN532_STATUS_MORE_INFO_BIT = 0x40
PN532_EXCHANGE_RESPONSE_LENGTH = 262  # PN532 frame payload ceiling per InDataExchange call

# Delivered by an NFC identity-bootstrap tap (see
# pie-api-main/docs/device-identity-nfc-bootstrap.md) on a freshly-flashed
# device, or written manually per that doc's predecessor
# (pie-api-main/docs/device-provisioning-secret-registration.md section 1)
# on an already-imaged one: {"apiBaseUrl": "...", "deviceId": <int>,
# "deviceApiKey": "..."}. `apiBaseUrl` is later refreshed by every
# successfully confirmed session tap (see apply_session_provisioning()), so
# a server that moved to a new address since the claim is picked up without
# re-claiming the device.
#
# This is a Raspberry Pi OS path — this script runs on the Pi itself, which
# only acts as a USB dongle (NFC reader + this device's own identity/API
# credential + the amd64 exam image server) for a *separate* x86 host that
# boots that image over USB and runs DevApp-main. That host never shares a
# filesystem with this one, so it can't read this file directly; it learns
# `deviceId` instead over the network, from device_identity_server.py (see
# that module's docstring), which reads this same file.
#
# This file's existence *is* this device's claimed/unclaimed state (see
# claim_identity() and run_claim_listener() below) — there is no separate
# marker file, since claim_identity() writes it atomically (write-then-
# rename), so a half-written claim can never be mistaken for a complete one.
DEVICE_CONFIG_FILE = Path("/etc/pie/device.json")

# The session this device was last provisioned for, including the
# session-scoped secret the examiner app generated and shared with both the
# server and this device. Written only after the server has confirmed it
# (see confirm_with_server()).
SESSION_STATE_FILE = Path("/etc/pie/session.json")

HTTP_TIMEOUT_SECONDS = 10


def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def b64u_decode(encoded: str) -> bytes:
    padding = "=" * ((4 - len(encoded) % 4) % 4)
    return base64.urlsafe_b64decode((encoded + padding).encode("ascii"))


def build_apdu(ins, p1=0x00, p2=0x00, data=b"", le=None):
    apdu = bytes([0x00, ins, p1, p2, len(data)]) + data
    if le is not None:
        apdu += bytes([le])
    return apdu


def send_and_parse(tag, name, apdu):
    """Sends one command APDU and returns (body, SW). A `61xx` status (the
    phone's response didn't fit one APDU) is followed up with GET RESPONSE
    until the phone reports 9000, and the chunks are returned concatenated."""
    print(f"-> {name}")
    body = bytearray()
    while True:
        resp = tag.transceive(apdu)
        if len(resp) < 2:
            raise RuntimeError(f"{name}: invalid APDU response")

        body += resp[:-2]
        sw = resp[-2:]
        if sw[0] != SW1_MORE_DATA:
            break
        apdu = build_apdu(INS_GET_RESPONSE, le=sw[1])
    print(f"<- SW={sw.hex().upper()}")
    return bytes(body), sw


def parse_json_body(name, body):
    try:
        decoded = body.decode("utf-8")
        return json.loads(decoded) if decoded else {}
    except Exception as exc:
        raise RuntimeError(f"{name}: non-JSON body: {body!r}") from exc


def load_device_config() -> dict:
    """Loads this device's identity, delivered by the NFC claim tap (see
    claim_identity())."""
    if not DEVICE_CONFIG_FILE.exists():
        raise RuntimeError(
            f"{DEVICE_CONFIG_FILE} not found. Expected keys: apiBaseUrl, "
            "deviceId, deviceApiKey — written by the NFC claim tap."
        )
    config = json.loads(DEVICE_CONFIG_FILE.read_text(encoding="utf-8"))
    for key in ("apiBaseUrl", "deviceId", "deviceApiKey"):
        if not config.get(key):
            raise RuntimeError(f"{DEVICE_CONFIG_FILE} missing required key: {key}")
    return config


def write_json_atomic(path: Path, content: dict):
    """Write-then-rename, so a crash mid-write never leaves a half-written
    file behind. 0600: every file written this way holds a secret."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".tmp")
    tmp_path.write_text(json.dumps(content, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp_path, 0o600)
    tmp_path.replace(path)


def api_request(method: str, url: str, context, body: dict | None = None):
    """Minimal JSON HTTP client using only the stdlib (no `requests` dependency
    to add to this device's already-narrow venv install list), over TLS with
    this device's pre-shared key (`context`, see pie_tls.py).

    Deliberately sends no device API key: the only call this script makes is
    confirm_with_server(), which authenticates by proving possession of the
    session secret instead. The PSK handshake also fails against any server
    that doesn't hold this device's key, before anything is sent — so a tap
    carrying a rogue `apiBaseUrl` reaches nothing."""
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_SECONDS, context=context) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, ssl.SSLError):
            raise RuntimeError(
                f"TLS handshake with {url} failed: the server doesn't accept this "
                "device's key (not registered with it, or its key was rotated). "
                "Register the device again."
            ) from exc
        raise RuntimeError(f"Could not reach API at {url}: {exc.reason}") from exc


def generate_reader_key() -> tuple[ec.EllipticCurvePrivateKey, bytes]:
    """Fresh per tap, never reused: a recorded response from an earlier tap
    is useless against the next one, since it was encrypted to a key that no
    longer exists. This is what replaces the old v1 challenge + jti replay
    list."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private_key.public_key().public_bytes(
        serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
    )
    return private_key, public_bytes


def decrypt_envelope(
    reader_private_key: ec.EllipticCurvePrivateKey,
    reader_public_bytes: bytes,
    ins: int,
    envelope: bytes,
) -> dict:
    """Envelope layout: phone_pub (65) || nonce (12) || AES-GCM ciphertext+tag.
    Key = HKDF-SHA256(ECDH(reader, phone), salt=reader_pub || phone_pub).
    The INS byte is the AAD, so an identity payload can never be replayed
    into the session-provisioning path or vice versa."""
    if len(envelope) <= P256_PUBLIC_KEY_BYTES + GCM_NONCE_BYTES:
        raise RuntimeError("Encrypted envelope too short")

    phone_public_bytes = envelope[:P256_PUBLIC_KEY_BYTES]
    nonce = envelope[P256_PUBLIC_KEY_BYTES:P256_PUBLIC_KEY_BYTES + GCM_NONCE_BYTES]
    ciphertext = envelope[P256_PUBLIC_KEY_BYTES + GCM_NONCE_BYTES:]

    phone_public_key = ec.EllipticCurvePublicKey.from_encoded_point(
        ec.SECP256R1(), phone_public_bytes
    )
    shared = reader_private_key.exchange(ec.ECDH(), phone_public_key)
    key = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=reader_public_bytes + phone_public_bytes,
        info=HKDF_INFO,
    ).derive(shared)

    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, bytes([ins]))
    except Exception as exc:
        raise RuntimeError("Envelope decryption failed") from exc
    return parse_json_body("encrypted envelope", plaintext)


def confirm_proof(secret: bytes, label: str, device_id: int, session_id: int, nonce_b64u: str) -> str:
    message = f"{label}|{device_id}|{session_id}|{nonce_b64u}".encode("utf-8")
    return b64u_encode(hmac.new(secret, message, sha256).digest())


def confirm_with_server(api_base_url: str, device_id: int, api_key: str, session_id: int, secret: bytes) -> dict:
    """Closes the loop on the examiner app acting as the trusted node: the
    phone gave the same secret to the server (teacher JWT) and to this
    device (the encrypted tap). Proving possession of it to the server, and
    checking the server can prove the same back, is what shows the tap came
    from a phone the server trusts and that `api_base_url` is that server —
    decryption alone only proves the tap was not eavesdropped."""
    nonce_b64u = b64u_encode(secrets.token_bytes(16))
    # The device port (TLS-PSK), not the apiBaseUrl itself: see pie_tls.py.
    url = f"{device_api_url(api_base_url)}/device/{device_id}/provisioning-secret/{session_id}/confirm"
    status, resp_body = api_request(
        "POST",
        url,
        device_tls_context(device_id, api_key),
        body={
            "nonce": nonce_b64u,
            "mac": confirm_proof(secret, CONFIRM_LABEL_DEVICE, device_id, session_id, nonce_b64u),
        },
    )
    if status != 200:
        raise RuntimeError(f"Server rejected provisioning secret: HTTP {status} {resp_body!r}")

    response = parse_json_body("confirm", resp_body)
    expected = confirm_proof(secret, CONFIRM_LABEL_SERVER, device_id, session_id, nonce_b64u)
    if not hmac.compare_digest(expected, str(response.get("mac", ""))):
        raise RuntimeError("Server confirmation MAC mismatch — not the server the phone registered with")
    return response


def apply_session_provisioning(payload: dict) -> dict:
    """Validates a decrypted session payload, confirms it with the server,
    and only then persists it. Returns the provisioned session summary."""
    if int(payload.get("v", 0)) != 2:
        raise RuntimeError("Unsupported payload version")
    for key in ("sid", "k", "u", "exp"):
        if not payload.get(key):
            raise RuntimeError(f"Malformed session payload: missing {key}")
    if int(payload["exp"]) < int(time.time()):
        raise RuntimeError("Payload expired")

    session_id = int(payload["sid"])
    secret = b64u_decode(str(payload["k"]))
    if len(secret) < 32:
        raise RuntimeError("Session secret too short")
    api_base_url = str(payload["u"]).rstrip("/")

    device_config = load_device_config()
    response = confirm_with_server(
        api_base_url,
        int(device_config["deviceId"]),
        str(device_config["deviceApiKey"]),
        session_id,
        secret,
    )

    if device_config["apiBaseUrl"] != api_base_url:
        device_config["apiBaseUrl"] = api_base_url
        write_json_atomic(DEVICE_CONFIG_FILE, device_config)

    session_state = {
        "sessionId": session_id,
        # The server's value is authoritative; the phone's copy is only a
        # fallback for an older server that doesn't return it.
        "nmec": str(response.get("nmec") or payload.get("nm", "")),
        # Shown by the exam app so the student can check the seat is theirs.
        "name": str(response.get("name") or ""),
        "secret": b64u_encode(secret),
        "provisionedAt": int(time.time()),
    }
    write_json_atomic(SESSION_STATE_FILE, session_state)
    return {k: v for k, v in session_state.items() if k != "secret"}


def init_pn532(attempts: int = 5) -> PN532_I2C:
    # Right after a restart (e.g. the claim tap's), the chip can still be
    # busy with the phone and miss the first command; retry before giving up.
    i2c = busio.I2C(board.SCL, board.SDA)
    for attempt in range(1, attempts + 1):
        try:
            pn532 = PN532_I2C(i2c, debug=False)
            ic, ver, rev, support = pn532.firmware_version
            pn532.SAM_configuration()
            break
        except (OSError, RuntimeError) as exc:
            if attempt == attempts:
                raise
            print(f"PN532 not ready ({exc}); retrying ({attempt}/{attempts})...")
            time.sleep(1)
    print(f"PN532 firmware v{ver}.{rev} detected (IC 0x{ic:02X}).")
    return pn532


class Type4TagSession:
    """Adapts PN532 InDataExchange to the `tag.transceive(apdu)` interface
    on_connect() expects, handling the PN532's MI-bit frame chaining so a
    response longer than one PN532 frame is reassembled transparently."""

    def __init__(self, pn532: PN532_I2C, target: int = PN532_TARGET_NUMBER):
        self._pn532 = pn532
        self._target = target

    def transceive(self, apdu: bytes) -> bytes:
        response = bytearray()
        params = bytes([self._target]) + bytes(apdu)
        while True:
            raw = self._pn532.call_function(
                PN532_INS_INDATAEXCHANGE,
                params=params,
                response_length=PN532_EXCHANGE_RESPONSE_LENGTH,
            )
            if not raw:
                raise RuntimeError("InDataExchange: no response from PN532")

            status, data = raw[0], raw[1:]
            if status & PN532_STATUS_ERROR_MASK != 0x00:
                raise RuntimeError(f"InDataExchange error status=0x{status:02X}")

            response += data
            if not status & PN532_STATUS_MORE_INFO_BIT:
                break
            params = bytes([self._target])  # empty payload requests the next chained frame

        return bytes(response)


def claim_identity(identity: dict):
    """Writes an identity delivered by INS_GET_DEVICE_IDENTITY to this Pi's
    own DEVICE_CONFIG_FILE. Written atomically (write-then-rename) so a
    crash mid-write can never leave a device looking claimed when it isn't.

    This device's `deviceId` also needs to reach DevApp-main, but that runs
    on a separate x86 host with no shared filesystem (see the module
    docstring) — that handoff happens over the network instead, via
    device_identity_server.py reading this same file on request, not by
    this function writing anywhere else."""
    write_json_atomic(DEVICE_CONFIG_FILE, {
        "apiBaseUrl": identity["apiBaseUrl"].rstrip("/"),
        "deviceId": identity["deviceId"],
        "deviceApiKey": identity["apiKey"],
    })


def on_connect_claim(tag):
    """Claim-listener tap handler for an unclaimed device (DEVICE_CONFIG_FILE
    absent). Mirrors on_connect()'s SELECT-then-command shape, but issues
    INS_GET_DEVICE_IDENTITY instead of the session-provisioning challenge —
    see pie-api-main/docs/device-identity-nfc-bootstrap.md section 2. An
    unclaimed device has no session to provision yet, so the only gate is
    whether the phone happens to be holding a freshly-created, undelivered
    identity at all.
    The identity (it carries a live API key) comes back encrypted to this
    tap's reader key, same as a session payload."""
    try:
        select_apdu = bytes([0x00, INS_SELECT_AID, 0x04, 0x00, len(AID), *AID, 0x00])
        _, sw = send_and_parse(tag, "SELECT AID", select_apdu)
        if sw != SW_SUCCESS:
            print("SELECT failed")
            return False

        reader_private_key, reader_public_bytes = generate_reader_key()
        _, sw = send_and_parse(
            tag,
            "SET_READER_CHALLENGE",
            build_apdu(INS_SET_READER_CHALLENGE, data=reader_public_bytes),
        )
        if sw != SW_SUCCESS:
            print("SET_READER_CHALLENGE failed")
            return False

        body, sw = send_and_parse(
            tag, "GET_DEVICE_IDENTITY", build_apdu(INS_GET_DEVICE_IDENTITY)
        )
        if sw != SW_SUCCESS:
            # Expected for a phone not currently holding an identity to
            # deliver (an unrelated tap, or a stray re-tap after delivery) —
            # not an error worth alarming an operator over.
            print("No identity pending on this phone.")
            return False

        identity = decrypt_envelope(
            reader_private_key, reader_public_bytes, INS_GET_DEVICE_IDENTITY, body
        )
        for key in ("deviceId", "apiKey", "apiBaseUrl"):
            if not identity.get(key):
                raise RuntimeError(f"Malformed identity payload: missing {key}")

        claim_identity(identity)
        print(f"Device claimed: id={identity['deviceId']}")
        return True
    except Exception as exc:
        print(f"Error: {exc}")
        return False


def run_claim_listener(pn532: PN532_I2C):
    """Passive-scan loop for an unclaimed device — waits for a tap carrying
    a device identity instead of running the normal session-provisioning
    reader loop. Returns once a claim succeeds; systemd's Restart=always on
    nfc-reader.service then relaunches this script, which now finds
    DEVICE_CONFIG_FILE present and falls straight through to the normal
    loop below (main()) — no separate "reload" path is needed."""
    print("Device unclaimed — waiting for an identity-bootstrap tap...")
    while not DEVICE_CONFIG_FILE.exists():
        uid = pn532.read_passive_target(timeout=0.5)
        if uid is None:
            continue

        claimed = on_connect_claim(Type4TagSession(pn532))

        # Wait for the phone to be pulled away before scanning again, same
        # debounce as the normal reader loop.
        while pn532.read_passive_target(timeout=0.5) is not None:
            time.sleep(0.2)

        if claimed:
            print("Claim complete. Restarting into normal provisioning mode.")
            return


def on_connect(tag):
    """Session-provisioning tap handler (examiner-trusted-node-provisioning.md
    section 2): the examiner app delivers a session-scoped secret it
    generated and already registered with the server, encrypted to this
    tap's reader key; this device then confirms it with the server before
    accepting it.

    There is no local arming step: any tap is accepted for processing, and
    the server's confirmation is the gate. Only an enrolled examiner phone
    can register a secret for this device and session, and the confirmation
    succeeds once, within its TTL, over this device's TLS-PSK link."""
    try:
        # 1) SELECT AID
        select_apdu = bytes([0x00, INS_SELECT_AID, 0x04, 0x00, len(AID), *AID, 0x00])
        _, sw = send_and_parse(tag, "SELECT AID", select_apdu)
        if sw != SW_SUCCESS:
            print("SELECT failed")
            return False

        # 2) SET_READER_CHALLENGE — now carries this tap's ephemeral public key
        reader_private_key, reader_public_bytes = generate_reader_key()
        _, sw = send_and_parse(
            tag,
            "SET_READER_CHALLENGE",
            build_apdu(INS_SET_READER_CHALLENGE, data=reader_public_bytes),
        )
        if sw != SW_SUCCESS:
            print("SET_READER_CHALLENGE failed")
            return False

        # 3) GET_PROVISION_TOKEN — encrypted session payload
        body, sw = send_and_parse(tag, "GET_PROVISION_TOKEN", build_apdu(INS_GET_PROVISION_TOKEN))
        if sw != SW_SUCCESS:
            print("GET_PROVISION_TOKEN failed")
            return False

        payload = decrypt_envelope(
            reader_private_key, reader_public_bytes, INS_GET_PROVISION_TOKEN, body
        )

        # 4) Key confirmation with the server, then persist
        session = apply_session_provisioning(payload)

        print("Provisioned exam session:")
        print(json.dumps(session, indent=2))
        return True
    except Exception as exc:
        print(f"Error: {exc}")
        return False


def parse_args():
    parser = argparse.ArgumentParser(
        description="PIE NFC reader: claim listener, then session provisioning taps"
    )
    return parser.parse_args()


def main():
    parse_args()

    # Integration of the NFC module through I2C.
    pn532 = init_pn532()

    if not DEVICE_CONFIG_FILE.exists():
        run_claim_listener(pn532)
        return

    print("Waiting for examiner phone...")
    while True:
        uid = pn532.read_passive_target(timeout=0.5)
        if uid is None:
            continue

        on_connect(Type4TagSession(pn532))

        # Wait for the phone to be pulled away so one physical tap isn't
        # processed repeatedly while it's still sitting on the reader.
        while pn532.read_passive_target(timeout=0.5) is not None:
            time.sleep(0.2)


if __name__ == "__main__":
    main()
