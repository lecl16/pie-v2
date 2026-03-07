from sqlalchemy import Column, Integer, String, ForeignKey
from app.models.db.base import Base

class Exam(Base):
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    course_id = Column(String(20), ForeignKey("course.id", ondelete="CASCADE"), index=True)
