import asyncio
import logging
from fastapi import WebSocket
from typing import Dict, Any

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, connection_id: str):
        await websocket.accept()
        self.active_connections[connection_id] = websocket
        logger.info(f"WebSocket connected: {connection_id}")

    def disconnect(self, connection_id: str):
        if connection_id in self.active_connections:
            del self.active_connections[connection_id]
            logger.info(f"WebSocket disconnected: {connection_id}")

    async def send_message(self, connection_id: str, message: str) -> bool:
        if connection_id in self.active_connections:
            try:
                await self.active_connections[connection_id].send_text(message)
                return True
            except Exception as e:
                logger.error(f"Error sending message to {connection_id}: {str(e)}")
                return False
        return False

manager = ConnectionManager()