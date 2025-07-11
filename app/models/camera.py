from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from datetime import datetime
from app.core.database import Base

class Camera(Base):
    __tablename__ = "cameras"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    location = Column(String, index=True)
    is_residential = Column(Boolean, default=False)
    public_slug = Column(String, unique=True, index=True)
    camera_token = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, index=True)
    endpoint = Column(Text)
    p256dh = Column(Text)
    auth = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
