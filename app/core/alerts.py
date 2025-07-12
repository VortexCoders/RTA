import asyncio
import logging
from typing import Dict, Any, List, Tuple, Optional
from datetime import datetime, timedelta
import json
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.models.camera import Camera
from app.core.tingtingapi import TingTingAPIClient
from app.core.whatsapp import send_wildlife_whatsapp_alert

# Configure logging for alerts
logger = logging.getLogger(__name__)
client = TingTingAPIClient()

# Cache for recent alerts to prevent spam (location -> last alert time)
_alert_cache = {}
ALERT_COOLDOWN_MINUTES = 5

# Animal classification for different alert types
DANGEROUS_ANIMALS = {
    # Animals that require civilian + official alerts
    1: {"nepali": "हात्ती", "english": "elephant", "type": "dangerous"}, 
    2: {"nepali": "चितुवा", "english": "leopard", "type": "dangerous"},
    0: {"nepali": "गैंडा", "english": "rhino", "type": "dangerous"},
    4: {"nepali": "बाघ", "english": "tiger", "type": "dangerous"},
}

ENDANGERED_ANIMALS = {
    # Animals that require only official alerts
    3: {"nepali": "रातो पाण्डा", "english": "red_panda", "type": "endangered"},
}

# Combine all animals for lookup
ALL_ANIMALS = {**DANGEROUS_ANIMALS, **ENDANGERED_ANIMALS}

async def send_alert_message(camera_id: str, alert_data: Dict[str, Any], video_bytes: bytes) -> None:
    """
    नेपालीमा अलर्ट सन्देश पठाउने फंक्शन - मुख्य एन्ट्री पोइन्ट
    
    Args:
        camera_id (str): क्यामेराको टोकन/आईडी
        alert_data (Dict[str, Any]): पत्ता लगाइएका जनावरहरूको जानकारी
        video_bytes (bytes): 10-सेकेन्डको भिडियो क्लिप
    """
    try:
        # Check cooldown period to prevent spam alerts
        current_time = datetime.now()
        cache_key = f"{camera_id}"
        
        if cache_key in _alert_cache:
            last_alert_time = _alert_cache[cache_key]
            time_since_last_alert = current_time - last_alert_time
            
            if time_since_last_alert < timedelta(minutes=ALERT_COOLDOWN_MINUTES):
                remaining_time = ALERT_COOLDOWN_MINUTES - time_since_last_alert.total_seconds() / 60
                logger.info(f"⏳ अलर्ट कूलडाउन सक्रिय: {camera_id} - {remaining_time:.1f} मिनेट बाँकी")
                return
        
        # Get camera information from database
        db = SessionLocal()
        try:
            camera = db.query(Camera).filter(Camera.camera_token == camera_id).first()
            if not camera:
                logger.error(f"❌ क्यामेरा फेला परेन: {camera_id}")
                return
        finally:
            db.close()
        
        timestamp = datetime.now()
        location = camera.location or "अज्ञात स्थान"
        
        # Extract detection information
        detections = alert_data.get('detections', [])
        highest_confidence = alert_data.get('highest_confidence', 0.0)
        
        # Filter detections and categorize animals
        dangerous_detections = []
        endangered_detections = []
        
        for detection in detections:
            class_id = detection.get('class_id', -1)
            confidence = detection.get('confidence', 0.0)

            print(f"Class ID: {class_id}, Confidence: {confidence}")

            if class_id in DANGEROUS_ANIMALS and confidence >= 0.80:
                dangerous_detections.append({
                    **detection,
                    'animal_info': DANGEROUS_ANIMALS[class_id]
                })
            elif class_id in ENDANGERED_ANIMALS and confidence >= 0.80:
                endangered_detections.append({
                    **detection,
                    'animal_info': ENDANGERED_ANIMALS[class_id]
                })
        
        # Get the one highest confidence detection, and check if it's dangerous or endangered.
        if dangerous_detections:
            highest_detection = max(dangerous_detections, key=lambda x: x['confidence'])
            alert_type = "खतरनाक"
            alert_confidence = highest_detection['confidence']
        elif endangered_detections:
            highest_detection = max(endangered_detections, key=lambda x: x['confidence'])
            alert_type = "संकटापन्न"
            alert_confidence = highest_detection['confidence']
        else:
            return
        
        animal_name = highest_detection['animal_info']['english']
        animal_name_nepali = highest_detection['animal_info']['nepali']


        # print the animal_name and animal_name_nepali
        print(f"Detected animal: {animal_name} ({animal_name_nepali})")
        voice_message = (
            f"सावधान! {alert_type} जनावर पत्ता लागेको छ। "
            f"{animal_name_nepali} ({animal_name}) को विश्वास स्तर {alert_confidence:.2f} छ। "
            f"स्थान: {location}।"
        )

        await send_whatsapp_alerts(camera, alert_type, animal_name_nepali, location, timestamp, video_bytes)

        # Send TingTing voice alert
        logger.info(f"📞 TingTing भ्वाइस अलर्ट पठाउँदै: {animal_name_nepali}")
        await client.send_voice_alert(voice_message=voice_message)
        
        # Send WhatsApp alerts with video
        
        # Update alert cache to prevent duplicate alerts
        _alert_cache[cache_key] = current_time
        
        logger.info(f"✅ अलर्ट पठाइयो: {animal_name_nepali} - {location}")
        
    except Exception as e:
        logger.error(f"❌ अलर्ट पठाउन असफल भयो camera {camera_id}: {e}")

async def send_whatsapp_alerts(camera: Camera, alert_type: str, animal_name_nepali: str, 
                              location: str, timestamp: datetime, video_bytes: bytes) -> None:
    """
    व्हाट्सएप अलर्ट पठाउने
    Send WhatsApp alerts to admin and civilians
    """
    try:
        # Prepare timestamp string
        timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M:%S')
        
        # Send to admin (camera owner)
        if camera.phone_number:
            logger.info(f"📱 प्रशासकलाई व्हाट्सएप पठाउँदै: {camera.phone_number}")
            admin_result = await send_wildlife_whatsapp_alert(
                phone_numbers=[camera.phone_number],
                endangered_or_dangerous=alert_type,
                animal_name_nepali=animal_name_nepali,
                location=location,
                timestamp=timestamp_str,
                video_bytes=video_bytes
            )
            
            if admin_result.get("success"):
                logger.info("✅ प्रशासक व्हाट्सएप अलर्ट सफल")
            else:
                logger.error(f"❌ प्रशासक व्हाट्सएप असफल: {admin_result.get('message')}")
                
    except Exception as e:
        logger.error(f"❌ व्हाट्सएप अलर्ट त्रुटि: {e}")