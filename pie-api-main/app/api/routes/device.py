import base64
import hmac
from datetime import datetime
from hashlib import sha256
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.auth import get_device, get_examiner_phone
from app.core.config import config
from app.core.database import get_db
from app.core.device_psk import new_wrapped_psk
from app.core.security import generate_device_api_key, hash_device_key
from app.models.db.device import Device
from app.models.db.device_provisioning_secret import DeviceProvisioningSecret
from app.models.db.examiner_phone import ExaminerPhone
from app.models.db.session import Session as ExamSession
from app.models.db.user import User
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceOut, DeviceCreated
from app.schemas.device_provisioning_secret import (
    DeviceProvisioningSecretConfirm,
    DeviceProvisioningSecretConfirmed,
)

CONFIRM_LABEL_DEVICE = "pie-confirm-v2|device"
CONFIRM_LABEL_SERVER = "pie-confirm-v2|server"

def b64u_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")

def b64u_decode(encoded: str) -> bytes:
    padding = "=" * ((4 - len(encoded) % 4) % 4)
    return base64.urlsafe_b64decode((encoded + padding).encode("ascii"))

router = APIRouter()

@router.post("/create", response_model=DeviceCreated)
def create_device(
    device: DeviceCreate,
    db: Session = Depends(get_db),
    # Only an enrolled Examiner App phone mints device identities, since it
    # is the one that delivers them in the registration tap
    # (docs/examiner-phone-enrollment.md).
    phone: ExaminerPhone = Depends(get_examiner_phone),
):
    api_key = generate_device_api_key()
    db_device = Device(
        **device.dict(),
        device_api_key_hash=hash_device_key(api_key),
        created_by_phone_id=phone.id,
    )
    try:
        db.add(db_device)
        db.flush()  # the id is part of the PSK's derivation
        db_device.tls_psk_enc = new_wrapped_psk(api_key, db_device.id)
        db.commit()
        db.refresh(db_device)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return DeviceCreated(
        id=db_device.id,
        name=db_device.name,
        last_ip=db_device.last_ip,
        last_online=db_device.last_online,
        last_update=db_device.last_update,
        api_key=api_key,
    )

@router.get("/", response_model=List[DeviceOut])
def read_devices(db: Session = Depends(get_db)):
    devices = db.query(Device).all()
    return devices

@router.get("/{device_id}", response_model=DeviceOut)
def read_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@router.put("/{device_id}", response_model=DeviceOut)
def update_device(device_id: int, device: DeviceUpdate, db: Session = Depends(get_db)):
    db_device = db.query(Device).filter(Device.id == device_id).first()
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    for key, value in device.dict().items():
        setattr(db_device, key, value)
    db.commit()
    db.refresh(db_device)
    return db_device

@router.delete("/{device_id}", response_model=DeviceOut)
def delete_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    db.delete(device)
    db.commit()
    return device

