import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from app.services.pubsub_service import redis_pubsub
from app.schemas.pubsub import PubSubMessage
from app.core.auth import get_current_user, get_teacher_or_admin_user
from app.models.db.user import User

router = APIRouter()

# Publishing (start, end, added time, notifications): teachers and admins.
@router.post("/pie", dependencies=[Depends(get_teacher_or_admin_user)])
async def publish_pie_message(message: PubSubMessage):
    """Publish a message to the /pie topic."""
    try:
        structured_message = json.dumps(message.model_dump())
    except Exception as e:
        return {"status": "Message not published", "error": str(e)}
    await redis_pubsub.publish("pie:broadcast", structured_message)
    return {"status": "Message published", "topic": "/pie", "message": message}

@router.post("/pie/{id}", dependencies=[Depends(get_teacher_or_admin_user)])
async def publish_pie_message_by_id(id: int, message: PubSubMessage):
    """Publish a message to the /pie topic."""
    structured_message = json.dumps(message.model_dump())
    await redis_pubsub.publish(f"pie:{id}", structured_message)
    return {"status": "Message published", "topic": f"/pie/{id}", "message": message}

async def event_stream(channel: str):
    """Generator function that streams messages from Redis Pub/Sub."""
    pubsub = redis_pubsub.redis.pubsub()
    await pubsub.subscribe(channel)

    async for message in pubsub.listen():
        if message["type"] == "message":
            yield message["data"]

@router.get("/pie")
async def subscribe_pie():
    """Subscribe to the /pie topic."""
    return StreamingResponse(event_stream("pie:broadcast"), media_type="text/event-stream")

@router.get("/pie/{id}")
async def subscribe_pie_by_id(id: int, current_user: User = Depends(get_current_user)):
    """Subscribe to the /pie topic. A student only to their own channel."""
    if current_user.role not in ["admin", "teacher"] and current_user.nmec != id:
        raise HTTPException(status_code=403, detail="Only the student's own channel")
    return StreamingResponse(event_stream(f"pie:{id}"), media_type="text/event-stream")
