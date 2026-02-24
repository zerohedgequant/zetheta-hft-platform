"""
Authentication Service - JWT based auth
"""
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr

SECRET_KEY = "zetheta-hft-secret-key-change-in-production"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30
REFRESH_TOKEN_EXPIRE_DAYS = 7

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# In-memory user store (replace with PostgreSQL later)
users_db = {}

class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    username: str
    password: str

class User(BaseModel):
    id: str
    username: str
    email: str
    skill_level: str = "BEGINNER"
    total_score: int = 0
    challenges_completed: int = 0
    created_at: datetime

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

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
    if user_data.username in users_db:
        return {"error": "Username already exists"}
    
    for u in users_db.values():
        if u["email"] == user_data.email:
            return {"error": "Email already registered"}
    
    user_id = f"user_{len(users_db) + 1}"
    hashed_password = get_password_hash(user_data.password)
    
    user = {
        "id": user_id,
        "username": user_data.username,
        "email": user_data.email,
        "password_hash": hashed_password,
        "skill_level": "BEGINNER",
        "total_score": 0,
        "challenges_completed": 0,
        "created_at": datetime.utcnow().isoformat()
    }
    
    users_db[user_data.username] = user
    
    access_token = create_access_token({"sub": user_id, "username": user_data.username})
    refresh_token = create_refresh_token({"sub": user_id, "username": user_data.username})
    
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "username": user_data.username,
            "email": user_data.email,
            "skill_level": "BEGINNER",
            "total_score": 0,
            "challenges_completed": 0
        }
    }

def login_user(username: str, password: str) -> dict:
    user = users_db.get(username)
    if not user:
        return {"error": "Invalid username or password"}
    
    if not verify_password(password, user["password_hash"]):
        return {"error": "Invalid username or password"}
    
    access_token = create_access_token({"sub": user["id"], "username": username})
    refresh_token = create_refresh_token({"sub": user["id"], "username": username})
    
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
    user = users_db.get(username)
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
    user = users_db.get(username)
    if not user:
        return {"error": "User not found"}
    
    new_access_token = create_access_token({"sub": user["id"], "username": username})
    
    return {
        "access_token": new_access_token,
        "token_type": "bearer"
    }

def update_user_score(username: str, score: int, challenge_completed: bool = False) -> dict:
    user = users_db.get(username)
    if not user:
        return {"error": "User not found"}
    
    user["total_score"] += score
    if challenge_completed:
        user["challenges_completed"] += 1
    
    if user["total_score"] >= 10000:
        user["skill_level"] = "EXPERT"
    elif user["total_score"] >= 5000:
        user["skill_level"] = "ADVANCED"
    elif user["total_score"] >= 1000:
        user["skill_level"] = "INTERMEDIATE"
    
    return {
        "total_score": user["total_score"],
        "challenges_completed": user["challenges_completed"],
        "skill_level": user["skill_level"]
    }
