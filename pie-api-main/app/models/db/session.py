from sqlalchemy import Column, Integer, String, Date, Time, Boolean, ForeignKey, JSON
from app.models.db.base import Base

class Session(Base):
    """Model for storing session information."""
    id = Column(Integer, primary_key=True, index=True)
    join_code = Column(String(20), unique=True, index=True)
    name = Column(String(100))
    course_id = Column(String(20), ForeignKey("course.id", ondelete="CASCADE"), index=True)
    exam_id = Column(Integer, ForeignKey("exam.id", ondelete="CASCADE"), index=True)
    exam_link = Column(String(255), nullable=True)
    encrypted_exam_file = Column(String(255), nullable=True)
    encryption_key = Column(String(255), nullable=True)
    is_started = Column(Boolean, default=False)
    is_ended = Column(Boolean, default=False)
    date = Column(Date)
    duration = Column(Integer)
    room = Column(String(20))
    allowed_links= Column(JSON)
    allowed_students = Column(JSON) 
