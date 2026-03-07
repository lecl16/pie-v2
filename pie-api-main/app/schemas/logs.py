from typing import Any, Dict, Optional
from datetime import datetime
from pydantic import BaseModel, Field

class LogBase(BaseModel):
    device_id: int
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    level: str  # INFO, WARNING, ERROR, DEBUG
    category: str  # NETWORK, SYSTEM, USB, FILE, COMMAND
    message: str
    details: Optional[Dict[str, Any]] = None
    session_id: Optional[int] = None
    user_nmec: Optional[int] = None
    course_id: Optional[str] = None
    exam_id: Optional[int] = None

class LogCreate(LogBase):
    pass

class LogResponse(LogBase):
    id: str 