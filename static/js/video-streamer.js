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
        this.targetFPS = 15;
        this.frameInterval = 1000 / this.targetFPS;
        this.lastFrameTime = 0;
        this.frameCounter = 0;
        this.qualityFactor = 0.8; // JPEG quality
        
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
            console.log("WebSocket connected - Real-time streaming");
            this.setStatus(`Streaming ${this.getSelectedCameraLabel()} in real-time...`, "success");
            this.isStreaming = true;
            this.startFrameCapture();
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
                    if (msg.type === 'fps_adjustment') {
                        this.targetFPS = msg.fps;
                        this.frameInterval = 1000 / this.targetFPS;
                        this.updateCameraInfo(); // Update UI
                        console.log(`FPS adjusted to ${this.targetFPS}`);
                    } else if (msg.type === 'adaptive_streaming') {
                        if (msg.fps) {
                            this.adjustFPS(msg.fps);
                        }
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
                        format: 'jpeg',
                        camera: this.getSelectedCameraLabel(),
                        cameraId: this.selectedCameraId
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

        // Re-enable camera selection
        if (this.cameraSelectElement) {
            this.cameraSelectElement.disabled = false;
        }

        document.getElementById("start-btn").style.display = "inline-block";
        document.getElementById("stop-btn").style.display = "none";
        this.setStatus("Stopped", "error");

        console.log(`Total frames sent: ${this.frameCounter} from ${this.getSelectedCameraLabel()}`);
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
        this.updateCameraInfo(); // Update UI
        console.log(`Quality adjusted to ${this.qualityFactor}`);
    }

    // Dynamic FPS adjustment
    adjustFPS(fps) {
        this.targetFPS = Math.max(5, Math.min(60, fps));
        this.frameInterval = 1000 / this.targetFPS;
        this.updateCameraInfo(); // Update UI
        console.log(`FPS adjusted to ${this.targetFPS}`);
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
                        <span id="fps-info">Target: ${this.targetFPS} FPS</span> • 
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
                fpsInfo.textContent = `Target: ${this.targetFPS} FPS`;
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
                audio: false
            };
            
            console.log("Starting video capture with constraints:", constraints);
            
            this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
            this.video = document.getElementById('local-video');
            this.video.srcObject = this.mediaStream;

            // Create canvas for frame capture if not exists
            if (!this.canvas) {
                this.canvas = document.createElement('canvas');
                this.context = this.canvas.getContext('2d');
            }

            // Wait for video metadata to load
            await new Promise(resolve => {
                this.video.onloadedmetadata = () => {
                    this.canvas.width = this.video.videoWidth;
                    this.canvas.height = this.video.videoHeight;
                    console.log(`Video resolution: ${this.canvas.width}x${this.canvas.height}`);
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
