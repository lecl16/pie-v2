from pydantic import BaseModel, EmailStr
from typing import Optional
from enum import Enum

class UserRole(str, Enum):
    ADMIN = "admin"
    TEACHER = "teacher"
    STUDENT = "student"
    AUDITOR = "auditor"


class UserBase(BaseModel):
    name: str
    email: EmailStr

class UserCreate(UserBase):
    nmec: int
    password: str
    email: str
    role: UserRole
    
class UserOut(UserBase):
    nmec: int
    email: str
    role: UserRole
    
class UserUpdate(UserBase):
    name: Optional[str]
    email: Optional[str]
    role: Optional[UserRole]
    
class UserPassword(BaseModel):
    current_password: str
    new_password: str
    
    
class UserLogin(BaseModel):
    email: EmailStr
    password: str
    
class UserWithToken(UserOut):
    access_token: str
    token_type: str

    class Config:
        orm_mode = True
        
