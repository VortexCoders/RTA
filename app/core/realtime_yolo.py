import asyncio
import time
import cv2
import numpy as np
import torch
from ultralytics import YOLO
from PIL import Image
import io
import json
from typing import Optional, Dict, Any

class RealtimeYOLOProcessor:
    def __init__(self, model_path: str = "yolov8l.pt"):
        """Initialize real-time YOLO processor with optimizations"""
        
        # Load YOLO model with GPU acceleration
        self.model = YOLO(model_path)
        if torch.cuda.is_available():
            self.model.to("cuda")
            self.model.model.half()  # Use half precision for speed
            print("🚀 YOLO loaded on GPU with FP16")
        else:
            print("⚠️ YOLO loaded on CPU")
        
        # Performance settings
        self.inference_size = 640  # Smaller size for speed
        self.confidence_threshold = 0.25
        self.iou_threshold = 0.45
        
        # Frame processing stats
        self.frame_count = 0
        self.total_inference_time = 0
        self.last_stats_time = time.time()
        
        # Batch processing for efficiency
        self.frame_batch = []
        self.batch_size = 1  # Start with single frame processing
        self.max_batch_size = 4
        
        # Adaptive processing
        self.target_fps = 30
        self.current_load = 0.0
        
    async def process_frame(self, frame_data: bytes, metadata: Dict[str, Any]) -> Optional[bytes]:
        """Process single frame through YOLO inference"""
        try:
            start_time = time.perf_counter()
            
            # Decode JPEG frame
            image = Image.open(io.BytesIO(frame_data))
            frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
            
            # Run YOLO inference in thread pool
            processed_frame = await asyncio.to_thread(
                self._run_inference, frame, metadata
            )
            
            if processed_frame is None:
                return None
                
            # Encode back to JPEG
            result_bytes = await asyncio.to_thread(
                self._encode_frame, processed_frame
            )
            
            # Update performance stats
            inference_time = time.perf_counter() - start_time
            self._update_stats(inference_time)
            
            return result_bytes
            
        except Exception as e:
            print(f"❌ Frame processing error: {e}")
            return None
    
    def _run_inference(self, frame: np.ndarray, metadata: Dict[str, Any]) -> Optional[np.ndarray]:
        """Run YOLO inference on frame"""
        try:
            # Resize frame for inference speed
            original_height, original_width = frame.shape[:2]
            
            # Run YOLO inference
            with torch.inference_mode():
                results = self.model(
                    frame,
                    imgsz=self.inference_size,
                    conf=self.confidence_threshold,
                    iou=self.iou_threshold,
                    verbose=False,
                    device='cuda' if torch.cuda.is_available() else 'cpu'
                )
            
            # Draw detections
            annotated_frame = frame.copy()
            
            if results and len(results) > 0:
                result = results[0]
                
                if result.boxes is not None and len(result.boxes) > 0:
                    boxes = result.boxes.xyxy.cpu().numpy()
                    confidences = result.boxes.conf.cpu().numpy()
                    classes = result.boxes.cls.cpu().numpy()
                    
                    for box, conf, cls in zip(boxes, confidences, classes):
                        x1, y1, x2, y2 = map(int, box)
                        
                        # Get class name
                        class_name = self.model.names[int(cls)]
                        label = f"{class_name} {conf:.2f}"
                        
                        # Draw bounding box
                        color = self._get_class_color(int(cls))
                        cv2.rectangle(annotated_frame, (x1, y1), (x2, y2), color, 2)
                        
                        # Draw label with background
                        label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)[0]
                        cv2.rectangle(
                            annotated_frame,
                            (x1, y1 - label_size[1] - 10),
                            (x1 + label_size[0], y1),
                            color,
                            -1
                        )
                        cv2.putText(
                            annotated_frame,
                            label,
                            (x1, y1 - 5),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.6,
                            (255, 255, 255),
                            1
                        )
            
            # Add performance overlay
            self._add_performance_overlay(annotated_frame, metadata)
            
            return annotated_frame
            
        except Exception as e:
            print(f"❌ YOLO inference error: {e}")
            return None
    
    def _encode_frame(self, frame: np.ndarray) -> bytes:
        """Encode frame back to JPEG bytes"""
        try:
            # Convert BGR to RGB for PIL
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pil_image = Image.fromarray(rgb_frame)
            
            # Encode to JPEG with good quality
            buffer = io.BytesIO()
            pil_image.save(buffer, format='JPEG', quality=85, optimize=True)
            
            return buffer.getvalue()
            
        except Exception as e:
            print(f"❌ Frame encoding error: {e}")
            return b""
    
    def _get_class_color(self, class_id: int) -> tuple:
        """Get consistent color for each class"""
        # Generate color based on class ID
        colors = [
            (0, 255, 0),    # Green
            (255, 0, 0),    # Blue  
            (0, 0, 255),    # Red
            (255, 255, 0),  # Cyan
            (255, 0, 255),  # Magenta
            (0, 255, 255),  # Yellow
            (128, 0, 128),  # Purple
            (255, 165, 0),  # Orange
        ]
        return colors[class_id % len(colors)]
    
    def _add_performance_overlay(self, frame: np.ndarray, metadata: Dict[str, Any]):
        """Add performance information overlay"""
        try:
            height, width = frame.shape[:2]
            
            # Calculate current FPS
            current_time = time.time()
            if hasattr(self, 'last_frame_time'):
                fps = 1.0 / (current_time - self.last_frame_time)
            else:
                fps = 0
            self.last_frame_time = current_time
            
            # Create info text
            info_lines = [
                f"FPS: {fps:.1f}",
                f"Frame: #{metadata.get('frameNumber', 0)}",
                f"Size: {width}x{height}",
                f"GPU: {'Yes' if torch.cuda.is_available() else 'No'}"
            ]
            
            # Draw semi-transparent background
            overlay = frame.copy()
            cv2.rectangle(overlay, (10, 10), (250, 100), (0, 0, 0), -1)
            cv2.addWeighted(overlay, 0.7, frame, 0.3, 0, frame)
            
            # Draw text
            for i, line in enumerate(info_lines):
                y = 30 + i * 20
                cv2.putText(
                    frame, line, (20, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                    (0, 255, 0), 1
                )
                
        except Exception as e:
            print(f"⚠️ Overlay error: {e}")
    
    def _update_stats(self, inference_time: float):
        """Update performance statistics"""
        self.frame_count += 1
        self.total_inference_time += inference_time
        
        current_time = time.time()
        if current_time - self.last_stats_time >= 5.0:  # Log stats every 5 seconds
            avg_inference_time = self.total_inference_time / self.frame_count
            fps = self.frame_count / (current_time - self.last_stats_time)
            
            print(f"🔥 YOLO Stats: {fps:.1f} FPS, {avg_inference_time*1000:.1f}ms avg inference")
            
            # Reset stats
            self.frame_count = 0
            self.total_inference_time = 0
            self.last_stats_time = current_time
            
            # Adaptive batch size adjustment
            self._adjust_processing_parameters(fps)
    
    def _adjust_processing_parameters(self, current_fps: float):
        """Dynamically adjust processing parameters based on performance"""
        if current_fps < self.target_fps * 0.8:  # If FPS is too low
            # Reduce quality for speed
            if self.inference_size > 320:
                self.inference_size = max(320, self.inference_size - 64)
                print(f"🔧 Reduced inference size to {self.inference_size}")
            elif self.confidence_threshold < 0.5:
                self.confidence_threshold = min(0.5, self.confidence_threshold + 0.05)
                print(f"🔧 Increased confidence threshold to {self.confidence_threshold}")
                
        elif current_fps > self.target_fps * 1.2:  # If FPS is too high
            # Increase quality
            if self.inference_size < 640:
                self.inference_size = min(640, self.inference_size + 64)
                print(f"🔧 Increased inference size to {self.inference_size}")
            elif self.confidence_threshold > 0.15:
                self.confidence_threshold = max(0.15, self.confidence_threshold - 0.05)
                print(f"🔧 Decreased confidence threshold to {self.confidence_threshold}")

    def get_performance_stats(self) -> Dict[str, Any]:
        """Get current performance statistics"""
        return {
            "inference_size": self.inference_size,
            "confidence_threshold": self.confidence_threshold,
            "frames_processed": getattr(self, 'total_frames_processed', 0),
            "gpu_available": torch.cuda.is_available(),
            "target_fps": self.target_fps
        }

# Global processor instance
realtime_processor = RealtimeYOLOProcessor()
