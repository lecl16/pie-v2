from pydantic import BaseModel

class CourseBase(BaseModel):
    name: str

class CourseCreate(CourseBase):
    id: str

class CourseRead(CourseBase):
    id: str #The id is a string of type "40379-fp"
    
class CourseUpdate(CourseBase):
    pass

    class Config:
        orm_mode = True