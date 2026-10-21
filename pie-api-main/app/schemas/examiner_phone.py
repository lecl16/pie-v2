from datetime import date as date_type, datetime
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

class ProvisioningSessionOut(BaseModel):
    """A session the Examiner App can provision devices for (not ended)."""
    course_id: str
    course_name: Optional[str] = None
    exam_id: int
    exam_name: Optional[str] = None
    session_id: int
    session_name: Optional[str] = None
    room: Optional[str] = None
    date: Optional[date_type] = None
    is_started: bool

class ProvisioningStudentOut(BaseModel):
    nmec: int
    name: Optional[str] = None
    email: Optional[str] = None
    # The device this student is currently assigned to in this session, if
    # a provisioning secret was registered for them.
    device_id: Optional[int] = None

class ProvisioningStudentsOut(BaseModel):
    # False when the session has no allowed-students list (anyone may join):
    # the app then asks for the NMEC instead of offering a list.
    restricted: bool
    students: list[ProvisioningStudentOut]
