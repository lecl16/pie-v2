from sqlalchemy import Column, Integer, DateTime, ForeignKey, UniqueConstraint
from app.models.db.base import Base

class SessionUser(Base):
    __tablename__ = "session_user"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey('session.id', ondelete="CASCADE"), nullable=False)
    user_nmec = Column(Integer, ForeignKey('user.nmec', ondelete="CASCADE"), nullable=False)
    device_id = Column(Integer, ForeignKey('device.id'), nullable=False)
    start_time = Column(DateTime)
    end_time = Column(DateTime)
    changed_time = Column(Integer, default=0)

    __table_args__ = (
         UniqueConstraint("session_id", "user_nmec", "device_id", name="uix_session_user"),
    )
