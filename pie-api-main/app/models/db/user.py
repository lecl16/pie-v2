from sqlalchemy import Column, Integer, String
from app.models.db.base import Base

class User(Base):
    """Model for storing audit logs."""
    nmec = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    email = Column(String(100), unique=True)
    password = Column(String(100))
    role = Column(String(20))