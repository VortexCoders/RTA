from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketState
from app.core.database import get_db
from app.core.websocket_manager import manager
from app.core.yolo_runner import run_yolo_on_webm
from app.models.camera import Camera
import asyncio

router = APIRouter()

@router.websocket("/ws/camera/{token}")
async def camera_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        await websocket.close(code=4404)
        return
    print(f"Camera connected: {token}")

    await manager.connect_camera(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            elif "bytes" in message and message["bytes"] is not None:
                print(f"Received binary: {len(message['bytes'])} bytes from {token}")
                messageBytes = message["bytes"]
                data = await run_yolo_on_webm(messageBytes)
                # Send each  as a separate WebSocket binary message
                await manager.broadcast_to_viewers(token, data, is_binary=True)

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_camera(token)

@router.websocket("/ws/view/{token}")
async def viewer_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    

    if not camera:
        await websocket.close(code=4404)
        return
    
    await manager.connect_viewer(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            await asyncio.sleep(10)  # Keeps the connection alive
    except WebSocketDisconnect:
        manager.disconnect_viewer(token, websocket)
