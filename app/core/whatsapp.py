import asyncio
import aiohttp
import logging
from typing import Dict, Any, List, Optional, Union
from datetime import datetime
import json
import base64
import os

# Configure logging
logger = logging.getLogger(__name__)

class WhatsAppAPIClient:
    """
    WhatsApp Business API client for sending template messages with video attachments
    व्हाट्सएप बिजनेस API क्लाइन्ट - भिडियो सहित टेम्प्लेट सन्देश पठाउनको लागि
    """
    
    def __init__(self, 
                 access_token: str,
                 phone_number_id: str,
                 base_url: str = "https://graph.facebook.com/v22.0"):
        self.access_token = "EAAKzezd8gtYBPF8F3lIs38wDhgmtNdl4iVIbvZAUjhT05LYPhgvnoTYsJdIdAwDBFryzC6rmVI6fWv1bbORZBKFdkZA0EOu2ROhfJWIiujveK3jjDxb9IFfgRFJ7BvXYCBbXfhFPCRP1xiCXEcunKHoefOCl6vC1aTZBIK4ZAHZAV33ZCjdbwV3ZCmMMSg1VojNELO8ixgbDNBgFQQMUhDQIqdVxA5w8wRfy7XSJpLO3UQZDZD"
        self.phone_number_id = phone_number_id
        self.base_url = base_url
        
    async def _get_headers(self) -> Dict[str, str]:
        """Get headers for WhatsApp API requests"""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Content-Type": "application/json"
        }
    
    async def upload_media(self, video_bytes: bytes, filename: str = "wildlife_alert.mp4") -> Optional[str]:
        """
        भिडियो मिडिया अपलोड गर्ने
        Upload video media to WhatsApp
        
        Args:
            video_bytes (bytes): Video file bytes
            filename (str): Filename for the video
            
        Returns:
            str: Media ID if successful, None otherwise
        """
        try:
            # Prepare form data for media upload
            form_data = aiohttp.FormData()
            form_data.add_field('messaging_product', 'whatsapp')
            form_data.add_field('type', 'video')
            form_data.add_field(
                'file',
                video_bytes,
                filename=filename,
                content_type='video/mp4'
            )
            
            headers = {
                "Authorization": f"Bearer {self.access_token}"
            }
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/{self.phone_number_id}/media",
                    data=form_data,
                    headers=headers
                ) as response:
                    result = await response.json()
                    
                    if response.status == 200 and result.get("id"):
                        media_id = result["id"]
                        logger.info(f"✅ भिडियो अपलोड सफल: Media ID {media_id}")
                        return media_id
                    else:
                        logger.error(f"❌ भिडियो अपलोड असफल: {result}")
                        return None
                        
        except Exception as e:
            logger.error(f"❌ भिडियो अपलोड त्रुटि: {e}")
            return None
    
    async def send_template_message(
        self,
        to_phone: str,
        template_name: str = "species_alert",
        template_variables: List[str] = None,
        media_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        टेम्प्लेट सन्देश पठाउने
        Send template message with optional media
        
        Args:
            to_phone (str): Recipient phone number (with country code)
            template_name (str): Template name
            template_variables (List[str]): Template variables
            media_id (str): Media ID for video attachment
            
        Returns:
            Dict containing API response
        """
        if template_variables is None:
            template_variables = []
            
        # Build template components
        components = []
        
        # Add header component with video if media_id provided
        if media_id:
            components.append({
                "type": "header",
                "parameters": [
                    {
                        "type": "video",
                        "video": {
                            "id": media_id
                        }
                    }
                ]
            })
        
        # Add body component with variables
        if template_variables:
            body_parameters = []
            for i, variable in enumerate(template_variables, 1):
                body_parameters.append({
                    "type": "text",
                    "text": str(variable)
                })
            
            components.append({
                "type": "body",
                "parameters": body_parameters
            })
        
        message_data = {
            "messaging_product": "whatsapp",
            "to": to_phone,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": "hi"  # Hindi language code
                },
                "components": components
            }
        }
        
        try:
            headers = await self._get_headers()
            
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{self.base_url}/{self.phone_number_id}/messages",
                    json=message_data,
                    headers=headers
                ) as response:
                    result = await response.json()

                    print("Whatsapp gave: ", result)
                    
                    if response.status == 200:
                        logger.info(f"✅ व्हाट्सएप सन्देश पठाइयो: {to_phone}")
                        return {
                            "status": 200,
                            "success": True,
                            "message": "WhatsApp message sent successfully",
                            "data": result
                        }
                    else:
                        logger.error(f"❌ व्हाट्सएप सन्देश असफल: {result}")
                        return {
                            "status": response.status,
                            "success": False,
                            "message": "WhatsApp message failed",
                            "data": result
                        }
                        
        except Exception as e:
            logger.error(f"❌ व्हाट्सएप API त्रुटि: {e}")
            return {
                "status": 500,
                "success": False,
                "message": f"WhatsApp API error: {e}",
                "errors": [str(e)]
            }
    
    async def send_species_alert(
        self,
        to_phone: str,
        endangered_or_dangerous: str,  # "लोपोन्मुख" or "खतरनाक"
        animal_name_nepali: str,
        location: str,
        timestamp: str,
        video_bytes: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        प्रजाति अलर्ट पठाउने - Complete workflow
        Send species alert with video - complete workflow
        
        Args:
            to_phone (str): Recipient phone number
            endangered_or_dangerous (str): "लोपोन्मुख" or "खतरनाक"
            animal_name_nepali (str): Animal name in Nepali
            location (str): Location name
            timestamp (str): Formatted timestamp
            video_bytes (bytes): Video evidence bytes
            
        Returns:
            Dict containing operation result
        """
        try:
            media_id = None
            
            # Upload video if provided
            if video_bytes:
                logger.info(f"📤 व्हाट्सएपको लागि भिडियो अपलोड गर्दै...")
                media_id = await self.upload_media(
                    video_bytes=video_bytes,
                    filename=f"wildlife_alert_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
                )
                
                if not media_id:
                    logger.warning("⚠️ भिडियो अपलोड असफल - टेक्स्ट मात्र पठाइनेछ")
            
            # Prepare template variables
            template_variables = [
                endangered_or_dangerous,  # {{1}}
                animal_name_nepali,       # {{2}}
                location,                 # {{3}}
                timestamp                 # {{4}}
            ]
            
            # Send template message
            logger.info(f"📱 व्हाट्सएप अलर्ट पठाउँदै: {to_phone}")
            result = await self.send_template_message(
                to_phone=to_phone,
                template_name="species_alert",
                template_variables=template_variables,
                media_id=media_id
            )
            
            if result.get("success"):
                logger.info(f"✅ व्हाट्सएप अलर्ट सफल: {animal_name_nepali} - {location}")
            else:
                logger.error(f"❌ व्हाट्सएप अलर्ट असफल: {result.get('message')}")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ प्रजाति अलर्ट त्रुटि: {e}")
            return {
                "status": 500,
                "success": False,
                "message": f"Species alert error: {e}",
                "errors": [str(e)]
            }

# Global WhatsApp client instance
_whatsapp_client: Optional[WhatsAppAPIClient] = None

async def get_whatsapp_client() -> WhatsAppAPIClient:
    """
    WhatsApp client instance प्राप्त गर्ने
    Get WhatsApp client instance
    """
    global _whatsapp_client
    if _whatsapp_client is None:
        # TODO: Get these from environment variables
        access_token = os.getenv("WHATSAPP_ACCESS_TOKEN", "EAAKzezd8gtYBPHsDiph9jZCZCmdef6ZBNaW3ogPcZBIYZAeyXXtZBZAShAO1ga4BbxmMZBaUD0VByZCZB6hR25LJ2dLDT2OUaeX3wg4vPq81Ufu9tLZAVzGlDkybHeMv2p858LUObkKAR5P60gDEHkdHGfg5B6EmUA59NT3UF9vXvVHZBJSr4sJdaBVrlfpQrrw6cxZCJ9rzBx2vVLxMJPvcMgaanikJQkmNiV7eQBekYms5rpZABG4DpnQvpR1AHudzTtSwZDZD")
        phone_number_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "603978709458247")
        
        _whatsapp_client = WhatsAppAPIClient(
            access_token=access_token,
            phone_number_id=phone_number_id
        )
    return _whatsapp_client


