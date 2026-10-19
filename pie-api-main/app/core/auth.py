from datetime import datetime, timedelta
from typing import Optional

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer, HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.db.device import Device
from app.models.db.examiner_phone import ExaminerPhone
from app.models.db.user import User
from app.schemas.user import UserOut
from app.core.config import config
from app.core.security import hash_device_key
from app.core.phone_certs import normalize_fingerprint

# Change these settings in production
SECRET_KEY = config.SECRET_KEY
ALGORITHM = config.ALGORITHM
ACCESS_TOKEN_EXPIRE_MINUTES = 1440  # 24 hours

security = HTTPBearer()

class Token(BaseModel):
    access_token: str
    token_type: str
    
class TokenData(BaseModel):
    email: Optional[str] = None

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid authentication credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
        token_data = TokenData(email=email)
    except (JWTError, AttributeError):
        raise credentials_exception
    user = db.query(User).filter(User.email == token_data.email).first()
    if user is None:
        raise credentials_exception
    return user

def get_current_active_user(current_user: User = Depends(get_current_user)):
    return current_user

def get_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    return current_user

def get_teacher_or_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role not in ["admin", "teacher"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Not enough permissions"
        )
    return current_user

def get_device(x_device_key: str = Header(..., alias="X-Device-Key"), db: Session = Depends(get_db)) -> Device:
    # Authenticate exam device via it API key, sent in the X-Device-Key header
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid device credentials",
    )
    key_hash = hash_device_key(x_device_key)
    device = db.query(Device).filter(Device.device_api_key_hash == key_hash).first()
    if device is None:
        raise credentials_exception
    return device

# Set by Caddy on the phone port only, from the client certificate it has
# just verified against the phone CA; dropped on the public port (Caddyfile).
PHONE_CERT_HEADER = "X-Pie-Phone-Cert-Fingerprint"

def get_examiner_phone(
    request: Request,
    current_user: User = Depends(get_teacher_or_admin_user),
    db: Session = Depends(get_db),
) -> ExaminerPhone:
    """For the actions only the trusted node may take (creating devices,
    registering provisioning secrets): the request must come from an
    enrolled, unrevoked Examiner App phone that belongs to the logged-in
    teacher — see docs/examiner-phone-enrollment.md. Needs both the JWT and
    the phone's certificate, so neither a stolen password nor a stolen
    phone is enough on its own."""
    fingerprint = request.headers.get(PHONE_CERT_HEADER, "")
    if not fingerprint:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action requires an enrolled Examiner App phone (phone port)",
        )
    phone = db.query(ExaminerPhone).filter(
        ExaminerPhone.cert_fingerprint == normalize_fingerprint(fingerprint)
    ).first()
    if phone is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Phone not enrolled")
    if phone.revoked_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Phone certificate revoked")
    if phone.expires_at < datetime.utcnow():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Phone certificate expired")
    if phone.user_nmec != current_user.nmec:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Phone enrolled by another user",
        )
    phone.last_seen = datetime.utcnow()
    db.commit()
    return phone
