import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pywebpush import webpush, WebPushException
from app.core.database import get_db
from app.core.security import VAPID_PRIVATE_KEY, VAPID_CLAIMS
from app.core.tingtingapi import TingTingAPIClient
from app.models.camera import Camera, Subscription

router = APIRouter()

@router.post("/subscribe/{camera_id}")
async def subscribe_to_notifications(
    camera_id: int,
    subscription_data: dict,
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    subscription = Subscription(
        camera_id=camera_id,
        endpoint=subscription_data.get("endpoint"),
        p256dh=subscription_data.get("keys", {}).get("p256dh"),
        auth=subscription_data.get("keys", {}).get("auth")
    )
    db.add(subscription)
    db.commit()
    
    return {"message": "Subscribed successfully"}

router.post("/subscribe/{camera_id}")
async def subscribe_to_notifications(
    camera_id: int,
    subscription_data: dict,
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    subscription = Subscription(
        camera_id=camera_id,
        endpoint=subscription_data.get("endpoint"),
        p256dh=subscription_data.get("keys", {}).get("p256dh"),
        auth=subscription_data.get("keys", {}).get("auth")
    )
    db.add(subscription)
    db.commit()
    
    return {"message": "Subscribed successfully"}

@router.post("/trigger-notification/{camera_id}")
async def trigger_notification(camera_id: int, message: str = "Motion detected!", db: Session = Depends(get_db)):
    subscriptions = db.query(Subscription).filter(Subscription.camera_id == camera_id).all()
    
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                },
                data=json.dumps({"title": "Camera Alert", "body": message}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
        except WebPushException as e:
            print(f"Failed to send notification: {e}")
    
    return {"message": f"Notifications sent to {len(subscriptions)} subscribers"}
