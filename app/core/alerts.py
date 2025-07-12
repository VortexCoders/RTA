import asyncio
import logging
from typing import Dict, Any, List, Tuple, Optional
from datetime import datetime, timedelta
import json
from sqlalchemy.orm import Session
from app.core.database import get_db, SessionLocal
from app.models.camera import Camera

# Configure logging for alerts
logger = logging.getLogger(__name__)

# Cache for recent alerts to prevent spam (location -> last alert time)
_alert_cache = {}
ALERT_COOLDOWN_MINUTES = 5

# Animal classification for different alert types
DANGEROUS_ANIMALS = {
    # Animals that require civilian + official alerts
    0: {"nepali": "हात्ती", "english": "elephant", "type": "dangerous"}, 
    1: {"nepali": "चितुवा", "english": "leopard", "type": "dangerous"},
    2: {"nepali": "गैंडा", "english": "rhino", "type": "dangerous"},
    3: {"nepali": "बाघ", "english": "tiger", "type": "dangerous"},
}

ENDANGERED_ANIMALS = {
    # Animals that require only official alerts
    4: {"nepali": "रातो पाण्डा", "english": "red_panda", "type": "endangered"},
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
            
            if class_id in DANGEROUS_ANIMALS and confidence >= 0.50:
                dangerous_detections.append({
                    **detection,
                    'animal_info': DANGEROUS_ANIMALS[class_id]
                })
            elif class_id in ENDANGERED_ANIMALS and confidence >= 0.50:
                endangered_detections.append({
                    **detection,
                    'animal_info': ENDANGERED_ANIMALS[class_id]
                })
        
        # Log alert in Nepali
        total_animals = len(dangerous_detections) + len(endangered_detections)
        logger.info(f"🚨 अलर्ट: {location} मा {total_animals} वटा जनावर भेटिए "
                   f"समय: {timestamp} (अधिकतम विश्वसनीयता: {highest_confidence:.2f})")
        
        # Print alert summary in Nepali
        print(f"\n🚨 सुरक्षा अलर्ट - स्थान: {location}")
        print(f"📅 समय: {timestamp.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"🎯 पत्ता लगाइएका जनावरहरू: {total_animals} वटा")
        
        # Process dangerous animals (civilian + official alerts)
        if dangerous_detections:
            await _process_dangerous_animal_alerts(camera, dangerous_detections, video_bytes, timestamp)
        
        # Process endangered animals (official alerts only)
        if endangered_detections:
            await _process_endangered_animal_alerts(camera, endangered_detections, video_bytes, timestamp)
        
        print(f"📹 भिडियो क्लिप साइज: {len(video_bytes) / 1024 / 1024:.2f} MB")
        print("-" * 50)
        
    except Exception as e:
        logger.error(f"❌ अलर्ट पठाउन असफल भयो camera {camera_id}: {e}")
        print(f"❌ अलर्ट प्रक्रिया त्रुटि: {e}")

async def _process_dangerous_animal_alerts(camera: Camera, detections: List[Dict], video_bytes: bytes, timestamp: datetime) -> None:
    """खतरनाक जनावरहरूको लागि नागरिक र अधिकारीहरूलाई अलर्ट पठाउने"""
    location = camera.location or "अज्ञात स्थान"
    
    # Check if we can send civilian alerts (respect cooldown)
    can_alert_civilians = _can_send_civilian_alert(location, timestamp)
    
    for detection in detections:
        animal_info = detection['animal_info']
        confidence = detection['confidence']
        animal_name = animal_info['nepali']
        
        print(f"⚠️ खतरनाक जनावर: {animal_name} (विश्वसनीयता: {confidence:.2f})")
        
        # Always alert officials for dangerous animals
        await _send_official_alert(camera, animal_info, confidence, video_bytes, timestamp)
        
        # Alert civilians if cooldown period has passed
        if can_alert_civilians:
            await _send_civilian_alert(camera, animal_info, confidence, video_bytes, timestamp)
            _update_alert_cache(location, timestamp)

async def _process_endangered_animal_alerts(camera: Camera, detections: List[Dict], video_bytes: bytes, timestamp: datetime) -> None:
    """लोपोन्मुख जनावरहरूको लागि केवल अधिकारीहरूलाई अलर्ट पठाउने"""
    location = camera.location or "अज्ञात स्थान"
    
    # Check if we can send official alerts (respect cooldown for same location)
    can_alert_officials = _can_send_official_alert(location, timestamp)
    
    for detection in detections:
        animal_info = detection['animal_info']
        confidence = detection['confidence']
        animal_name = animal_info['nepali']
        
        print(f"🔴 लोपोन्मुख जनावर: {animal_name} (विश्वसनीयता: {confidence:.2f})")
        
        # Alert officials if cooldown allows
        if can_alert_officials:
            await _send_official_alert(camera, animal_info, confidence, video_bytes, timestamp)
            _update_official_alert_cache(location, timestamp)

def _can_send_civilian_alert(location: str, current_time: datetime) -> bool:
    """नागरिकहरूलाई अलर्ट पठाउन मिल्छ कि भनेर जाँच गर्ने"""
    cache_key = f"civilian_{location}"
    if cache_key in _alert_cache:
        last_alert = _alert_cache[cache_key]
        if current_time - last_alert < timedelta(minutes=ALERT_COOLDOWN_MINUTES):
            return False
    return True

def _can_send_official_alert(location: str, current_time: datetime) -> bool:
    """अधिकारीहरूलाई अलर्ट पठाउन मिल्छ कि भनेर जाँच गर्ने"""
    cache_key = f"official_{location}"
    if cache_key in _alert_cache:
        last_alert = _alert_cache[cache_key]
        if current_time - last_alert < timedelta(minutes=ALERT_COOLDOWN_MINUTES):
            return False
    return True

def _update_alert_cache(location: str, timestamp: datetime) -> None:
    """नागरिक अलर्ट क्यास अपडेट गर्ने"""
    _alert_cache[f"civilian_{location}"] = timestamp

def _update_official_alert_cache(location: str, timestamp: datetime) -> None:
    """अधिकारी अलर्ट क्यास अपडेट गर्ने"""
    _alert_cache[f"official_{location}"] = timestamp

async def _send_civilian_alert(camera: Camera, animal_info: Dict, confidence: float, video_bytes: bytes, timestamp: datetime) -> None:
    """नागरिकहरूलाई अलर्ट पठाउने"""
    location = camera.location or "अज्ञात स्थान"
    animal_name = animal_info['nepali']
    animal_type = "खतरनाक" if animal_info['type'] == 'dangerous' else "लोपोन्मुख"
    
    # Voice message template in Nepali
    voice_message = f"यस क्षेत्रमा, हामीले एक {animal_type} {animal_name} भेट्यौं, हामीले व्हाट्सएपमा भिडियो र विवरणहरू पठाएका छौं।"
    
    # WhatsApp message template in Nepali
    whatsapp_message = f"""
🚨 सुरक्षा अलर्ट 🚨

📅 समय: {timestamp.strftime('%Y-%m-%d %H:%M:%S')}
🐾 जनावर: {animal_name}
📊 विश्वसनीयता: {confidence:.2f}
📍 स्थान: {location}

⚠️ सावधान रहनुहोस्! यो क्षेत्रमा {animal_type} जनावर देखिएको छ।

🎥 भिडियो प्रमाण संलग्न छ।
"""
    
    print(f"📢 नागरिक अलर्ट तयार: {location}")
    print(f"🔊 भ्वाइस सन्देश: {voice_message}")
    
    # Store alert data for external processing
    alert_payload = {
        'type': 'civilian',
        'camera': {
            'id': camera.id,
            'name': camera.name,
            'location': camera.location,
            'phone_number': camera.phone_number,
            'camera_token': camera.camera_token
        },
        'animal_info': animal_info,
        'confidence': confidence,
        'timestamp': timestamp.isoformat(),
        'voice_message_nepali': voice_message,
        'whatsapp_message_nepali': whatsapp_message,
        'video_bytes': video_bytes
    }
    
    # Save to processing queue or call external handler
    await _queue_civilian_alert(alert_payload)

async def _send_official_alert(camera: Camera, animal_info: Dict, confidence: float, video_bytes: bytes, timestamp: datetime) -> None:
    """अधिकारीहरूलाई अलर्ट पठाउने"""
    location = camera.location or "अज्ञात स्थान"
    animal_name = animal_info['nepali']
    animal_type = "खतरनाक" if animal_info['type'] == 'dangerous' else "लोपोन्मुख"
    
    
    # Official alert message in Nepali
    official_message = f"""
🚨 आधिकारिक वन्यजन्तु अलर्ट 🚨

📅 पत्ता लगाएको समय: {timestamp.strftime('%Y-%m-%d %H:%M:%S')}
🐾 जनावरको नाम: {animal_name}
📊 पहिचान विश्वसनीयता: {confidence:.2f}
📍 स्थान: {location}
🏠 क्यामेरा: {camera.name}

📞 सम्पर्क नम्बर: {camera.phone_number or 'उपलब्ध छैन'}

🎥 भिडियो प्रमाण संलग्न छ।

तत्काल कार्रवाई आवश्यक छ।
"""
    
    print(f"🏛️ अधिकारी अलर्ट तयार: {location}")
    
    # Store alert data for external processing
    alert_payload = {
        'type': 'official',
        'camera': {
            'id': camera.id,
            'name': camera.name,
            'location': camera.location,
            'phone_number': camera.phone_number,
            'camera_token': camera.camera_token
        },
        'animal_info': animal_info,
        'confidence': confidence,
        'timestamp': timestamp.isoformat(),
        'official_message_nepali': official_message,
        'video_bytes': video_bytes
    }
    
    # Save to processing queue or call external handler
    await _queue_official_alert(alert_payload)

async def _queue_civilian_alert(alert_payload: Dict[str, Any]) -> None:
    """नागरिक अलर्ट queue मा राख्ने"""
    # TODO: Implement actual queuing mechanism or direct API call
    logger.info(f"� नागरिक अलर्ट queue गरियो: {alert_payload['camera']['location']}")
    
    # Save evidence video
    await _save_evidence_video(alert_payload['camera']['camera_token'], alert_payload, alert_payload['video_bytes'])

async def _queue_official_alert(alert_payload: Dict[str, Any]) -> None:
    """अधिकारी अलर्ट queue मा राख्ने"""
    # TODO: Implement actual queuing mechanism or direct API call
    logger.info(f"🏛️ अधिकारी अलर्ट queue गरियो: {alert_payload['camera']['location']}")
    
    # Save evidence video
    await _save_evidence_video(alert_payload['camera']['camera_token'], alert_payload, alert_payload['video_bytes'])

async def _save_evidence_video(camera_token: str, alert_data: Dict[str, Any], video_bytes: bytes) -> None:
    """प्रमाण भिडियो सेभ गर्ने"""
    try:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        animal_name = alert_data['animal_info']['english']
        alert_type = alert_data['type']
        
        filename = f"alert_{alert_type}_{camera_token}_{animal_name}_{timestamp}.mp4"
        filepath = f"recordings/{filename}"
        
        # Save video file
        with open(filepath, 'wb') as f:
            f.write(video_bytes)
        
        logger.info(f"💾 प्रमाण भिडियो सेभ भयो: {filepath}")
        
    except Exception as e:
        logger.error(f"❌ प्रमाण भिडियो सेभ गर्न असफल: {e}")

def format_detection_summary(detections: List[Tuple]) -> Dict[str, Any]:
    """
    पत्ता लगाइएका जनावरहरूको जानकारी फर्म्याट गर्ने
    
    Args:
        detections: List of (bbox, class_id, confidence) tuples
        
    Returns:
        Dict containing formatted detection data
    """
    if not detections:
        return {
            'detections': [],
            'detected_classes': [],
            'highest_confidence': 0.0,
            'detection_count': 0
        }
    
    formatted_detections = []
    detected_classes = set()
    confidences = []
    
    for bbox, class_id, confidence in detections:
        class_id = int(class_id)
        
        # Get animal info if available
        animal_info = ALL_ANIMALS.get(class_id, {
            "nepali": f"अज्ञात जनावर {class_id}",
            "english": f"unknown_animal_{class_id}",
            "type": "unknown"
        })
        
        formatted_detections.append({
            'bbox': bbox.tolist() if hasattr(bbox, 'tolist') else list(bbox),
            'class_id': class_id,
            'class_name': animal_info['english'],
            'class_name_nepali': animal_info['nepali'],
            'animal_type': animal_info['type'],
            'confidence': float(confidence)
        })
        
        detected_classes.add(animal_info['nepali'])
        confidences.append(float(confidence))
    
    return {
        'detections': formatted_detections,
        'detected_classes': list(detected_classes),
        'highest_confidence': max(confidences) if confidences else 0.0,
        'detection_count': len(formatted_detections)
    }
