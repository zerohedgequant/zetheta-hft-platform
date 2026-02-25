"""
ZeTheta HFT Platform - FastAPI Backend
"""
from routes.auth_routes import router as auth_router
from routes.risk_routes import router as risk_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys
sys.path.append("services")
sys.path.append("routes")
sys.path.append("database")


app = FastAPI(
    title="ZeTheta HFT Platform",
    description="High-Frequency Trading Puzzle Platform API",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(risk_router)
app.include_router(auth_router)


@app.get("/")
async def root():
    return {"message": "ZeTheta HFT Platform API", "status": "running"}


@app.get("/health")
async def health():
    return {"status": "healthy", "version": "1.0.0"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
