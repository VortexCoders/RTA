from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.websockets import WebSocketState
from app.core.database import get_db
from app.core.websocket_manager import manager
from app.core.yolo_runner import run_yolo_on_webm
from app.models.camera import Camera
import asyncio
import json
import time
from typing import Dict, Any, List

router = APIRouter()

# Store pending video data for each camera
pending_video_data: Dict[str, Dict[str, Any]] = {}

# Video processing queue and stats
video_processing_queue = asyncio.Queue()
processing_stats = {
    'clips_received': 0,
    'clips_processed': 0,
    'clips_failed': 0,
    'avg_processing_time': 0,
    'total_processing_time': 0
}

# Processed video queues for each camera (max 10 items)
processed_video_queues: Dict[str, List[Dict[str, Any]]] = {}
MAX_QUEUE_SIZE = 3

# Background worker management
_background_worker_started = False
_worker_count = 3  # Number of parallel YOLO workers

async def start_background_workers():
    """Start video processing workers"""
    global _background_worker_started
    if not _background_worker_started:
        # Start multiple parallel workers
        for i in range(_worker_count):
            asyncio.create_task(video_processing_worker(worker_id=i))
        _background_worker_started = True
        print(f"🚀 {_worker_count} video processing workers started")

# Video processing worker function
async def video_processing_worker(worker_id: int = 0):
    """Background worker to process video clips with YOLO"""
    print(f"🔧 Worker {worker_id} started")
    while True:
        try:
            video_task = await video_processing_queue.get()
            await process_video_clip(video_task, worker_id)
            video_processing_queue.task_done()
        except Exception as e:
            print(f"❌ Video processing worker {worker_id} error: {e}")
            await asyncio.sleep(1)

async def process_video_clip(task, worker_id: int = 0):
    """Process a single video clip with YOLO inference"""
    token, video_data, clip_number = task['token'], task['video_data'], task['clip_number']
    
    try:
        start_time = time.perf_counter()
        
        print(f"🧠 Worker {worker_id} processing video clip #{clip_number} for {token} ({len(video_data) / 1024 / 1024:.2f} MB)")
        
        # Run YOLO inference on the video clip
        processed_video_bytes = await run_yolo_on_webm(video_data)
        
        processing_time = time.perf_counter() - start_time
        processing_stats['clips_processed'] += 1
        processing_stats['total_processing_time'] += processing_time
        processing_stats['avg_processing_time'] = processing_stats['total_processing_time'] / processing_stats['clips_processed']
        
        print(f"✅ Worker {worker_id} YOLO processing complete for clip #{clip_number}: {processing_time:.2f}s")
        
        # Add to processed video queue instead of broadcasting immediately
        await add_to_processed_queue(token, {
            'clip_number': clip_number,
            'video_data': processed_video_bytes,
            'processing_time': processing_time,
            'original_size': len(video_data),
            'processed_size': len(processed_video_bytes),
            'timestamp': time.time() * 1000,
            'metadata': task.get('metadata', {})
        })
        
    except Exception as e:
        print(f"❌ Worker {worker_id} failed to process video clip #{clip_number}: {e}")
        processing_stats['clips_failed'] += 1

