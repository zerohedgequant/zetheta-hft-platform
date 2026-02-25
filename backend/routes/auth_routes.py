from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from typing import Optional
import sys
sys.path.append("..")
from services.auth_service import (
    register_user, login_user, get_current_user,
    refresh_access_token, update_user_score, UserCreate
)

router = APIRouter(prefix="/api/auth", tags=["Authentication"])

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class ScoreUpdateRequest(BaseModel):
    score: int
    challenge_completed: bool = False

@router.post("/register")
async def register(request: RegisterRequest):
    result = register_user(UserCreate(
        username=request.username,
        email=request.email,
        password=request.password
    ))
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.post("/login")
async def login(request: LoginRequest):
    result = login_user(request.username, request.password)
    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])
    return result

@router.get("/me")
async def get_me(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ")[1]
    user = get_current_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user

@router.post("/refresh")
async def refresh(request: RefreshRequest):
    result = refresh_access_token(request.refresh_token)
    if "error" in result:
        raise HTTPException(status_code=401, detail=result["error"])
    return result

@router.post("/score")
async def update_score(request: ScoreUpdateRequest, authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ")[1]
    user = get_current_user(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    result = update_user_score(user["username"], request.score, request.challenge_completed)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result
