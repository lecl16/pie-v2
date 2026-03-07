from pydantic import BaseModel

class ExamBase(BaseModel):
    name: str
    course_id: str

class ExamCreate(ExamBase):
    pass

class ExamOut(ExamBase):
    id: int
    
class ExamUpdate(ExamBase):
    pass

    class Config:
        orm_mode = True

