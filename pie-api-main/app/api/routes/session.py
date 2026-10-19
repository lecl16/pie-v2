from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response, Form, Query
from fastapi.responses import FileResponse, JSONResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.database import get_db
from app.models.db.session import Session as dbSession
from app.models.db.exam import Exam as dbExam
from app.models.db.course import Course as dbCourse
from app.models.db.submission import Submission
from app.models.db.session_user import SessionUser
from app.models.db.device_provisioning_secret import DeviceProvisioningSecret
from app.schemas.session import SessionCreate, SessionUpdate, SessionOut, SessionUpload
from app.schemas.submission import SubmissionOut
from app.models.db.device import Device
from app.models.db.user import User
from app.schemas.device_provisioning_secret import (
    DeviceProvisioningSecretRegister,
    DeviceProvisioningSecretRegistered,
)
from app.core.auth import get_examiner_phone
from app.models.db.examiner_phone import ExaminerPhone
import os
import mimetypes
import zipfile
import random
import string
from datetime import datetime, timedelta
from app.core.security import (validate_file, sanitize_filename, secure_join_path, create_secure_directory, encrypt_file, format_key_for_storage, get_key_from_storage, generate_encryption_key, generate_hmac, verify_hmac, format_hmac_for_storage)
import tempfile
from starlette.background import BackgroundTask
import logging
import shutil
from app.services.pubsub_service import redis_pubsub
import json
import base64

logger = logging.getLogger("uvicorn.error")
router = APIRouter()

@router.post("/session-create", response_model=SessionOut)
def create_session(course_id: str, exam_id: int, session: SessionCreate, db: Session = Depends(get_db)):
    course = db.query(dbCourse).filter(dbCourse.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    exam = db.query(dbExam).filter(
        dbExam.id == exam_id,
        dbExam.course_id == course_id
    ).first()
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found for this course")

    session_data = session.dict()
    session_data["course_id"] = course_id
    session_data["exam_id"] = exam_id

    # Process allowed_students if it contains email objects
    if session_data.get("allowed_students"):
        # Extract email strings from the objects if necessary
        processed_students = []
        for student in session_data["allowed_students"]:
            if isinstance(student, dict) and "email" in student:
                processed_students.append(student["email"])
            else:
                processed_students.append(student)
        session_data["allowed_students"] = processed_students

    if not session_data.get("join_code"):
        session_data["join_code"] = generate_join_code(db)
        
    db_session = dbSession(**session_data)

    try:
        db.add(db_session)
        db.commit()
        db.refresh(db_session)
        return db_session
    except Exception as e:
        db.rollback()
        logger.error(f"Error creating session: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

def generate_join_code(db: Session, max_attempts=10):
    attempts = 0
    while attempts < max_attempts:
        join_code = ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))
        if not db.query(dbSession).filter(dbSession.join_code == join_code).first():
            return join_code
        attempts += 1
    raise HTTPException(status_code=500, detail="Could not generate unique join code after multiple attempts")

@router.get("/sessions", response_model=List[SessionOut])
def read_sessions(course_id: str, exam_id: int, db: Session = Depends(get_db)):
    sessions = db.query(dbSession).filter(dbSession.course_id == course_id, dbSession.exam_id == exam_id).all()
    return sessions

