class EnhancedVideoViewer {
    constructor(cameraToken) {
        this.cameraToken = cameraToken;
        this.videoElement = document.getElementById('stream-video');
        this.statusElement = document.getElementById('connection-status');
        
        this.websocket = null;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.frameQueue = [];
        this.isPlaying = false;
        this.frameRate = 30;
        this.frameInterval = 1000 / this.frameRate;
        this.lastFrameTime = 0;
        this.frameCounter = 0;
        this.canvas = null;
        this.context = null;
        this.pendingMetadata = null;
        
        // Performance monitoring
        this.fpsCounter = 0;
        this.lastFpsTime = Date.now();
        this.latencySum = 0;
        this.latencyCount = 0;
    }

    connect() {
        this.updateStatus("Connecting...", "info");
        this.setupCanvas();
        this.setupWebSocket();
    }

    setupCanvas() {
        // Create canvas for real-time frame rendering
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        
        // Replace video element with canvas or overlay
        const container = this.videoElement.parentElement;
        this.canvas.id = 'stream-canvas';
        this.canvas.style.width = '100%';
        this.canvas.style.height = 'auto';
        this.canvas.style.maxWidth = '800px';
        this.canvas.style.border = '1px solid #ddd';
        
        // Hide video element and show canvas
        this.videoElement.style.display = 'none';
        container.appendChild(this.canvas);
    }

    setupWebSocket() {
        const wsUrl = `wss://${location.host}/ws/view/${this.cameraToken}`;
        this.websocket = new WebSocket(wsUrl);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onopen = () => {
            this.updateStatus("Connected - Real-time stream", "success");
            this.startFrameRenderer();
        };

        this.websocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'frame_metadata') {
                        this.pendingMetadata = {
                            timestamp: message.timestamp,
                            frameNumber: message.frameNumber,
                            width: message.width,
                            height: message.height,
                            format: message.format,
                            receivedAt: Date.now()
                        };
                        
                        // Update canvas size if needed
                        if (this.canvas.width !== message.width || this.canvas.height !== message.height) {
                            this.canvas.width = message.width;
                            this.canvas.height = message.height;
                        }
                    }
                } catch (e) {
                    console.error("Failed to parse metadata:", e);
                }
            } else if (event.data instanceof ArrayBuffer && this.pendingMetadata) {
                // Process binary frame data
                this.processFrame(event.data, this.pendingMetadata);
                this.pendingMetadata = null;
            }
        };

        this.websocket.onerror = (err) => {
            console.error("WebSocket error:", err);
            this.updateStatus("WebSocket error", "danger");
        };

        this.websocket.onclose = () => {
            this.updateStatus("Disconnected", "danger");
            this.isPlaying = false;
        };
    }

    async processFrame(frameData, metadata) {
        try {
            // Create blob from frame data
            const blob = new Blob([frameData], { type: `image/${metadata.format}` });
            const imageBitmap = await createImageBitmap(blob);
            
            // Add to frame queue with metadata
            this.frameQueue.push({
                imageBitmap,
                metadata,
                processedAt: Date.now()
            });

            // Calculate latency
            const latency = Date.now() - metadata.timestamp;
            this.latencySum += latency;
            this.latencyCount++;

            // Limit queue size to prevent memory issues
            if (this.frameQueue.length > 10) {
                const oldFrame = this.frameQueue.shift();
                if (oldFrame.imageBitmap) {
                    oldFrame.imageBitmap.close();
                }
            }

        } catch (err) {
            console.error("Frame processing error:", err);
        }
    }

    startFrameRenderer() {
        this.isPlaying = true;
        
        const renderFrame = (currentTime) => {
            if (!this.isPlaying) return;

            // Render frames at target FPS
            if (currentTime - this.lastFrameTime >= this.frameInterval) {
                this.renderNextFrame();
                this.lastFrameTime = currentTime;
                this.updatePerformanceStats();
            }

            requestAnimationFrame(renderFrame);
        };

        requestAnimationFrame(renderFrame);
    }

    renderNextFrame() {
        if (this.frameQueue.length === 0) {
            this.updateStatus("Buffering frames...", "warning");
            return;
        }

        const frame = this.frameQueue.shift();
        if (!frame || !frame.imageBitmap) return;

        try {
            // Clear canvas and draw frame
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
            this.context.drawImage(frame.imageBitmap, 0, 0);
            
            // Clean up ImageBitmap
            frame.imageBitmap.close();
            
            this.frameCounter++;
            this.fpsCounter++;
            
            // Update status with frame info
            const latency = frame.processedAt - frame.metadata.timestamp;
            this.updateStatus(`Playing - Frame #${frame.metadata.frameNumber} (${latency}ms latency)`, "success");
            
        } catch (err) {
            console.error("Render error:", err);
            if (frame.imageBitmap) {
                frame.imageBitmap.close();
            }
        }
    }

    updatePerformanceStats() {
        const now = Date.now();
        if (now - this.lastFpsTime >= 1000) {
            const actualFPS = this.fpsCounter;
            const avgLatency = this.latencyCount > 0 ? (this.latencySum / this.latencyCount).toFixed(1) : 0;
            
            console.log(`Viewer Stats: ${actualFPS} FPS, ${avgLatency}ms avg latency, ${this.frameQueue.length} queued`);
            
            // Send performance data to server
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    type: 'performance_stats',
                    fps: actualFPS,
                    latency: avgLatency,
                    queueSize: this.frameQueue.length
                }));
            }
            
            // Reset counters
            this.fpsCounter = 0;
            this.lastFpsTime = now;
            this.latencySum = 0;
            this.latencyCount = 0;
        }
    }

    updateStatus(text, type = 'info') {
        if (!this.statusElement) return;
        this.statusElement.className = `alert alert-${type}`;
        this.statusElement.textContent = text;
    }

    reset() {
        this.isPlaying = false;

        if (this.websocket) {
            this.websocket.close();
            this.websocket = null;
        }

        // Clean up frame queue
        this.frameQueue.forEach(frame => {
            if (frame.imageBitmap) {
                frame.imageBitmap.close();
            }
        });
        this.frameQueue = [];

        // Clear canvas
        if (this.context && this.canvas) {
            this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // Reset counters
        this.frameCounter = 0;
        this.fpsCounter = 0;
        this.latencySum = 0;
        this.latencyCount = 0;

        this.updateStatus("Reset", "secondary");
    }

    // Dynamic quality adjustment
    adjustFrameRate(fps) {
        this.frameRate = Math.max(5, Math.min(60, fps));
        this.frameInterval = 1000 / this.frameRate;
        console.log(`Viewer frame rate adjusted to ${this.frameRate} FPS`);
    }
}
  