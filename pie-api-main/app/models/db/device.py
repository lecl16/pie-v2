from sqlalchemy import Column, Integer, String, DateTime
from app.models.db.base import Base

class Device(Base):
    # Audit logs
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100))
    last_ip = Column(String(20))
    last_online = Column(DateTime)
    last_update = Column(DateTime)
    device_api_key_hash = Column(String(64), unique=True, index=True, nullable=True)