@router.get("/{session_id}", response_model=SessionOut)
def read_session(course_id: str, exam_id: int, session_id: int, db: Session = Depends(get_db)):
    session = db.query(dbSession).filter(dbSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

@router.post("/{session_id}/upload", response_model=SessionOut)
async def upload_exam_files(
    course_id: str,
    exam_id: int,
    session_id: int,
    files: List[UploadFile] = File(None),
    exam_link: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):

    db_session = db.query(dbSession).filter(dbSession.id == session_id).first()
    if not db_session:
        raise HTTPException(status_code=404, detail="Session not found")

    exam = db.query(dbExam).filter(dbExam.id == db_session.exam_id).first()
    course = db.query(dbCourse).filter(dbCourse.id == db_session.course_id).first()
    if not exam or not course:
        raise HTTPException(status_code=404, detail="Exam or course not found")

    has_files = files and any(f.filename for f in files)
    has_link = exam_link and exam_link.strip() and exam_link != "string"

    if has_files and has_link:
        raise HTTPException(
            status_code=400,
            detail="Cannot provide both files and an exam link. Choose one method only."
        )

    if exam_link and exam_link.strip():
        if exam_link == "string" or not (exam_link.startswith('http://') or exam_link.startswith('https://')):
            raise HTTPException(
                status_code=400,
                detail="Exam link must be a valid URL starting with http:// or https://"
            )

        # if not db_session.encryption_key:
        #     key = generate_encryption_key()
        #     db_session.encryption_key = format_key_for_storage(key)
        # else:
        #     key = get_key_from_storage(db_session.encryption_key)

        # hmac_value = generate_hmac(key, exam_link)
        # hmac_str = format_hmac_for_storage(hmac_value)
        db_session.exam_link = exam_link  # Store the link directly
        db_session.encrypted_exam_file = None
        
        try:
            db.commit()
            return db_session
        except Exception as e:
            db.rollback()
            logger.error(f"Database error: {str(e)}")
            raise HTTPException(status_code=500, detail="Error saving exam link")

    # Ensure files were provided if no valid link
    if not has_files:
        raise HTTPException(status_code=400, detail="Either valid files or an exam link must be provided")

    try:
        db_session.exam_link = None

        course_name_sanitized = sanitize_filename(course.name)
        exam_name_sanitized = sanitize_filename(exam.name)
        session_name_sanitized = sanitize_filename(db_session.name)
        dir_path = secure_join_path("/home", course_name_sanitized,
                                  exam_name_sanitized, session_name_sanitized)
        create_secure_directory(dir_path)

        key = generate_encryption_key()

        original_filenames = []
        validated_files = []

        for file in files:
            if not file.filename or file.filename.strip() == "":
                continue

            file_content, safe_filename = await validate_file(file)
            validated_files.append((file_content, safe_filename))
            original_filenames.append(safe_filename)

        if len(validated_files) > 1:
            zip_filename = f"exam_{session_id}.zip"
            zip_path = os.path.join(dir_path, zip_filename)

            with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                for content, filename in validated_files:
                    zipf.writestr(filename, content)

            with open(zip_path, 'rb') as f:
                file_content = f.read()

            os.remove(zip_path)
            encrypted_filename = f"{zip_filename}.encrypted"

        else:
            file_content, filename = validated_files[0]
            encrypted_filename = f"{filename}.encrypted"

        encrypted_content, _ = encrypt_file(file_content, key)
        encrypted_file_path = os.path.join(dir_path, encrypted_filename)

        with open(encrypted_file_path, 'wb') as f:
            f.write(encrypted_content)

        os.chmod(encrypted_file_path, 0o644)  # Read-write for owner, read-only for group and others

        db_session.original_filename = ", ".join(original_filenames)
        db_session.encrypted_exam_file = encrypted_file_path
        db_session.encryption_key = format_key_for_storage(key)

        try:
            db.commit()
        except Exception as e:
            logger.error(f"Database commit error: {str(e)}")
            raise HTTPException(status_code=500, detail="Error saving to database")

        return db_session

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error uploading exam files: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error uploading files: {str(e)}")

@router.get("/{session_id}/download")
def download_exam_file(
    course_id: str,
    exam_id: int,
    session_id: int,
    db: Session = Depends(get_db)
):
    try:
        db_session = db.query(dbSession).filter(
            dbSession.id == session_id,
            dbSession.course_id == course_id,
            dbSession.exam_id == exam_id
        ).first()

        if not db_session:
            return JSONResponse(
                status_code=404,
                content={"detail": "Session not found", "error_code": "SESSION_NOT_FOUND"}
            )

        if db_session.exam_link:
            try:
                parts = db_session.exam_link.split("|")
                if len(parts) != 2:
                    raise ValueError("Invalid exam link format")
                
                exam_link, hmac = parts
                hmac_bytes = base64.urlsafe_b64decode(hmac)
                
                key = get_key_from_storage(db_session.encryption_key)
                
                if not verify_hmac(key, exam_link, hmac_bytes):
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "HMAC verification failed", "error_code": "HMAC_FAILED"}
                    )
                
                return JSONResponse(
                    status_code=200,
                    content={"link": exam_link}
                )
            
            except Exception as e:
                    logger.error(f"Error downloading exam file: {str(e)}")
                    return JSONResponse(
                        status_code=500,
                        content={"detail": f"Server error: {str(e)}", "error_code": "SERVER_ERROR"}
                    )
        
        if not db_session.encrypted_exam_file:
            return JSONResponse(
                status_code=404,
                content={"detail": "No encrypted file path found in database", "error_code": "FILE_PATH_MISSING"}
            )

        # Verify file exists on filesystem
        if not os.path.exists(db_session.encrypted_exam_file):
            return JSONResponse(
                status_code=404,
                content={"detail": f"File not found at path: {db_session.encrypted_exam_file}",
                         "error_code": "FILE_NOT_FOUND"}
            )

        if not os.access(db_session.encrypted_exam_file, os.R_OK):
            return JSONResponse(
                status_code=403,
                content={"detail": "File exists but is not readable (permission issue)",
                         "error_code": "FILE_NOT_READABLE"}
            )

        filename = os.path.basename(db_session.encrypted_exam_file)

        return FileResponse(
            path=db_session.encrypted_exam_file,
            filename=filename,
            media_type="application/octet-stream"
        )

    except Exception as e:
        logger.exception(f"Error in download endpoint: {str(e)}")
        return JSONResponse(
            status_code=500,
            content={"detail": f"Server error: {str(e)}", "error_code": "SERVER_ERROR"}
        )