@router.websocket("/ws/camera/{token}")
async def camera_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """Video clip streaming endpoint for cameras"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        await websocket.close(code=4404)
        return
    
    # Start background workers if not already started
    await start_background_workers()
    
    print(f"🎥 Video clip camera connected: {token}")
    await manager.connect_camera(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            elif message["type"] == "websocket.receive":
                if "text" in message and message["text"]:
                    # Handle video metadata and control messages
                    try:
                        data = json.loads(message["text"])
                        await handle_camera_text_message(token, data, websocket)
                    except json.JSONDecodeError:
                        print(f"⚠️ Invalid JSON from camera {token}")

                elif "bytes" in message and message["bytes"]:
                    # Handle binary video chunk data
                    await handle_camera_binary_message(token, message["bytes"])

    except WebSocketDisconnect:
        print(f"📴 Camera {token} disconnected")
    except Exception as e:
        print(f"❌ Camera {token} error: {e}")
    finally:
        manager.disconnect_camera(token)
        # Clean up pending video data
        pending_video_data.pop(token, None)

async def handle_camera_text_message(token: str, data: Dict[str, Any], websocket: WebSocket):
    """Handle text messages from camera clients"""
    message_type = data.get("type")
    
    if message_type == "video_metadata":
        # Initialize video data structure for this clip
        clip_number = data.get("clipNumber")
        pending_video_data[token] = {
            'metadata': data,
            'chunks': [],
            'expected_chunks': 0,
            'received_chunks': 0,
            'clip_number': clip_number
        }
        processing_stats['clips_received'] += 1
        print(f"📹 Receiving video clip #{clip_number} from {token} ({data.get('size', 0) / 1024 / 1024:.2f} MB)")
        
    elif message_type == "video_chunk":
        # Update chunk tracking
        clip_number = data.get("clipNumber")
        if token in pending_video_data and pending_video_data[token]['clip_number'] == clip_number:
            pending_video_data[token]['expected_chunks'] = data.get("totalChunks", 0)
            
    elif message_type == "video_complete":
        # Video fully received, queue for processing
        clip_number = data.get("clipNumber")
        await finalize_video_clip(token, clip_number)
        
    elif message_type == "performance_feedback":
        # Handle camera performance feedback
        await handle_camera_performance_feedback(token, data, websocket)

async def handle_camera_binary_message(token: str, chunk_data: bytes):
    """Handle binary video chunk data from camera"""
    if token not in pending_video_data:
        print(f"⚠️ Received video chunk for {token} without metadata")
        return
        
    video_data = pending_video_data[token]
    video_data['chunks'].append(chunk_data)
    video_data['received_chunks'] += 1
    
    # Log progress periodically
    if video_data['received_chunks'] % 50 == 0:
        progress = video_data['received_chunks'] / max(video_data['expected_chunks'], 1) * 100
        print(f"📦 Clip #{video_data['clip_number']}: {progress:.1f}% received ({video_data['received_chunks']}/{video_data['expected_chunks']} chunks)")

async def finalize_video_clip(token: str, clip_number: int):
    """Assemble video chunks and queue for YOLO processing"""
    if token not in pending_video_data:
        print(f"⚠️ No video data found for {token} clip #{clip_number}")
        return
        
    video_data = pending_video_data[token]
    
    if video_data['clip_number'] != clip_number:
        print(f"⚠️ Clip number mismatch for {token}: expected {video_data['clip_number']}, got {clip_number}")
        return
        
    try:
        # Assemble all chunks
        total_size = sum(len(chunk) for chunk in video_data['chunks'])
        assembled_video = bytearray(total_size)
        offset = 0
        
        for chunk in video_data['chunks']:
            assembled_video[offset:offset + len(chunk)] = chunk
            offset += len(chunk)
            
        video_bytes = bytes(assembled_video)
        
        print(f"✅ Video clip #{clip_number} assembled: {len(video_bytes) / 1024 / 1024:.2f} MB from {len(video_data['chunks'])} chunks")
        
        # Queue for YOLO processing
        task = {
            'token': token,
            'video_data': video_bytes,
            'clip_number': clip_number,
            'metadata': video_data['metadata']
        }
        
        await video_processing_queue.put(task)
        print(f"🔄 Video clip #{clip_number} queued for YOLO processing (queue size: {video_processing_queue.qsize()})")
        
        # Clean up
        pending_video_data.pop(token, None)
        
    except Exception as e:
        print(f"❌ Failed to assemble video clip #{clip_number}: {e}")
        pending_video_data.pop(token, None)

async def handle_camera_performance_feedback(token: str, data: Dict[str, Any], websocket: WebSocket):
    """Handle performance feedback from camera clients"""
    try:
        # Send adaptive streaming suggestions based on processing queue load
        queue_size = video_processing_queue.qsize()
        
        response = {
            "type": "adaptive_streaming",
            "processing_queue_size": queue_size,
            "avg_processing_time": processing_stats['avg_processing_time'],
            "clips_processed": processing_stats['clips_processed']
        }
        
        # Adjust recording interval based on processing load
        if queue_size > 3:  # High load
            response["suggested_recording_interval"] = 15  # Record every 15 seconds instead of 10
            response["suggested_bitrate"] = 1500000  # Lower bitrate
        elif queue_size < 1:  # Low load
            response["suggested_recording_interval"] = 8   # Faster recording
            response["suggested_bitrate"] = 3000000  # Higher bitrate
            
        await websocket.send_text(json.dumps(response))
        
    except Exception as e:
        print(f"⚠️ Performance feedback error: {e}")

@router.websocket("/ws/view/{token}")
async def viewer_websocket_deprecated(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    """DEPRECATED: Video clip viewer endpoint - use HTTP polling instead"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    
    if not camera:
        await websocket.close(code=4404)
        return
    
    await websocket.accept()
    await websocket.send_text(json.dumps({
        "type": "deprecated",
        "message": "WebSocket viewer is deprecated. Use HTTP polling at /api/camera/{token}/next-video instead"
    }))
    await websocket.close(code=4000)

