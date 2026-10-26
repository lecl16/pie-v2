from pydantic import BaseModel
from datetime import date, time, datetime
from typing import Optional

class SessionUserBase(BaseModel):
    user_nmec: int
    # session_id: int
    device_id: int

class SessionUserCreate(BaseModel):
    """The joining student is the one the examiner assigned to the device in
    the session tap, not a body field; `nonce`/`mac` prove the join comes
    from the device the examiner tapped — see docs/tap-gated-student-join.md
    section 5."""
    join_code: str
    device_id: int
    nonce: str
    mac: str

class SessionUserOut(SessionUserBase):
    id: int
    session_id: int
    exam_id: int
    course_id: str
    duration: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    changed_time: int
    allowed_links: Optional[list[str]] = None
    exam: str

class SessionUserJoined(SessionUserOut):
    """The join response, with the assigned student's name and token."""
    name: str
    access_token: str
    token_type: str

class SessionUserUpdate(SessionUserBase):
    session_id: int
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    
class SessionUserTime(BaseModel):
    changed_time: int

    class Config:
        orm_mode = True
