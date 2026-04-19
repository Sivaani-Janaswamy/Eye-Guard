import uuid
from datetime import datetime, timezone, timedelta
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import Session as SessionModel, DailyScore as DailyScoreModel

router = APIRouter(prefix="/analytics", tags=["analytics"])

class TrendDataPoint(BaseModel):
    date: str
    value: float

class TrendResponse(BaseModel):
    data: List[TrendDataPoint]

class WeeklySummaryResponse(BaseModel):
    total_screen_time_minutes: int
    avg_score: float
    avg_distance_cm: float
    avg_blink_rate: float
    alerts_triggered: int

@router.get("/weekly-summary", response_model=WeeklySummaryResponse)
async def get_weekly_summary(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    now = datetime.now(timezone.utc)
    seven_days_ago = now - timedelta(days=7)
    
    # Scores Query
    score_q = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date >= seven_days_ago.date()
    )
    score_res = await db.execute(score_q)
    scores = score_res.scalars().all()

    avg_score = sum([s.score for s in scores]) / len(scores) if scores else 100.0

    # Sessions Query
    seven_days_ms = int(seven_days_ago.timestamp() * 1000)
    sess_q = select(SessionModel).where(
        SessionModel.user_id == uuid.UUID(user_id),
        SessionModel.start_time >= seven_days_ms
    )
    sess_res = await db.execute(sess_q)
    sessions = sess_res.scalars().all()

    total_screen_time_ms = sum([s.duration_ms or 0 for s in sessions])
    total_screen_time_minutes = int(total_screen_time_ms / 60000)

    total_alerts = sum([s.alerts_triggered or 0 for s in sessions])

    # Time-weighted avgs logic
    if total_screen_time_ms > 0:
        avg_dist = sum([s.avg_distance_cm * ((s.duration_ms or 0) / total_screen_time_ms) for s in sessions if s.avg_distance_cm])
        avg_blink = sum([s.avg_blink_rate * ((s.duration_ms or 0) / total_screen_time_ms) for s in sessions if s.avg_blink_rate])
    else:
        avg_dist = 0
        avg_blink = 0

    return WeeklySummaryResponse(
        total_screen_time_minutes=total_screen_time_minutes,
        avg_score=round(avg_score, 1),
        avg_distance_cm=round(avg_dist, 1),
        avg_blink_rate=round(avg_blink, 1),
        alerts_triggered=total_alerts
    )

@router.get("/trends", response_model=TrendResponse)
async def get_trends(
    metric: str = Query(..., description="blinkRate|distance|score"),
    days: int = 30,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    if metric not in ["blinkRate", "distance", "score"]:
        raise HTTPException(status_code=422, detail="Invalid metric query param")

    now = datetime.now(timezone.utc)
    cutoff_date = (now - timedelta(days=days)).date()

    query = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date >= cutoff_date
    ).order_by(DailyScoreModel.date.asc())

    res = await db.execute(query)
    scores = res.scalars().all()

    # Note: We reverse map the sub-scores to their float values from the scoring mapping constraints
    # blinkScore = (avgBlink - 5) / 10 * 25
    # distanceScore = (avgDist - 30) / 30 * 25

    def extract_val(s: DailyScoreModel) -> float:
        if metric == "score": return s.score
        if metric == "blinkRate": return ((s.blink_score or 0) * 10 / 25) + 5
        if metric == "distance": return ((s.distance_score or 0) * 30 / 25) + 30
        return 0

    data = [TrendDataPoint(date=s.date.strftime("%Y-%m-%d"), value=extract_val(s)) for s in scores]
    return TrendResponse(data=data)
