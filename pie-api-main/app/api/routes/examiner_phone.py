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
from app.models.db.course import Course
from app.models.db.device_provisioning_secret import DeviceProvisioningSecret
from app.models.db.exam import Exam
from app.models.db.examiner_phone import ExaminerPhone
from app.models.db.session import Session as ExamSession
from app.models.db.user import User
from app.schemas.examiner_phone import (
    ExaminerPhoneEnroll,
    ExaminerPhoneEnrolled,
    ExaminerPhoneOut,
    ProvisioningSessionOut,
    ProvisioningStudentOut,
    ProvisioningStudentsOut,
)

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


# --- What the app's provisioning screen offers to pick from ---
# Read-only, but limited like the trusted-node actions it feeds (enrolled
# phone + its teacher), since the student list holds names and NMECs.

@router.get("/provisioning/sessions", response_model=List[ProvisioningSessionOut])
def provisioning_sessions(
    db: Session = Depends(get_db),
    phone: ExaminerPhone = Depends(get_examiner_phone),
):
    """Sessions not yet ended, newest date first, with their course and exam
    names, so the examiner picks one instead of typing three IDs."""
    rows = (
        db.query(ExamSession, Course, Exam)
        .outerjoin(Course, Course.id == ExamSession.course_id)
        .outerjoin(Exam, Exam.id == ExamSession.exam_id)
        .filter(ExamSession.is_ended.isnot(True))
        .order_by(ExamSession.date.desc(), ExamSession.id.desc())
        .all()
    )
    return [
        ProvisioningSessionOut(
            course_id=exam_session.course_id,
            course_name=course.name if course else None,
            exam_id=exam_session.exam_id,
            exam_name=exam.name if exam else None,
            session_id=exam_session.id,
            session_name=exam_session.name,
            room=exam_session.room,
            date=exam_session.date,
            is_started=bool(exam_session.is_started),
        )
        for exam_session, course, exam in rows
    ]


@router.get("/provisioning/sessions/{session_id}/students", response_model=ProvisioningStudentsOut)
def provisioning_students(
    session_id: int,
    db: Session = Depends(get_db),
    phone: ExaminerPhone = Depends(get_examiner_phone),
):
    """The session's allowed students, by name, with the device each one is
    currently assigned to, so the examiner picks the student whose card they
    checked instead of typing the NMEC."""
    exam_session = db.query(ExamSession).filter(ExamSession.id == session_id).first()
    if exam_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    allowed = exam_session.allowed_students or []
    if not allowed:
        return ProvisioningStudentsOut(restricted=False, students=[])

    assigned = {
        row.nmec: row.device_id
        for row in db.query(DeviceProvisioningSecret)
        .filter(DeviceProvisioningSecret.session_id == session_id)
        .all()
        if row.nmec is not None
    }
    students = (
        db.query(User)
        .filter(User.email.in_(allowed), User.role == "student")
        .order_by(User.name)
        .all()
    )
    return ProvisioningStudentsOut(
        restricted=True,
        students=[
            ProvisioningStudentOut(
                nmec=student.nmec,
                name=student.name,
                email=student.email,
                device_id=assigned.get(student.nmec),
            )
            for student in students
        ],
    )
