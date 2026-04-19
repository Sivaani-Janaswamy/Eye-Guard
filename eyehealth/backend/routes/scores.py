from typing import List, Optional
from datetime import datetime, timezone
import uuid
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import Session as SessionModel, DailyScore as DailyScoreModel

router = APIRouter(prefix="/score", tags=["score"])

class DailyScoreBreakdown(BaseModel):
    screenTimeScore: float
    distanceScore: float
    blinkScore: float
    lightingScore: float

class DailyScoreResponse(BaseModel):
    date: str
    score: int
    breakdown: DailyScoreBreakdown
    riskLevel: str
    myopiaRiskFlag: bool
    totalScreenMinutes: int

class ScoreComputeResponse(BaseModel):
    job_id: str
    status: str

def clamp(val: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(val, max_val))

def compute_daily_score(sessions_list: list) -> dict:
    total_duration_ms = sum([s.duration_ms or 0 for s in sessions_list])
    total_screen_min = int(total_duration_ms / 60000)

    if total_duration_ms == 0:
        return {
            "score": 100,
            "breakdown": {"screenTimeScore": 25, "distanceScore": 25, "blinkScore": 25, "lightingScore": 25},
            "riskLevel": "low",
            "totalScreenMinutes": 0
        }

    def weighted_avg(key: str) -> float:
        return sum([getattr(s, key, 0) * ((s.duration_ms or 0) / total_duration_ms) for s in sessions_list])

    avg_dist = weighted_avg("avg_distance_cm")
    avg_blink = weighted_avg("avg_blink_rate")
    avg_lux = weighted_avg("avg_lux_level")

    st_score = clamp(25 - (total_screen_min / 30), 0, 25)
    dist_score = clamp((avg_dist - 30) / 30 * 25, 0, 25) if avg_dist else 0
    blink_score = clamp((avg_blink - 5) / 10 * 25, 0, 25) if avg_blink else 0
    lux_score = clamp((avg_lux - 20) / 100 * 25, 0, 25) if avg_lux else 0

    total_score = int(round(st_score + dist_score + blink_score + lux_score))
    risk_level = "low" if total_score >= 75 else "moderate" if total_score >= 50 else "high"

    return {
        "score": total_score,
        "breakdown": {
            "screenTimeScore": round(st_score, 2),
            "distanceScore": round(dist_score, 2),
            "blinkScore": round(blink_score, 2),
            "lightingScore": round(lux_score, 2)
        },
        "riskLevel": risk_level,
        "totalScreenMinutes": total_screen_min
    }

@router.get("/today", response_model=DailyScoreResponse)
async def get_today_score(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    query = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date == datetime.strptime(today_str, "%Y-%m-%d").date()
    )
    res = await db.execute(query)
    score = res.scalars().first()

    if not score:
        raise HTTPException(status_code=404, detail="Score not yet computed for today")

    return DailyScoreResponse(
        date=today_str,
        score=score.score,
        breakdown=DailyScoreBreakdown(
            screenTimeScore=score.screen_time_score,
            distanceScore=score.distance_score,
            blinkScore=score.blink_score,
            lightingScore=score.lighting_score
        ),
        riskLevel=score.risk_level,
        myopiaRiskFlag=score.myopia_risk_flag,
        totalScreenMinutes=score.total_screen_minutes
    )

class ScoreHistoryResponse(BaseModel):
    scores: List[DailyScoreResponse]

@router.get("/history", response_model=ScoreHistoryResponse)
async def get_score_history(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    try:
        dt_from = datetime.strptime(from_date, "%Y-%m-%d").date()
        dt_to = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")

    query = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date >= dt_from,
        DailyScoreModel.date <= dt_to
    ).order_by(DailyScoreModel.date.asc())

    res = await db.execute(query)
    scores = res.scalars().all()

    return ScoreHistoryResponse(scores=[
        DailyScoreResponse(
            date=s.date.strftime("%Y-%m-%d"),
            score=s.score,
            breakdown=DailyScoreBreakdown(
                screenTimeScore=s.screen_time_score,
                distanceScore=s.distance_score,
                blinkScore=s.blink_score,
                lightingScore=s.lighting_score
            ),
            riskLevel=s.risk_level,
            myopiaRiskFlag=s.myopia_risk_flag,
            totalScreenMinutes=s.total_screen_minutes
        ) for s in scores
    ])

@router.post("/compute", status_code=202, response_model=ScoreComputeResponse)
async def compute_score(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    today = datetime.now(timezone.utc)
    today_str = today.strftime("%Y-%m-%d")
    start_of_day = int(today.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)

    # Fetch sessions
    query = select(SessionModel).where(
        SessionModel.user_id == uuid.UUID(user_id),
        SessionModel.start_time >= start_of_day
    )
    res = await db.execute(query)
    sessions = res.scalars().all()

    # If no sessions but they called compute, compute as 100 or 0? 
    computed = compute_daily_score(sessions)
    
    # Check consecutive myopia flags natively
    past_flag_query = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date < today.date()
    ).order_by(DailyScoreModel.date.desc()).limit(2)
    past_res = await db.execute(past_flag_query)
    past_scores = past_res.scalars().all()

    # Myopia risk sets when score < 50 for 3 days 
    myopia_flag = False
    if computed["score"] < 50 and len(past_scores) == 2 and all([s.score < 50 for s in past_scores]):
        myopia_flag = True

    # Upsert logic
    score_q = select(DailyScoreModel).where(
        DailyScoreModel.user_id == uuid.UUID(user_id),
        DailyScoreModel.date == today.date()
    )
    s_res = await db.execute(score_q)
    existing_score = s_res.scalars().first()

    brk = computed["breakdown"]
    
    if existing_score:
        existing_score.score = computed["score"]
        existing_score.screen_time_score = brk["screenTimeScore"]
        existing_score.distance_score = brk["distanceScore"]
        existing_score.blink_score = brk["blinkScore"]
        existing_score.lighting_score = brk["lightingScore"]
        existing_score.risk_level = computed["riskLevel"]
        existing_score.myopia_risk_flag = myopia_flag
        existing_score.total_screen_minutes = computed["totalScreenMinutes"]
    else:
        new_score = DailyScoreModel(
            user_id=uuid.UUID(user_id),
            date=today.date(),
            score=computed["score"],
            screen_time_score=brk["screenTimeScore"],
            distance_score=brk["distanceScore"],
            blink_score=brk["blinkScore"],
            lighting_score=brk["lightingScore"],
            risk_level=computed["riskLevel"],
            myopia_risk_flag=myopia_flag,
            total_screen_minutes=computed["totalScreenMinutes"]
        )
        db.add(new_score)

    await db.commit()
    return ScoreComputeResponse(job_id=str(uuid.uuid4()), status="computing")
