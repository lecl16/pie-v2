import json
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from app.services.pubsub_service import redis_pubsub
from app.schemas.pubsub import PubSubMessage

router = APIRouter()

@router.post("/pie")
async def publish_pie_message(message: PubSubMessage):
    """Publish a message to the /pie topic."""
    try:
        structured_message = json.dumps(message.model_dump())
    except Exception as e:
        return {"status": "Message not published", "error": str(e)}
    await redis_pubsub.publish("pie:broadcast", structured_message)
    return {"status": "Message published", "topic": "/pie", "message": message}

@router.post("/pie/{id}")
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
async def subscribe_pie_by_id(id: int):
    """Subscribe to the /pie topic."""
    return StreamingResponse(event_stream(f"pie:{id}"), media_type="text/event-stream")
