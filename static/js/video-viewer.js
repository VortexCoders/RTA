class EnhancedVideoViewer {
    constructor(cameraToken) {
        this.cameraToken = cameraToken;
        this.videoElement = document.getElementById('stream-video');
        this.statusElement = document.getElementById('connection-status');
        
        this.websocket = null;
        this.videoQueue = [];
        this.isPlaying = false;
        this.currentVideoIndex = 0;
        this.bufferSize = 3; // Keep 3 video clips buffered
        this.frameCounter = 0;
        
        // Video processing
        this.pendingVideoData = new Map(); // For chunked video assembly
        this.processedVideos = [];
        this.playbackBuffer = [];
        this.isBuffering = true;
        this.bufferThreshold = 2; // Start playing when we have 2 clips ready
        
        // Performance monitoring
        this.fpsCounter = 0;
        this.lastFpsTime = Date.now();
        this.latencySum = 0;
        this.latencyCount = 0;
        this.clipsReceived = 0;
        this.clipsPlayed = 0;
    }

    connect() {
        this.updateStatus("Connecting...", "info");
        this.setupVideoElement();
        this.setupWebSocket();
    }

    setupVideoElement() {
        // Ensure video element is ready for continuous playback
        this.videoElement.style.width = '100%';
        this.videoElement.style.height = 'auto';
        this.videoElement.style.maxWidth = '800px';
        this.videoElement.style.border = '1px solid #ddd';
        this.videoElement.muted = true; // Start muted for autoplay
        this.videoElement.controls = true;
        this.videoElement.preload = 'auto';
        
        // Handle video events
        this.videoElement.addEventListener('ended', () => {
            this.playNextVideo();
        });
        
        this.videoElement.addEventListener('error', (e) => {
            console.error("Video playback error:", e);
            this.playNextVideo(); // Try to recover
        });
        
        this.videoElement.addEventListener('loadstart', () => {
            console.log("🎬 Loading new video clip...");
        });
        
        this.videoElement.addEventListener('canplay', () => {
            console.log("✅ Video clip ready to play");
        });
    }

    setupWebSocket() {
        const wsUrl = `wss://${location.host}/ws/view/${this.cameraToken}`;
        this.websocket = new WebSocket(wsUrl);
        this.websocket.binaryType = 'arraybuffer';

        this.websocket.onopen = () => {
            this.updateStatus("Connected - Receiving 10s video clips", "success");
            this.isPlaying = true;
        };

        this.websocket.onmessage = (event) => {
            if (typeof event.data === 'string') {
                try {
                    const message = JSON.parse(event.data);
                    this.handleTextMessage(message);
                } catch (e) {
                    console.warn("Failed to parse message:", e);
                }
            } else {
                // Binary data - video chunk
                this.handleBinaryMessage(event.data);
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

    handleTextMessage(message) {
        switch (message.type) {
            case 'video_metadata':
                console.log(`📹 Receiving video clip #${message.clipNumber} (${(message.size / 1024 / 1024).toFixed(2)} MB)`);
                this.pendingVideoData.set(message.clipNumber, {
                    metadata: message,
                    chunks: [],
                    receivedChunks: 0,
                    totalChunks: 0
                });
                break;

            case 'video_chunk':
                // Initialize chunk tracking for this clip
                if (this.pendingVideoData.has(message.clipNumber)) {
                    const videoData = this.pendingVideoData.get(message.clipNumber);
                    videoData.totalChunks = message.totalChunks;
                }
                break;

            case 'video_complete':
                this.assembleAndProcessVideo(message.clipNumber);
                break;

            case 'keepalive':
                // Server keepalive, no action needed
                break;

            default:
                console.log("📨 Server message:", message);
        }
    }

    handleBinaryMessage(data) {
        // Find which video this chunk belongs to (latest pending)
        let targetClipNumber = null;
        for (const [clipNumber, videoData] of this.pendingVideoData.entries()) {
            if (videoData.receivedChunks < videoData.totalChunks || videoData.totalChunks === 0) {
                targetClipNumber = clipNumber;
                break;
            }
        }

        if (targetClipNumber !== null && this.pendingVideoData.has(targetClipNumber)) {
            const videoData = this.pendingVideoData.get(targetClipNumber);
            videoData.chunks.push(data);
            videoData.receivedChunks++;

            // Log progress periodically
            if (videoData.receivedChunks % 50 === 0 || videoData.receivedChunks === videoData.totalChunks) {
                console.log(`📦 Clip #${targetClipNumber}: ${videoData.receivedChunks}/${videoData.totalChunks} chunks received`);
            }
        }
    }

    async assembleAndProcessVideo(clipNumber) {
        const videoData = this.pendingVideoData.get(clipNumber);
        if (!videoData || videoData.chunks.length === 0) {
            console.warn(`❌ No video data for clip #${clipNumber}`);
            return;
        }

        try {
            // Assemble all chunks into one ArrayBuffer
            const totalSize = videoData.chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
            const assembledVideo = new Uint8Array(totalSize);
            let offset = 0;

            for (const chunk of videoData.chunks) {
                assembledVideo.set(new Uint8Array(chunk), offset);
                offset += chunk.byteLength;
            }

            // Create video blob
            const videoBlob = new Blob([assembledVideo], { type: 'video/webm' });
            const videoUrl = URL.createObjectURL(videoBlob);

            // Calculate latency
            const latency = Date.now() - videoData.metadata.timestamp;
            this.latencySum += latency;
            this.latencyCount++;

            const processedVideo = {
                url: videoUrl,
                blob: videoBlob,
                metadata: videoData.metadata,
                clipNumber: clipNumber,
                latency: latency,
                processedAt: Date.now()
            };

            // Add to playback buffer
            this.playbackBuffer.push(processedVideo);
            this.clipsReceived++;

            console.log(`✅ Video clip #${clipNumber} ready for playback (${latency}ms latency)`);

            // Clean up
            this.pendingVideoData.delete(clipNumber);

            // Start playback if we have enough buffer
            if (this.isBuffering && this.playbackBuffer.length >= this.bufferThreshold) {
                console.log("🎬 Starting video playback");
                this.isBuffering = false;
                this.playNextVideo();
            }

            // Manage buffer size
            while (this.playbackBuffer.length > this.bufferSize) {
                const oldVideo = this.playbackBuffer.shift();
                URL.revokeObjectURL(oldVideo.url);
            }

            this.updatePerformanceStats();

        } catch (error) {
            console.error(`❌ Failed to assemble video clip #${clipNumber}:`, error);
            this.pendingVideoData.delete(clipNumber);
        }
    }

    async playNextVideo() {
        if (this.playbackBuffer.length === 0) {
            console.log("📋 No videos in buffer, buffering...");
            this.isBuffering = true;
            this.updateStatus("Buffering video clips...", "warning");
            return;
        }

        const video = this.playbackBuffer.shift();
        this.clipsPlayed++;

        try {
            // Load new video
            this.videoElement.src = video.url;
            
            // Update status
            this.updateStatus(
                `🎥 Playing clip #${video.clipNumber} | ${video.latency}ms latency | ${this.playbackBuffer.length} buffered`, 
                "success"
            );

            // Play the video
            await this.videoElement.play();

            console.log(`▶️ Playing video clip #${video.clipNumber}`);

            // Clean up old URL after a delay to ensure playback started
            setTimeout(() => {
                URL.revokeObjectURL(video.url);
            }, 1000);

        } catch (error) {
            console.error(`❌ Failed to play video clip #${video.clipNumber}:`, error);
            // Try next video
            this.playNextVideo();
        }
    }

    updatePerformanceStats() {
        const now = Date.now();
        if (now - this.lastFpsTime >= 3000) { // Update every 3 seconds
            const avgLatency = this.latencyCount > 0 ? (this.latencySum / this.latencyCount).toFixed(1) : 0;
            const bufferHealth = this.playbackBuffer.length;
            
            console.log(`📊 Viewer Performance: ${avgLatency}ms avg latency | ` +
                       `${bufferHealth} clips buffered | ${this.clipsReceived} received | ${this.clipsPlayed} played`);
            
            // Send performance data to server
            if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({
                    type: 'viewer_performance',
                    avgLatency: parseFloat(avgLatency),
                    bufferHealth: bufferHealth,
                    clipsReceived: this.clipsReceived,
                    clipsPlayed: this.clipsPlayed,
                    timestamp: now
                }));
            }
            
            // Reset counters
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

        // Clean up video buffers
        this.playbackBuffer.forEach(video => {
            URL.revokeObjectURL(video.url);
        });
        this.playbackBuffer = [];
        this.pendingVideoData.clear();

        // Stop video playback
        this.videoElement.pause();
        this.videoElement.src = '';

        // Reset counters
        this.frameCounter = 0;
        this.clipsReceived = 0;
        this.clipsPlayed = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.isBuffering = true;

        this.updateStatus("Reset", "secondary");
    }

    // Performance adjustment method for compatibility
    adjustFrameRate(fps) {
        // For video clips, we don't adjust frame rate but buffer size
        if (fps < 20) {
            this.bufferThreshold = Math.max(1, this.bufferThreshold - 1);
            console.log(`🎯 Reduced buffer threshold to ${this.bufferThreshold} for lower latency`);
        } else if (fps > 40) {
            this.bufferThreshold = Math.min(4, this.bufferThreshold + 1);
            console.log(`🚀 Increased buffer threshold to ${this.bufferThreshold} for smoother playback`);
        }
    }
}
  