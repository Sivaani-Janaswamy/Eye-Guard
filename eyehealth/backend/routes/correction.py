import uuid
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from ..database import get_db
from ..auth import get_current_user_id
from ..models import CorrectionProfile as CorrectionProfileModel

router = APIRouter(prefix="/correction", tags=["correction"])

CORRECTION_PRESETS = {
  "off":    { "contrastBoost": 0,   "sharpnessLevel": 0,   "fontScaleFactor": 1.0, "blueLightFilter": 0,   "autoAdjust": False, "activePreset": "off" },
  "office": { "contrastBoost": 0.3, "sharpnessLevel": 0.2, "fontScaleFactor": 1.1, "blueLightFilter": 0.2, "autoAdjust": False, "activePreset": "office" },
  "night":  { "contrastBoost": 0.2, "sharpnessLevel": 0.1, "fontScaleFactor": 1.2, "blueLightFilter": 0.8, "autoAdjust": False, "activePreset": "night" },
}

class CorrectionProfileBody(BaseModel):
    contrast_boost: Optional[float] = None
    sharpness_level: Optional[float] = None
    font_scale_factor: Optional[float] = None
    blue_light_filter: Optional[float] = None
    auto_adjust: Optional[bool] = None
    active_preset: Optional[str] = None

class CorrectionProfileResponse(BaseModel):
    applied: bool
    active_preset: str

@router.get("/profile")
async def get_profile(
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(CorrectionProfileModel).where(CorrectionProfileModel.user_id == uuid.UUID(user_id))
    res = await db.execute(query)
    profile = res.scalars().first()
    
    # If no profile, mock default "off" preset
    if not profile:
        return {
            "contrast_boost": 0,
            "sharpness_level": 0,
            "font_scale_factor": 1.0,
            "blue_light_filter": 0,
            "auto_adjust": False,
            "active_preset": "off"
        }
        
    return {
        "contrast_boost": profile.contrast_boost,
        "sharpness_level": profile.sharpness_level,
        "font_scale_factor": profile.font_scale_factor,
        "blue_light_filter": profile.blue_light_filter,
        "auto_adjust": profile.auto_adjust,
        "active_preset": profile.active_preset
    }

@router.put("/profile", response_model=CorrectionProfileResponse)
async def update_profile(
    data: CorrectionProfileBody,
    user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    query = select(CorrectionProfileModel).where(CorrectionProfileModel.user_id == uuid.UUID(user_id))
    res = await db.execute(query)
    profile = res.scalars().first()

    if profile:
        if data.contrast_boost is not None: profile.contrast_boost = data.contrast_boost
        if data.sharpness_level is not None: profile.sharpness_level = data.sharpness_level
        if data.font_scale_factor is not None: profile.font_scale_factor = data.font_scale_factor
        if data.blue_light_filter is not None: profile.blue_light_filter = data.blue_light_filter
        if data.auto_adjust is not None: profile.auto_adjust = data.auto_adjust
        if data.active_preset is not None: profile.active_preset = data.active_preset
        active = profile.active_preset
    else:
        new_prof = CorrectionProfileModel(
            user_id=uuid.UUID(user_id),
            contrast_boost=data.contrast_boost if data.contrast_boost is not None else 0,
            sharpness_level=data.sharpness_level if data.sharpness_level is not None else 0,
            font_scale_factor=data.font_scale_factor if data.font_scale_factor is not None else 1.0,
            blue_light_filter=data.blue_light_filter if data.blue_light_filter is not None else 0,
            auto_adjust=data.auto_adjust if data.auto_adjust is not None else False,
            active_preset=data.active_preset if data.active_preset is not None else 'off'
        )
        db.add(new_prof)
        active = new_prof.active_preset

    await db.commit()
    return CorrectionProfileResponse(applied=True, active_preset=active)

@router.get("/presets")
async def get_presets():
    return {"presets": CORRECTION_PRESETS}
