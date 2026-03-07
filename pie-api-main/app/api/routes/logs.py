from fastapi import APIRouter, Query
from typing import List, Optional
from datetime import datetime
from fastapi.responses import StreamingResponse
from app.schemas.logs import LogCreate, LogResponse
from app.services.streams_service import log_service
from app.services.elasticsearch_service import elasticsearch_service
from app.services.pubsub_service import redis_pubsub

router = APIRouter()

@router.post("/device/{device_id}", response_model=dict)
async def create_device_log(device_id: int, log: LogCreate):
    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

@router.post("/session/{session_id}/device/{device_id}", response_model=dict)
async def create_session_device_log(
    session_id: int, 
    device_id: int, 
    log: LogCreate
):
    if log.session_id is None:
        log.session_id = session_id
    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

@router.post("/session/{session_id}/user/{user_nmec}", response_model=dict)
async def create_session_user_log(
    session_id: int, 
    user_nmec: int, 
    log: LogCreate
):
    if log.session_id is None:
        log.session_id = session_id
        
    if log.user_nmec is None:
        log.user_nmec = user_nmec
        
    device_id = log.device_id if log.device_id is not None else 0
    
    log_id = await log_service.add_log(device_id, log)
    return {"id": log_id, "message": "Log created successfully"}

async def log_event_stream(channel: str):
    pubsub = redis_pubsub.redis.pubsub()
    await pubsub.subscribe(channel)

    async for message in pubsub.listen():
        if message["type"] == "message":
            yield f"data: {message['data']}\n\n"

@router.get("/session/{session_id}/user/{user_nmec}/stream", response_class=StreamingResponse)
async def stream_session_user_logs(session_id: int, user_nmec: int):
    """Subscribe to session-user logs in real-time."""
    return StreamingResponse(
        log_event_stream(f"logs:session:{session_id}:user:{user_nmec}"), 
        media_type="text/event-stream"
    )

@router.get("/search", response_model=dict)
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

@router.get("/device/{device_id}", response_model=List[LogResponse])
async def get_device_logs(
    device_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_device_logs(device_id, count)
    return logs

@router.get("/session/{session_id}", response_model=List[LogResponse])
async def get_session_logs(
    session_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_session_logs(session_id, count)
    return logs

@router.get("/user/{user_nmec}", response_model=List[LogResponse])
async def get_user_logs(
    user_nmec: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_user_logs(user_nmec, count)
    return logs

@router.get("/session/{session_id}/user/{user_nmec}", response_model=List[LogResponse])
async def get_session_user_logs(
    session_id: int,
    user_nmec: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_session_user_logs(session_id, user_nmec, count)
    return logs

@router.get("/course/{course_id}", response_model=List[LogResponse])
async def get_course_logs(
    course_id: str,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_course_logs(course_id, count)
    return logs

@router.get("/exam/{exam_id}", response_model=List[LogResponse])
async def get_exam_logs(
    exam_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_exam_logs(exam_id, count)
    return logs

@router.get("/course/{course_id}/exam/{exam_id}", response_model=List[LogResponse])
async def get_course_exam_logs(
    course_id: str,
    exam_id: int,
    count: int = Query(100, ge=1, le=1000)
):
    logs = await log_service.get_course_exam_logs(course_id, exam_id, count)
    return logs