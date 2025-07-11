import asyncio, os, time, tempfile, av
import numpy as np
import cv2
from ultralytics import YOLO

yolo_model = YOLO("yolov8n.pt").to("cuda")

async def run_yolo_on_webm(webm_bytes: bytes) -> bytes:
    def _process() -> bytes:
        t0 = time.perf_counter()
        infer_time = 0
        frames_done = 0
        frames_yolo = 0
        yolo_boxes = {}

        in_fd, in_path = tempfile.mkstemp(suffix=".webm")
        os.write(in_fd, webm_bytes)
        os.close(in_fd)

        out_path = in_path.replace(".webm", "_out.mp4")

        container = av.open(in_path)
        stream = container.streams.video[0]
        stream.thread_type = "AUTO"

        fps = stream.average_rate or 15
        width, height = stream.width, stream.height

        frames = list(container.decode(video=0))
        total_frames = len(frames)
        sample_idxs = np.linspace(0, total_frames - 1, num=5, dtype=int).tolist()

        # Run YOLO on selected frames
        for i in sample_idxs:
            frame = frames[i]
            img = frame.to_ndarray(format="bgr24")

            tic = time.perf_counter()
            result = yolo_model(img, imgsz=640, conf=0.4, verbose=False)[0]
            infer_time += time.perf_counter() - tic

            boxes = result.boxes.xyxy.cpu().numpy() if result.boxes else []
            classes = result.boxes.cls.cpu().numpy() if result.boxes else []
            probs = result.boxes.conf.cpu().numpy() if result.boxes else []
            yolo_boxes[i] = list(zip(boxes, classes, probs))
            frames_yolo += 1

        output = av.open(out_path, 'w')
        out_stream = output.add_stream("libx264", rate=int(fps))
        out_stream.width = width
        out_stream.height = height
        out_stream.pix_fmt = "yuv420p"

        for idx, frame in enumerate(frames):
            img = frame.to_ndarray(format="bgr24")
            frames_done += 1

            nearest_yolo_idx = min(yolo_boxes.keys(), key=lambda x: abs(x - idx))
            detections = yolo_boxes[nearest_yolo_idx]

            for (xyxy, cls, conf) in detections:
                x1, y1, x2, y2 = map(int, xyxy)
                label = f"{yolo_model.names[int(cls)]} {conf:.2f}"
                cv2.rectangle(img, (x1, y1), (x2, y2), (0, 255, 0), 2)
                cv2.putText(img, label, (x1, max(10, y1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 1)

            new_frame = av.VideoFrame.from_ndarray(img, format="bgr24")
            for packet in out_stream.encode(new_frame):
                output.mux(packet)

        # Flush encoder
        for packet in out_stream.encode():
            output.mux(packet)

        container.close()
        output.close()
        os.remove(in_path)

        with open(out_path, "rb") as f:
            out_bytes = f.read()
        os.remove(out_path)

        total = time.perf_counter() - t0
        fps_eff = frames_done / total if total else 0
        print(
            f"🟢 YOLO H264 video | frames={frames_done:3d} | "
            f"total={total:6.3f}s | FPS={fps_eff:5.2f} | "
            f"YOLO‑frames={frames_yolo} | pure‑YOLO={infer_time:6.3f}s"
        )

        return out_bytes

    return await asyncio.to_thread(_process)
