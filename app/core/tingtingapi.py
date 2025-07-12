import asyncio
import sys
import os

# Add the app directory to Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'app'))

## create TingTingAPIClient
class TingTingAPIClient:
    def __init__(self):
        self.base_url = "https://app.tingting.io"
        self.access_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzUyMzg0Njk3LCJpYXQiOjE3NTIyOTgyOTcsImp0aSI6IjcxNzMxZmUzNjZlOTQxY2E5ZTI3N2M1NjU1ZDZhNDBhIiwidXNlcl9pZCI6MTQ4fQ.e3x6VgXS4QHOUlYmjxf-lG4WXtDFFI01rvZvJJnSp-c"

    async def send_voice_alert(self, voice_message):
        import aiohttp
        async with aiohttp.ClientSession() as session:
            url = f"{self.base_url}/api/system/campaigns/2919/begin/"
            headers = {
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json"
            }
            payload = {
                "message": voice_message
            }
            async with session.post(url, json=payload, headers=headers) as response:
                return await response.json()
    
