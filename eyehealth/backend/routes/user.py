import time
import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import (
    ConsentLog as ConsentLogModel, Session as SessionModel, DailyScore as DailyScoreModel,
    Alert as AlertModel, Prediction as PredictionModel, CorrectionProfile as CorrectionProfileModel,
    AlertConfig as AlertConfigModel
)

router = APIRouter(prefix="/user", tags=["user"])

class ConsentRecordBody(BaseModel):
    consent_version: str
    backend_sync_enabled: bool
    data_retention_days: int

class ConsentRecordResponse(ConsentRecordBody):
    consented_at: int

class DeleteDataResponse(BaseModel):
    deleted_at: int
    records_deleted: int

@router.get("/consent", response_model=ConsentRecordResponse)
async def get_consent(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(ConsentLogModel).where(ConsentLogModel.user_id == uuid.UUID(user_id)).order_by(ConsentLogModel.consented_at.desc())
    res = await db.execute(query)
    log = res.scalars().first()

    if not log:
        raise HTTPException(status_code=404, detail="No consent record found")

    return ConsentRecordResponse(
        consented_at=log.consented_at,
        consent_version=log.consent_version,
        backend_sync_enabled=log.backend_sync_enabled,
        data_retention_days=log.data_retention_days
    )

@router.put("/consent", response_model=ConsentRecordResponse)
async def update_consent(
    data: ConsentRecordBody,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    now_ms = int(time.time() * 1000)
    new_log = ConsentLogModel(
        user_id=uuid.UUID(user_id),
        consented_at=now_ms,
        consent_version=data.consent_version,
        backend_sync_enabled=data.backend_sync_enabled,
        data_retention_days=data.data_retention_days
    )
    db.add(new_log)
    await db.commit()

    return ConsentRecordResponse(
        consented_at=now_ms,
        consent_version=data.consent_version,
        backend_sync_enabled=data.backend_sync_enabled,
        data_retention_days=data.data_retention_days
    )

@router.delete("/data", response_model=DeleteDataResponse)
async def delete_user_data(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    uid = uuid.UUID(user_id)
    models = [
        SessionModel, DailyScoreModel, AlertModel, PredictionModel, 
        CorrectionProfileModel, AlertConfigModel
    ]
    
    total_deleted = 0
    # Actual hardcore data deletion across all tables mappings
    for m in models:
        stmt = delete(m).where(m.user_id == uid)
        res = await db.execute(stmt)
        total_deleted += res.rowcount

    # Log deletion in consent_log
    now_ms = int(time.time() * 1000)
    deletion_log = ConsentLogModel(
        user_id=uid,
        consented_at=now_ms,
        consent_version="deleted",
        backend_sync_enabled=False,
        data_retention_days=0
    )
    # Delete past logs too, replacing strictly with the deletion tombstone
    await db.execute(delete(ConsentLogModel).where(ConsentLogModel.user_id == uid))
    
    db.add(deletion_log)
    await db.commit()

    return DeleteDataResponse(
        deleted_at=now_ms,
        records_deleted=total_deleted
    )
