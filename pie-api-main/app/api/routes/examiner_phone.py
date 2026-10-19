"""Enrollment of Examiner App phones — see docs/examiner-phone-enrollment.md.

The phone generates its key pair in the Android Keystore and sends a
certificate signing request after the teacher logs in; the server signs a
client certificate with the phone CA and records the phone. From then on
the trusted-node actions (creating devices, registering provisioning
secrets) are accepted only over Caddy's phone port, with that certificate,
from that teacher (app.core.auth.get_examiner_phone)."""

import logging
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.auth import get_examiner_phone, get_teacher_or_admin_user
from app.core.config import config
from app.core.database import get_db
from app.core.phone_certs import InvalidCsr, certificate_pem, issue_phone_certificate, load_phone_csr
from app.models.db.examiner_phone import ExaminerPhone
from app.models.db.user import User
from app.schemas.examiner_phone import ExaminerPhoneEnroll, ExaminerPhoneEnrolled, ExaminerPhoneOut

logger = logging.getLogger("uvicorn.error")
router = APIRouter()

@router.post("/enroll", response_model=ExaminerPhoneEnrolled)
def enroll_phone(
    payload: ExaminerPhoneEnroll,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_teacher_or_admin_user),
):
    try:
        csr = load_phone_csr(payload.csr)
    except InvalidCsr as e:
        raise HTTPException(status_code=422, detail=str(e))

    now = datetime.utcnow()
    # The row's id names the certificate (CN=phone-<id>), so it is created
    # first, with a placeholder fingerprint, inside the same transaction.
    phone = ExaminerPhone(
        user_nmec=current_user.nmec,
        label=payload.label.strip() or None,
        cert_fingerprint=f"pending-{now.timestamp()}",
        cert_serial="",
        created_at=now,
        expires_at=now,
    )
    db.add(phone)
    db.flush()

    cert, fingerprint, serial, not_after = issue_phone_certificate(csr, phone.id)
    phone.cert_fingerprint = fingerprint
    phone.cert_serial = serial
    phone.expires_at = not_after
    db.commit()
    db.refresh(phone)
    logger.info(
        "Examiner phone %s enrolled by user %s (label=%r, fingerprint=%s)",
        phone.id, current_user.nmec, phone.label, fingerprint,
    )

    return ExaminerPhoneEnrolled(
        **ExaminerPhoneOut.model_validate(phone).model_dump(),
        certificate=certificate_pem(cert),
        mtls_port=config.PHONE_MTLS_PORT,
    )

@router.get("/current", response_model=ExaminerPhoneOut)
def current_phone(phone: ExaminerPhone = Depends(get_examiner_phone)):
    """Called by the app on the phone port to check that its certificate is
    accepted (enrolled, not revoked, same teacher)."""
    return phone

@router.get("/", response_model=List[ExaminerPhoneOut])
def list_phones(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_teacher_or_admin_user),
):
    """A teacher sees their own phones; an admin sees every phone."""
    query = db.query(ExaminerPhone)
    if current_user.role != "admin":
        query = query.filter(ExaminerPhone.user_nmec == current_user.nmec)
    return query.order_by(ExaminerPhone.created_at.desc()).all()

@router.delete("/{phone_id}", response_model=ExaminerPhoneOut)
def revoke_phone(
    phone_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_teacher_or_admin_user),
):
    """Revokes one phone (e.g. a lost one) without touching any other phone
    or the teacher's password. Takes effect on the phone's next request."""
    phone = db.query(ExaminerPhone).filter(ExaminerPhone.id == phone_id).first()
    if phone is None or (current_user.role != "admin" and phone.user_nmec != current_user.nmec):
        raise HTTPException(status_code=404, detail="Phone not found")
    if phone.revoked_at is None:
        phone.revoked_at = datetime.utcnow()
        db.commit()
        db.refresh(phone)
        logger.info("Examiner phone %s revoked by user %s", phone.id, current_user.nmec)
    return phone
