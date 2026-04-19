from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

from .routes import sessions, scores, alerts, predictions, correction, analytics, user

app = FastAPI(title="EyeGuard API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["chrome-extension://*", "http://localhost:*"],
    allow_methods=["*"],
    allow_headers=["Authorization", "Content-Type"],
)

@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}

app.include_router(sessions.router, prefix="/api/v1")
app.include_router(scores.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(predictions.router, prefix="/api/v1")
app.include_router(correction.router, prefix="/api/v1")
app.include_router(analytics.router, prefix="/api/v1")
app.include_router(user.router, prefix="/api/v1")
