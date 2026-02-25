"""
PostgreSQL Database Service
"""
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager

import os
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://localhost/zetheta_hft")

engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)


@contextmanager
def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

# User operations


def create_user(username: str, email: str, password_hash: str) -> dict:
    with get_db() as db:
        result = db.execute(text("""
            INSERT INTO users (username, email, password_hash)
            VALUES (:username, :email, :password_hash)
            RETURNING id, username, email, skill_level, total_score, challenges_completed, created_at
        """), {"username": username, "email": email, "password_hash": password_hash})
        row = result.fetchone()
        return dict(row._mapping) if row else None


def get_user_by_username(username: str) -> dict:
    with get_db() as db:
        result = db.execute(text(
            "SELECT * FROM users WHERE username = :username"
        ), {"username": username})
        row = result.fetchone()
        return dict(row._mapping) if row else None


def get_user_by_email(email: str) -> dict:
    with get_db() as db:
        result = db.execute(text(
            "SELECT * FROM users WHERE email = :email"
        ), {"email": email})
        row = result.fetchone()
        return dict(row._mapping) if row else None


def update_user_score(user_id: int, score: int, challenge_completed: bool = False) -> dict:
    with get_db() as db:
        if challenge_completed:
            db.execute(text("""
                UPDATE users 
                SET total_score = total_score + :score,
                    challenges_completed = challenges_completed + 1,
                    skill_level = CASE 
                        WHEN total_score + :score >= 10000 THEN 'EXPERT'
                        WHEN total_score + :score >= 5000 THEN 'ADVANCED'
                        WHEN total_score + :score >= 1000 THEN 'INTERMEDIATE'
                        ELSE 'BEGINNER'
                    END
                WHERE id = :user_id
            """), {"score": score, "user_id": user_id})
        else:
            db.execute(text("""
                UPDATE users SET total_score = total_score + :score WHERE id = :user_id
            """), {"score": score, "user_id": user_id})

        result = db.execute(text(
            "SELECT total_score, challenges_completed, skill_level FROM users WHERE id = :user_id"
        ), {"user_id": user_id})
        row = result.fetchone()
        return dict(row._mapping) if row else None

# Submission operations


def create_submission(user_id: int, challenge_id: str, score: int, pnl: float,
                      trades_count: int, max_drawdown: float, latency_avg: float, passed: bool) -> dict:
    with get_db() as db:
        result = db.execute(text("""
            INSERT INTO submissions (user_id, challenge_id, score, pnl, trades_count, max_drawdown, latency_avg, passed)
            VALUES (:user_id, :challenge_id, :score, :pnl, :trades_count, :max_drawdown, :latency_avg, :passed)
            RETURNING id, submitted_at
        """), {
            "user_id": user_id, "challenge_id": challenge_id, "score": score,
            "pnl": pnl, "trades_count": trades_count, "max_drawdown": max_drawdown,
            "latency_avg": latency_avg, "passed": passed
        })
        row = result.fetchone()
        return dict(row._mapping) if row else None


def get_user_submissions(user_id: int) -> list:
    with get_db() as db:
        result = db.execute(text(
            "SELECT * FROM submissions WHERE user_id = :user_id ORDER BY submitted_at DESC"
        ), {"user_id": user_id})
        return [dict(row._mapping) for row in result.fetchall()]

# Leaderboard operations


def update_leaderboard(user_id: int, username: str, total_score: int,
                       challenges_completed: int, best_latency: float = None) -> dict:
    with get_db() as db:
        db.execute(text("""
            INSERT INTO leaderboard (user_id, username, total_score, challenges_completed, best_latency, updated_at)
            VALUES (:user_id, :username, :total_score, :challenges_completed, :best_latency, CURRENT_TIMESTAMP)
            ON CONFLICT (user_id) DO UPDATE SET
                total_score = :total_score,
                challenges_completed = :challenges_completed,
                best_latency = COALESCE(LEAST(leaderboard.best_latency, :best_latency), :best_latency),
                updated_at = CURRENT_TIMESTAMP
        """), {
            "user_id": user_id, "username": username, "total_score": total_score,
            "challenges_completed": challenges_completed, "best_latency": best_latency
        })
        return {"status": "updated"}


def get_leaderboard(limit: int = 10) -> list:
    with get_db() as db:
        result = db.execute(text("""
            SELECT username, total_score, challenges_completed, best_latency, win_streak,
                   ROW_NUMBER() OVER (ORDER BY total_score DESC) as rank
            FROM leaderboard
            ORDER BY total_score DESC
            LIMIT :limit
        """), {"limit": limit})
        return [dict(row._mapping) for row in result.fetchall()]
