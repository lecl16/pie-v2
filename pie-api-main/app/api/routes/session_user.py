from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.session import Session
from app.models.db.session_user import SessionUser
from app.models.db.user import User
from app.schemas.session_user import SessionUserCreate, SessionUserOut, SessionUserUpdate, SessionUserTime
import json
import base64
from app.core.security import get_key_from_storage, verify_hmac
from fastapi.responses import JSONResponse
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn.error")

@router.post("/create", response_model=SessionUserOut)
def create_session_user(session_user: SessionUserCreate, db: Session = Depends(get_db)):
    # Get the session first using the join_code
    session = db.query(Session).filter(Session.join_code == session_user.join_code).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Create a dict from session_user but exclude join_code which is not in the SessionUser model
    session_user_data = session_user.dict()
    join_code = session_user_data.pop('join_code', None)  # Remove join_code from the dict
    
    # Set the session_id from the session we found
    session_user_data['session_id'] = session.id
    
    db_session_user = SessionUser(**session_user_data)

    try:
        # Check if the user is already in the session
        if db.query(SessionUser).filter(SessionUser.session_id == session_user_data['session_id'], 
                                        SessionUser.user_nmec == session_user_data['user_nmec']).first():
            raise HTTPException(status_code=400, detail="User already in session")
        
        # Check if user email is on the allowed_students
        if session.allowed_students:
            # Get the user email from the nmec
            user = db.query(User).filter(User.nmec == session_user_data['user_nmec']).first()
            if not user:
                raise HTTPException(status_code=404, detail="User not found")
            if user.email not in session.allowed_students:
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
        
        response_data = {
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