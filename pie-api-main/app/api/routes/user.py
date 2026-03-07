from fastapi import APIRouter, Depends, HTTPException, Response, status, Request
from sqlalchemy.orm import Session
from typing import List
from app.core.database import get_db
from app.models.db.user import User
from app.schemas.user import UserCreate, UserUpdate, UserOut, UserLogin, UserPassword, UserWithToken
from app.core.security import hash_password, verify_password
from app.core.auth import create_access_token
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

router = APIRouter()
limiter = Limiter(key_func=get_remote_address)

@router.post("/create", response_model=UserOut)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    
    existing_user = db.query(User).filter(User.email == user.email).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    existing_nmec = db.query(User).filter(User.nmec == user.nmec).first()
    if existing_nmec:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User with this nmec already exists"
        )
    
    user_dict = user.dict()
    user_dict["password"] = hash_password(user_dict["password"])
    
    db_user = User(**user_dict)
    try:
        db.add(db_user)
        db.commit()
        db.refresh(db_user)
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
    return db_user

@router.get("/", response_model=List[UserOut])
def read_users(db: Session = Depends(get_db)):
    users = db.query(User).all()
    return users

@router.get("/{nmec}", response_model=UserOut)
def read_user(nmec: str, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.nmec == nmec).first()
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@router.put("/{nmec}", response_model=UserOut)
def update_user(nmec: int, user: UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.nmec == nmec).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(db_user, key, value)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.put("/{nmec}/change-password", response_model=UserOut)
def change_password(nmec: int, password_data: UserPassword, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.nmec == nmec).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Verify current password
    if not verify_password(password_data.current_password, db_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    # Update password
    db_user.password = hash_password(password_data.new_password)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/{nmec}", response_model=UserOut)
def delete_user(nmec: str, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.nmec == nmec).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(db_user)
    db.commit()
    return Response(status_code=204)

@router.post("/login", response_model=UserWithToken)
@limiter.limit("5/minute")
def login_user(request: Request, user_credentials: UserLogin, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.email == user_credentials.email).first()
    
    if not db_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not verify_password(user_credentials.password, db_user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Create access token
    access_token = create_access_token(
        data={"sub": db_user.email}
    )
    
    # Return user with token
    user_dict = {
        "nmec": db_user.nmec,
        "name": db_user.name,
        "email": db_user.email,
        "role": db_user.role,
        "access_token": access_token,
        "token_type": "bearer"
    }
    
    return user_dict
@router.post("/logout")
def logout_user():
    return {"message": "Successfully logged out"}