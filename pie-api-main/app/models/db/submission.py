from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Float
from app.models.db.base import Base

class Submission(Base):
    id = Column(Integer, primary_key=True, index=True)
    session_user_id = Column(Integer, ForeignKey('session_user.id', ondelete="CASCADE"))
    submission_file = Column(String(255))
    original_filename = Column(String(255))
    file_size = Column(Integer)
    mime_type = Column(String(100)) 
    date = Column(DateTime)
    grade = Column(Float, nullable=True)