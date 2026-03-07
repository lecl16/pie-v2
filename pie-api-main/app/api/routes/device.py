from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.device import Device
from app.schemas.device import DeviceCreate, DeviceUpdate, DeviceOut

router = APIRouter()

@router.post("/create", response_model=DeviceOut)
def create_device(device: DeviceCreate, db: Session = Depends(get_db)):
    db_device = Device(**device.dict())
    try:
        db.add(db_device)
        db.commit()
        db.refresh(db_device)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return db_device

@router.get("/", response_model=List[DeviceOut])
def read_devices(db: Session = Depends(get_db)):
    devices = db.query(Device).all()
    return devices

@router.get("/{device_id}", response_model=DeviceOut)
def read_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    return device

@router.put("/{device_id}", response_model=DeviceOut)
def update_device(device_id: int, device: DeviceUpdate, db: Session = Depends(get_db)):
    db_device = db.query(Device).filter(Device.id == device_id).first()
    if db_device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    for key, value in device.dict().items():
        setattr(db_device, key, value)
    db.commit()
    db.refresh(db_device)
    return db_device

@router.delete("/{device_id}", response_model=DeviceOut)
def delete_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if device is None:
        raise HTTPException(status_code=404, detail="Device not found")
    db.delete(device)
    db.commit()
    return device

