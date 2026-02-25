"""
Authentication Service - JWT with PostgreSQL
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from pydantic import BaseModel, EmailStr
import hashlib
from database.db_service import create_user, get_user_by_username, get_user_by_email, update_user_score as db_update_score

SECRET_KEY = "zetheta-hft-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7


class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return hashlib.sha256(plain_password.encode()).hexdigest() == hashed_password


def get_password_hash(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "type": "access"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "type": "refresh"})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


def register_user(user_data: UserCreate) -> dict:
    if get_user_by_username(user_data.username):
        return {"error": "Username already exists"}
    if get_user_by_email(user_data.email):
        return {"error": "Email already registered"}
    hashed_password = get_password_hash(user_data.password)
    user = create_user(user_data.username, user_data.email, hashed_password)
    if not user:
        return {"error": "Failed to create user"}
    access_token = create_access_token(
        {"sub": str(user["id"]), "username": user_data.username})
    refresh_token = create_refresh_token(
        {"sub": str(user["id"]), "username": user_data.username})
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "skill_level": user["skill_level"],
            "total_score": user["total_score"],
            "challenges_completed": user["challenges_completed"]
        }
    }


def login_user(username: str, password: str) -> dict:
    user = get_user_by_username(username)
    if not user:
        return {"error": "Invalid username or password"}
    if not verify_password(password, user["password_hash"]):
        return {"error": "Invalid username or password"}
    access_token = create_access_token(
        {"sub": str(user["id"]), "username": username})
    refresh_token = create_refresh_token(
        {"sub": str(user["id"]), "username": username})
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "email": user["email"],
            "skill_level": user["skill_level"],
            "total_score": user["total_score"],
            "challenges_completed": user["challenges_completed"]
        }
    }


def get_current_user(token: str) -> Optional[dict]:
    payload = verify_token(token)
    if not payload or payload.get("type") != "access":
        return None
    username = payload.get("username")
    user = get_user_by_username(username)
    if not user:
        return None
    return {
        "id": user["id"],
        "username": user["username"],
        "email": user["email"],
        "skill_level": user["skill_level"],
        "total_score": user["total_score"],
        "challenges_completed": user["challenges_completed"]
    }


def refresh_access_token(refresh_token: str) -> dict:
    payload = verify_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        return {"error": "Invalid refresh token"}
    username = payload.get("username")
    user = get_user_by_username(username)
    if not user:
        return {"error": "User not found"}
    new_access_token = create_access_token(
        {"sub": str(user["id"]), "username": username})
    return {"access_token": new_access_token, "token_type": "bearer"}


def update_user_score(username: str, score: int, challenge_completed: bool = False) -> dict:
    user = get_user_by_username(username)
    if not user:
        return {"error": "User not found"}
    result = db_update_score(user["id"], score, challenge_completed)
    if not result:
        return {"error": "Failed to update score"}
    return result
