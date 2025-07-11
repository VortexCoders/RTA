class EnhancedVideoStreamer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaStream = null;
        this.isStreaming = false;
        this.video = null;
        this.frameCounter = 0;
        
        // Video recording properties for 10-second clips
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.recordingDuration = 10000; // 10 seconds in milliseconds
        this.recordingTimer = null;
        this.isRecording = false;
        this.videoQueue = [];
        this.isProcessingQueue = false;
        this.videoBitrate = 2500000; // 2.5 Mbps default
        
        // Camera selection properties
        this.availableCameras = [];
        this.selectedCameraId = null;
        this.cameraSelectElement = null;
        
        // Initialize camera selection
        this.initializeCameraSelection();
    }

    async startStreaming() {
        try {
            // Ensure camera devices are loaded
            if (this.availableCameras.length === 0) {
                await this.getCameraDevices();
                this.createCameraSelectionUI();
            }
            
            // Start video capture with selected camera
            await this.startVideoCapture();
            
            // Setup WebSocket connection
            this.setupWebSocket();
            
        } catch (err) {
            console.error("Failed to start streaming:", err);
            this.setStatus("Failed to start streaming", "error");
        }
    }

    setupWebSocket() {
        const protocol = location.protocol === "https:" ? "wss" : "ws";
        const wsURL = `${protocol}://${location.host}/ws/camera/${this.token}`;
        this.ws = new WebSocket(wsURL);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
            console.log("WebSocket connected - 10-second video clip streaming");
            this.setStatus(`Streaming ${this.getSelectedCameraLabel()} in 10s clips...`, "success");
            this.isStreaming = true;
            this.startVideoRecording();
            this.updateCameraInfo(); // Update UI
            document.getElementById("start-btn").style.display = "none";
            document.getElementById("stop-btn").style.display = "inline-block";
            
            // Keep camera selection enabled for hot-swapping
            if (this.cameraSelectElement) {
                this.cameraSelectElement.disabled = false;
            }
        };

        this.ws.onclose = () => {
            console.log("WebSocket closed");
            this.isStreaming = false;
            this.updateCameraInfo(); // Update UI
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
                    if (msg.type === 'performance_feedback') {
                        // Log backend performance feedback
                        console.log("Backend performance feedback:", msg);
                        if (msg.quality) {
                            this.adjustQuality(msg.quality);
                        }
                        this.updateCameraInfo(); // Update UI
                    }
                } catch (e) {
                    console.log("Server message:", event.data);
                }
            }
        };
    }

    startVideoRecording() {
        if (!this.mediaStream || !this.video) {
            console.error("No media stream available for recording");
            return;
        }

        // Setup MediaRecorder for 10-second clips
        const options = {
            mimeType: 'video/webm;codecs=vp9',
            videoBitsPerSecond: this.videoBitrate
        };

        try {
            this.mediaRecorder = new MediaRecorder(this.mediaStream, options);
        } catch (e) {
            // Fallback to default codec
            console.warn("VP9 not supported, falling back to default codec");
            this.mediaRecorder = new MediaRecorder(this.mediaStream);
        }

        this.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                this.recordedChunks.push(event.data);
            }
        };

        this.mediaRecorder.onstop = () => {
            this.processRecordedVideo();
        };

        // Start the first recording cycle
        this.startRecordingCycle();
    }

    startRecordingCycle() {
        if (!this.isStreaming) return;

        this.recordedChunks = [];
        this.isRecording = true;
        
        console.log(`📹 Starting 10-second recording cycle #${this.frameCounter + 1}`);
        this.setStatus(`Recording 10s clip #${this.frameCounter + 1}...`, "info");

        // Start recording
        this.mediaRecorder.start();

        // Stop recording after 10 seconds
        this.recordingTimer = setTimeout(() => {
            if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                this.mediaRecorder.stop();
                this.isRecording = false;
            }
        }, this.recordingDuration);
    }

    async processRecordedVideo() {
        if (this.recordedChunks.length === 0) {
            console.warn("No video data recorded");
            this.scheduleNextRecording();
            return;
        }

        try {
            // Create video blob from chunks
            const videoBlob = new Blob(this.recordedChunks, { type: 'video/webm' });
            const arrayBuffer = await videoBlob.arrayBuffer();
            
            console.log(`📦 Video clip ready: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);

            // Add to queue for processing
            const videoData = {
                data: arrayBuffer,
                timestamp: Date.now(),
                clipNumber: this.frameCounter + 1,
                duration: this.recordingDuration / 1000,
                camera: this.getSelectedCameraLabel(),
                cameraId: this.selectedCameraId
            };

            this.videoQueue.push(videoData);
            this.frameCounter++;

            // Process queue if not already processing
            if (!this.isProcessingQueue) {
                this.processVideoQueue();
            }

            // Schedule next recording
            this.scheduleNextRecording();

        } catch (error) {
            console.error("Error processing recorded video:", error);
            this.scheduleNextRecording();
        }
    }

    async processVideoQueue() {
        if (this.videoQueue.length === 0 || this.isProcessingQueue) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.videoQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const videoData = this.videoQueue.shift();
            
            try {
                this.setStatus(`Sending clip #${videoData.clipNumber} for processing...`, "info");

                // Send metadata first
                await this.sendVideoMetadata(videoData);

                // Send video data in chunks to avoid WebSocket limits
                await this.sendVideoInChunks(videoData.data, videoData.clipNumber);

                console.log(`✅ Sent video clip #${videoData.clipNumber} for YOLO processing`);

            } catch (error) {
                console.error(`❌ Failed to send video clip #${videoData.clipNumber}:`, error);
            }

            // Small delay between clips to prevent overwhelming the server
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isProcessingQueue = false;
        
        if (this.isStreaming) {
            this.setStatus(`Streaming ${this.getSelectedCameraLabel()} in 10s clips...`, "success");
        }
    }

    async sendVideoMetadata(videoData) {
        const metadata = {
            type: 'video_metadata',
            timestamp: videoData.timestamp,
            clipNumber: videoData.clipNumber,
            duration: videoData.duration,
            size: videoData.data.byteLength,
            camera: videoData.camera,
            cameraId: videoData.cameraId,
            format: 'webm'
        };

        this.ws.send(JSON.stringify(metadata));
    }

    async sendVideoInChunks(arrayBuffer, clipNumber) {
        const chunkSize = 64 * 1024; // 64KB chunks
        const totalChunks = Math.ceil(arrayBuffer.byteLength / chunkSize);

        for (let i = 0; i < totalChunks; i++) {
            const start = i * chunkSize;
            const end = Math.min(start + chunkSize, arrayBuffer.byteLength);
            const chunk = arrayBuffer.slice(start, end);

            // Send chunk header
            this.ws.send(JSON.stringify({
                type: 'video_chunk',
                clipNumber: clipNumber,
                chunkIndex: i,
                totalChunks: totalChunks,
                chunkSize: chunk.byteLength
            }));

            // Send chunk data
            this.ws.send(chunk);

            // Small delay to prevent overwhelming
            if (i % 10 === 0) {
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        }

        // Send completion signal
        this.ws.send(JSON.stringify({
            type: 'video_complete',
            clipNumber: clipNumber,
            totalChunks: totalChunks
        }));
    }

    scheduleNextRecording() {
        if (!this.isStreaming) return;

        // Start next recording cycle immediately (continuous recording)
        setTimeout(() => {
            if (this.isStreaming) {
                this.startRecordingCycle();
            }
        }, 100); // Small delay to prevent overlapping
    }

    stopStreaming() {
        this.isStreaming = false;

        // Stop recording timer
        if (this.recordingTimer) {
            clearTimeout(this.recordingTimer);
            this.recordingTimer = null;
        }

        // Stop media recorder
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        this.mediaRecorder = null;
        this.isRecording = false;

        // Clear video queue
        this.videoQueue = [];
        this.isProcessingQueue = false;

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

        // Re-enable camera selection
        if (this.cameraSelectElement) {
            this.cameraSelectElement.disabled = false;
        }

        document.getElementById("start-btn").style.display = "inline-block";
        document.getElementById("stop-btn").style.display = "none";
        this.setStatus("Stopped", "error");

        console.log(`Total video clips sent: ${this.frameCounter} from ${this.getSelectedCameraLabel()}`);
        this.frameCounter = 0;
    }

    setStatus(msg, type) {
        const statusEl = document.getElementById("status");
        statusEl.textContent = msg;
        statusEl.className = `alert alert-${type}`;
    }

    // Dynamic quality adjustment based on backend feedback
    adjustQuality(factor) {
        // Adjust video bitrate instead of JPEG quality
        const baseBitrate = 2500000; // 2.5 Mbps base
        this.videoBitrate = Math.max(500000, Math.min(5000000, baseBitrate * factor)); // 0.5-5 Mbps range
        this.updateCameraInfo(); // Update UI
        console.log(`Video bitrate adjusted to ${(this.videoBitrate / 1000000).toFixed(1)} Mbps based on backend feedback`);
    }

    async initializeCameraSelection() {
        try {
            // Get available cameras
            await this.getCameraDevices();
            
            // Create camera selection UI if not exists
            this.createCameraSelectionUI();
            
        } catch (err) {
            console.error("Camera initialization failed:", err);
        }
    }

    async getCameraDevices() {
        try {
            // Request permission first
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately
            
            // Get all video input devices
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.availableCameras = devices.filter(device => device.kind === 'videoinput');
            
            console.log(`Found ${this.availableCameras.length} camera(s):`, this.availableCameras);
            
            // Set default to first camera
            if (this.availableCameras.length > 0) {
                this.selectedCameraId = this.availableCameras[0].deviceId;
            }
            
        } catch (err) {
            console.error("Failed to get camera devices:", err);
            this.setStatus("Camera permission denied", "error");
        }
    }

    createCameraSelectionUI() {
        // Check if camera selection already exists
        let cameraContainer = document.getElementById('camera-selection-container');
        
        if (!cameraContainer) {
            // Create container for camera selection
            cameraContainer = document.createElement('div');
            cameraContainer.id = 'camera-selection-container';
            cameraContainer.className = 'mb-3';
            
            // Insert before start button
            const startBtn = document.getElementById('start-btn');
            if (startBtn && startBtn.parentNode) {
                startBtn.parentNode.insertBefore(cameraContainer, startBtn);
            }
        }
        
        // Create camera selection HTML
        cameraContainer.innerHTML = `
            <div class="row align-items-center">
                <div class="col-md-3">
                    <label for="camera-select" class="form-label"><strong>📹 Camera Source:</strong></label>
                </div>
                <div class="col-md-6">
                    <select id="camera-select" class="form-select">
                        ${this.availableCameras.map((camera, index) => 
                            `<option value="${camera.deviceId}" ${index === 0 ? 'selected' : ''}>
                                ${this.formatCameraLabel(camera, index)}
                            </option>`
                        ).join('')}
                    </select>
                    <div class="camera-info" id="camera-info">
                        ${this.availableCameras.length} camera(s) detected
                    </div>
                </div>
                <div class="col-md-2">
                    <button id="refresh-cameras-btn" class="btn btn-outline-secondary btn-sm" title="Refresh camera list">
                        🔄 Refresh
                    </button>
                </div>
                <div class="col-md-1">
                    <div id="camera-status" class="camera-status">
                        ${this.isStreaming ? '🟢' : '⚪'}
                    </div>
                </div>
            </div>
            <div class="row mt-2" id="camera-details" style="display: none;">
                <div class="col-12">
                    <small class="text-muted">
                        <span id="resolution-info"></span> • 
                        <span id="fps-info">Unlimited FPS (Backend Controlled)</span> • 
                        <span id="quality-info">Quality: ${Math.round(this.qualityFactor * 100)}%</span>
                    </small>
                </div>
            </div>
        `;
        
        // Add event listeners
        this.cameraSelectElement = document.getElementById('camera-select');
        if (this.cameraSelectElement) {
            this.cameraSelectElement.addEventListener('change', (e) => {
                this.selectedCameraId = e.target.value;
                console.log(`Selected camera: ${this.getSelectedCameraLabel()}`);
                this.updateCameraInfo();
                
                // If currently streaming, restart with new camera
                if (this.isStreaming) {
                    this.restartWithNewCamera();
                }
            });
        }
        
        // Refresh cameras button
        const refreshBtn = document.getElementById('refresh-cameras-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                await this.refreshCameraList();
            });
        }
        
        // Update initial camera info
        this.updateCameraInfo();
    }

    formatCameraLabel(camera, index) {
        if (camera.label) {
            // Clean up the label
            let label = camera.label;
            
            // Common camera label patterns
            if (label.includes('FaceTime') || label.includes('Front')) {
                return `📱 ${label} (Front)`;
            } else if (label.includes('Back') || label.includes('Rear')) {
                return `📱 ${label} (Back)`;
            } else if (label.includes('USB') || label.includes('Webcam')) {
                return `💻 ${label}`;
            } else if (label.includes('Virtual') || label.includes('OBS')) {
                return `🎥 ${label}`;
            } else {
                return `📹 ${label}`;
            }
        } else {
            // Fallback for cameras without labels
            return `📹 Camera ${index + 1}`;
        }
    }

    updateCameraInfo() {
        const infoElement = document.getElementById('camera-info');
        const detailsElement = document.getElementById('camera-details');
        const statusElement = document.getElementById('camera-status');
        
        if (infoElement) {
            const selectedCamera = this.availableCameras.find(cam => cam.deviceId === this.selectedCameraId);
            if (selectedCamera) {
                infoElement.textContent = `Selected: ${selectedCamera.label || 'Unknown Camera'}`;
            } else {
                infoElement.textContent = `${this.availableCameras.length} camera(s) available`;
            }
        }
        
        if (statusElement) {
            statusElement.textContent = this.isStreaming ? '🟢' : '⚪';
            statusElement.title = this.isStreaming ? 'Streaming' : 'Not streaming';
        }
        
        // Show/hide details when streaming
        if (detailsElement) {
            detailsElement.style.display = this.isStreaming ? 'block' : 'none';
        }
        
        // Update resolution info if available
        if (this.canvas && this.isStreaming) {
            const resolutionInfo = document.getElementById('resolution-info');
            const fpsInfo = document.getElementById('fps-info');
            const qualityInfo = document.getElementById('quality-info');
            
            if (resolutionInfo) {
                resolutionInfo.textContent = `${this.canvas.width}x${this.canvas.height}`;
            }
            if (fpsInfo) {
                fpsInfo.textContent = `Unlimited FPS (Backend Controlled)`;
            }
            if (qualityInfo) {
                qualityInfo.textContent = `Quality: ${Math.round(this.qualityFactor * 100)}%`;
            }
        }
    }

    async refreshCameraList() {
        try {
            this.setStatus("Refreshing camera list...", "info");
            await this.getCameraDevices();
            this.createCameraSelectionUI();
            this.setStatus("Camera list updated", "success");
        } catch (err) {
            console.error("Failed to refresh camera list:", err);
            this.setStatus("Failed to refresh cameras", "error");
        }
    }

    getSelectedCameraLabel() {
        const selectedCamera = this.availableCameras.find(cam => cam.deviceId === this.selectedCameraId);
        return selectedCamera ? (selectedCamera.label || 'Unknown Camera') : 'No Camera Selected';
    }

    async restartWithNewCamera() {
        console.log("Restarting stream with new camera...");
        this.setStatus("Switching camera...", "info");
        
        // Stop current stream but keep WebSocket open
        const wasStreaming = this.isStreaming;
        this.isStreaming = false;
        
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }
        
        // Start with new camera
        if (wasStreaming) {
            await this.startVideoCapture();
            if (this.mediaStream) {
                this.startFrameCapture();
                this.setStatus(`Streaming with ${this.getSelectedCameraLabel()}`, "success");
                this.updateCameraInfo();
            }
        }
    }

    async startVideoCapture() {
        try {
            // Prepare constraints with selected camera
            const constraints = {
                video: {
                    deviceId: this.selectedCameraId ? { exact: this.selectedCameraId } : undefined,
                    width: { ideal: 1920, min: 1280 },
                    height: { ideal: 1080, min: 720 },
                    frameRate: { ideal: 30, min: 15 }
                },
                audio: false // For now, no audio in clips
            };
            
            console.log("Starting video capture with constraints:", constraints);
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video = document.getElementById('local-video');
            this.video.srcObject = this.mediaStream;

            // Wait for video metadata to load
            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    console.log(`Video resolution: ${this.video.videoWidth}x${this.video.videoHeight}`);
                    resolve();
                };
            });
            
            // Display selected camera info
            const cameraLabel = this.getSelectedCameraLabel();
            console.log(`Successfully started camera: ${cameraLabel}`);
            
        } catch (err) {
            console.error("Camera access failed:", err);
            this.setStatus(`Camera access failed: ${err.message}`, "error");
            throw err;
        }
    }
}
