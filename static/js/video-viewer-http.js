class HTTPVideoViewer {
    constructor(cameraToken) {
        this.cameraToken = cameraToken;
        this.videoElement = document.getElementById('stream-video');
        this.statusElement = document.getElementById('connection-status');
        
        // Polling settings
        this.isPolling = false;
        this.pollingInterval = 5000; // Poll every 5 seconds
        this.pollingTimer = null;
        
        // Video buffering
        this.videoQueue = [];
        this.isPlaying = false;
        this.currentVideoIndex = 0;
        this.bufferSize = 3; // Keep 3 video clips buffered
        this.bufferThreshold = 2; // Start playing when we have 2 clips ready
        this.isBuffering = true;
        
        // Performance monitoring
        this.clipsReceived = 0;
        this.clipsPlayed = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.lastClipNumber = null;
        
        // URL cache for clips
        this.urlCache = new Map();
    }

    connect() {
        this.updateStatus("Connecting...", "info");
        this.setupVideoElement();
        this.startPolling();
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

    startPolling() {
        this.isPolling = true;
        this.updateStatus("Connected - Polling for 10s video clips", "success");
        
        // Start immediate poll
        this.pollForNextVideo();
        
        // Set up regular polling
        this.pollingTimer = setInterval(() => {
            this.pollForNextVideo();
        }, this.pollingInterval);
    }

    async pollForNextVideo() {
        try {
            const response = await fetch(`/api/camera/${this.cameraToken}/next-video`);
            const data = await response.json();
            
            if (data.error) {
                console.error("Polling error:", data.error);
                this.updateStatus(data.error, "danger");
                return;
            }
            
            if (data.video && data.video.available) {
                const clipNumber = data.video.clip_number;
                
                // Check if this is a new clip
                if (this.lastClipNumber !== clipNumber) {
                    console.log(`🎬 New clip available: #${clipNumber}`);
                    await this.fetchAndQueueVideo(clipNumber, data.video);
                    this.lastClipNumber = clipNumber;
                    this.clipsReceived++;
                }
                
                // Update status with queue info
                this.updateStatus(
                    `🎥 Buffering clips | Queue: ${data.queue_size} | Buffered: ${this.videoQueue.length}`,
                    "success"
                );
            } else {
                this.updateStatus("⏳ Waiting for processed videos...", "warning");
            }
            
        } catch (error) {
            console.error("Polling error:", error);
            this.updateStatus("Polling error", "danger");
        }
    }

    async fetchAndQueueVideo(clipNumber, metadata) {
        try {
            // Check if already in queue
            if (this.videoQueue.some(v => v.clipNumber === clipNumber)) {
                console.log(`📋 Clip #${clipNumber} already in queue`);
                return;
            }
            
            console.log(`📥 Fetching clip #${clipNumber}...`);
            
            const videoResponse = await fetch(`/api/camera/${this.cameraToken}/video/${clipNumber}`);
            if (!videoResponse.ok) {
                throw new Error(`Failed to fetch video: ${videoResponse.status}`);
            }
            
            const videoBlob = await videoResponse.blob();
            const videoUrl = URL.createObjectURL(videoBlob);
            
            // Calculate latency
            const latency = Date.now() - metadata.timestamp;
            this.latencySum += latency;
            this.latencyCount++;
            
            const videoItem = {
                url: videoUrl,
                blob: videoBlob,
                clipNumber: clipNumber,
                metadata: metadata,
                latency: latency,
                fetchedAt: Date.now()
            };
            
            // Add to queue
            this.videoQueue.push(videoItem);
            console.log(`✅ Clip #${clipNumber} added to queue (${latency}ms latency)`);
            
            // Manage buffer size
            while (this.videoQueue.length > this.bufferSize) {
                const oldVideo = this.videoQueue.shift();
                URL.revokeObjectURL(oldVideo.url);
                console.log(`📤 Removed old clip #${oldVideo.clipNumber} from buffer`);
            }
            
            // Start playback if we have enough buffer
            if (this.isBuffering && this.videoQueue.length >= this.bufferThreshold) {
                console.log("🎬 Starting video playback");
                this.isBuffering = false;
                this.playNextVideo();
            }
            
        } catch (error) {
            console.error(`❌ Failed to fetch clip #${clipNumber}:`, error);
        }
    }

    async playNextVideo() {
        if (this.videoQueue.length === 0) {
            console.log("📋 No videos in buffer, buffering...");
            this.isBuffering = true;
            this.updateStatus("Buffering video clips...", "warning");
            
            // Try to fetch immediately if buffer is empty
            this.pollForNextVideo();
            return;
        }

        const video = this.videoQueue.shift();
        this.clipsPlayed++;

        try {
            // Load new video
            this.videoElement.src = video.url;
            
            // Update status
            this.updateStatus(
                `▶️ Playing clip #${video.clipNumber} | ${video.latency}ms latency | ${this.videoQueue.length} buffered`, 
                "success"
            );

            // Play the video
            await this.videoElement.play();

            console.log(`▶️ Playing video clip #${video.clipNumber}`);

            // Clean up old URL after a delay
            setTimeout(() => {
                URL.revokeObjectURL(video.url);
            }, 1000);

            // Log performance stats periodically
            this.logPerformanceStats();

        } catch (error) {
            console.error(`❌ Failed to play video clip #${video.clipNumber}:`, error);
            // Try next video
            this.playNextVideo();
        }
    }

    logPerformanceStats() {
        if (this.clipsPlayed % 5 === 0 && this.clipsPlayed > 0) {
            const avgLatency = this.latencyCount > 0 ? (this.latencySum / this.latencyCount).toFixed(1) : 0;
            const bufferHealth = this.videoQueue.length;
            
            console.log(`📊 Viewer Performance: ${avgLatency}ms avg latency | ` +
                       `${bufferHealth} clips buffered | ${this.clipsReceived} received | ${this.clipsPlayed} played`);
        }
    }

    updateStatus(text, type = 'info') {
        if (!this.statusElement) return;
        this.statusElement.className = `alert alert-${type}`;
        this.statusElement.textContent = text;
    }

    reset() {
        this.isPolling = false;

        if (this.pollingTimer) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = null;
        }

        // Clean up video buffers
        this.videoQueue.forEach(video => {
            URL.revokeObjectURL(video.url);
        });
        this.videoQueue = [];
        this.urlCache.clear();

        // Stop video playback
        this.videoElement.pause();
        this.videoElement.src = '';

        // Reset counters
        this.clipsReceived = 0;
        this.clipsPlayed = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.isBuffering = true;
        this.lastClipNumber = null;

        this.updateStatus("Disconnected", "secondary");
    }

    // Adaptive polling based on queue health
    adjustPollingRate() {
        if (this.videoQueue.length < 1) {
            // Buffer is low, poll faster
            this.pollingInterval = Math.max(2000, this.pollingInterval - 500);
        } else if (this.videoQueue.length >= this.bufferSize) {
            // Buffer is full, poll slower
            this.pollingInterval = Math.min(8000, this.pollingInterval + 1000);
        }
        
        // Restart polling with new interval
        if (this.pollingTimer && this.isPolling) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = setInterval(() => {
                this.pollForNextVideo();
            }, this.pollingInterval);
            
            console.log(`⚡ Adjusted polling rate to ${this.pollingInterval}ms`);
        }
    }

    // Legacy compatibility method
    adjustFrameRate(fps) {
        // For HTTP polling, adjust polling interval instead
        this.adjustPollingRate();
    }
}
