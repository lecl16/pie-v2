from pydantic import BaseModel
from datetime import date, time
from typing import Optional, List


class SessionBase(BaseModel):
    exam_id: int
    course_id: str

class SessionCreate(SessionBase):
    name: str
    join_code: Optional[str] = None
    date: date
    duration: int
    room: str
    encrypted_exam_file: Optional[str] = None
    exam_link: Optional[str] = None
    allowed_links: Optional[List[str]] = None
    allowed_students: Optional[List[str]] = None  # Array of email strings

class SessionOut(SessionBase):
    id: int
    join_code: str
    name: str
    encrypted_exam_file: Optional[str] = None
    exam_link: Optional[str] = None
    date: date
    duration: int
    room: str
    is_started: bool
    is_ended: bool
    allowed_links: Optional[List[str]] = None
    allowed_students: Optional[List[str]] = None 

class SessionUpdate(SessionBase):
    name: str
    date: date
    duration: int
    room: str
    encrypted_exam_file: Optional[str] = None
    exam_link: Optional[str] = None
    allowed_links: Optional[List[str]] = None
    allowed_students: Optional[List[str]] = None  # Array of email strings

    
class SessionUpload(SessionBase):
    exam_file: Optional[str] = None
    exam_link: Optional[str] = None

    class Config:
        orm_mode = True