import av
import io

async def compress_video_pyav_nvenc(input_bytes: bytes, target_mb: int = 15, crf: int = 28) -> bytes:
    """
    Compress a video using PyAV with NVENC (h264_nvenc) to stay under the target size.
    """
    input_buffer = io.BytesIO(input_bytes)
    input_container = av.open(input_buffer, format="mp4")
    input_stream = input_container.streams.video[0]

    output_buffer = io.BytesIO()
    output_container = av.open(output_buffer, mode='w', format='mp4')

    # ⚠️ NVENC encoder (requires ffmpeg built with --enable-nvenc)
    output_stream = output_container.add_stream("h264_nvenc", rate=input_stream.average_rate or 24)
    output_stream.width = input_stream.width
    output_stream.height = input_stream.height
    output_stream.pix_fmt = "yuv420p"
    output_stream.options = {
        "preset": "p3",       # nvenc quality preset (p1 = slowest/best, p7 = fastest)
        "rc": "vbr",          # variable bitrate mode
        "cq": str(crf),       # quality-based variable bitrate (like CRF)
        "b": "0"              # disable constant bitrate override
    }

    for frame in input_container.decode(video=0):
        frame = frame.reformat(width=output_stream.width, height=output_stream.height, format="yuv420p")
        packet = output_stream.encode(frame)
        if packet:
            output_container.mux(packet)

    # Flush encoder
    for packet in output_stream.encode(None):
        output_container.mux(packet)

    output_container.close()
    compressed_bytes = output_buffer.getvalue()

    # Retry with worse quality if still large
    if len(compressed_bytes) > target_mb * 1024 * 1024 and crf < 35:
        return await compress_video_pyav_nvenc(input_bytes, target_mb, crf + 4)

    return compressed_bytes


