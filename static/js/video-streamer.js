class EnhancedVideoStreamer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaStream = null;
        this.isStreaming = false;
        this.canvas = null;
        this.context = null;
        this.video = null;
        this.animationId = null;
        this.targetFPS = 30;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        this.frameCounter = 0;
        this.qualityFactor = 0.8; // JPEG quality
    }

    async startStreaming() {
        try {
            // Get high-quality video stream
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    frameRate: { ideal: 30, min: 15 }
                },
                audio: false
            });

            this.video = document.getElementById('local-video');
            this.video.srcObject = this.mediaStream;

            // Create canvas for frame capture
            this.canvas = document.createElement('canvas');
            this.context = this.canvas.getContext('2d');

            // Wait for video metadata to load
            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.canvas.width = this.video.videoWidth;
                    this.canvas.height = this.video.videoHeight;
                    resolve();
                };
            });

            this.setupWebSocket();
        } catch (err) {
            console.error("Camera access failed:", err);
            this.setStatus("Camera access denied", "error");
        }
    }

    setupWebSocket() {
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const wsURL = `${protocol}://${location.host}/ws/camera/${this.token}`;
        this.ws = new WebSocket(wsURL);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            console.log("WebSocket connected - Real-time streaming");
            this.setStatus("Streaming in real-time...", "success");
            this.isStreaming = true;
            this.startFrameCapture();
            document.getElementById("start-btn").style.display = "none";
            document.getElementById("stop-btn").style.display = "inline-block";
        };

        this.ws.onclose = () => {
            console.log("WebSocket closed");
            this.isStreaming = false;
            this.setStatus("Disconnected", "error");
        };

        this.ws.onerror = err => {
            console.error("WebSocket error:", err);
            this.setStatus("WebSocket error", "error");
        };

        this.ws.onmessage = (event) => {
            // Handle any server messages (like FPS adjustments)
            if (typeof event.data === 'string') {
                try {
                    const msg = JSON.parse(event.data);
                    if (msg.type === 'fps_adjustment') {
                        this.targetFPS = msg.fps;
                        this.frameInterval = 1000 / this.targetFPS;
                        console.log(`FPS adjusted to ${this.targetFPS}`);
                    }
                } catch (e) {
                    console.log("Server message:", event.data);
                }
            }
        };
    }

    startFrameCapture() {
        const captureFrame = (currentTime) => {
            if (!this.isStreaming) return;

            // Throttle to target FPS
            if (currentTime - this.lastFrameTime >= this.frameInterval) {
                this.captureAndSendFrame();
                this.lastFrameTime = currentTime;
                this.frameCounter++;
            }

            this.animationId = requestAnimationFrame(captureFrame);
        };

        this.animationId = requestAnimationFrame(captureFrame);
    }

    async captureAndSendFrame() {
        if (!this.video || !this.canvas || !this.context || this.ws.readyState !== WebSocket.OPEN) {
            return;
        }

        try {
            // Draw current video frame to canvas
            this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Convert to JPEG blob for better compression
            this.canvas.toBlob(async (blob) => {
                if (blob && this.ws.readyState === WebSocket.OPEN) {
                    const arrayBuffer = await blob.arrayBuffer();
                    
                    // Create frame metadata
                    const metadata = {
                        timestamp: Date.now(),
                        frameNumber: this.frameCounter,
                        width: this.canvas.width,
                        height: this.canvas.height,
                        format: 'jpeg'
                    };

                    // Send metadata as text first
                    this.ws.send(JSON.stringify({
                        type: 'frame_metadata',
                        ...metadata
                    }));

                    // Send frame data as binary
                    this.ws.send(arrayBuffer);
                }
            }, 'image/jpeg', this.qualityFactor);

        } catch (err) {
            console.error("Frame capture error:", err);
        }
    }

    stopStreaming() {
        this.isStreaming = false;

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }

        if (this.video) {
            this.video.srcObject = null;
        }

        // Cleanup canvas
        this.canvas = null;
        this.context = null;

        document.getElementById("start-btn").style.display = "inline-block";
        document.getElementById("stop-btn").style.display = "none";
        this.setStatus("Stopped", "error");

        console.log(`Total frames sent: ${this.frameCounter}`);
        this.frameCounter = 0;
    }

    setStatus(msg, type) {
        const statusEl = document.getElementById("status");
        statusEl.textContent = msg;
        statusEl.className = `alert alert-${type}`;
    }

    // Dynamic quality adjustment based on connection
    adjustQuality(factor) {
        this.qualityFactor = Math.max(0.1, Math.min(1.0, factor));
        console.log(`Quality adjusted to ${this.qualityFactor}`);
    }

    // Dynamic FPS adjustment
    adjustFPS(fps) {
        this.targetFPS = Math.max(5, Math.min(60, fps));
        this.frameInterval = 1000 / this.targetFPS;
        console.log(`FPS adjusted to ${this.targetFPS}`);
    }
}
