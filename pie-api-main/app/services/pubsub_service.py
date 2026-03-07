import redis.asyncio as redis
from app.core.config import config

class RedisPubSub:
    def __init__(self):
        self.redis = None

    async def connect(self):
        """Connect to Redis."""
        self.redis = await redis.Redis.from_url(config.REDIS_URL, decode_responses=True)

    async def publish(self, channel: str, message: str):
        """Publish a message to the specified channel."""
        await self.redis.publish(channel, message)

    async def subscribe(self, channel: str, callback):
        """Subscribe to the specified channel and call the callback with the message."""
        pubsub = self.redis.pubsub()
        await pubsub.subscribe(channel)

        async for message in pubsub.listen():
            if message["type"] == "message":
                await callback(message["data"])

redis_pubsub = RedisPubSub()

