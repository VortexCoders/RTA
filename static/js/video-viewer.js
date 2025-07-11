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
        this.maxFrameRate = 60; // Increased from 30 for faster processing
        this.frameInterval = 1000 / this.maxFrameRate;
        this.lastFrameTime = 0;
        this.frameCounter = 0;
        this.canvas = null;
        this.context = null;
        this.pendingMetadata = null;
        
        // Enhanced performance monitoring
        this.fpsCounter = 0;
        this.lastFpsTime = Date.now();
        this.latencySum = 0;
        this.latencyCount = 0;
        this.maxQueueSize = 3; // Reduced to minimize latency
        this.frameDrops = 0;
        this.renderingFrame = false; // Prevent frame rendering overlap
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
            
            // 🚀 Aggressive frame queue management for low latency
            const frameInfo = {
                imageBitmap,
                metadata,
                processedAt: Date.now()
            };

            // Calculate latency
            const latency = Date.now() - metadata.timestamp;
            this.latencySum += latency;
            this.latencyCount++;

            // 🎯 Smart queue management - drop old frames aggressively
            if (this.frameQueue.length >= this.maxQueueSize) {
                // Drop oldest frames to maintain low latency
                while (this.frameQueue.length >= this.maxQueueSize) {
                    const oldFrame = this.frameQueue.shift();
                    if (oldFrame.imageBitmap) {
                        oldFrame.imageBitmap.close();
                    }
                    this.frameDrops++;
                }
            }

            // Add new frame
            this.frameQueue.push(frameInfo);

            // 🏃‍♂️ Immediate rendering attempt (don't wait for RAF)
            if (!this.renderingFrame && this.frameQueue.length > 0) {
                this.renderNextFrame();
            }

        } catch (err) {
            console.error("Frame processing error:", err);
        }
    }

    startFrameRenderer() {
        this.isPlaying = true;
        
        // 🏃‍♂️ High-performance frame renderer with immediate processing
        const renderFrame = (currentTime) => {
            if (!this.isPlaying) return;

            // 🚀 Process multiple frames per cycle if available (catch up)
            let framesProcessed = 0;
            const maxFramesPerCycle = 3; // Process up to 3 frames per RAF cycle
            
            while (this.frameQueue.length > 0 && framesProcessed < maxFramesPerCycle) {
                this.renderNextFrame();
                framesProcessed++;
            }

            // Continue frame processing loop
            requestAnimationFrame(renderFrame);
        };

        // Start the rendering loop immediately
        requestAnimationFrame(renderFrame);
        
        // 🎯 Also setup a high-frequency interval for ultra-low latency
        this.highFrequencyTimer = setInterval(() => {
            if (this.frameQueue.length > 0 && !this.renderingFrame) {
                this.renderNextFrame();
            }
        }, 16); // ~60 FPS interval for immediate processing
    }

    renderNextFrame() {
        if (this.frameQueue.length === 0 || this.renderingFrame) {
            if (this.frameQueue.length === 0) {
                this.updateStatus("Buffering frames...", "warning");
            }
            return;
        }

        this.renderingFrame = true; // Prevent overlapping renders

        // 🎯 Always take the NEWEST frame for lowest latency
        let frame;
        if (this.frameQueue.length > 1) {
            // Drop intermediate frames and take the newest
            while (this.frameQueue.length > 1) {
                const oldFrame = this.frameQueue.shift();
                if (oldFrame.imageBitmap) {
                    oldFrame.imageBitmap.close();
                }
                this.frameDrops++;
            }
        }
        
        frame = this.frameQueue.shift();
        if (!frame || !frame.imageBitmap) {
            this.renderingFrame = false;
            return;
        }

        try {
            // 🚀 Ultra-fast canvas rendering
            this.context.drawImage(frame.imageBitmap, 0, 0, this.canvas.width, this.canvas.height);
            
            // Clean up ImageBitmap immediately
            frame.imageBitmap.close();
            
            this.frameCounter++;
            this.fpsCounter++;
            
            // Calculate real-time latency
            const totalLatency = Date.now() - frame.metadata.timestamp;
            const processingLatency = frame.processedAt - frame.metadata.timestamp;
            
            // Update status with performance info
            this.updateStatus(
                `🎥 Live Stream - Frame #${frame.metadata.frameNumber} | ` +
                `${totalLatency}ms total latency | ${this.frameQueue.length} queued | ` +
                `${this.frameDrops} dropped`, 
                "success"
            );
            
            // Performance stats update (less frequent)
            this.updatePerformanceStats();
            
        } catch (err) {
            console.error("Render error:", err);
            if (frame.imageBitmap) {
                frame.imageBitmap.close();
            }
        } finally {
            this.renderingFrame = false;
        }
    }

    updatePerformanceStats() {
        const now = Date.now();
        if (now - this.lastFpsTime >= 2000) { // Update every 2 seconds
            const actualFPS = this.fpsCounter / 2; // Adjust for 2-second interval
            const avgLatency = this.latencyCount > 0 ? (this.latencySum / this.latencyCount).toFixed(1) : 0;
            
            console.log(`🚀 Viewer Performance: ${actualFPS.toFixed(1)} FPS | ` +
                       `${avgLatency}ms avg latency | ${this.frameQueue.length} queued | ` +
                       `${this.frameDrops} frames dropped for speed`);
            
            // Send enhanced performance data to server
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    type: 'performance_stats',
                    fps: actualFPS,
                    latency: parseFloat(avgLatency),
                    queueSize: this.frameQueue.length,
                    frameDrops: this.frameDrops,
                    timestamp: now
                }));
            }
            
            // 🎯 Dynamic performance adjustment
            if (parseFloat(avgLatency) > 200) { // High latency
                this.maxQueueSize = Math.max(1, this.maxQueueSize - 1);
                console.log(`🎯 Reduced queue size to ${this.maxQueueSize} for lower latency`);
            } else if (parseFloat(avgLatency) < 50 && this.frameDrops < 10) { // Low latency
                this.maxQueueSize = Math.min(5, this.maxQueueSize + 1);
                console.log(`🚀 Increased queue size to ${this.maxQueueSize} for smoother playback`);
            }
            
            // Reset counters
            this.fpsCounter = 0;
            this.lastFpsTime = now;
            this.latencySum = 0;
            this.latencyCount = 0;
            this.frameDrops = 0;
        }
    }

    updateStatus(text, type = 'info') {
        if (!this.statusElement) return;
        this.statusElement.className = `alert alert-${type}`;
        this.statusElement.textContent = text;
    }

    reset() {
        this.isPlaying = false;

        // Clear high-frequency timer
        if (this.highFrequencyTimer) {
            clearInterval(this.highFrequencyTimer);
            this.highFrequencyTimer = null;
        }

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
        this.frameDrops = 0;
        this.renderingFrame = false;

        this.updateStatus("Reset", "secondary");
    }

    // Dynamic quality adjustment
    adjustFrameRate(fps) {
        this.maxFrameRate = Math.max(15, Math.min(120, fps)); // Increased max to 120 FPS
        this.frameInterval = 1000 / this.maxFrameRate;
        console.log(`🎯 Viewer frame rate adjusted to ${this.maxFrameRate} FPS for ultra-low latency`);
    }
}
  