async def send_wildlife_whatsapp_alert(
    phone_numbers: List[str],
    endangered_or_dangerous: str,
    animal_name_nepali: str,
    location: str,
    timestamp: str,
    video_bytes: Optional[bytes] = None

) -> Dict[str, Any]:
    """
    वन्यजन्तु व्हाट्सएप अलर्ट पठाउने
    Send wildlife WhatsApp alert to multiple recipients
    
    Args:
        phone_numbers (List[str]): List of phone numbers
        endangered_or_dangerous (str): "लोपोन्मुख" or "खतरनाक"
        animal_name_nepali (str): Animal name in Nepali
        location (str): Location name
        timestamp (str): Formatted timestamp
        video_bytes (bytes): Video evidence bytes
        
    Returns:
        Dict containing operation results
    """
    if not phone_numbers:
        logger.warning("⚠️ व्हाट्सएपको लागि कुनै फोन नम्बर उपलब्ध छैन")
        return {
            "status": 400,
            "success": False,
            "message": "No phone numbers provided"
        }
    
    # encode the video_bytes within 15MB with PyAv.
    if video_bytes and len(video_bytes) > 15 * 1024 * 1024:
        logger.info("🎞️ Compressing with PyAV + NVENC...")
        try:
            video_bytes = await compress_video_pyav_nvenc(video_bytes)
        except Exception as e:
            logger.error(f"🚫 PyAV NVENC compression failed: {e}")
            return {
                "status": 500,
                "success": False,
                "message": f"Video compression failed: {e}",
                "errors": [str(e)]
            }


    try:
        client = await get_whatsapp_client()
        results = []
        success_count = 0
        
        logger.info(f"📱 {len(phone_numbers)} जनालाई व्हाट्सएप अलर्ट पठाउँदै...")
        
        for phone in phone_numbers:
            try:
                # Ensure phone number has country code (Nepal: +977)
                if not phone.startswith('+'):
                    formatted_phone = f"+977{phone}" if phone.startswith('9') else f"+977{phone}"
                else:
                    formatted_phone = phone
                
                result = await client.send_species_alert(
                    to_phone=formatted_phone,
                    endangered_or_dangerous=endangered_or_dangerous,
                    animal_name_nepali=animal_name_nepali,
                    location=location,
                    timestamp=timestamp,
                    video_bytes=video_bytes
                )
                
                results.append({
                    "phone": formatted_phone,
                    "success": result.get("success", False),
                    "message": result.get("message", "Unknown error")
                })
                
                if result.get("success"):
                    success_count += 1
                
                # Small delay between messages to avoid rate limiting
                await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.error(f"❌ व्हाट्सएप पठाउन असफल {phone}: {e}")
                results.append({
                    "phone": phone,
                    "success": False,
                    "message": str(e)
                })
        
        logger.info(f"✅ व्हाट्सएप अलर्ट पूरा: {success_count}/{len(phone_numbers)} सफल")
        
        return {
            "status": 200,
            "success": success_count > 0,
            "message": f"WhatsApp alerts sent: {success_count}/{len(phone_numbers)} successful",
            "data": {
                "total_sent": len(phone_numbers),
                "successful": success_count,
                "failed": len(phone_numbers) - success_count,
                "results": results
            }
        }
        
    except Exception as e:
        logger.error(f"❌ व्हाट्सएप अलर्ट त्रुटि: {e}")
        return {
            "status": 500,
            "success": False,
            "message": f"WhatsApp alert error: {e}",
            "errors": [str(e)]
        }