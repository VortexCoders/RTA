from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketState
from app.core.database import get_db
from app.core.websocket_manager import manager
from app.core.realtime_yolo import realtime_processor
from app.models.camera import Camera
import asyncio
import json
import time
from typing import Dict, Any

router = APIRouter()

# Store pending frame metadata for each camera
pending_metadata: Dict[str, Dict[str, Any]] = {}

@router.websocket("/ws/camera/{token}")
async def camera_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """Real-time camera streaming endpoint"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        await websocket.close(code=4404)
        return
    
    print(f"🎥 Real-time camera connected: {token}")
    await manager.connect_camera(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            elif message["type"] == "websocket.receive":
                if "text" in message and message["text"]:
                    # Handle metadata messages
                    try:
                        data = json.loads(message["text"])
                        if data.get("type") == "frame_metadata":
                            # Store metadata for next binary frame
                            pending_metadata[token] = {
                                "timestamp": data["timestamp"],
                                "frameNumber": data["frameNumber"],
                                "width": data["width"],
                                "height": data["height"],
                                "format": data["format"],
                                "received_at": time.time() * 1000
                            }
                    except json.JSONDecodeError:
                        print(f"⚠️ Invalid metadata from {token}")

                elif "bytes" in message and message["bytes"]:
                    # Handle binary frame data
                    frame_data = message["bytes"]
                    metadata = pending_metadata.get(token)
                    
                    if metadata:
                        print(f"📸 Processing frame #{metadata['frameNumber']} from {token} ({len(frame_data)} bytes)")
                        
                        # Process frame through YOLO
                        start_time = time.perf_counter()
                        processed_frame = await realtime_processor.process_frame(frame_data, metadata)
                        processing_time = (time.perf_counter() - start_time) * 1000
                        
                        if processed_frame:
                            # Add processing info to metadata
                            enhanced_metadata = metadata.copy()
                            enhanced_metadata.update({
                                "processing_time_ms": processing_time,
                                "processed_at": time.time() * 1000,
                                "processed_size": len(processed_frame)
                            })
                            
                            # Broadcast to all viewers
                            await manager.broadcast_frame_to_viewers(
                                token, 
                                processed_frame, 
                                enhanced_metadata
                            )
                        
                        # Clear pending metadata
                        pending_metadata.pop(token, None)
                    else:
                        print(f"⚠️ Received frame data without metadata from {token}")

            # Handle performance feedback from viewers
            elif message.get("type") == "performance_feedback":
                data = json.loads(message.get("text", "{}"))
                await handle_performance_feedback(token, data, websocket)

    except WebSocketDisconnect:
        print(f"📴 Camera {token} disconnected")
    except Exception as e:
        print(f"❌ Camera {token} error: {e}")
    finally:
        manager.disconnect_camera(token)
        pending_metadata.pop(token, None)

@router.websocket("/ws/view/{token}")
async def viewer_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """Real-time viewer endpoint"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    
    if not camera:
        await websocket.close(code=4404)
        return
    
    print(f"👁️ Real-time viewer connected to {token}")
    await manager.connect_viewer(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            # Handle viewer messages (performance stats, etc.)
            try:
                message = await asyncio.wait_for(websocket.receive(), timeout=1.0)
                
                if message["type"] == "websocket.disconnect":
                    break
                elif "text" in message and message["text"]:
                    try:
                        data = json.loads(message["text"])
                        if data.get("type") == "performance_stats":
                            # Log viewer performance
                            print(f"📊 Viewer {token}: {data.get('fps', 0)} FPS, "
                                  f"{data.get('latency', 0)}ms latency, "
                                  f"{data.get('queueSize', 0)} queued")
                            
                            # Could relay this back to camera for adaptive streaming
                            await relay_performance_to_camera(token, data)
                            
                    except json.JSONDecodeError:
                        pass
                        
            except asyncio.TimeoutError:
                # Send periodic keepalive
                await websocket.send_text(json.dumps({
                    "type": "keepalive",
                    "timestamp": time.time() * 1000
                }))
                
    except WebSocketDisconnect:
        print(f"👋 Viewer disconnected from {token}")
    except Exception as e:
        print(f"❌ Viewer {token} error: {e}")
    finally:
        manager.disconnect_viewer(token, websocket)

async def handle_performance_feedback(token: str, data: Dict[str, Any], websocket: WebSocket):
    """Handle performance feedback from camera clients"""
    try:
        if data.get("type") == "quality_adjustment":
            # Send quality adjustment suggestions
            response = {
                "type": "fps_adjustment",
                "fps": data.get("suggested_fps", 30),
                "quality": data.get("suggested_quality", 0.8)
            }
            await websocket.send_text(json.dumps(response))
            
    except Exception as e:
        print(f"⚠️ Performance feedback error: {e}")

async def relay_performance_to_camera(token: str, viewer_stats: Dict[str, Any]):
    """Relay viewer performance stats to camera for adaptive streaming"""
    try:
        camera_ws = manager.active_connections.get(token)
        if camera_ws and camera_ws.client_state == WebSocketState.CONNECTED:
            
            # Simple adaptive logic
            viewer_fps = viewer_stats.get("fps", 30)
            viewer_latency = viewer_stats.get("latency", 0)
            
            suggested_changes = {}
            
            if viewer_latency > 200:  # High latency
                suggested_changes["fps"] = max(15, viewer_fps - 5)
                suggested_changes["quality"] = 0.6
            elif viewer_latency < 50 and viewer_fps > 25:  # Low latency, good performance
                suggested_changes["fps"] = min(30, viewer_fps + 2)
                suggested_changes["quality"] = 0.8
            
            if suggested_changes:
                await camera_ws.send_text(json.dumps({
                    "type": "adaptive_streaming",
                    **suggested_changes
                }))
                
    except Exception as e:
        print(f"⚠️ Relay error: {e}")

@router.get("/api/camera/{token}/stats")
async def get_camera_stats(token: str, db: Session = Depends(get_db)):
    """Get real-time processing statistics"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        return {"error": "Camera not found"}
    
    # Get YOLO processor stats
    processor_stats = realtime_processor.get_performance_stats()
    
    # Get connection stats
    is_camera_connected = token in manager.active_connections
    viewer_count = len(manager.viewers.get(token, []))
    
    return {
        "camera_connected": is_camera_connected,
        "viewer_count": viewer_count,
        "processor_stats": processor_stats,
        "pending_metadata": token in pending_metadata
    }
