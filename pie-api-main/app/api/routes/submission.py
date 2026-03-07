from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List
import os
from datetime import datetime
from app.core.database import get_db
from app.models.db.submission import Submission
from app.schemas.submission import SubmissionOut
from app.schemas.session_user import SessionUserUpdate
from app.models.db.session import Session
from app.models.db.exam import Exam
from app.models.db.course import Course
from app.models.db.session_user import SessionUser
from app.core.security import validate_file, sanitize_filename, secure_join_path, create_secure_directory

import logging
logger = logging.getLogger("uvicorn.error")

router = APIRouter()

@router.post("/create", response_model=SubmissionOut)
async def create_submission(
    session_user_id: str,
    submission_file: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    """Submit a completed exam solution file"""
    session_user_id = int(session_user_id)

    # Verify session user exists
    session_user = db.query(SessionUser).filter(SessionUser.id == session_user_id).first()
    if session_user is None:
        raise HTTPException(status_code=404, detail="Session user not found")

    # Verify related records exist
    session = db.query(Session).filter(Session.id == session_user.session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    exam = db.query(Exam).filter(Exam.id == session.exam_id).first()
    course = db.query(Course).filter(Course.id == session.course_id).first()
    if not exam or not course:
        raise HTTPException(status_code=404, detail="Exam or course not found")

    # Verify session is started
    #if not session.is_started:
    #    raise HTTPException(status_code=403, detail="Exam session has not started yet")

    # Verify user is still within their time limit
    #current_time = datetime.utcnow()
    #if session_user.end_time and current_time > session_user.end_time:
    #    raise HTTPException(status_code=403, detail="Exam time has ended for this user")

    # Extract user ID for file naming
    user_nmec = session_user.user_nmec

    # Validate file - this calls scan_for_malicious_patterns internally
    try:
        file_content, safe_filename = await validate_file(submission_file)
    except HTTPException as e:
        # Add more context to the error
        raise HTTPException(
            status_code=e.status_code,
            detail=f"Submission file validation failed: {e.detail}"
        )

    # Create path with timestamp to prevent overwriting previous submissions
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    prefixed_filename = f"{user_nmec}_{timestamp}_{safe_filename}"

    # Create directory path
    course_name_sanitized = sanitize_filename(course.name)
    exam_name_sanitized = sanitize_filename(exam.name)
    session_name_sanitized = sanitize_filename(session.name)

    submissions_dir = secure_join_path("/home", course_name_sanitized,
                                     exam_name_sanitized,
                                     session_name_sanitized, "submissions")
    file_location = os.path.join(submissions_dir, prefixed_filename)

    # Ensure directory exists with proper permissions
    create_secure_directory(submissions_dir)

    # Save file with proper permissions
    try:
        with open(file_location, "wb") as file_object:
            file_object.write(file_content)

        # Set secure permissions
        os.chmod(file_location, 0o640)  # Read/write for owner, read for group
    except Exception as e:
        logger.error(f"Error saving submission file: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error saving file: {str(e)}")

    # Create submission record
    submission_date = datetime.utcnow()
    db_submission = Submission(
        session_user_id=session_user_id,
        submission_file=file_location,
        date=submission_date,
        original_filename=safe_filename,  # Store original name for reference
        file_size=len(file_content),     # Store file size
        mime_type=submission_file.content_type,  # Store MIME type
        grade=None
    )

    # Save to database with transaction
    try:
        db.add(db_submission)
        db.commit()
        db.refresh(db_submission)
    except Exception as e:
        # Clean up file if database operation fails
        if os.path.exists(file_location):
            os.remove(file_location)
        logger.error(f"Database error creating submission: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    return db_submission

@router.get("/{session_user_id}", response_model=List[SubmissionOut])
def read_submissions(session_user_id: int, db: Session = Depends(get_db)):
    submissions = db.query(Submission).filter(Submission.session_user_id == session_user_id).all()
    return submissions


@router.post("/{session_user_id}/start", response_model=SessionUserUpdate)
def start_session_user(session_user_id: int, db: Session = Depends(get_db)):
    session_user = db.query(SessionUser).filter(SessionUser.id == session_user_id).first()
    if session_user is None:
        raise HTTPException(status_code=404, detail="Session user not found")

    session_user.start_time = datetime.utcnow()
    db.commit()
    db.refresh(session_user)
    return session_user

@router.post("/{session_user_id}/end", response_model=SessionUserUpdate)
def end_session_user(session_user_id: int, db: Session = Depends(get_db)):
    session_user = db.query(SessionUser).filter(SessionUser.id == session_user_id).first()
    if session_user is None:
        raise HTTPException(status_code=404, detail="Session user not found")

    session_user.end_time = datetime.utcnow()
    db.commit()
    db.refresh(session_user)
    return session_user