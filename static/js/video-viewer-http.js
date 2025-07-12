class HTTPVideoViewer {
    constructor(cameraToken) {
        this.cameraToken = cameraToken;
        this.videoElement = document.getElementById('stream-video');
        this.statusElement = document.getElementById('connection-status');

        // Polling
        this.isPolling = false;
        this.pollingInterval = 5000;
        this.pollingTimer = null;

        // Buffering
        this.videoQueue = [];
        this.bufferSize = 3;
        this.bufferThreshold = 2;
        this.isBuffering = true;

        // Performance
        this.clipsReceived = 0;
        this.clipsPlayed = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.lastClipNumber = null;

        // Warmup
        this.warmupPolls = 3; // how many rapid polls to run initially
    }

    connect() {
        this.updateStatus("Connecting...", "info");
        this.setupVideoElement();
        this.startPolling();

        // Run initial warm-up polls to accelerate buffer fill
        for (let i = 0; i < this.warmupPolls; i++) {
            this.pollForNextVideo();
        }
    }

    setupVideoElement() {
        const el = this.videoElement;
        el.style.width = '100%';
        el.style.maxWidth = '800px';
        el.muted = true;
        el.controls = true;
        el.preload = 'auto';

        el.addEventListener('ended', () => this.playNextVideo());
        el.addEventListener('error', () => this.playNextVideo());
        el.addEventListener('loadstart', () => console.log("🎬 Loading new video..."));
        el.addEventListener('canplay', () => console.log("✅ Ready to play"));
    }

    startPolling() {
        this.isPolling = true;
        this.updateStatus("Connected - Polling for clips...", "success");

        this.pollingTimer = setInterval(() => {
            this.pollForNextVideo();
        }, this.pollingInterval);
    }

    async pollForNextVideo() {
        try {
            const response = await fetch(`/api/camera/${this.cameraToken}/next-video`);
            const data = await response.json();

            if (data?.error) {
                this.updateStatus(data.error, "danger");
                return;
            }

            if (data.video?.available) {
                const clipNumber = data.video.clip_number;

                if (this.lastClipNumber !== clipNumber) {
                    console.log(`🎬 New clip: #${clipNumber}`);
                    await this.fetchAndQueueVideo(clipNumber, data.video);
                    this.lastClipNumber = clipNumber;
                    this.clipsReceived++;
                    this.adjustPollingRate(); // Early rate adjustment
                }

                this.updateStatus(`🎥 Queue: ${data.queue_size} | Buffered: ${this.videoQueue.length}`, "success");
            } else {
                this.updateStatus("⏳ Waiting for processed videos...", "warning");
            }

        } catch (err) {
            console.error("Polling error:", err);
            this.updateStatus("Polling error", "danger");
        }
    }

    async fetchAndQueueVideo(clipNumber, metadata) {
        if (this.videoQueue.some(v => v.clipNumber === clipNumber)) {
            console.log(`📋 Clip #${clipNumber} already buffered`);
            return;
        }

        try {
            const res = await fetch(`/api/camera/${this.cameraToken}/video/${clipNumber}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const latency = Date.now() - metadata.timestamp;

            this.latencySum += latency;
            this.latencyCount++;

            this.videoQueue.push({ url, blob, clipNumber, latency });
            console.log(`✅ Fetched clip #${clipNumber} (${latency}ms)`);

            while (this.videoQueue.length > this.bufferSize) {
                const old = this.videoQueue.shift();
                URL.revokeObjectURL(old.url);
                console.log(`♻️ Removed old clip #${old.clipNumber}`);
            }

            if (this.isBuffering && this.videoQueue.length >= this.bufferThreshold) {
                this.isBuffering = false;
                this.playNextVideo();
            }

        } catch (err) {
            console.error(`❌ Fetch error clip #${clipNumber}:`, err);
        }
    }

    async waitUntilPlayable(timeout = 3000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                if (this.videoElement.readyState >= 3) return resolve();
                if (Date.now() - start > timeout) return reject("Timed out waiting for canplay");
                setTimeout(check, 100);
            };
            check();
        });
    }

    async playNextVideo() {
        if (this.videoQueue.length === 0) {
            this.isBuffering = true;
            this.updateStatus("Buffering...", "warning");
            this.pollForNextVideo();
            return;
        }

        const video = this.videoQueue.shift();
        this.clipsPlayed++;
        this.videoElement.src = video.url;

        try {
            await this.waitUntilPlayable();
            await this.videoElement.play();

            this.updateStatus(`▶️ Playing #${video.clipNumber} | Latency: ${video.latency}ms | Buffer: ${this.videoQueue.length}`, "success");
            console.log(`▶️ Playing #${video.clipNumber}`);

            setTimeout(() => {
                URL.revokeObjectURL(video.url);
            }, 1000);

            this.logPerformanceStats();

        } catch (err) {
            console.error(`❌ Playback failed for clip #${video.clipNumber}:`, err);
            this.playNextVideo();
        }
    }

    logPerformanceStats() {
        if (this.clipsPlayed % 5 === 0) {
            const avg = this.latencyCount > 0 ? (this.latencySum / this.latencyCount).toFixed(1) : 0;
            console.log(`📊 Avg Latency: ${avg}ms | Buffered: ${this.videoQueue.length} | Received: ${this.clipsReceived} | Played: ${this.clipsPlayed}`);
        }
    }

    updateStatus(text, type = "info") {
        if (!this.statusElement) return;
        this.statusElement.className = `alert alert-${type}`;
        this.statusElement.textContent = text;
    }

    reset() {
        this.isPolling = false;
        if (this.pollingTimer) clearInterval(this.pollingTimer);

        this.videoQueue.forEach(v => URL.revokeObjectURL(v.url));
        this.videoQueue = [];
        this.videoElement.pause();
        this.videoElement.src = '';

        this.clipsReceived = 0;
        this.clipsPlayed = 0;
        this.latencySum = 0;
        this.latencyCount = 0;
        this.isBuffering = true;
        this.lastClipNumber = null;

        this.updateStatus("Disconnected", "secondary");
    }

    adjustPollingRate() {
        if (this.videoQueue.length < 1) {
            this.pollingInterval = Math.max(2000, this.pollingInterval - 500);
        } else if (this.videoQueue.length >= this.bufferSize) {
            this.pollingInterval = Math.min(8000, this.pollingInterval + 1000);
        }

        if (this.pollingTimer && this.isPolling) {
            clearInterval(this.pollingTimer);
            this.pollingTimer = setInterval(() => {
                this.pollForNextVideo();
            }, this.pollingInterval);
            console.log(`⚡ Adjusted polling to ${this.pollingInterval}ms`);
        }
    }

    adjustFrameRate() {
        this.adjustPollingRate();
    }
}
