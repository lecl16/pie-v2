from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class SubmissionBase(BaseModel):
    session_user_id: int
    submission_file: str
    original_filename: str
    file_size: int
    mime_type: str
    date: datetime
    
class SubmissionCreate(SubmissionBase):
    pass
    
class SubmissionOut(SubmissionBase):
    id: int
    grade: Optional[float] = None
    
    class Config:
        orm_mode = True
    
class SubmissionUpdate(BaseModel):
    grade: float