import time
import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import Alert as AlertModel, AlertConfig as AlertConfigModel

router = APIRouter(prefix="/alerts", tags=["alerts"])

class AlertResponse(BaseModel):
    alert_id: str
    type: str
    severity: str
    triggered_at: int
    dismissed: bool
    snoozed_until: Optional[int]
    message: str
    action_taken: Optional[str]

class AlertListResponse(BaseModel):
    alerts: List[AlertResponse]

class AlertConfigBody(BaseModel):
    distance_threshold_cm: float = 50
    blink_rate_minimum: float = 15
    lux_minimum: float = 50
    continuous_usage_minutes: int = 20
    alert_cooldown_seconds: int = 300
    max_alerts_per_hour: int = 4

@router.get("", response_model=AlertListResponse)
async def get_alerts(
    unread: bool = Query(True),
    limit: int = 10,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(AlertModel).where(AlertModel.user_id == uuid.UUID(user_id))
    if unread:
        query = query.where(AlertModel.dismissed == False)
    
    query = query.order_by(AlertModel.triggered_at.desc()).limit(limit)
    res = await db.execute(query)
    alerts = res.scalars().all()

    return AlertListResponse(alerts=[
        AlertResponse(
            alert_id=a.alert_id,
            type=a.type,
            severity=a.severity,
            triggered_at=a.triggered_at,
            dismissed=a.dismissed,
            snoozed_until=a.snoozed_until,
            message=a.message,
            action_taken=a.action_taken
        ) for a in alerts
    ])

@router.post("/{alert_id}/dismiss")
async def dismiss_alert(
    alert_id: str,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(AlertModel).where(
        AlertModel.alert_id == alert_id,
        AlertModel.user_id == uuid.UUID(user_id)
    )
    res = await db.execute(query)
    alert = res.scalars().first()

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found or unauthorized")

    alert.dismissed = True
    alert.action_taken = "dismissed"
    await db.commit()

    return {"alert_id": alert_id, "dismissed": True}

class SnoozeRequest(BaseModel):
    snooze_minutes: int

@router.post("/{alert_id}/snooze")
async def snooze_alert(
    alert_id: str,
    data: SnoozeRequest,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(AlertModel).where(
        AlertModel.alert_id == alert_id,
        AlertModel.user_id == uuid.UUID(user_id)
    )
    res = await db.execute(query)
    alert = res.scalars().first()

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found or unauthorized")

    now_ms = int(time.time() * 1000)
    snooze_val = now_ms + (data.snooze_minutes * 60000)
    alert.snoozed_until = snooze_val
    alert.action_taken = "snoozed"
    await db.commit()

    return {"alert_id": alert_id, "snoozed_until": snooze_val}

@router.get("/config", response_model=AlertConfigBody)
async def get_alert_config(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(AlertConfigModel).where(AlertConfigModel.user_id == uuid.UUID(user_id))
    res = await db.execute(query)
    conf = res.scalars().first()

    if not conf:
        return AlertConfigBody() # returns defaults

    return AlertConfigBody(
        distance_threshold_cm=conf.distance_threshold_cm,
        blink_rate_minimum=conf.blink_rate_minimum,
        lux_minimum=conf.lux_minimum,
        continuous_usage_minutes=conf.continuous_usage_minutes,
        alert_cooldown_seconds=conf.alert_cooldown_seconds,
        max_alerts_per_hour=conf.max_alerts_per_hour
    )

@router.put("/config", response_model=AlertConfigBody)
async def update_alert_config(
    data: AlertConfigBody,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(AlertConfigModel).where(AlertConfigModel.user_id == uuid.UUID(user_id))
    res = await db.execute(query)
    conf = res.scalars().first()

    if conf:
        conf.distance_threshold_cm = data.distance_threshold_cm
        conf.blink_rate_minimum = data.blink_rate_minimum
        conf.lux_minimum = data.lux_minimum
        conf.continuous_usage_minutes = data.continuous_usage_minutes
        conf.alert_cooldown_seconds = data.alert_cooldown_seconds
        conf.max_alerts_per_hour = data.max_alerts_per_hour
    else:
        new_conf = AlertConfigModel(
            user_id=uuid.UUID(user_id),
            distance_threshold_cm=data.distance_threshold_cm,
            blink_rate_minimum=data.blink_rate_minimum,
            lux_minimum=data.lux_minimum,
            continuous_usage_minutes=data.continuous_usage_minutes,
            alert_cooldown_seconds=data.alert_cooldown_seconds,
            max_alerts_per_hour=data.max_alerts_per_hour
        )
        db.add(new_conf)

    await db.commit()
    return data
