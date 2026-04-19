from datetime import datetime, timezone
import uuid
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, 
    BigInteger, Date, DateTime, JSON, Text, text, Date
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from .database import Base

def now_utc():
    return datetime.now(timezone.utc)

class Session(Base):
    __tablename__ = "sessions"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(String(36), unique=True, nullable=False)
    start_time = Column(BigInteger, nullable=False)
    end_time = Column(BigInteger, nullable=True)
    duration_ms = Column(BigInteger, nullable=True)
    avg_distance_cm = Column(Float, nullable=True)
    avg_blink_rate = Column(Float, nullable=True)
    avg_lux_level = Column(Float, nullable=True)
    breaks_taken = Column(Integer, default=0)
    alerts_triggered = Column(Integer, default=0)
    platform = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"))

class DailyScore(Base):
    __tablename__ = "daily_scores"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False)
    date = Column(Date, nullable=False)
    score = Column(Integer, nullable=False)
    screen_time_score = Column(Float, nullable=True)
    distance_score = Column(Float, nullable=True)
    blink_score = Column(Float, nullable=True)
    lighting_score = Column(Float, nullable=True)
    risk_level = Column(String(16), nullable=True)
    myopia_risk_flag = Column(Boolean, default=False)
    total_screen_minutes = Column(Integer, nullable=True)

class Alert(Base):
    __tablename__ = "alerts"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False)
    alert_id = Column(String(36), unique=True, nullable=False)
    type = Column(String(32), nullable=True)
    severity = Column(String(16), nullable=True)
    triggered_at = Column(BigInteger, nullable=True)
    dismissed = Column(Boolean, default=False)
    snoozed_until = Column(BigInteger, nullable=True)
    message = Column(Text, nullable=True)
    action_taken = Column(String(16), nullable=True)

class CorrectionProfile(Base):
    __tablename__ = "correction_profiles"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), unique=True, nullable=False)
    contrast_boost = Column(Float, default=0)
    sharpness_level = Column(Float, default=0)
    font_scale_factor = Column(Float, default=1.0)
    blue_light_filter = Column(Float, default=0)
    auto_adjust = Column(Boolean, default=False)
    active_preset = Column(String(16), default='off')
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"))

class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False)
    generated_at = Column(BigInteger, nullable=False)
    horizon = Column(String(4), nullable=True)
    predicted_risk_level = Column(String(16), nullable=True)
    confidence = Column(Float, nullable=True)
    trend_slope = Column(Float, nullable=True)
    key_factors = Column(JSONB, nullable=True)
    recommendation = Column(Text, nullable=True)
    disclaimer = Column(Text, default='This is a habit trend indicator, not medical advice.')

class ConsentLog(Base):
    __tablename__ = "consent_log"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), nullable=False)
    consented_at = Column(BigInteger, nullable=False)
    consent_version = Column(String(8), nullable=True)
    backend_sync_enabled = Column(Boolean, nullable=True)
    data_retention_days = Column(Integer, default=90)

class AlertConfig(Base):
    __tablename__ = "alert_configs"
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    user_id = Column(UUID(as_uuid=True), unique=True, nullable=False)
    distance_threshold_cm = Column(Float, default=50)
    blink_rate_minimum = Column(Float, default=15)
    lux_minimum = Column(Float, default=50)
    continuous_usage_minutes = Column(Integer, default=20)
    alert_cooldown_seconds = Column(Integer, default=300)
    max_alerts_per_hour = Column(Integer, default=4)