async def relay_performance_to_camera(token: str, viewer_stats: Dict[str, Any]):
    """DEPRECATED: No longer needed with HTTP polling"""
    pass

@router.get("/api/camera/{token}/stats")
async def get_camera_stats(token: str, db: Session = Depends(get_db)):
    """Get video processing statistics"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        return {"error": "Camera not found"}
    
    # Get connection stats
    is_camera_connected = token in manager.active_connections
    processed_queue_size = len(processed_video_queues.get(token, []))
    
    # Get latest clips info
    latest_clips = []
    if token in processed_video_queues:
        queue = processed_video_queues[token]
        latest_clips = [
            {
                "clip_number": item['clip_number'],
                "timestamp": item['timestamp'],
                "processing_time": item['processing_time'],
                "size": item['processed_size']
            }
            for item in queue[-5:]  # Last 5 clips
        ]
    
    return {
        "camera_connected": is_camera_connected,
        "processed_queue_size": processed_queue_size,
        "processing_stats": processing_stats,
        "pending_video_data": token in pending_video_data,
        "processing_queue_size": video_processing_queue.qsize(),
        "worker_count": _worker_count,
        "latest_clips": latest_clips,
        "max_queue_size": MAX_QUEUE_SIZE
    }

async def add_to_processed_queue(token: str, video_item: Dict[str, Any]):
    """Add processed video to camera's queue with max capacity"""
    if token not in processed_video_queues:
        processed_video_queues[token] = []
    
    queue = processed_video_queues[token]
    queue.append(video_item)
    
    # Maintain max queue size
    while len(queue) > MAX_QUEUE_SIZE:
        removed = queue.pop(0)  # Remove oldest
        print(f"📤 Removed old clip #{removed['clip_number']} from {token} queue (queue full)")
    
    print(f"📥 Added clip #{video_item['clip_number']} to {token} queue (size: {len(queue)})")

def get_video_for_viewer(token: str) -> Dict[str, Any]:
    """Get the 2nd last video from queue for smart buffering"""
    if token not in processed_video_queues:
        return None
    
    queue = processed_video_queues[token]
    
    # Return 2nd last item if queue has 2+ items, otherwise return last item
    if len(queue) >= 2:
        return queue[-2]  # 2nd last for buffering
    elif len(queue) == 1:
        return queue[-1]  # Last item if only one available
    else:
        return None

@router.get("/api/camera/{token}/next-video")
async def get_next_video(token: str, db: Session = Depends(get_db)):
    """Get the next video clip for viewer (2nd last in queue for smart buffering)"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        return {"error": "Camera not found"}
    
    video_item = get_video_for_viewer(token)
    if not video_item:
        return {"video": None, "queue_size": 0}
    
        
    # Return metadata without actual video data for polling
    return {
        "video": {
            "clip_number": video_item['clip_number'],
            "processing_time": video_item['processing_time'],
            "original_size": video_item['original_size'],
            "processed_size": video_item['processed_size'],
            "timestamp": video_item['timestamp'],
            "available": True
        },
        "queue_size": len(processed_video_queues.get(token, []))
    }

@router.get("/api/camera/{token}/video/{clip_number}")
async def download_video(token: str, clip_number: int, db: Session = Depends(get_db)):
    """Download specific processed video clip"""
    from fastapi.responses import Response
    
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        return {"error": "Camera not found"}
    
    if token not in processed_video_queues:
        return {"error": "No videos available"}
    
    # Find the specific clip
    queue = processed_video_queues[token]
    for video_item in queue:
        if video_item['clip_number'] == clip_number:
            return Response(
                content=video_item['video_data'],
                media_type="video/webm",
                headers={
                    "Content-Disposition": f"inline; filename=clip_{clip_number}.webm",
                    "Cache-Control": "public, max-age=3600"
                }
            )
    
    return {"error": "Video clip not found"}

@router.get("/api/camera/{token}/latest-video-url")
async def get_latest_video_url(token: str, db: Session = Depends(get_db)):
    """Get URL for the latest processed video for immediate playback"""
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        return {"error": "Camera not found"}
    
    video_item = get_video_for_viewer(token)
    if not video_item:
        return {"video_url": None}
    
    clip_number = video_item['clip_number']
    video_url = f"/api/camera/{token}/video/{clip_number}"
    
    return {
        "video_url": video_url,
        "clip_number": clip_number,
        "metadata": video_item
    }