@router.post("/{device_id}/rotate-key", response_model=DeviceCreated)
def rotate_device_key(device_id: int, db: Session = Depends(get_db)):
    """Revokes a device's current API key and issues a new one in its place,
    keeping the `Device` row (and its `session_user` history) intact — see
    pie-api-main/docs/device-identity-nfc-bootstrap.md section 4. This is
    step 1 of that doc's two-step reset procedure: rotate here first, only
    then clear the device's local /etc/pie/device.json, never the reverse.
    Like `POST /create`, the plaintext key is returned once and never
    stored or retrievable in plaintext again. Also replaces the device's
    TLS pre-shared key, which is derived from it (docs/device-tls-psk.md),
    so the old key stops working on the device port too."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")

    api_key = generate_device_api_key()
    device.device_api_key_hash = hash_device_key(api_key)
    device.tls_psk_enc = new_wrapped_psk(api_key, device.id)
    db.commit()
    db.refresh(device)
    return DeviceCreated(
        id=device.id,
        name=device.name,
        last_ip=device.last_ip,
        last_online=device.last_online,
        last_update=device.last_update,
        api_key=api_key,
    )

# --- Secret-authenticated endpoint (no JWT, no X-Device-Key) ---

def provisioning_confirm_mac(secret_b64u: str, label: str, device_id: int, session_id: int, nonce: str) -> str:
    """Must match confirm_proof() in NFC-Support/reader_script.py."""
    message = f"{label}|{device_id}|{session_id}|{nonce}".encode("utf-8")
    return b64u_encode(hmac.new(b64u_decode(secret_b64u), message, sha256).digest())

JOIN_LABEL = "pie-join-v1"

def join_key(secret_b64u: str, device_id: int, session_id: int) -> bytes:
    """Key the Pi derives from the session secret and hands to DevApp-main,
    so the secret itself never leaves the Pi — see
    docs/tap-gated-student-join.md section 3. Must match join_key() in
    NFC-Support/device_identity_server.py."""
    message = f"{JOIN_LABEL}|{device_id}|{session_id}".encode("utf-8")
    return hmac.new(b64u_decode(secret_b64u), message, sha256).digest()

def join_mac(secret_b64u: str, device_id: int, session_id: int, nmec: int, nonce: str) -> str:
    """Proof DevApp-main sends with its session join (section 4). Must match
    _joinMac() in DevApp-main/lib/main.dart."""
    message = f"{JOIN_LABEL}|{device_id}|{session_id}|{nmec}|{nonce}".encode("utf-8")
    return b64u_encode(hmac.new(join_key(secret_b64u, device_id, session_id), message, sha256).digest())

@router.post(
    "/{device_id}/provisioning-secret/{session_id}/confirm",
    response_model=DeviceProvisioningSecretConfirmed,
)
def confirm_provisioning_secret(
    device_id: int,
    session_id: int,
    payload: DeviceProvisioningSecretConfirm,
    db: Session = Depends(get_db),
):
    """Called by the device right after an NFC session tap — see
    docs/examiner-trusted-node-provisioning.md section 4. The device proves
    it holds the secret the examiner app registered for this device and
    session; the response proves the same back, so the device knows it is
    talking to the server the phone registered with. Deliberately takes no
    X-Device-Key: the device may be handed a new server URL in that same tap,
    and must not send its long-lived key to a URL it hasn't verified yet.
    Single-use: a confirmed secret can't be confirmed again."""
    rejected = HTTPException(status_code=401, detail="Invalid provisioning proof")

    secret_row = db.query(DeviceProvisioningSecret).filter(
        DeviceProvisioningSecret.device_id == device_id,
        DeviceProvisioningSecret.session_id == session_id,
    ).first()
    if secret_row is None:
        raise rejected
    if secret_row.claimed_at is not None:
        raise HTTPException(status_code=409, detail="Provisioning secret already confirmed")
    if datetime.utcnow() > secret_row.expires_at:
        raise HTTPException(status_code=410, detail="Provisioning secret expired")

    expected = provisioning_confirm_mac(
        secret_row.secret, CONFIRM_LABEL_DEVICE, device_id, session_id, payload.nonce
    )
    if not hmac.compare_digest(expected, payload.mac):
        raise rejected

    secret_row.claimed_at = datetime.utcnow()
    db.commit()

    student = db.query(User).filter(User.nmec == secret_row.nmec).first() if secret_row.nmec is not None else None
    return DeviceProvisioningSecretConfirmed(
        sessionId=str(session_id),
        # The examiner-assigned student (docs/tap-gated-student-join.md),
        # authoritative over the copy the phone put in the tap.
        nmec=str(secret_row.nmec) if secret_row.nmec is not None else "",
        # Shown by the exam app, so the student can see the seat is theirs
        # (there is no student login to catch a wrong assignment).
        name=student.name if student is not None and student.name else "",
        mac=provisioning_confirm_mac(
            secret_row.secret, CONFIRM_LABEL_SERVER, device_id, session_id, payload.nonce
        ),
    )

# --- Device-key-authenticated endpoint (no JWT) ---

@router.get("/{device_id}/session/{session_id}/status")
def provisioned_session_status(
    device_id: int,
    session_id: int,
    device: Device = Depends(get_device),
    db: Session = Depends(get_db),
):
    """Polled by the Pi's device_identity_server.py so it can drop its
    session.json once the provisioning no longer lets anyone join — see
    docs/tap-gated-student-join.md section 7. A confirmed tap stays valid
    across reboots until then. The X-Device-Key here is safe to send: the
    Pi only polls the apiBaseUrl the server already proved itself on in the
    confirmation (docs/examiner-trusted-node-provisioning.md section 4)."""
    if device.id != device_id:
        raise HTTPException(status_code=403, detail="Not this device")

    exam_session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    secret_row = db.query(DeviceProvisioningSecret).filter(
        DeviceProvisioningSecret.device_id == device_id,
        DeviceProvisioningSecret.session_id == session_id,
    ).first()
    active = (
        exam_session is not None
        and not exam_session.is_ended
        and secret_row is not None
        and secret_row.claimed_at is not None
    )
    return {"active": active}

@router.get("/{device_id}/server-ca")
def server_ca(device_id: int, device: Device = Depends(get_device)):
    """This deployment's CA certificate (PEM), which the Pi relays to the exam
    app so it can verify this server's certificate (docs/exam-app-tls.md).
    The Pi fetches it only over its TLS-PSK port, so it comes from the
    server that holds this device's key. The CA is public; X-Device-Key only
    keeps the route to registered devices, like the status route."""
    if device.id != device_id:
        raise HTTPException(status_code=403, detail="Not this device")
    try:
        with open(config.SERVER_CA_CERT_PATH, encoding="ascii") as ca_file:
            pem = ca_file.read()
    except OSError:
        raise HTTPException(status_code=503, detail="Server CA not configured")
    return {"caCert": pem}
