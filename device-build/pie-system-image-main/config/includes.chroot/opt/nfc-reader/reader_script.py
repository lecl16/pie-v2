import argparse
import base64
import hmac
import json
import os
import secrets
import time
from hashlib import sha256
from pathlib import Path

import board
import busio
from adafruit_pn532.i2c import PN532_I2C

AID = bytes([0xF0, 0x45, 0x58, 0x4D, 0x41, 0x50, 0x50, 0x31])

INS_SELECT_AID = 0xA4
INS_SET_READER_CHALLENGE = 0xCB
INS_GET_PROVISION_TOKEN = 0xCC

SW_SUCCESS = b"\x90\x00"

# PN532 host commands/status bits used to drive InDataExchange directly, since
# nfcpy has no I2C transport at all (only TTY/USB — see nfc/clf/pn532.py's
# init()/nfc/clf/transport.py upstream) and this reader is wired over I2C.
PN532_INS_INDATAEXCHANGE = 0x40
PN532_TARGET_NUMBER = 0x01
PN532_STATUS_ERROR_MASK = 0x3F
PN532_STATUS_MORE_INFO_BIT = 0x40
PN532_EXCHANGE_RESPONSE_LENGTH = 262  # PN532 frame payload ceiling per InDataExchange call

SECRET_FILE = Path(__file__).with_name("provision_secret.txt")
USED_TOKEN_FILE = Path(__file__).with_name("used_token_ids.json")
WINDOW_STATE_FILE = Path(__file__).with_name("provision_window.json")

# Hard lock mode: provisioning is allowed only during a short, explicitly armed window.
HARD_LOCK_MODE = True
DEFAULT_WINDOW_SECONDS = 60
MAX_WINDOW_SECONDS = 300

# TODO(server-integration): replace local secret bootstrap with server registration.
# Planned flow: this device uploads its secret to backend; examiner app fetches it by exam/session.


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
    print(f"-> {name}")
    resp = tag.transceive(apdu)
    if len(resp) < 2:
        raise RuntimeError(f"{name}: invalid APDU response")

    body = resp[:-2]
    sw = resp[-2:]
    print(f"<- SW={sw.hex().upper()}")
    return body, sw


def parse_json_body(name, body):
    try:
        decoded = body.decode("utf-8")
        return json.loads(decoded) if decoded else {}
    except Exception as exc:
        raise RuntimeError(f"{name}: non-JSON body: {body!r}") from exc


def load_or_create_secret() -> bytes:
    if SECRET_FILE.exists():
        secret_text = SECRET_FILE.read_text(encoding="utf-8").strip()
        if not secret_text:
            raise RuntimeError(f"{SECRET_FILE} is empty")
        return b64u_decode(secret_text)

    secret = secrets.token_bytes(32)
    SECRET_FILE.write_text(b64u_encode(secret) + "\n", encoding="utf-8")
    return secret


def load_used_token_ids() -> set[str]:
    if not USED_TOKEN_FILE.exists():
        return set()
    try:
        data = json.loads(USED_TOKEN_FILE.read_text(encoding="utf-8"))
        if not isinstance(data, list):
            return set()
        return {str(item) for item in data}
    except Exception:
        return set()


def save_used_token_ids(used: set[str]):
    USED_TOKEN_FILE.write_text(json.dumps(sorted(used), indent=2) + "\n", encoding="utf-8")


def arm_provisioning_window(seconds: int):
    duration = max(1, min(seconds, MAX_WINDOW_SECONDS))
    expires_at = int(time.time()) + duration
    state = {"expiresAt": expires_at}
    WINDOW_STATE_FILE.write_text(json.dumps(state) + "\n", encoding="utf-8")


def clear_provisioning_window():
    if WINDOW_STATE_FILE.exists():
        WINDOW_STATE_FILE.unlink()


def get_window_remaining_seconds() -> int:
    if not WINDOW_STATE_FILE.exists():
        return 0
    try:
        state = json.loads(WINDOW_STATE_FILE.read_text(encoding="utf-8"))
        expires_at = int(state.get("expiresAt", 0))
    except Exception:
        return 0
    remaining = expires_at - int(time.time())
    return max(0, remaining)


def is_window_open() -> bool:
    remaining = get_window_remaining_seconds()
    if remaining <= 0:
        return False
    return True


