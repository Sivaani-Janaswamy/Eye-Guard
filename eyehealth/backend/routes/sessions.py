import time
import uuid
from typing import List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from ..database import get_db
from ..auth import get_current_user_id
from ..models import Session as SessionModel
from pydantic import BaseModel, Field

router = APIRouter(prefix="/sessions", tags=["sessions"])

class SessionStartRequest(BaseModel):
    session_id: str
    device_id: str
    platform: str
    consent_version: str

class SessionStartResponse(BaseModel):
    session_id: str
    start_time: int

class SessionEndRequest(BaseModel):
    end_time: int
    avg_distance_cm: float
    avg_blink_rate: float
    avg_lux_level: float
    breaks_taken: int

class SessionEndResponse(BaseModel):
    session_id: str
    duration_ms: int

class SessionResponse(BaseModel):
    session_id: str
    start_time: int
    end_time: Optional[int]
    duration_ms: Optional[int]
    avg_distance_cm: Optional[float]
    avg_blink_rate: Optional[float]
    avg_lux_level: Optional[float]
    breaks_taken: int

class SessionListResponse(BaseModel):
    sessions: List[SessionResponse]
    total: int

@router.post("/start", status_code=201, response_model=SessionStartResponse)
async def start_session(
    data: SessionStartRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    start_time = int(time.time() * 1000)
    db_obj = SessionModel(
        user_id=uuid.UUID(user_id),
        session_id=data.session_id,
        start_time=start_time,
        platform=data.platform
    )
    db.add(db_obj)
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail="Database insertion failed")
    
    return SessionStartResponse(session_id=data.session_id, start_time=start_time)

@router.post("/{session_id}/end", response_model=SessionEndResponse)
async def end_session(
    session_id: str,
    data: SessionEndRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(SessionModel).where(
        SessionModel.session_id == session_id,
        SessionModel.user_id == uuid.UUID(user_id)
    )
    result = await db.execute(query)
    session_rcd = result.scalars().first()

    if not session_rcd:
        raise HTTPException(status_code=404, detail="Session not found or belongs to another user")

    duration = data.end_time - session_rcd.start_time
    # Ensure no negative durations mapped
    duration = duration if duration > 0 else 0

    session_rcd.end_time = data.end_time
    session_rcd.duration_ms = duration
    session_rcd.avg_distance_cm = data.avg_distance_cm
    session_rcd.avg_blink_rate = data.avg_blink_rate
    session_rcd.avg_lux_level = data.avg_lux_level
    session_rcd.breaks_taken = data.breaks_taken

    await db.commit()
    return SessionEndResponse(session_id=session_id, duration_ms=duration)

@router.get("", response_model=SessionListResponse)
async def get_sessions(
    date: str = Query(..., description="YYYY-MM-DD"),
    limit: int = 20,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    try:
        dt = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format, use YYYY-MM-DD")
    
    start_of_day_ms = int(dt.timestamp() * 1000)
    end_of_day_ms = start_of_day_ms + 86400000

    base_query = select(SessionModel).where(
        SessionModel.user_id == uuid.UUID(user_id),
        SessionModel.start_time >= start_of_day_ms,
        SessionModel.start_time < end_of_day_ms
    )

    count_query = select(func.count()).select_from(base_query.subquery())
    count_res = await db.execute(count_query)
    total = count_res.scalar_one()

    data_query = base_query.order_by(SessionModel.start_time.desc()).limit(limit).offset(offset)
    data_res = await db.execute(data_query)
    records = data_res.scalars().all()

    items = [
        SessionResponse(
            session_id=r.session_id,
            start_time=r.start_time,
            end_time=r.end_time,
            duration_ms=r.duration_ms,
            avg_distance_cm=r.avg_distance_cm,
            avg_blink_rate=r.avg_blink_rate,
            avg_lux_level=r.avg_lux_level,
            breaks_taken=r.breaks_taken
        ) for r in records
    ]

    return SessionListResponse(sessions=items, total=total)
