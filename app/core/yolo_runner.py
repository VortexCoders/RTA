import asyncio, time, av
import numpy as np
import cv2
import torch
from io import BytesIO
from ultralytics import YOLO

# Load high-accuracy YOLO model
yolo_model = YOLO("yolov8l.pt").to("cuda").half()

async def run_yolo_on_webm(webm_bytes: bytes) -> bytes:
    def _process() -> bytes:
        t0 = time.perf_counter()
        infer_time = 0
        frames_done = 0
        yolo_boxes = {}

        # Load video from memory
        in_mem = BytesIO(webm_bytes)
        container = av.open(in_mem)
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"
        fps = stream.average_rate or 15
        width, height = stream.width, stream.height

        # Decode all frames
        frames = list(container.decode(video=0))
        total_frames = len(frames)
        sample_idxs = np.linspace(0, total_frames - 1, num=min(5, total_frames), dtype=int).tolist()
        sample_imgs = [frames[i].to_ndarray(format="bgr24") for i in sample_idxs]

        # YOLO batch inference
        with torch.inference_mode():
            tic = time.perf_counter()
            results = yolo_model(sample_imgs, imgsz=960, conf=0.25, verbose=False)
            infer_time = time.perf_counter() - tic

        for idx, result in zip(sample_idxs, results):
            boxes = result.boxes.xyxy.cpu().numpy() if result.boxes else []
            classes = result.boxes.cls.cpu().numpy() if result.boxes else []
            probs = result.boxes.conf.cpu().numpy() if result.boxes else []
            yolo_boxes[idx] = list(zip(boxes, classes, probs))

        # Encode using in-memory h264_nvenc
        output_buffer = BytesIO()
        output = av.open(output_buffer, mode='w', format='mp4')
        out_stream = output.add_stream("h264_nvenc", rate=int(fps))
        out_stream.width = width
        out_stream.height = height
        out_stream.pix_fmt = "yuv420p"

        for idx, frame in enumerate(frames):
            img = frame.to_ndarray(format="bgr24")

            # Use closest detection frame
            nearest_idx = min(yolo_boxes.keys(), key=lambda x: abs(x - idx))
            detections = yolo_boxes.get(nearest_idx, [])

            for (xyxy, cls, conf) in detections:
                x1, y1, x2, y2 = map(int, xyxy)
                label = f"{yolo_model.names[int(cls)]} {conf:.2f}"
                cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(img, label, (x1, max(10, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

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

        total = time.perf_counter() - t0
        fps_eff = frames_done / total if total else 0
        print(
            f"✅ YOLO on 5 frames | total={frames_done} | time={total:.2f}s | "
            f"FPS={fps_eff:.2f} | YOLO_time={infer_time:.2f}s"
        )

        return out_bytes

    return await asyncio.to_thread(_process)
