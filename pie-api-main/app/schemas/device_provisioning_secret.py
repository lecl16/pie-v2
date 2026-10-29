from pydantic import BaseModel, Field

class DeviceProvisioningSecretRegister(BaseModel):
    """Sent by the examiner app, which generates the secret itself — see
    README.md, "Session provisioning". `ttl_seconds` rather
    than an absolute expiry, so the server's own clock is the only one that
    decides when the secret expires."""
    secret: str
    ttl_seconds: int = Field(default=300, ge=10, le=900)
    # The student the examiner assigned to this device after checking their
    # card — see README.md, "Joining a session".
    nmec: int

class DeviceProvisioningSecretRegistered(BaseModel):
    sessionId: str
    nmec: str

class DeviceProvisioningSecretConfirm(BaseModel):
    nonce: str
    mac: str

class DeviceProvisioningSecretConfirmed(BaseModel):
    sessionId: str
    nmec: str
    name: str = ""
    mac: str
