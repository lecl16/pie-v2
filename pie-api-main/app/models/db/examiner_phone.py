from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from app.models.db.base import Base

class ExaminerPhone(Base):
    """An Examiner App installation enrolled by a teacher — see
    README.md, "Phone enrollment". The phone holds the private key (in
    the Android Keystore); the server keeps only the fingerprint of the
    client certificate it issued, which Caddy forwards on the phone port.
    Revoking sets revoked_at; the row is kept for the audit columns that
    point at it (Device.created_by_phone_id and
    DeviceProvisioningSecret.registered_by_phone_id)."""
    __tablename__ = "examiner_phone"

    id = Column(Integer, primary_key=True, index=True)
    user_nmec = Column(Integer, ForeignKey("user.nmec", ondelete="CASCADE"), nullable=False)
    label = Column(String(100))
    # SHA-256 of the DER certificate, lowercase hex, as Caddy reports it.
    cert_fingerprint = Column(String(64), unique=True, index=True, nullable=False)
    cert_serial = Column(String(40), nullable=False)
    created_at = Column(DateTime, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    last_seen = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
