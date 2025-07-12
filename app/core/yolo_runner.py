import asyncio, time, av
import numpy as np
import cv2
import torch
from io import BytesIO
from ultralytics import YOLO
from .alerts import send_alert_message, format_detection_summary

# Load optimized YOLO model
model_path = "weights_v11.pt"
yolo_model = YOLO(model_path)

if torch.cuda.is_available():
    yolo_model = yolo_model.to("cuda").half()
    print("🚀 YOLO model loaded on GPU with FP16")
else:
    print("⚠️ YOLO model loaded on CPU")

async def run_yolo_on_webm(webm_bytes: bytes, camera_id: str = "unknown") -> bytes:
    """Run YOLO object detection on a WebM video clip and return annotated video."""
    def _process() -> bytes:
        t0 = time.perf_counter()
        frames_done = 0
        inference_time = 0
        detection_map = {}

        try:
            in_mem = BytesIO(webm_bytes)
            container = av.open(in_mem)
            stream = container.streams.video[0]
            stream.thread_type = "AUTO"

            fps = float(stream.average_rate or 30.0)
            width, height = stream.width, stream.height

            print(f"🎥 Processing video: {width}x{height} @ {fps:.1f} FPS")

            frames = list(container.decode(video=0))
            total_frames = len(frames)

            inference_interval = max(15, min(30, total_frames // 10))
            sample_idxs = list(range(0, total_frames, inference_interval))
            if total_frames - 1 not in sample_idxs:
                sample_idxs.append(total_frames - 1)

            print(f"🔍 Running YOLO on {len(sample_idxs)} sampled frames")
            sample_imgs = [frames[i].to_ndarray(format="bgr24") for i in sample_idxs]

            with torch.inference_mode():
                tic = time.perf_counter()
                results = yolo_model(sample_imgs, imgsz=960, conf=0.25, verbose=False)
                inference_time = time.perf_counter() - tic

            for idx, result in zip(sample_idxs, results):
                boxes = result.boxes.xyxy.cpu().numpy() if result.boxes else []
                classes = result.boxes.cls.cpu().numpy() if result.boxes else []
                confs = result.boxes.conf.cpu().numpy() if result.boxes else []
                detection_map[idx] = list(zip(boxes, classes, confs))

            print(f"✅ Inference complete in {inference_time:.2f}s")

            output_buffer = BytesIO()
            codec = "h264_nvenc" if torch.cuda.is_available() else "libx264"

            try:
                output = av.open(output_buffer, mode='w', format='mp4')
                out_stream = output.add_stream(codec, rate=int(fps))
            except Exception:
                output = av.open(output_buffer, mode='w', format='mp4')
                out_stream = output.add_stream("libx264", rate=int(fps))

            out_stream.width = width
            out_stream.height = height
            out_stream.pix_fmt = "yuv420p"
            out_stream.options = {"preset": "fast" if codec == "h264_nvenc" else "veryfast",
                                  "tune": "ll" if codec == "h264_nvenc" else "zerolatency"}

            for idx, frame in enumerate(frames):
                img = frame.to_ndarray(format="bgr24")
                nearest_idx = min(detection_map.keys(), key=lambda x: abs(x - idx))
                detections = detection_map.get(nearest_idx, [])

                for (xyxy, cls_id, conf) in detections:
                    if conf >= 0.75:
                        x1, y1, x2, y2 = map(int, xyxy)
                        label = f"{yolo_model.names[int(cls_id)]} {conf:.2f}"
                        cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                        label_size = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 2)[0]
                        cv2.rectangle(img, (x1, y1 - label_size[1] - 10),
                                      (x1 + label_size[0], y1), (0, 255, 0), -1)
                        cv2.putText(img, label, (x1, y1 - 5),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2)

                new_frame = av.VideoFrame.from_ndarray(img, format="bgr24")
                for packet in out_stream.encode(new_frame):
                    output.mux(packet)
                frames_done += 1

            for packet in out_stream.encode():
                output.mux(packet)

            output.close()
            output_buffer.seek(0)
            out_bytes = output_buffer.read()

            # Check if we have any high-confidence detections for alerts
            all_detections = []
            for frame_detections in detection_map.values():
                for detection in frame_detections:
                    bbox, class_id, confidence = detection
                    if confidence >= 0.50:  # Same threshold as drawing
                        all_detections.append(detection)

            # Send alert if detections found
            if all_detections:
                try:
                    # Format detection data for alert
                    alert_data = format_detection_summary(all_detections)
                    
                    # Update class names with actual YOLO model names
                    for detection in alert_data['detections']:
                        detection['class_name'] = yolo_model.names[int(detection['class_id'])]
                    
                    # Update detected classes list
                    alert_data['detected_classes'] = list(set(
                        yolo_model.names[int(det['class_id'])] for det in alert_data['detections']
                    ))
                    
                    # Send alert asynchronously (fire and forget)
                    asyncio.create_task(send_alert_message(camera_id, alert_data, out_bytes))
                    
                except Exception as alert_error:
                    print(f"⚠️ Alert processing error: {alert_error}")

            total_time = time.perf_counter() - t0
            fps_eff = frames_done / total_time if total_time else 0
            print(f"✅ Video processed: {frames_done} frames in {total_time:.2f}s | FPS: {fps_eff:.1f} | Output size: {len(out_bytes)/1024/1024:.2f} MB")

            return out_bytes

        except Exception as e:
            print(f"❌ Processing error: {e}")
            return webm_bytes

    return await asyncio.to_thread(_process)
