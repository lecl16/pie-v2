from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import List, Optional
from datetime import datetime
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.auth import get_current_user, get_teacher_or_admin_user
from app.core.database import get_db
from app.core.tunnel import TUNNEL_IP_HEADER, device_id_for_tunnel_ip
from app.models.db.session import Session as ExamSession
from app.models.db.session_user import SessionUser
from app.models.db.user import User
from app.schemas.logs import LogCreate, LogResponse
from app.services.streams_service import log_service
from app.services.elasticsearch_service import elasticsearch_service
from app.services.pubsub_service import redis_pubsub

router = APIRouter()

# Logs naming any device or session, without a student: teachers and admins
# only. The exam app uses the route below.
@router.post("/device/{device_id}", response_model=dict)
async def create_device_log(
    device_id: int,
    log: LogCreate,
    _: User = Depends(get_teacher_or_admin_user),
):
    log.device_id = device_id
    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

@router.post("/session/{session_id}/device/{device_id}", response_model=dict)
async def create_session_device_log(
    session_id: int,
    device_id: int,
    log: LogCreate,
    _: User = Depends(get_teacher_or_admin_user),
):
    log.session_id = session_id
    log.device_id = device_id
    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

@router.post("/session/{session_id}/user/{user_nmec}", response_model=dict)
async def create_session_user_log(
    session_id: int,
    user_nmec: int,
    log: LogCreate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The exam app's activity logs. Only the student themself, through the
    device they joined on: the student comes from the token, the device
    from the tunnel the request arrives through (app/core/tunnel.py), and
    the session, exam and course from the student's join. What the body
    says about any of them is ignored, so a student cannot write logs in
    another student's name, or for another device or session."""
    if current_user.role != "student" or current_user.nmec != user_nmec:
        raise HTTPException(status_code=403, detail="Only the student's own logs")
    device_id = device_id_for_tunnel_ip(request.headers.get(TUNNEL_IP_HEADER))
    if device_id is None:
        raise HTTPException(status_code=403, detail="Logs only through a PIE device")
    joined = db.query(SessionUser).filter(
        SessionUser.session_id == session_id,
        SessionUser.user_nmec == user_nmec,
        SessionUser.device_id == device_id,
    ).first()
    if joined is None:
        raise HTTPException(status_code=403, detail="Not joined on this device")
    exam_session = db.query(ExamSession).filter(ExamSession.id == session_id).first()

    log.user_nmec = user_nmec
    log.device_id = device_id
    log.session_id = session_id
    if exam_session is not None:
        log.exam_id = exam_session.exam_id
        log.course_id = exam_session.course_id

    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

# Reading logs (the dashboard): teachers and admins only. A student's own
# logs are written through the exam app, never read back.
async def log_event_stream(channel: str):
    pubsub = redis_pubsub.redis.pubsub()
    await pubsub.subscribe(channel)

    async for message in pubsub.listen():
        if message["type"] == "message":
            yield f"data: {message['data']}\n\n"

@router.get("/session/{session_id}/user/{user_nmec}/stream", response_class=StreamingResponse, dependencies=[Depends(get_teacher_or_admin_user)])
async def stream_session_user_logs(session_id: int, user_nmec: int):
    """Subscribe to session-user logs in real-time."""
    return StreamingResponse(
        log_event_stream(f"logs:session:{session_id}:user:{user_nmec}"), 
        media_type="text/event-stream"
    )

@router.get("/search", response_model=dict, dependencies=[Depends(get_teacher_or_admin_user)])
async def search_archived_logs(
    device_id: Optional[int] = None,
    user_nmec: Optional[int] = None,
    session_id: Optional[int] = None,
    course_id: Optional[str] = None,
    exam_id: Optional[int] = None,
    level: Optional[str] = None,
    category: Optional[str] = None,
    start_time: Optional[datetime] = None,
    end_time: Optional[datetime] = None,
    page: int = Query(0, ge=0),
    page_size: int = Query(100, ge=1, le=1000)
):
    logs = await elasticsearch_service.search_logs(
        device_id=device_id,
        user_nmec=user_nmec,
        session_id=session_id,
        course_id=course_id,
        exam_id=exam_id,
        level=level,
        category=category,
        start_time=start_time,
        end_time=end_time,
        from_=page * page_size,
        size=page_size
    )
    return {"logs": logs, "count": len(logs)}

@router.get("/device/{device_id}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_device_logs(
    device_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_device_logs(device_id, count)
    return logs

@router.get("/session/{session_id}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_session_logs(
    session_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_session_logs(session_id, count)
    return logs

@router.get("/user/{user_nmec}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_user_logs(
    user_nmec: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_user_logs(user_nmec, count)
    return logs

@router.get("/session/{session_id}/user/{user_nmec}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_session_user_logs(
    session_id: int,
    user_nmec: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_session_user_logs(session_id, user_nmec, count)
    return logs

@router.get("/course/{course_id}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_course_logs(
    course_id: str,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_course_logs(course_id, count)
    return logs

@router.get("/exam/{exam_id}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_exam_logs(
    exam_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_exam_logs(exam_id, count)
    return logs

@router.get("/course/{course_id}/exam/{exam_id}", response_model=List[LogResponse], dependencies=[Depends(get_teacher_or_admin_user)])
async def get_course_exam_logs(
    course_id: str,
    exam_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_course_exam_logs(course_id, exam_id, count)
    return logs