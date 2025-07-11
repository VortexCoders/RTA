// Enhanced video streaming with fallback options
class EnhancedVideoStreamer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.canvas = null;
        this.context = null;
        this.isStreaming = false;
        this.streamingMethod = 'mediarecorder'; // 'mediarecorder' or 'canvas'
    }
    
    async startStreaming() {
        try {
            // Get user media
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: { ideal: 1280, max: 1920 },
                    height: { ideal: 720, max: 1080 },
                    frameRate: { ideal: 15, max: 30 }
                },
                audio: true
            });
            
            const video = document.getElementById('local-video');
            video.srcObject = this.mediaStream;
            
            // Setup WebSocket
            this.setupWebSocket();
            
            // Try MediaRecorder first, fallback to canvas if needed
            if (this.tryMediaRecorder()) {
                console.log('Using MediaRecorder streaming');
                this.streamingMethod = 'mediarecorder';
            } else {
                console.log('Falling back to canvas streaming');
                this.streamingMethod = 'canvas';
                this.setupCanvasStreaming();
            }
            
            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'inline-block';
            document.getElementById('status').textContent = `Streaming (${this.streamingMethod})...`;
            document.getElementById('status').className = 'alert alert-success';
            
        } catch (error) {
            console.error('Error starting stream:', error);
            showAlert('Error accessing camera: ' + error.message, 'error');
        }
    }
    
    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/camera/${this.token}`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isStreaming = true;
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.isStreaming = false;
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            showAlert('Connection error occurred', 'error');
        };
    }
    
    tryMediaRecorder() {
        try {
            // Check if MediaRecorder is supported
            if (!window.MediaRecorder) {
                return false;
            }
            
            // Try different MIME types
            const mimeTypes = [
                'video/webm;codecs=vp9,opus',
                'video/webm;codecs=vp8,opus', 
                'video/webm;codecs=vp8',
                'video/webm',
                'video/mp4'
            ];
            
            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaRecorder.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }
            
            if (!selectedMimeType) {
                return false;
            }
            
            console.log('Using MIME type:', selectedMimeType);
            
            this.mediaRecorder = new MediaRecorder(this.mediaStream, {
                mimeType: selectedMimeType,
                videoBitsPerSecond: 500000, // 500 kbps
                audioBitsPerSecond: 64000   // 64 kbps
            });
            
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(event.data);
                }
            };
            
            this.mediaRecorder.start(1000); // Send chunks every 1 second
            return true;
            
        } catch (error) {
            console.error('MediaRecorder setup failed:', error);
            return false;
        }
    }
    
    setupCanvasStreaming() {
        const video = document.getElementById('local-video');
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext('2d');
        
        // Set canvas size
        this.canvas.width = 640;
        this.canvas.height = 480;
        
        // Start capturing frames
        this.captureFrame();
    }
    
    captureFrame() {
        if (!this.isStreaming) return;
        
        const video = document.getElementById('local-video');
        if (video.videoWidth > 0 && video.videoHeight > 0) {
            // Draw video frame to canvas
            this.context.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
            
            // Convert to JPEG and send
            this.canvas.toBlob((blob) => {
                if (blob && this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(blob);
                }
            }, 'image/jpeg', 0.7);
        }
        
        // Capture next frame (aim for ~10 FPS)
        setTimeout(() => this.captureFrame(), 100);
    }
    
    stopStreaming() {
        this.isStreaming = false;
        
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }
        
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }
        
        if (this.ws) {
            this.ws.close();
        }
        
        document.getElementById('start-btn').style.display = 'inline-block';
        document.getElementById('stop-btn').style.display = 'none';
        document.getElementById('status').textContent = 'Stopped';
        document.getElementById('status').className = 'alert alert-error';
        
        const video = document.getElementById('local-video');
        video.srcObject = null;
    }
}

class EnhancedVideoViewer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.videoElement = null;
        this.viewerMode = 'auto';
        this.lastImageTime = 0;
        this.bufferQueue = [];
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.mediaSourceUrl = null;
        this.currentMode = null; // 'video' or 'image'
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/view/${this.token}`;

        console.log('Connecting to viewer WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.videoElement = document.getElementById('stream-video');

        this.ws.onmessage = (event) => {
            this.handleIncomingData(event.data);
        };

        this.ws.onopen = () => {
            console.log('Viewer WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateStatus('Connected - Waiting for stream...', 'success');
        };

        this.ws.onclose = (event) => {
            console.log('Viewer WebSocket disconnected:', event.code, event.reason);
            this.updateStatus('Disconnected - Reconnecting...', 'error');
            this.cleanup();
            
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => this.connect(), this.reconnectDelay);
            } else {
                this.updateStatus('Connection failed after multiple attempts', 'error');
            }
        };

        this.ws.onerror = (error) => {
            console.error('Viewer WebSocket error:', error);
            this.updateStatus('Connection Error', 'error');
        };
    }

    handleIncomingData(data) {
        try {
            if (data instanceof ArrayBuffer) {
                this.handleBinaryData(data);
            } else {
                this.handleTextData(data);
            }
        } catch (error) {
            console.error('Error handling incoming data:', error);
            this.updateStatus('Error processing stream data', 'error');
        }
    }

    handleBinaryData(arrayBuffer) {
        const uint8Array = new Uint8Array(arrayBuffer);

        // Check if it's a JPEG image first
        if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
            this.switchToImageMode();
            this.displayAsImage(arrayBuffer);
        } 
        // For all other binary data, try WebM video mode first
        // (Since the streamer is sending WebM chunks)
        else {
            this.switchToVideoMode();
            this.handleWebMData(arrayBuffer);
        }
    }

    handleTextData(text) {
        if (text.startsWith('data:image/')) {
            this.switchToImageMode();
            this.displayAsDataURL(text);
        }
    }

    switchToImageMode() {
        if (this.currentMode === 'image') return;
        
        console.log('Switching to image mode');
        this.currentMode = 'image';
        this.cleanupMediaSource();
        
        // Create image element if needed
        let img = document.getElementById('stream-image');
        if (!img && this.videoElement && this.videoElement.parentElement) {
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            
            img = document.createElement('img');
            img.id = 'stream-image';
            img.style.width = '100%';
            img.style.maxHeight = '500px';
            img.style.objectFit = 'contain';
            img.style.display = 'block';
            
            container.appendChild(img);
        }
    }

    switchToVideoMode() {
        if (this.currentMode === 'video') return;
        
        console.log('Switching to video mode');
        this.currentMode = 'video';
        this.cleanupImageDisplay();
        
        // Ensure video element is visible and properly placed
        if (this.videoElement && this.videoElement.parentElement) {
            this.videoElement.style.display = 'block';
            
            // Clear container and add video element
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            container.appendChild(this.videoElement);
        }
        
        // Initialize MediaSource if not already done
        if (!this.mediaSource || this.mediaSource.readyState === 'ended') {
            this.setupMediaSource();
        }
    }

    handleWebMData(arrayBuffer) {
        if (!window.MediaSource) {
            console.log('MediaSource not supported, falling back to image mode');
            this.switchToImageMode();
            this.displayAsImage(arrayBuffer);
            return;
        }

        // Add to buffer queue (we'll be more permissive with WebM data)
        this.bufferQueue.push(arrayBuffer);
        console.log('Added WebM chunk to queue, size:', arrayBuffer.byteLength);

        // Process queue if ready
        if (this.isSourceBufferReady && !this.isProcessingQueue) {
            this.processBufferQueue();
        }
    }

    isValidWebMData(arrayBuffer) {
        try {
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Check for minimum length
            if (uint8Array.length < 4) return false;
            
            // Look for EBML header (0x1A45DFA3) - full WebM file
            if (uint8Array[0] === 0x1A && uint8Array[1] === 0x45 && 
                uint8Array[2] === 0xDF && uint8Array[3] === 0xA3) {
                return true;
            }
            
            // Look for WebM Cluster element (0x1F43B675)
            if (uint8Array[0] === 0x1F && uint8Array[1] === 0x43 &&
                uint8Array[2] === 0xB6 && uint8Array[3] === 0x75) {
                return true;
            }
            
            // Look for common WebM elements in the stream
            for (let i = 0; i < Math.min(uint8Array.length - 4, 200); i++) {
                // Cluster marker
                if (uint8Array[i] === 0x1F && uint8Array[i + 1] === 0x43 &&
                    uint8Array[i + 2] === 0xB6 && uint8Array[i + 3] === 0x75) {
                    return true;
                }
                // SimpleBlock marker
                if (uint8Array[i] === 0xA3) {
                    return true;
                }
                // Block marker
                if (uint8Array[i] === 0xA1) {
                    return true;
                }
                // Timecode marker
                if (uint8Array[i] === 0xE7) {
                    return true;
                }
            }
            
            // If it's not a JPEG (which we already checked), assume it might be WebM
            // This is more permissive for streaming chunks
            return true;
            
        } catch (error) {
            console.error('Error validating WebM data:', error);
            return false;
        }
    }

    setupMediaSource() {
        this.cleanupMediaSource();
        
        console.log('Setting up MediaSource...');
        this.mediaSource = new MediaSource();
        this.bufferQueue = [];
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;

        // Create object URL and assign to video
        this.mediaSourceUrl = URL.createObjectURL(this.mediaSource);
        this.videoElement.src = this.mediaSourceUrl;

        this.mediaSource.addEventListener('sourceopen', () => {
            console.log('MediaSource opened');
            this.initializeSourceBuffer();
        });

        this.mediaSource.addEventListener('sourceended', () => {
            console.log('MediaSource ended');
            this.isSourceBufferReady = false;
        });

        this.mediaSource.addEventListener('sourceclose', () => {
            console.log('MediaSource closed');
            this.isSourceBufferReady = false;
        });
    }

    initializeSourceBuffer() {
        try {
            // Try different codec combinations
            const mimeTypes = [
                'video/webm; codecs="vp8,opus"',
                'video/webm; codecs="vp8"',
                'video/webm; codecs="vp9,opus"',
                'video/webm; codecs="vp9"',
                'video/webm'
            ];

            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaSource.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }

            if (!selectedMimeType) {
                throw new Error('No supported MIME type found');
            }

            console.log('Using MIME type:', selectedMimeType);
            this.sourceBuffer = this.mediaSource.addSourceBuffer(selectedMimeType);

            this.sourceBuffer.addEventListener('updateend', () => {
                console.log('SourceBuffer update ended');
                this.isProcessingQueue = false;
                
                // Process next chunk if available
                if (this.bufferQueue.length > 0) {
                    this.processBufferQueue();
                }
            });

            this.sourceBuffer.addEventListener('error', (event) => {
                console.error('SourceBuffer error:', event);
                this.isSourceBufferReady = false;
                this.isProcessingQueue = false;
                this.bufferQueue = []; // Clear problematic queue
                
                // Switch to image mode as fallback
                setTimeout(() => {
                    this.switchToImageMode();
                }, 100);
            });

            this.sourceBuffer.addEventListener('abort', () => {
                console.log('SourceBuffer aborted');
                this.isProcessingQueue = false;
            });

            this.isSourceBufferReady = true;
            console.log('SourceBuffer ready');

            // Process any queued data
            this.processBufferQueue();

        } catch (error) {
            console.error('Failed to initialize SourceBuffer:', error);
            this.switchToImageMode();
        }
    }

    processBufferQueue() {
        if (this.isProcessingQueue || !this.isSourceBufferReady || this.bufferQueue.length === 0) {
            return;
        }

        if (!this.sourceBuffer || this.sourceBuffer.updating) {
            return;
        }

        // Check if MediaSource is still valid
        if (!this.mediaSource || this.mediaSource.readyState !== 'open') {
            console.log('MediaSource not ready, clearing queue');
            this.bufferQueue = [];
            return;
        }

        try {
            const chunk = this.bufferQueue.shift();
            this.isProcessingQueue = true;
            
            console.log('Appending buffer chunk, queue length:', this.bufferQueue.length);
            this.sourceBuffer.appendBuffer(chunk);
            
            this.updateStatus('Streaming video...', 'success');
            
            // Auto-play if paused (with error handling)
            if (this.videoElement.paused) {
                this.videoElement.play().catch(e => {
                    console.log('Auto-play failed:', e.message);
                });
            }
            
        } catch (error) {
            console.error('Error appending buffer:', error);
            this.isProcessingQueue = false;
            
            // Clear the problematic buffer queue and switch to image mode
            this.bufferQueue = [];
            this.switchToImageMode();
        }
    }

    displayAsImage(arrayBuffer) {
        const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        const img = document.getElementById('stream-image');
        if (!img) {
            console.error('Image element not found');
            return;
        }

        // Clean up previous blob URL
        if (img.src && img.src.startsWith('blob:')) {
            URL.revokeObjectURL(img.src);
        }

        img.src = url;

        // Calculate FPS
        const now = Date.now();
        if (this.lastImageTime > 0) {
            const fps = 1000 / (now - this.lastImageTime);
            this.updateStatus(`Streaming images (~${fps.toFixed(1)} FPS)`, 'success');
        } else {
            this.updateStatus('Streaming images...', 'success');
        }
        this.lastImageTime = now;
    }

    displayAsDataURL(dataURL) {
        const img = document.getElementById('stream-image');
        if (!img) {
            console.error('Image element not found');
            return;
        }

        img.src = dataURL;
        this.updateStatus('Streaming (data URL)...', 'success');
    }

    updateStatus(message, type) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `alert alert-${type}`;
        }
        console.log('Status:', message);
    }

    cleanupMediaSource() {
        console.log('Cleaning up MediaSource...');
        
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;
        this.bufferQueue = [];

        if (this.sourceBuffer) {
            try {
                if (this.sourceBuffer.updating) {
                    this.sourceBuffer.abort();
                }
                
                if (this.mediaSource && this.mediaSource.readyState === 'open') {
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                }
            } catch (e) {
                console.log('Error cleaning up SourceBuffer:', e.message);
            }
            this.sourceBuffer = null;
        }

        if (this.mediaSource) {
            try {
                if (this.mediaSource.readyState === 'open') {
                    this.mediaSource.endOfStream();
                }
            } catch (e) {
                console.log('Error ending MediaSource:', e.message);
            }
            this.mediaSource = null;
        }

        if (this.mediaSourceUrl) {
            try {
                URL.revokeObjectURL(this.mediaSourceUrl);
            } catch (e) {
                console.log('Error revoking MediaSource URL:', e.message);
            }
            this.mediaSourceUrl = null;
        }

        if (this.videoElement) {
            this.videoElement.src = '';
            this.videoElement.load();
        }
    }

    cleanupImageDisplay() {
        const img = document.getElementById('stream-image');
        if (img) {
            if (img.src && img.src.startsWith('blob:')) {
                URL.revokeObjectURL(img.src);
            }
            img.remove();
        }
    }

    cleanup() {
        console.log('Full cleanup...');
        this.cleanupMediaSource();
        this.cleanupImageDisplay();
        this.currentMode = null;
        this.lastImageTime = 0;
    }

    disconnect() {
        console.log('Disconnecting...');
        this.cleanup();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.updateStatus('Disconnected', 'error');
    }
}

