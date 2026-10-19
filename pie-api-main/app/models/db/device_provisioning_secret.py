from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from app.models.db.base import Base

class DeviceProvisioningSecret(Base):
    __tablename__ = "device_provisioning_secret"

    id = Column(Integer, primary_key=True, index=True)
    device_id = Column(Integer, ForeignKey("device.id", ondelete="CASCADE"), nullable=False)
    session_id = Column(Integer, ForeignKey("session.id", ondelete="CASCADE"), nullable=False)
    secret = Column(String(255), nullable=False)
    # Examiner-assigned student (docs/tap-gated-student-join.md): the only
    # NMEC allowed to join this session from this device. Nullable only
    # because _sync_existing_tables() adds it to rows registered before it
    # existed; registration always sets it, and a join rejects a row without it.
    nmec = Column(Integer, nullable=True)
    expires_at = Column(DateTime, nullable=False)
    claimed_at = Column(DateTime, nullable=True)
    # Audit: the enrolled Examiner App phone that registered this secret
    # (docs/examiner-phone-enrollment.md).
    registered_by_phone_id = Column(Integer, nullable=True)

    __table_args__ = (
        UniqueConstraint("device_id", "session_id", name="uix_device_provisioning_secret"),
    )
