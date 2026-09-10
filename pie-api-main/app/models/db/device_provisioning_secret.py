from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from app.models.db.base import Base

class DeviceProvisioningSecret(Base):
    __tablename__ = "device_provisioning_secret"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("device.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(Integer, ForeignKey("session.id", ondelete="CASCADE"), nullable=False)
    secret = Column(String(255), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    claimed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("device_id", "session_id", name="uix_device_provisioning_secret"),
    )
