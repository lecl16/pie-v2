import json

import nfc

AID = bytes([0xF0, 0x45, 0x58, 0x4D, 0x41, 0x50, 0x50, 0x31])

INS_SELECT_AID = 0xA4
INS_GET_EXAM_DATA = 0xCA

SW_SUCCESS = b"\x90\x00"


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


def on_connect(tag):
    try:
        # 1) SELECT AID
        select_apdu = bytes([0x00, INS_SELECT_AID, 0x04, 0x00, len(AID), *AID, 0x00])
        _, sw = send_and_parse(tag, "SELECT AID", select_apdu)
        if sw != SW_SUCCESS:
            print("SELECT failed")
            return False

        # 2) GET_EXAM_DATA
        body, sw = send_and_parse(tag, "GET_EXAM_DATA", build_apdu(INS_GET_EXAM_DATA))
        if sw != SW_SUCCESS:
            print("GET_EXAM_DATA failed")
            return False
        exam_data = parse_json_body("GET_EXAM_DATA", body)
        print("Exam data:")
        print(json.dumps(exam_data, indent=2))

        return True
    except Exception as exc:
        print(f"Error: {exc}")
        return False


# Adjust the device string to match your connection method:
#   UART  -> 'tty:AMA0'
#   USB   -> 'usb'
#   SPI   -> 'spi:spidev0.0'
#   I2C   -> 'i2c:/dev/i2c-1'
with nfc.ContactlessFrontend("tty:AMA0") as clf:
    print("Waiting for phone...")
    while True:
        clf.connect(rdwr={"on-connect": on_connect})
