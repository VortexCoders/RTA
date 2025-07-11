from typing import Dict, List
from starlette.websockets import WebSocketState
from fastapi import WebSocket
import os
import asyncio
import json
from datetime import datetime

SAVE_DIR = "./recordings"
os.makedirs(SAVE_DIR, exist_ok=True)


class ConnectionManager:
    def __init__(self):
        # Maps camera_token → single camera WebSocket
        self.active_connections: Dict[str, WebSocket] = {}
        # Maps camera_token → list of viewer WebSockets
        self.viewers: Dict[str, List[WebSocket]] = {}

    async def connect_camera(self, websocket: WebSocket, camera_token: str):
        await websocket.accept()

        # Force disconnect existing camera (only 1 allowed per token)
        old_ws = self.active_connections.get(camera_token)
        if old_ws and old_ws.client_state == WebSocketState.CONNECTED:
            print(f"🔄 Replacing existing camera connection for token {camera_token}")
            try:
                await old_ws.close(code=4000)
                print(f"🔌 Closed existing camera connection for token {camera_token}")
            except Exception as e:
                print(f"⚠️ Failed to close old camera socket: {e}")

        self.active_connections[camera_token] = websocket
        self.viewers.setdefault(camera_token, [])
        print(f"🎥 Camera connected: {camera_token}")

    async def connect_viewer(self, websocket: WebSocket, camera_token: str):
        await websocket.accept()

        self.viewers.setdefault(camera_token, [])
        if websocket not in self.viewers[camera_token]:
            self.viewers[camera_token].append(websocket)
            print(f"👁️ Viewer connected to {camera_token} (total: {len(self.viewers[camera_token])})")

    def disconnect_camera(self, camera_token: str):
        if camera_token in self.active_connections:
            del self.active_connections[camera_token]
            print(f"❌ Camera disconnected: {camera_token}")

    def disconnect_viewer(self, websocket: WebSocket, camera_token: str):
        if camera_token in self.viewers:
            try:
                self.viewers[camera_token].remove(websocket)
                print(f"👋 Viewer disconnected from {camera_token}")
            except ValueError:
                pass

    async def broadcast_to_viewers(self, camera_token: str, data: bytes, is_binary: bool = False):
        """Send data to all connected viewers of a specific camera"""
        if camera_token not in self.viewers:
            return

        # if is_binary:
        #     await self.save_chunk(camera_token, data)

        disconnected = []

        for ws in self.viewers[camera_token]:
            if ws.client_state != WebSocketState.CONNECTED:  # WebSocketState.CONNECTED
                print(f"⚠️ Viewer {ws} is not connected, removing...")
                continue
            try:
                if is_binary:
                    await ws.send_bytes(data)
                else:
                    await ws.send_text(data)
            except Exception as e:
                print(f"⚠️ Failed to send to viewer: {e}")
                disconnected.append(ws)

        # Remove dead sockets
        for ws in disconnected:
            try:
                self.viewers[camera_token].remove(ws)
            except ValueError:
                pass
    
    # 🧪 Save function (non-blocking I/O)
    async def save_chunk(self, camera_token: str, data: bytes):
        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
        filename = os.path.join(SAVE_DIR, f"{camera_token}_{timestamp}.webm")
        # Append mode so chunks accumulate
        await asyncio.to_thread(self._write_to_file, filename, data)

    def _write_to_file(self, filename, data):
        with open(filename, 'ab') as f:
            f.write(data)


    async def disconnect_all(self):
        print("🧹 Disconnecting all WebSocket connections...")

        # Disconnect cameras
        for token, ws in self.active_connections.items():
            try:
                await ws.close(code=1001)
                print(f"Closed camera for token {token}")
            except Exception as e:
                print(f"Error closing camera {token}: {e}")
        self.active_connections.clear()

        # Disconnect viewers
        for token, viewer_list in self.viewers.items():
            for ws in viewer_list:
                try:
                    await ws.close(code=1001)
                    print(f"Closed viewer for token {token}")
                except Exception as e:
                    print(f"Error closing viewer for {token}: {e}")
        self.viewers.clear()

    # DEPRECATED: No longer needed with HTTP polling
    # async def broadcast_processed_video_to_viewers(self, camera_token: str, video_data: bytes, metadata: dict):
    #     """Broadcast processed video clip with metadata to all viewers"""
    #     pass

manager = ConnectionManager()