class EnhancedVideoViewer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.videoElement = null;
        this.viewerMode = 'auto';
        this.lastImageTime = 0;
        this.bufferQueue = [];
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 3000;
        this.mediaSourceUrl = null;
        this.currentMode = null; // 'video' or 'image'
        this.hasReceivedInitSegment = false;
        this.initSegmentReceived = false;
    }

    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/view/${this.token}`;

        console.log('Connecting to viewer WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';

        this.videoElement = document.getElementById('stream-video');

        this.ws.onmessage = (event) => {
            this.handleIncomingData(event.data);
        };

        this.ws.onopen = () => {
            console.log('Viewer WebSocket connected');
            this.reconnectAttempts = 0;
            this.updateStatus('Connected - Waiting for stream...', 'success');
        };

        this.ws.onclose = (event) => {
            console.log('Viewer WebSocket disconnected:', event.code, event.reason);
            this.updateStatus('Disconnected - Reconnecting...', 'error');
            this.cleanup();
            
            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                this.reconnectAttempts++;
                setTimeout(() => this.connect(), this.reconnectDelay);
            } else {
                this.updateStatus('Connection failed after multiple attempts', 'error');
            }
        };

        this.ws.onerror = (error) => {
            console.error('Viewer WebSocket error:', error);
            this.updateStatus('Connection Error', 'error');
        };
    }

    handleIncomingData(data) {
        try {
            if (data instanceof ArrayBuffer) {
                this.handleBinaryData(data);
            } else {
                this.handleTextData(data);
            }
        } catch (error) {
            console.error('Error handling incoming data:', error);
            this.updateStatus('Error processing stream data', 'error');
        }
    }

    handleBinaryData(arrayBuffer) {
        const uint8Array = new Uint8Array(arrayBuffer);

        // Check if it's a JPEG image first
        if (uint8Array[0] === 0xFF && uint8Array[1] === 0xD8) {
            this.switchToImageMode();
            this.displayAsImage(arrayBuffer);
        } 
        // Check if it's a Blob (from MediaRecorder)
        else if (arrayBuffer.byteLength > 0) {
            // Try to handle as WebM video first
            this.handleVideoBlob(arrayBuffer);
        }
    }

    handleVideoBlob(arrayBuffer) {
        // Create a blob URL and try to play it directly
        const blob = new Blob([arrayBuffer], { type: 'video/webm' });
        
        // Switch to video mode but use blob URL instead of MediaSource
        this.switchToBlobVideoMode();
        this.playBlobVideo(blob);
    }

    switchToBlobVideoMode() {
        if (this.currentMode === 'blobvideo') return;
        
        console.log('Switching to blob video mode');
        this.currentMode = 'blobvideo';
        this.cleanupMediaSource();
        this.cleanupImageDisplay();
        
        // Ensure video element is visible and properly placed
        if (this.videoElement && this.videoElement.parentElement) {
            this.videoElement.style.display = 'block';
            
            // Clear container and add video element
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            container.appendChild(this.videoElement);
        }
    }

    playBlobVideo(blob) {
        try {
            // Clean up previous blob URL
            if (this.videoElement.src && this.videoElement.src.startsWith('blob:')) {
                URL.revokeObjectURL(this.videoElement.src);
            }
            
            // Create new blob URL and play
            const blobUrl = URL.createObjectURL(blob);
            this.videoElement.src = blobUrl;
            
            this.videoElement.load();
            this.videoElement.play().catch(e => {
                console.log('Blob video play failed:', e.message);
                // If blob video fails, fall back to image mode
                this.switchToImageMode();
                this.displayAsImage(blob);
            });
            
            this.updateStatus('Playing video blob...', 'success');
            
        } catch (error) {
            console.error('Error playing blob video:', error);
            this.switchToImageMode();
            this.displayAsImage(blob);
        }
    }

    handleTextData(text) {
        if (text.startsWith('data:image/')) {
            this.switchToImageMode();
            this.displayAsDataURL(text);
        }
    }

    switchToImageMode() {
        if (this.currentMode === 'image') return;
        
        console.log('Switching to image mode');
        this.currentMode = 'image';
        this.cleanupMediaSource();
        this.cleanupVideoBlob();
        
        // Create image element if needed
        let img = document.getElementById('stream-image');
        if (!img && this.videoElement && this.videoElement.parentElement) {
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            
            img = document.createElement('img');
            img.id = 'stream-image';
            img.style.width = '100%';
            img.style.maxHeight = '500px';
            img.style.objectFit = 'contain';
            img.style.display = 'block';
            
            container.appendChild(img);
        }
    }

    cleanupVideoBlob() {
        if (this.videoElement && this.videoElement.src && this.videoElement.src.startsWith('blob:')) {
            URL.revokeObjectURL(this.videoElement.src);
            this.videoElement.src = '';
            this.videoElement.load();
        }
    }

    switchToVideoMode() {
        if (this.currentMode === 'video') return;
        
        console.log('Switching to video mode');
        this.currentMode = 'video';
        this.cleanupImageDisplay();
        
        // Ensure video element is visible and properly placed
        if (this.videoElement && this.videoElement.parentElement) {
            this.videoElement.style.display = 'block';
            
            // Clear container and add video element
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            container.appendChild(this.videoElement);
        }
        
        // Initialize MediaSource if not already done
        if (!this.mediaSource || this.mediaSource.readyState === 'ended') {
            this.setupMediaSource();
        }
    }

    handleWebMData(arrayBuffer) {
        if (!window.MediaSource) {
            console.log('MediaSource not supported, falling back to image mode');
            this.switchToImageMode();
            this.displayAsImage(arrayBuffer);
            return;
        }

        // Add to buffer queue (we'll be more permissive with WebM data)
        this.bufferQueue.push(arrayBuffer);
        console.log('Added WebM chunk to queue, size:', arrayBuffer.byteLength);

        // Process queue if ready
        if (this.isSourceBufferReady && !this.isProcessingQueue) {
            this.processBufferQueue();
        }
    }

    isValidWebMData(arrayBuffer) {
        try {
            const uint8Array = new Uint8Array(arrayBuffer);
            
            // Check for minimum length
            if (uint8Array.length < 4) return false;
            
            // Look for EBML header (0x1A45DFA3) - full WebM file
            if (uint8Array[0] === 0x1A && uint8Array[1] === 0x45 && 
                uint8Array[2] === 0xDF && uint8Array[3] === 0xA3) {
                return true;
            }
            
            // Look for WebM Cluster element (0x1F43B675)
            if (uint8Array[0] === 0x1F && uint8Array[1] === 0x43 &&
                uint8Array[2] === 0xB6 && uint8Array[3] === 0x75) {
                return true;
            }
            
            // Look for common WebM elements in the stream
            for (let i = 0; i < Math.min(uint8Array.length - 4, 200); i++) {
                // Cluster marker
                if (uint8Array[i] === 0x1F && uint8Array[i + 1] === 0x43 &&
                    uint8Array[i + 2] === 0xB6 && uint8Array[i + 3] === 0x75) {
                    return true;
                }
                // SimpleBlock marker
                if (uint8Array[i] === 0xA3) {
                    return true;
                }
                // Block marker
                if (uint8Array[i] === 0xA1) {
                    return true;
                }
                // Timecode marker
                if (uint8Array[i] === 0xE7) {
                    return true;
                }
            }
            
            // If it's not a JPEG (which we already checked), assume it might be WebM
            // This is more permissive for streaming chunks
            return true;
            
        } catch (error) {
            console.error('Error validating WebM data:', error);
            return false;
        }
    }

    setupMediaSource() {
        this.cleanupMediaSource();
        
        console.log('Setting up MediaSource...');
        this.mediaSource = new MediaSource();
        this.bufferQueue = [];
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;

        // Create object URL and assign to video
        this.mediaSourceUrl = URL.createObjectURL(this.mediaSource);
        this.videoElement.src = this.mediaSourceUrl;

        this.mediaSource.addEventListener('sourceopen', () => {
            console.log('MediaSource opened');
            this.initializeSourceBuffer();
        });

        this.mediaSource.addEventListener('sourceended', () => {
            console.log('MediaSource ended');
            this.isSourceBufferReady = false;
        });

        this.mediaSource.addEventListener('sourceclose', () => {
            console.log('MediaSource closed');
            this.isSourceBufferReady = false;
        });
    }

    initializeSourceBuffer() {
        try {
            // Try different codec combinations
            const mimeTypes = [
                'video/webm; codecs="vp8,opus"',
                'video/webm; codecs="vp8"',
                'video/webm; codecs="vp9,opus"',
                'video/webm; codecs="vp9"',
                'video/webm'
            ];

            let selectedMimeType = null;
            for (const mimeType of mimeTypes) {
                if (MediaSource.isTypeSupported(mimeType)) {
                    selectedMimeType = mimeType;
                    break;
                }
            }

            if (!selectedMimeType) {
                throw new Error('No supported MIME type found');
            }

            console.log('Using MIME type:', selectedMimeType);
            this.sourceBuffer = this.mediaSource.addSourceBuffer(selectedMimeType);

            this.sourceBuffer.addEventListener('updateend', () => {
                console.log('SourceBuffer update ended');
                this.isProcessingQueue = false;
                
                // Process next chunk if available
                if (this.bufferQueue.length > 0) {
                    this.processBufferQueue();
                }
            });

            this.sourceBuffer.addEventListener('error', (event) => {
                console.error('SourceBuffer error:', event);
                this.isSourceBufferReady = false;
                this.isProcessingQueue = false;
                this.bufferQueue = []; // Clear problematic queue
                
                // Switch to image mode as fallback
                setTimeout(() => {
                    this.switchToImageMode();
                }, 100);
            });

            this.sourceBuffer.addEventListener('abort', () => {
                console.log('SourceBuffer aborted');
                this.isProcessingQueue = false;
            });

            this.isSourceBufferReady = true;
            console.log('SourceBuffer ready');

            // Process any queued data
            this.processBufferQueue();

        } catch (error) {
            console.error('Failed to initialize SourceBuffer:', error);
            this.switchToImageMode();
        }
    }

    processBufferQueue() {
        if (this.isProcessingQueue || !this.isSourceBufferReady || this.bufferQueue.length === 0) {
            return;
        }

        if (!this.sourceBuffer || this.sourceBuffer.updating) {
            return;
        }

        // Check if MediaSource is still valid
        if (!this.mediaSource || this.mediaSource.readyState !== 'open') {
            console.log('MediaSource not ready, clearing queue');
            this.bufferQueue = [];
            return;
        }

        try {
            const chunk = this.bufferQueue.shift();
            this.isProcessingQueue = true;
            
            console.log('Appending buffer chunk, queue length:', this.bufferQueue.length);
            this.sourceBuffer.appendBuffer(chunk);
            
            this.updateStatus('Streaming video...', 'success');
            
            // Auto-play if paused (with error handling)
            if (this.videoElement.paused) {
                this.videoElement.play().catch(e => {
                    console.log('Auto-play failed:', e.message);
                });
            }
            
        } catch (error) {
            console.error('Error appending buffer:', error);
            this.isProcessingQueue = false;
            
            // Clear the problematic buffer queue and switch to image mode
            this.bufferQueue = [];
            this.switchToImageMode();
        }
    }

    displayAsImage(arrayBuffer) {
        const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
        const url = URL.createObjectURL(blob);

        const img = document.getElementById('stream-image');
        if (!img) {
            console.error('Image element not found');
            return;
        }

        // Clean up previous blob URL
        if (img.src && img.src.startsWith('blob:')) {
            URL.revokeObjectURL(img.src);
        }

        img.src = url;

        // Calculate FPS
        const now = Date.now();
        if (this.lastImageTime > 0) {
            const fps = 1000 / (now - this.lastImageTime);
            this.updateStatus(`Streaming images (~${fps.toFixed(1)} FPS)`, 'success');
        } else {
            this.updateStatus('Streaming images...', 'success');
        }
        this.lastImageTime = now;
    }

    displayAsDataURL(dataURL) {
        const img = document.getElementById('stream-image');
        if (!img) {
            console.error('Image element not found');
            return;
        }

        img.src = dataURL;
        this.updateStatus('Streaming (data URL)...', 'success');
    }

    updateStatus(message, type) {
        const statusElement = document.getElementById('connection-status');
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = `alert alert-${type}`;
        }
        console.log('Status:', message);
    }

    cleanupMediaSource() {
        console.log('Cleaning up MediaSource...');
        
        this.isSourceBufferReady = false;
        this.isProcessingQueue = false;
        this.bufferQueue = [];

        if (this.sourceBuffer) {
            try {
                if (this.sourceBuffer.updating) {
                    this.sourceBuffer.abort();
                }
                
                if (this.mediaSource && this.mediaSource.readyState === 'open') {
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                }
            } catch (e) {
                console.log('Error cleaning up SourceBuffer:', e.message);
            }
            this.sourceBuffer = null;
        }

        if (this.mediaSource) {
            try {
                if (this.mediaSource.readyState === 'open') {
                    this.mediaSource.endOfStream();
                }
            } catch (e) {
                console.log('Error ending MediaSource:', e.message);
            }
            this.mediaSource = null;
        }

        if (this.mediaSourceUrl) {
            try {
                URL.revokeObjectURL(this.mediaSourceUrl);
            } catch (e) {
                console.log('Error revoking MediaSource URL:', e.message);
            }
            this.mediaSourceUrl = null;
        }

        if (this.videoElement) {
            this.videoElement.src = '';
            this.videoElement.load();
        }
    }

    cleanupImageDisplay() {
        const img = document.getElementById('stream-image');
        if (img) {
            if (img.src && img.src.startsWith('blob:')) {
                URL.revokeObjectURL(img.src);
            }
            img.remove();
        }
    }

    cleanup() {
        console.log('Full cleanup...');
        this.cleanupMediaSource();
        this.cleanupImageDisplay();
        this.currentMode = null;
        this.lastImageTime = 0;
    }

    disconnect() {
        console.log('Disconnecting...');
        this.cleanup();
        
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        
        this.updateStatus('Disconnected', 'error');
    }
}