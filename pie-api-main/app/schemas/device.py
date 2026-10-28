from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class DeviceBase(BaseModel):
    name: str

class DeviceCreate(DeviceBase):
    pass

class DeviceOut(DeviceBase):
    id: int
    last_ip: Optional[str] = None
    last_online: Optional[datetime] = None
    last_update: Optional[datetime] = None

class DeviceCreated(DeviceOut):
    api_key: str


class DeviceTunnelRegister(BaseModel):
    """The device's WireGuard public key (base64, 32 bytes)."""
    publicKey: str

class DeviceTunnel(BaseModel):
    """What the device needs for its tunnel (app/core/tunnel.py)."""
    address: str
    serverAddress: str
    serverPublicKey: str
    endpointPort: int
    # The API inside the tunnel, which the device gives the exam app.
    apiUrl: str

class DeviceUpdate(DeviceBase):
    pass

    class Config:
        orm_mode = True