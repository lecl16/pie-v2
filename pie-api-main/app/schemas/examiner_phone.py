from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

class ExaminerPhoneEnroll(BaseModel):
    """Sent by the Examiner App after login — docs/examiner-phone-enrollment.md."""
    csr: str = Field(..., max_length=4096)  # PKCS#10, PEM
    label: str = Field(default="", max_length=100)  # e.g. the phone's model

class ExaminerPhoneOut(BaseModel):
    id: int
    user_nmec: int
    label: Optional[str] = None
    cert_fingerprint: str
    created_at: datetime
    expires_at: datetime
    last_seen: Optional[datetime] = None
    revoked_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class ExaminerPhoneEnrolled(ExaminerPhoneOut):
    certificate: str  # PEM, signed by the phone CA
    mtls_port: int  # where the phone presents it (Caddyfile)
