import asyncio, time, av
import numpy as np
import cv2
import torch
from io import BytesIO
from ultralytics import YOLO

# Load high-accuracy YOLO model with optimizations
yolo_model = YOLO("prelim.pt")
if torch.cuda.is_available():
    yolo_model = yolo_model.to("cuda").half()
    print("🚀 YOLO model loaded on GPU with FP16")
else:
    print("⚠️ YOLO model loaded on CPU")

async def run_yolo_on_webm(webm_bytes: bytes) -> bytes:
    """Process entire video clip with YOLO inference - optimized for 10-second clips"""
    def _process() -> bytes:
        t0 = time.perf_counter()
        infer_time = 0
        frames_done = 0
        yolo_boxes = {}

        try:
            # Load video from memory
            in_mem = BytesIO(webm_bytes)
            container = av.open(in_mem)
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"
            fps = float(stream.average_rate) if stream.average_rate else 30.0
            width, height = stream.width, stream.height

            print(f"🎥 Processing video: {width}x{height} @ {fps:.1f} FPS")

            # Decode all frames
            frames = list(container.decode(video=0))
            total_frames = len(frames)
            
            # For 10-second clips, sample every 15-30 frames for YOLO inference
            inference_interval = max(15, min(30, total_frames // 10))  # 10-20 inference points
            sample_idxs = list(range(0, total_frames, inference_interval))
            if total_frames - 1 not in sample_idxs:
                sample_idxs.append(total_frames - 1)  # Always include last frame
                
            print(f"🔍 Running YOLO on {len(sample_idxs)} frames (every {inference_interval} frames)")
            sample_imgs = [frames[i].to_ndarray(format="bgr24") for i in sample_idxs]

            # YOLO batch inference for speed
            with torch.inference_mode():
                tic = time.perf_counter()
                results = yolo_model(sample_imgs, imgsz=960, conf=0.25, verbose=False)
                infer_time = time.perf_counter() - tic

            # Process detection results
            for idx, result in zip(sample_idxs, results):
                boxes = result.boxes.xyxy.cpu().numpy() if result.boxes else []
                classes = result.boxes.cls.cpu().numpy() if result.boxes else []
                probs = result.boxes.conf.cpu().numpy() if result.boxes else []
                yolo_boxes[idx] = list(zip(boxes, classes, probs))

            print(f"✅ YOLO inference complete: {infer_time:.2f}s for {len(sample_idxs)} frames")

            # Encode output video with detections
            output_buffer = BytesIO()
            
            # Use hardware encoder if available
            codec = "h264_nvenc" if torch.cuda.is_available() else "libx264"
            try:
                output = av.open(output_buffer, mode='w', format='mp4')
                out_stream = output.add_stream(codec, rate=int(fps))
            except Exception:
                # Fallback to software encoder
                output = av.open(output_buffer, mode='w', format='mp4')
                out_stream = output.add_stream("libx264", rate=int(fps))
                
            out_stream.width = width
            out_stream.height = height
            out_stream.pix_fmt = "yuv420p"
            
            # Set quality parameters
            if codec == "h264_nvenc":
                out_stream.options = {"preset": "fast", "tune": "ll"}
            else:
                out_stream.options = {"preset": "veryfast", "tune": "zerolatency"}

            # Process each frame
            for idx, frame in enumerate(frames):
                img = frame.to_ndarray(format="bgr24")

                # Find nearest detection frame
                nearest_idx = min(yolo_boxes.keys(), key=lambda x: abs(x - idx))
                detections = yolo_boxes.get(nearest_idx, [])

                # Draw detections
                for (xyxy, cls, conf) in detections:
                    x1, y1, x2, y2 = map(int, xyxy)
                    class_name = yolo_model.names[int(cls)]
                    label = f"{class_name} {conf:.2f}"
                    
                    # Draw bounding box
                    cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                    
                    # Draw label with background
                    label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                    cv2.rectangle(img, (x1, y1 - label_size[1] - 10), 
                                (x1 + label_size[0], y1), (0, 255, 0), -1)
                    cv2.putText(img, label, (x1, y1 - 5),
                              cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                # Encode frame
                new_frame = av.VideoFrame.from_ndarray(img, format="bgr24")
                for packet in out_stream.encode(new_frame):
                    output.mux(packet)
                frames_done += 1

            # Final flush
            for packet in out_stream.encode():
                output.mux(packet)

            output.close()
            output_buffer.seek(0)
            out_bytes = output_buffer.read()

            total_time = time.perf_counter() - t0
            fps_eff = frames_done / total_time if total_time else 0
            
            print(f"✅ Video processing complete: {frames_done} frames in {total_time:.2f}s "
                  f"(effective {fps_eff:.1f} FPS) | YOLO: {infer_time:.2f}s | "
                  f"Output: {len(out_bytes) / 1024 / 1024:.2f} MB")

            return out_bytes

        except Exception as e:
            print(f"❌ Video processing error: {e}")
            return webm_bytes  # Return original video as fallback

    return await asyncio.to_thread(_process)
