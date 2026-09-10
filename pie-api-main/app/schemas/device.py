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


class DeviceUpdate(DeviceBase):
    pass

    class Config:
        orm_mode = True