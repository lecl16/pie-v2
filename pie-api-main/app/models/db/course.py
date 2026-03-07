from sqlalchemy import Column, String
from app.models.db.base import Base

class Course(Base):
    """Model for storing audit logs."""
    id = Column(String(20), primary_key=True, index=True)
    name = Column(String(100))
    