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

# 🚀 Frame skipping optimization at WebSocket level
camera_frame_counters: Dict[str, int] = {}
camera_last_inference: Dict[str, float] = {}
camera_inference_intervals: Dict[str, int] = {}  # Per-camera inference intervals
INITIAL_INFERENCE_INTERVAL = 15  # Process every Nth frame through YOLO
MAX_INFERENCE_INTERVAL = 30     # Maximum frames to skip
MIN_INFERENCE_INTERVAL = 5      # Minimum frames to skip  
FORCE_INFERENCE_INTERVAL = 2.0  # Force YOLO every 2 seconds minimum

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
                    # Handle binary frame data with smart YOLO processing
                    frame_data = message["bytes"]
                    metadata = pending_metadata.get(token)
                    
                    if metadata:
                        # Initialize frame counters for new cameras
                        if token not in camera_frame_counters:
                            camera_frame_counters[token] = 0
                            camera_last_inference[token] = 0
                            camera_inference_intervals[token] = INITIAL_INFERENCE_INTERVAL
                        
                        camera_frame_counters[token] += 1
                        current_time = time.time()
                        frame_number = metadata['frameNumber']
                        current_interval = camera_inference_intervals[token]
                        
                        # 🎯 Smart YOLO processing decision
                        should_run_yolo = (
                            camera_frame_counters[token] % current_interval == 0 or  # Every Nth frame
                            (current_time - camera_last_inference[token]) > FORCE_INFERENCE_INTERVAL or  # Force every 2s
                            camera_last_inference[token] == 0  # First frame
                        )
                        
                        if should_run_yolo:
                            # 🔍 Process through YOLO inference
                            print(f"🔍 YOLO inference on frame #{frame_number} from {token} ({len(frame_data)} bytes)")
                            start_time = time.perf_counter()
                            processed_frame = await realtime_processor.process_frame(frame_data, metadata)
                            processing_time = (time.perf_counter() - start_time) * 1000
                            camera_last_inference[token] = current_time
                            
                            # 🎯 Adaptive performance adjustment
                            if processing_time > 100:  # If YOLO takes more than 100ms
                                camera_inference_intervals[token] = min(
                                    camera_inference_intervals[token] + 5, 
                                    MAX_INFERENCE_INTERVAL
                                )
                                print(f"⚡ Increased inference interval to {camera_inference_intervals[token]} for {token} (slow processing: {processing_time:.1f}ms)")
                            elif processing_time < 30:  # If YOLO is fast
                                camera_inference_intervals[token] = max(
                                    camera_inference_intervals[token] - 1,
                                    MIN_INFERENCE_INTERVAL
                                )
                                print(f"🚀 Decreased inference interval to {camera_inference_intervals[token]} for {token} (fast processing: {processing_time:.1f}ms)")
                            
                            if processed_frame:
                                # Add processing info to metadata
                                enhanced_metadata = metadata.copy()
                                enhanced_metadata.update({
                                    "processing_time_ms": processing_time,
                                    "processed_at": time.time() * 1000,
                                    "processed_size": len(processed_frame),
                                    "yolo_processed": True,
                                    "inference_frame": True
                                })
                                
                                # Broadcast to all viewers
                                await manager.broadcast_frame_to_viewers(
                                    token, 
                                    processed_frame, 
                                    enhanced_metadata
                                )
                        else:
                            # Pass frame through YOLO processor for cached detection overlay only
                            start_time = time.perf_counter()
                            processed_frame = await realtime_processor.process_frame(frame_data, metadata)
                            processing_time = (time.perf_counter() - start_time) * 1000
                            
                            if processed_frame:
                                # Add processing info to metadata
                                enhanced_metadata = metadata.copy()
                                enhanced_metadata.update({
                                    "processing_time_ms": processing_time,
                                    "processed_at": time.time() * 1000,
                                    "processed_size": len(processed_frame),
                                    "yolo_processed": False,
                                    "inference_frame": False,
                                    "cached_detections": True
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
        # Clean up frame counters
        camera_frame_counters.pop(token, None)
        camera_last_inference.pop(token, None)
        camera_inference_intervals.pop(token, None)

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
            
            # Enhanced adaptive logic based on viewer performance
            viewer_fps = viewer_stats.get("fps", 30)
            viewer_latency = viewer_stats.get("latency", 0)
            frame_drops = viewer_stats.get("frameDrops", 0)
            
            # 🎯 Adjust inference interval based on viewer performance
            current_interval = camera_inference_intervals.get(token, INITIAL_INFERENCE_INTERVAL)
            
            if viewer_latency > 150:  # High latency - reduce inference frequency
                new_interval = min(current_interval + 3, MAX_INFERENCE_INTERVAL)
                camera_inference_intervals[token] = new_interval
                print(f"🐌 High viewer latency ({viewer_latency}ms) - increased inference interval to {new_interval} for {token}")
                
            elif viewer_latency < 50 and frame_drops < 5:  # Low latency and few drops - can increase inference frequency
                new_interval = max(current_interval - 1, MIN_INFERENCE_INTERVAL)
                camera_inference_intervals[token] = new_interval
                print(f"🚀 Low viewer latency ({viewer_latency}ms) - decreased inference interval to {new_interval} for {token}")
            
            suggested_changes = {
                "type": "performance_feedback",
                "inference_interval": camera_inference_intervals.get(token, INITIAL_INFERENCE_INTERVAL),
                "viewer_performance": {
                    "fps": viewer_fps,
                    "latency": viewer_latency,
                    "frame_drops": frame_drops
                }
            }
            
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

async def get_camera_performance_stats(token: str) -> Dict[str, Any]:
    """Get current performance statistics for a camera"""
    return {
        "frame_count": camera_frame_counters.get(token, 0),
        "inference_interval": camera_inference_intervals.get(token, INITIAL_INFERENCE_INTERVAL),
        "last_inference": camera_last_inference.get(token, 0),
        "frames_since_inference": camera_frame_counters.get(token, 0) % camera_inference_intervals.get(token, INITIAL_INFERENCE_INTERVAL),
        "active": token in camera_frame_counters
    }

async def adjust_camera_inference_interval(token: str, new_interval: int):
    """Manually adjust inference interval for a camera"""
    if token in camera_inference_intervals:
        camera_inference_intervals[token] = max(MIN_INFERENCE_INTERVAL, min(MAX_INFERENCE_INTERVAL, new_interval))
        print(f"🎛️ Manually adjusted inference interval for {token} to {camera_inference_intervals[token]}")
