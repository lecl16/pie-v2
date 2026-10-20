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
    # Audit: the enrolled Examiner App phone that created this device
    # (docs/examiner-phone-enrollment.md). Null for devices created before.
    created_by_phone_id = Column(Integer, nullable=True)
    # TLS pre-shared key for the device port, derived from the API key when
    # it is minted and stored wrapped (docs/device-tls-psk.md). Null for a
    # device whose key predates it: rotate the key and register it again.
    tls_psk_enc = Column(String(255), nullable=True)
