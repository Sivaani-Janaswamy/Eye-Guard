import time
import uuid
import numpy as np
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import Prediction as PredictionModel, DailyScore as DailyScoreModel

router = APIRouter(prefix="/prediction", tags=["prediction"])

class GeneratePredictionRequest(BaseModel):
    horizon: str # "7d", "14d", "30d"

class PredictionResponse(BaseModel):
    generated_at: int
    horizon: str
    predicted_risk_level: str
    confidence: float
    trend_slope: float
    key_factors: List[str]
    recommendation: str
    disclaimer: str

def weighted_linear_regression(scores: list[float], weights: list[float]) -> float:
    if len(scores) == 0: return 0.0
    x = np.arange(len(scores))
    y = np.array(scores)
    w = np.array(weights)
    
    w_sum = np.sum(w)
    if w_sum == 0: return 0.0
    
    wx_sum = np.sum(w * x)
    wy_sum = np.sum(w * y)
    wxx_sum = np.sum(w * x * x)
    wxy_sum = np.sum(w * x * y)
    
    denom = (w_sum * wxx_sum) - (wx_sum * wx_sum)
    if denom == 0: return 0.0
    
    return float(((w_sum * wxy_sum) - (wx_sum * wy_sum)) / denom)

@router.get("/latest", response_model=PredictionResponse)
async def get_latest_prediction(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(PredictionModel).where(
        PredictionModel.user_id == uuid.UUID(user_id)
    ).order_by(PredictionModel.generated_at.desc())
    res = await db.execute(query)
    pred = res.scalars().first()

    if not pred:
        raise HTTPException(status_code=404, detail="No predictions found")

    return PredictionResponse(
        generated_at=pred.generated_at,
        horizon=pred.horizon,
        predicted_risk_level=pred.predicted_risk_level,
        confidence=pred.confidence,
        trend_slope=pred.trend_slope,
        key_factors=pred.key_factors or [],
        recommendation=pred.recommendation,
        disclaimer=pred.disclaimer
    )

@router.post("/generate", response_model=PredictionResponse)
async def generate_prediction(
    data: GeneratePredictionRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    if data.horizon not in ["7d", "14d", "30d"]:
        raise HTTPException(status_code=422, detail="Invalid horizon")

    # Fetch last 30 daily scores
    query = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id)
    ).order_by(DailyScoreModel.date.desc()).limit(30)
    res = await db.execute(query)
    records = res.scalars().all()
    records.reverse()  # chronological order

    now_ms = int(time.time() * 1000)
    disclaimer = "This is a habit trend indicator, not medical advice."

    if len(records) < 5:
        # Not enough data
        p = PredictionModel(
            user_id=uuid.UUID(user_id),
            generated_at=now_ms,
            horizon=data.horizon,
            predicted_risk_level="low",
            confidence=0.1,
            trend_slope=0,
            key_factors=["Not enough data yet"],
            recommendation="Keep using EyeGuard for 5+ days to unlock predictions",
            disclaimer=disclaimer
        )
        db.add(p)
        await db.commit()
        return p

    scores = [r.score for r in records]
    n = len(scores)
    weights = [1.0 + (i / n) for i in range(n)]

    slope = weighted_linear_regression(scores, weights)
    
    horizon_days_map = {"7d": 7, "14d": 14, "30d": 30}
    days_ahead = horizon_days_map[data.horizon]

    projected = scores[-1] + (slope * days_ahead)
    predicted = max(0.0, min(100.0, projected))

    risk_level = "low" if predicted >= 75 else "moderate" if predicted >= 50 else "high"
    confidence = min(0.9, 0.4 + (n * 0.035))

    # Basic factors logic
    key_factors = []
    if slope < -0.5:
        key_factors.append(f"Score is trending downwards by {abs(slope):.1f} per day")
    elif slope > 0.5:
        key_factors.append(f"Score is steadily improving by {slope:.1f} per day")

    # Dummy recommendation based on slope
    rec = "Your score is declining — increase break frequency and maintain 50cm+ screen distance" if slope < -0.5 else "Keep up your current habits"

    p = PredictionModel(
        user_id=uuid.UUID(user_id),
        generated_at=now_ms,
        horizon=data.horizon,
        predicted_risk_level=risk_level,
        confidence=confidence,
        trend_slope=slope,
        key_factors=key_factors,
        recommendation=rec,
        disclaimer=disclaimer
    )
    db.add(p)
    await db.commit()

    return PredictionResponse(
        generated_at=p.generated_at,
        horizon=p.horizon,
        predicted_risk_level=p.predicted_risk_level,
        confidence=p.confidence,
        trend_slope=p.trend_slope,
        key_factors=p.key_factors or [],
        recommendation=p.recommendation,
        disclaimer=p.disclaimer
    )