def verify_token(shared_secret: bytes, challenge_b64u: str, payload: dict, used_ids: set[str]):
    if not isinstance(payload, dict) or "t" not in payload or "m" not in payload:
        raise RuntimeError("Malformed token envelope")

    token = payload["t"]
    mac_b64u = str(payload["m"])

    if not isinstance(token, dict):
        raise RuntimeError("Token body must be an object")

    token_json = json.dumps(token, separators=(",", ":"), ensure_ascii=False)
    expected_mac = hmac.new(shared_secret, token_json.encode("utf-8"), sha256).digest()
    recv_mac = b64u_decode(mac_b64u)

    if not hmac.compare_digest(expected_mac, recv_mac):
        raise RuntimeError("Token MAC verification failed")

    if int(token.get("v", 0)) != 1:
        raise RuntimeError("Unsupported token version")

    if str(token.get("ch", "")) != challenge_b64u:
        raise RuntimeError("Challenge mismatch")

    exp = int(token.get("exp", 0))
    now = int(time.time())
    if exp < now:
        raise RuntimeError("Token expired")

    jti = str(token.get("jti", ""))
    if not jti:
        raise RuntimeError("Missing token id (jti)")
    if jti in used_ids:
        raise RuntimeError("Replay detected: token id already used")

    used_ids.add(jti)

    return {
        "sessionId": token.get("sid", ""),
        "nmec": token.get("nm", ""),
        "timestamp": token.get("ts", ""),
        "jti": jti,
        "exp": exp,
    }


SHARED_SECRET = load_or_create_secret()
USED_IDS = load_used_token_ids()


def init_pn532() -> PN532_I2C:
    i2c = busio.I2C(board.SCL, board.SDA)
    pn532 = PN532_I2C(i2c, debug=False)
    ic, ver, rev, support = pn532.firmware_version
    print(f"PN532 firmware v{ver}.{rev} detected (IC 0x{ic:02X}).")
    pn532.SAM_configuration()
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


def on_connect(tag):
    try:
        if HARD_LOCK_MODE and not is_window_open():
            print("Provisioning rejected: hard lock active and no open provisioning window.")
            return False

        # 1) SELECT AID
        select_apdu = bytes([0x00, INS_SELECT_AID, 0x04, 0x00, len(AID), *AID, 0x00])
        _, sw = send_and_parse(tag, "SELECT AID", select_apdu)
        if sw != SW_SUCCESS:
            print("SELECT failed")
            return False

        # 2) SET_READER_CHALLENGE
        challenge = os.urandom(16)
        challenge_b64u = b64u_encode(challenge)
        _, sw = send_and_parse(
            tag,
            "SET_READER_CHALLENGE",
            build_apdu(INS_SET_READER_CHALLENGE, data=challenge),
        )
        if sw != SW_SUCCESS:
            print("SET_READER_CHALLENGE failed")
            return False

        # 3) GET_PROVISION_TOKEN
        body, sw = send_and_parse(tag, "GET_PROVISION_TOKEN", build_apdu(INS_GET_PROVISION_TOKEN))
        if sw != SW_SUCCESS:
            print("GET_PROVISION_TOKEN failed")
            return False

        envelope = parse_json_body("GET_PROVISION_TOKEN", body)
        exam_data = verify_token(SHARED_SECRET, challenge_b64u, envelope, USED_IDS)
        save_used_token_ids(USED_IDS)

        print("Provisioned exam data:")
        print(json.dumps(exam_data, indent=2))

        # Consume the window after a successful provisioning so a new explicit arm is needed.
        if HARD_LOCK_MODE:
            clear_provisioning_window()
            print("Provisioning window consumed and locked.")

        return True
    except Exception as exc:
        print(f"Error: {exc}")
        return False


def parse_args():
    parser = argparse.ArgumentParser(
        description="NFC secure provisioning reader with hard lock mode"
    )
    parser.add_argument(
        "--arm",
        action="store_true",
        help="Open provisioning window and exit",
    )
    parser.add_argument(
        "--status",
        action="store_true",
        help="Show provisioning window status and exit",
    )
    parser.add_argument(
        "--clear-window",
        action="store_true",
        help="Clear/lock provisioning window and exit",
    )
    parser.add_argument(
        "--window-seconds",
        type=int,
        default=DEFAULT_WINDOW_SECONDS,
        help=f"Provisioning window duration in seconds (1-{MAX_WINDOW_SECONDS})",
    )
    return parser.parse_args()


def main():
    args = parse_args()

    print("Shared secret for the Examiner App (paste into the app as Base64URL):")
    print(b64u_encode(SHARED_SECRET))
    print("TODO: temporary manual secret sharing until server-based distribution is implemented.")

    if args.clear_window:
        clear_provisioning_window()
        print("Provisioning window cleared. Reader is locked.")
        return

    if args.arm:
        arm_provisioning_window(args.window_seconds)
        remaining = get_window_remaining_seconds()
        print(f"Provisioning window armed for {remaining} seconds.")
        return

    if args.status:
        remaining = get_window_remaining_seconds()
        if remaining > 0:
            print(f"Provisioning window OPEN ({remaining}s remaining).")
        else:
            print("Provisioning window CLOSED.")
        return

    if HARD_LOCK_MODE:
        remaining = get_window_remaining_seconds()
        if remaining > 0:
            print(f"Hard lock mode ON. Current window open for {remaining}s.")
        else:
            print("Hard lock mode ON. Window closed. Run with --arm to accept provisioning.")

    # Integration of the NFC module through I2C.
    pn532 = init_pn532()
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