@router.put("/{session_id}", response_model=SessionOut)
async def update_session(
    course_id: str,
    exam_id: int,
    session_id: int,
    session: SessionUpdate = None,
    name: Optional[str] = Form(None),
    date: Optional[datetime] = Form(None),
    duration: Optional[str] = Form(None),
    room: Optional[str] = Form(None),
    files: List[UploadFile] = File(None),
    exam_link: Optional[str] = Form(None),
    allowed_students: Optional[str] = Form(None),  
    allowed_links: Optional[str] = Form(None),     
    keep_existing_materials: Optional[str] = Form(None),
    db: Session = Depends(get_db)
):
    db_session = db.query(dbSession).filter(dbSession.id == session_id).first()
    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if name:
        db_session.name = name
    if date:
        db_session.date = date
    if duration:
        db_session.duration = int(duration)
    if room:
        db_session.room = room
        
    if allowed_students:
        try:
            # Parse the JSON string into a Python list
            student_list = json.loads(allowed_students)
            db_session.allowed_students = student_list
            logger.info(f"Updated allowed_students for session {session_id}: {student_list}")
        except Exception as e:
            logger.error(f"Error parsing allowed_students: {str(e)}")  
             
    if allowed_links:
        try:
            # Parse the JSON string into a Python list
            links_list = json.loads(allowed_links)
            db_session.allowed_links = links_list
            logger.info(f"Updated allowed_links for session {session_id}: {links_list}")
        except Exception as e:
            logger.error(f"Error parsing allowed_links: {str(e)}")
        
    

    has_files = files and any(f.filename for f in files)
    has_link = exam_link and exam_link.strip() and exam_link != "string"

    if (has_files or has_link) and db_session.is_started:
        raise HTTPException(
            status_code=403,
            detail="Cannot change exam content after session has started"
        )

    if session:
        update_data = session.dict(exclude={"encrypted_exam_file", "encryption_key", "exam_link"})
        for key, value in update_data.items():
            setattr(db_session, key, value)

    if has_files and has_link:
        raise HTTPException(
            status_code=400,
            detail="Cannot provide both files and an exam link. Choose one method only."
        )

    if has_link:
        if not (exam_link.startswith('http://') or exam_link.startswith('https://')):
            raise HTTPException(
                status_code=400,
                detail="Exam link must be a valid URL starting with http:// or https://"
            )
            
        if not db_session.encryption_key:
            key = generate_encryption_key()
            db_session.encryption_key = format_key_for_storage(key)
        else:
            key = get_key_from_storage(db_session.encryption_key)
        
        hmac_value = generate_hmac(key, exam_link)
        hmac_str = format_hmac_for_storage(hmac_value)
        
        db_session.exam_link = f"{exam_link}|{hmac_str}"
        db_session.encrypted_exam_file = None
        db_session.original_filename = None

    # Handle file update
    if has_files:
        # Get exam and course info
        exam = db.query(dbExam).filter(dbExam.id == db_session.exam_id).first()
        course = db.query(dbCourse).filter(dbCourse.id == db_session.course_id).first()

        if not exam or not course:
            raise HTTPException(status_code=404, detail="Exam or course not found")

        try:
            # Clear any existing exam link
            db_session.exam_link = None

            # Set up paths
            course_name_sanitized = sanitize_filename(course.name)
            exam_name_sanitized = sanitize_filename(exam.name)
            session_name_sanitized = sanitize_filename(db_session.name)
            dir_path = secure_join_path("/home", course_name_sanitized,
                                      exam_name_sanitized, session_name_sanitized)
            create_secure_directory(dir_path)

            # Generate encryption key
            key = generate_encryption_key()

            # Process the files
            original_filenames = []
            validated_files = []

            for file in files:
                if not file.filename or file.filename.strip() == "":
                    continue

                file_content, safe_filename = await validate_file(file)
                validated_files.append((file_content, safe_filename))
                original_filenames.append(safe_filename)

            if len(validated_files) > 1:
                zip_filename = f"exam_{session_id}.zip"
                zip_path = os.path.join(dir_path, zip_filename)

                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for content, filename in validated_files:
                        zipf.writestr(filename, content)

                with open(zip_path, 'rb') as f:
                    file_content = f.read()

                os.remove(zip_path)
                encrypted_filename = f"{zip_filename}.encrypted"

            else:
                file_content, filename = validated_files[0]
                encrypted_filename = f"{filename}.encrypted"

            encrypted_content, _ = encrypt_file(file_content, key)
            encrypted_file_path = os.path.join(dir_path, encrypted_filename)

            with open(encrypted_file_path, 'wb') as f:
                f.write(encrypted_content)

            os.chmod(encrypted_file_path, 0o644)

            db_session.original_filename = ", ".join(original_filenames)
            db_session.encrypted_exam_file = encrypted_file_path
            db_session.encryption_key = format_key_for_storage(key)

        except Exception as e:
            logger.error(f"Error updating exam files: {str(e)}")
            raise HTTPException(status_code=500, detail=f"Error updating files: {str(e)}")

    try:
        db.commit()
        db.refresh(db_session)
        return db_session
    except Exception as e:
        db.rollback()
        logger.error(f"Database error: {str(e)}")
        raise HTTPException(status_code=500, detail="Error updating session")

