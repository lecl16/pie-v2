from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.session import Session
from app.models.db.session_user import SessionUser
from app.models.db.user import User
from app.models.db.device_provisioning_secret import DeviceProvisioningSecret
from app.api.routes.device import join_mac
from app.core.auth import get_current_user
from app.schemas.session_user import SessionUserCreate, SessionUserOut, SessionUserUpdate, SessionUserTime
import json
import base64
import hmac
from app.core.security import get_key_from_storage, verify_hmac
from fastapi.responses import JSONResponse
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

def _join_response(db_session_user: SessionUser, session: Session) -> dict:
    return {
        "id": db_session_user.id,
        "user_nmec": db_session_user.user_nmec,
        "session_id": db_session_user.session_id,
        "course_id": session.course_id,
        "exam_id": session.exam_id,
        "device_id": db_session_user.device_id,
        "duration": session.duration,
        "changed_time": getattr(db_session_user, 'changed_time', 0),
        "allowed_links": session.allowed_links,
        "exam": session.exam_link if session.exam_link else "files"
    }

@router.post("/create", response_model=SessionUserOut)
def create_session_user(
    session_user: SessionUserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Tap-gated join — see docs/tap-gated-student-join.md section 5. Only
    the student the examiner assigned to this device, joining from the
    device that confirmed the session secret, gets in."""
    # Get the session first using the join_code
    session = db.query(Session).filter(Session.join_code == session_user.join_code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    # A confirmed tap stays valid until the session ends, not just until
    # its 5-minute confirmation window (docs/tap-gated-student-join.md
    # section 7).
    if session.is_ended:
        raise HTTPException(status_code=403, detail="Session has ended")

    # The joining student is whoever is logged in, never a body field.
    user_nmec = current_user.nmec

    secret_row = db.query(DeviceProvisioningSecret).filter(
        DeviceProvisioningSecret.device_id == session_user.device_id,
        DeviceProvisioningSecret.session_id == session.id,
    ).first()
    if secret_row is None or secret_row.claimed_at is None:
        raise HTTPException(status_code=403, detail="Device not provisioned for this session")
    if secret_row.nmec != user_nmec:
        raise HTTPException(status_code=403, detail="Device assigned to another student")

    expected = join_mac(secret_row.secret, session_user.device_id, session.id, user_nmec, session_user.nonce)
    if not hmac.compare_digest(expected, session_user.mac):
        raise HTTPException(status_code=401, detail="Invalid join proof")

    # Rejoin after a reboot or crash of the exam host: same student, same
    # tapped device, attempt not finished — hand back the existing row
    # instead of failing with "User already in session".
    existing = db.query(SessionUser).filter(
        SessionUser.session_id == session.id,
        SessionUser.user_nmec == user_nmec,
    ).first()
    if existing is not None:
        if existing.device_id != session_user.device_id:
            raise HTTPException(status_code=400, detail="User already in session on another device")
        if existing.end_time is not None:
            raise HTTPException(status_code=400, detail="User already finished this session")
        return _join_response(existing, session)

    session_user_data = {
        'session_id': session.id,
        'user_nmec': user_nmec,
        'device_id': session_user.device_id,
    }

    db_session_user = SessionUser(**session_user_data)

    try:
        # Check if the user is already in the session
        if db.query(SessionUser).filter(SessionUser.session_id == session_user_data['session_id'], 
                                        SessionUser.user_nmec == session_user_data['user_nmec']).first():
            raise HTTPException(status_code=400, detail="User already in session")
        
        # Check if user email is on the allowed_students
        if session.allowed_students and current_user.email not in session.allowed_students:
            raise HTTPException(status_code=400, detail="User not allowed in session")
                 
        db.add(db_session_user)
        db.commit()
        db.refresh(db_session_user)
        
        # if session.exam_link:
        #     try:
        #         parts = session.exam_link.split("|")
        #         if len(parts) != 2:
        #             raise ValueError("Invalid exam link format")
                
        #         exam_link, hmac = parts
        #         logger.error(f"Exam link part: {exam_link}, HMAC part: {hmac}")
        #         hmac_bytes = base64.urlsafe_b64decode(hmac)
                
        #         key = get_key_from_storage(session.encryption_key)
        #         logger.error(f"Key for HMAC verification: {key}")
        #         if not verify_hmac(key, exam_link, hmac_bytes):
        #             return JSONResponse(
        #                 status_code=403,
        #                 content={"detail": "HMAC verification failed", "error_code": "HMAC_FAILED"}
        #             )
        #     except Exception as e:
        #         logger.error(f"Error processing exam link: {exam_link}") 
        #         raise HTTPException(status_code=400, detail=f"Invalid exam link format: {str(e)}")
        # else:
        #     exam_link = "files"
        
        response_data = _join_response(db_session_user, session)
        logger.error(f"Response: {response_data}")
        return response_data
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/", response_model=List[SessionUserOut])
def read_session_user(db: Session = Depends(get_db)):
    session_users = db.query(SessionUser).all()
    for session_user in session_users:
        session = db.query(Session).filter(Session.id == session_user.session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        session_user.exam_id = session.exam_id
        session_user.course_id = session.course_id
        session_user.duration = session.duration
        session_user.exam = session.exam_link if session.exam_link else "files"
    return session_users

@router.get("/{session_id}", response_model=List[SessionUserOut])
def read_session_user(session_id: int, db: Session = Depends(get_db)):
    session_users = db.query(SessionUser).filter(SessionUser.session_id == session_id).all()
    session = db.query(Session).filter(Session.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    for session_user in session_users:
        session_user.exam_id = session.exam_id
        session_user.course_id = session.course_id
        session_user.duration = session.duration
        session_user.exam = session.exam_link if session.exam_link else "files"
    return session_users

@router.patch("/{id}/time", response_model=SessionUserOut)
def update_user_time(id: int, time_data: SessionUserTime, db: Session = Depends(get_db)):
    """Update only the changed_time field without affecting other fields"""
    db_session_user = db.query(SessionUser).filter(SessionUser.id == id).first()
    if not db_session_user:
        raise HTTPException(status_code=404, detail="Session user not found")
    
    db_session_user.changed_time =  time_data.changed_time
    
    db.commit()
    db.refresh(db_session_user)
    
    # Add these lines to populate the response model fields
    session = db.query(Session).filter(Session.id == db_session_user.session_id).first()
    db_session_user.exam_id = session.exam_id
    db_session_user.course_id = session.course_id
    db_session_user.duration = session.duration
    session_user.exam = session.exam_link if session.exam_link else "files"
    
    return db_session_user