@router.delete("/{session_id}", response_model=SessionOut)
def delete_session(course_id: str, exam_id: int, session_id: int, db: Session = Depends(get_db)):
    db_session = db.query(dbSession).filter(dbSession.id == session_id).first()
    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete(db_session)
    db.commit()
    return Response(status_code=204)

@router.get("/{session_id}/submissions", response_model=List[SubmissionOut])
def read_submissions(course_id: str, exam_id: int, session_id: int, db: Session = Depends(get_db)):
    session = db.query(dbSession).filter(dbSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    session_users = db.query(SessionUser).filter(SessionUser.session_id == session_id).all()
    session_user_ids = [session_user.id for session_user in session_users]

    submissions = db.query(Submission).filter(Submission.session_user_id.in_(session_user_ids)).all()
    return submissions

@router.get("/{session_id}/get-submissions", response_class=FileResponse)
def download_submissions(
    course_id: str,
    exam_id: int,
    session_id: int,
    # Add role-based authentication when available
    db: Session = Depends(get_db)
):
    """Download all student submissions for a session as a ZIP file"""
    try:
        # Verify session exists and belongs to the specified course/exam
        session = db.query(dbSession).filter(
            dbSession.id == session_id,
            dbSession.course_id == course_id,
            dbSession.exam_id == exam_id
        ).first()

        if session is None:
            raise HTTPException(status_code=404, detail="Session not found")

        # Add authorization check here once you implement roles
        # if current_user.role != "instructor" and current_user.role != "admin":
        #    raise HTTPException(status_code=403, detail="Not authorized to download submissions")

        # Get paths to submission directory
        course = db.query(dbCourse).filter(dbCourse.id == session.course_id).first()
        exam = db.query(dbExam).filter(dbExam.id == session.exam_id).first()

        if not course or not exam:
            raise HTTPException(status_code=404, detail="Course or exam not found")

        course_name_sanitized = sanitize_filename(course.name)
        exam_name_sanitized = sanitize_filename(exam.name)
        session_name_sanitized = sanitize_filename(session.name)

        # Build submission directory path
        submissions_dir = secure_join_path("/home", course_name_sanitized,
                                          exam_name_sanitized,
                                          session_name_sanitized, "submissions")

        # Check if submission directory exists
        if not os.path.exists(submissions_dir):
            raise HTTPException(status_code=404, detail="No submissions found")

        # Create temp directory with proper permissions
        temp_dir = tempfile.mkdtemp(prefix="submissions_")
        temp_zip_path = os.path.join(temp_dir, "submissions.zip")

        # Set secure umask before creating sensitive files
        old_umask = os.umask(0o077)  # Only owner can access

        try:
            # Track zip size to prevent zip bombs
            total_size = 0
            zip_size_limit = 500 * 1024 * 1024  # 500MB max zip size

            # Find all submissions in database for this session
            session_users = db.query(SessionUser).filter(
                SessionUser.session_id == session_id).all()

            session_user_ids = [su.id for su in session_users]
            submissions = db.query(Submission).filter(
                Submission.session_user_id.in_(session_user_ids)).all()

            # If no submissions in database, check if files exist on disk
            if not submissions:
                file_count = sum(len(files) for _, _, files in os.walk(submissions_dir))
                if file_count == 0:
                    raise HTTPException(status_code=404, detail="No submissions found")

            with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                # First, add submissions from database records (safer)
                for submission in submissions:
                    # Verify file still exists
                    if os.path.exists(submission.submission_file):
                        try:
                            # Check if user info exists
                            session_user = next((su for su in session_users
                                              if su.id == submission.session_user_id), None)

                            # Create descriptive name with student ID and timestamp
                            if session_user:
                                timestamp = submission.date.strftime("%Y-%m-%d_%H-%M-%S")
                                student_id = session_user.user_nmec or "unknown"
                                arcname = f"{student_id}/{timestamp}_{submission.original_filename}"
                            else:
                                arcname = os.path.basename(submission.submission_file)

                            # Size check - individual file
                            file_size = os.path.getsize(submission.submission_file)
                            if file_size > 100 * 1024 * 1024:  # 100MB
                                continue

                            # Track total size
                            total_size += file_size
                            if total_size > zip_size_limit:
                                break

                            # Add file to ZIP with sanitized, structured name
                            zipf.write(submission.submission_file, arcname)
                        except Exception as e:
                            logger.error(f"Error adding {submission.submission_file} to zip: {str(e)}")

                # Then add any files found in directory but not in database (fallback)
                if not submissions:
                    for foldername, _, filenames in os.walk(submissions_dir):
                        for filename in filenames:
                            filepath = os.path.join(foldername, filename)

                            try:
                                # Security checks
                                if not os.path.isfile(filepath):
                                    continue

                                # Add file to ZIP
                                arcname = os.path.relpath(filepath, submissions_dir)
                                zipf.write(filepath, arcname)
                            except Exception as e:
                                logger.error(f"Error adding file {filepath} to zip: {str(e)}")

            # Restore original umask
            os.umask(old_umask)

            # Generate a unique filename for the download
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            download_filename = f"{course_name_sanitized}_{exam_name_sanitized}_{session_name_sanitized}_submissions_{timestamp}.zip"

            # Clean up temp directory after sending file
            background_task = BackgroundTask(lambda: shutil.rmtree(temp_dir, ignore_errors=True))

            return FileResponse(
                path=temp_zip_path,
                media_type="application/zip",
                filename=download_filename,
                background=background_task
            )

        except Exception as e:
            # Clean up on error
            if os.path.exists(temp_dir):
                shutil.rmtree(temp_dir, ignore_errors=True)
            logger.error(f"Error creating submission zip: {str(e)}")
            raise HTTPException(status_code=500, detail="Error creating submission archive")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error in download_submissions: {str(e)}")
        raise HTTPException(status_code=500, detail="An unexpected error occurred")

@router.post("/{session_id}/start", response_model=SessionOut)
async def start_session(
    course_id: str,
    exam_id: int,
    session_id: int,
    db: Session = Depends(get_db)
):
    db_session = db.query(dbSession).filter(
        dbSession.id == session_id,
        dbSession.course_id == course_id,
        dbSession.exam_id == exam_id
    ).first()

    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if db_session.is_started:
        raise HTTPException(status_code=403, detail="Session has already started")

    db_session.is_started = True

    session_users = db.query(SessionUser).filter(SessionUser.session_id == session_id).all()

    db.commit()
    db.refresh(db_session)
    
    try: 
        message_start = {
            "operation": "start_exam",
            "message": db_session.encryption_key,
            "courseID": course_id,
            "examID": exam_id,
            "sessionID": session_id
        }
        
        message_start = json.dumps(message_start)
        for user in session_users:
            await redis_pubsub.publish(f"pie:{user.user_nmec}", message_start)
    except Exception as e:
        logger.error(f"Error starting exam: {str(e)}")
        
    return db_session

@router.get("/{session_id}/key")
def get_decryption_key(
    course_id: str,
    exam_id: int,
    session_id: int,
    #user_nmec: int,
    db: Session = Depends(get_db)
):
    # Verify the session
    db_session = db.query(dbSession).filter(
        dbSession.id == session_id,
        dbSession.course_id == course_id,
        dbSession.exam_id == exam_id
    ).first()

    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Check if session has started
    #if not db_session.is_started:
    #    raise HTTPException(status_code=403, detail="Session has not started yet")

    # Verify the user is enrolled in this session
    #session_user = db.query(SessionUser).filter(
    #    SessionUser.session_id == session_id,
    #    SessionUser.user_nmec == user_nmec
    #).first()

    #if session_user is None:
    #    raise HTTPException(status_code=403, detail="User is not enrolled in this session")

    # Return the encryption key
    return {"key": db_session.encryption_key}


@router.post("/{session_id}/end", response_model=SessionOut)
async def end_session(
    course_id: str,
    exam_id: int,
    session_id: int,
    db: Session = Depends(get_db)
):
    db_session = db.query(dbSession).filter(
        dbSession.id == session_id,
        dbSession.course_id == course_id,
        dbSession.exam_id == exam_id
    ).first()

    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if not db_session.is_started:
        raise HTTPException(status_code=403, detail="Session has not started yet")

    db_session.is_started = True
    db_session.is_ended = True

    session_users = db.query(SessionUser).filter(SessionUser.session_id == session_id).all()

    db.commit()
    db.refresh(db_session)
    
    try: 
        message_end = {
            "operation": "finish_exam",
            "message": "Exam has ended",
            "courseID": course_id,
            "examID": exam_id,
            "sessionID": session_id
        }
        
        message_end = json.dumps(message_end)
        for user in session_users:
            await redis_pubsub.publish(f"pie:{user.user_nmec}", message_end)
    except Exception as e:
        logger.error(f"Error ending exam: {str(e)}")

    return db_session

def _get_session_or_404(db: Session, course_id: str, exam_id: int, session_id: int):
    db_session = db.query(dbSession).filter(
        dbSession.id == session_id,
        dbSession.course_id == course_id,
        dbSession.exam_id == exam_id,
    ).first()
    if db_session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return db_session

@router.post("/{session_id}/device/{device_id}/provisioning-secret", response_model=DeviceProvisioningSecretRegistered)
def register_provisioning_secret(
    course_id: str,
    exam_id: int,
    session_id: int,
    device_id: int,
    payload: DeviceProvisioningSecretRegister,
    db: Session = Depends(get_db),
    # Explicit: session_router's own default dependency is get_current_user
    # (any authenticated role). This one also requires teacher/admin, and
    # that the request comes from that teacher's enrolled Examiner App phone
    # (docs/examiner-phone-enrollment.md).
    phone: ExaminerPhone = Depends(get_examiner_phone),
):
    """The examiner app, as the trusted node, registers the secret it just
    generated before delivering the same secret to the device over NFC — see
    docs/examiner-trusted-node-provisioning.md section 2. It also assigns
    the student (`nmec`) the examiner seated at this device after checking
    their card; only that student can later join the session from this
    device (docs/tap-gated-student-join.md). Happens before the student
    joins, so no SessionUser is needed. Re-registering for the same device
    and session replaces the previous secret and student and resets it to
    unconfirmed, so a wrong NMEC can be fixed before the student joins."""
    db_session = _get_session_or_404(db, course_id, exam_id, session_id)

    if db.query(Device).filter(Device.id == device_id).first() is None:
        raise HTTPException(status_code=404, detail="Device not found")

    student = db.query(User).filter(User.nmec == payload.nmec).first()
    if student is None or student.role != "student":
        raise HTTPException(status_code=404, detail="Student not found")
    # Same rule create_session_user applies at join time — fail here, while
    # the examiner is still at the seat, rather than when the student joins.
    if db_session.allowed_students and student.email not in db_session.allowed_students:
        raise HTTPException(status_code=400, detail="Student not allowed in session")

    try:
        secret_len = len(base64.urlsafe_b64decode(payload.secret + "=" * (-len(payload.secret) % 4)))
    except Exception:
        secret_len = 0
    if secret_len < 32:
        raise HTTPException(status_code=422, detail="Secret must be at least 32 bytes, base64url-encoded")

    expires_at = datetime.utcnow() + timedelta(seconds=payload.ttl_seconds)
    existing = db.query(DeviceProvisioningSecret).filter(
        DeviceProvisioningSecret.device_id == device_id,
        DeviceProvisioningSecret.session_id == session_id,
    ).first()
    if existing:
        existing.secret = payload.secret
        existing.nmec = payload.nmec
        existing.expires_at = expires_at
        existing.claimed_at = None
        existing.registered_by_phone_id = phone.id
    else:
        db.add(DeviceProvisioningSecret(
            device_id=device_id,
            session_id=session_id,
            secret=payload.secret,
            nmec=payload.nmec,
            expires_at=expires_at,
            registered_by_phone_id=phone.id,
        ))
    db.commit()

    return DeviceProvisioningSecretRegistered(
        sessionId=str(session_id),
        nmec=str(payload.nmec),
    )

@router.delete("/{session_id}/device/{device_id}/provisioning-secret", status_code=200)
def invalidate_provisioning_secret(
    course_id: str,
    exam_id: int,
    session_id: int,
    device_id: int,
    db: Session = Depends(get_db),
    _phone: ExaminerPhone = Depends(get_examiner_phone),
):
    """The examiner backed out before tapping — drop the secret so it can't
    be confirmed later. A confirmed secret is kept: the student's join
    checks it (docs/tap-gated-student-join.md), and the examiner app calls
    this on "Deactivate" whether or not the tap went through."""
    _get_session_or_404(db, course_id, exam_id, session_id)
    secret_row = db.query(DeviceProvisioningSecret).filter(
        DeviceProvisioningSecret.device_id == device_id,
        DeviceProvisioningSecret.session_id == session_id,
    ).first()
    if secret_row is not None and secret_row.claimed_at is not None:
        return {"status": "kept"}
    if secret_row is not None:
        db.delete(secret_row)
        db.commit()
    return {"status": "invalidated"}
