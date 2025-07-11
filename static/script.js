// Camera search functionality
async function searchCameras() {
    const searchTerm = document.getElementById('search-input').value;
    const response = await fetch(`/search?q=${encodeURIComponent(searchTerm)}`);
    const cameras = await response.json();
    
    const grid = document.getElementById('cameras-grid');
    grid.innerHTML = '';
    
    cameras.forEach(camera => {
        const card = createCameraCard(camera);
        grid.appendChild(card);
    });
    
    if (cameras.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #7f8c8d; grid-column: 1 / -1;">No cameras found matching your search.</p>';
    }
}

function createCameraCard(camera) {
    const card = document.createElement('div');
    card.className = 'camera-card';
    card.innerHTML = `
        <h3>${camera.name}</h3>
        <div class="camera-info">
            <p><strong>Location:</strong> ${camera.location}</p>
        </div>
        <a href="/view/${camera.slug}" class="btn btn-primary">View Stream</a>
    `;
    return card;
}

// Admin functionality
async function createCamera(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.innerHTML = 'Creating... <span class="loading"></span>';
    submitBtn.disabled = true;
    
    try {
        const response = await fetch('/admin/camera', {
            method: 'POST',
            body: formData
        });
        
        const result = await response.json();
        
        if (response.ok) {
            showModal('Camera Created Successfully', `
                <p><strong>Public URL:</strong> <a href="${result.public_url}" target="_blank">${window.location.origin}${result.public_url}</a></p>
                <p><strong>Camera URL:</strong> <a href="${result.camera_url}" target="_blank">${window.location.origin}${result.camera_url}</a></p>
                <p>Share the Camera URL with the device that will stream video.</p>
            `);
            form.reset();
            loadCameras();
        } else {
            showAlert(result.detail || 'Error creating camera', 'error');
        }
    } catch (error) {
        showAlert('Network error occurred', 'error');
    } finally {
        submitBtn.innerHTML = originalText;
        submitBtn.disabled = false;
    }
}

async function deleteCamera(cameraId) {
    if (!confirm('Are you sure you want to delete this camera?')) {
        return;
    }
    
    try {
        const response = await fetch(`/admin/camera/${cameraId}`, {
            method: 'DELETE'
        });
        
        if (response.ok) {
            showAlert('Camera deleted successfully', 'success');
            loadCameras();
        } else {
            showAlert('Error deleting camera', 'error');
        }
    } catch (error) {
        showAlert('Network error occurred', 'error');
    }
}

async function loadCameras() {
    // Reload the page to refresh camera list
    window.location.reload();
}

// Camera streaming functionality
class CameraStreamer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaStream = null;
        this.mediaRecorder = null;
        this.isStreaming = false;
    }
    
    async startStreaming() {
        try {
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720 },
                audio: true
            });
            
            const video = document.getElementById('local-video');
            video.srcObject = this.mediaStream;
            
            this.setupWebSocket();
            this.setupMediaRecorder();
            
            document.getElementById('start-btn').style.display = 'none';
            document.getElementById('stop-btn').style.display = 'inline-block';
            document.getElementById('status').textContent = 'Streaming...';
            document.getElementById('status').className = 'alert alert-success';
            
        } catch (error) {
            console.error('Error accessing camera:', error);
            showAlert('Error accessing camera. Please ensure you have granted camera permissions.', 'error');
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
    
    setupMediaRecorder() {
        // Try different MIME types for better compatibility
        let mimeType = 'video/webm;codecs=vp9,opus';
        if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = 'video/webm;codecs=vp8,opus';
            if (!MediaRecorder.isTypeSupported(mimeType)) {
                mimeType = 'video/webm';
                if (!MediaRecorder.isTypeSupported(mimeType)) {
                    mimeType = 'video/mp4';
                }
            }
        }
        
        console.log('Using MIME type:', mimeType);
        
        this.mediaRecorder = new MediaRecorder(this.mediaStream, {
            mimeType: mimeType,
            videoBitsPerSecond: 1000000, // 1 Mbps
            audioBitsPerSecond: 128000   // 128 kbps
        });
        
        this.mediaRecorder.ondataavailable = (event) => {
            console.log('Data available:', event.data.size, event.data.type);
            if (event.data.size > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
                this.ws.send(event.data);
            }        
        };
        
        this.mediaRecorder.start(1000); // Send data every 1 second for smoother streaming
    }
    
    stopStreaming() {
        if (this.mediaRecorder) {
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

// Video viewer functionality
class VideoViewer {
    constructor(token) {
        this.token = token;
        this.ws = null;
        this.mediaSource = null;
        this.sourceBuffer = null;
        this.videoElement = null;
        this.chunks = [];
        this.isInitialized = false;
    }
    
    connect() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/view/${this.token}`;
        
        console.log('Connecting to viewer WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        this.ws.binaryType = 'arraybuffer';
        
        this.videoElement = document.getElementById('stream-video');
        this.setupMediaSource();
        
        this.ws.onmessage = (event) => {
            this.handleVideoData(event.data);
        };
        
        this.ws.onopen = () => {
            console.log('Viewer WebSocket connected');
            document.getElementById('connection-status').textContent = 'Connected - Waiting for stream...';
            document.getElementById('connection-status').className = 'alert alert-success';
        };
        
        this.ws.onclose = () => {
            console.log('Viewer WebSocket disconnected');
            document.getElementById('connection-status').textContent = 'Disconnected - Reconnecting...';
            document.getElementById('connection-status').className = 'alert alert-error';
            
            // Clean up media source
            this.cleanup();
            
            // Try to reconnect after 3 seconds
            setTimeout(() => this.connect(), 3000);
        };
        
        this.ws.onerror = (error) => {
            console.error('Viewer WebSocket error:', error);
            document.getElementById('connection-status').textContent = 'Connection Error';
            document.getElementById('connection-status').className = 'alert alert-error';
        };
    }
    
    setupMediaSource() {
        if (!window.MediaSource) {
            console.error('MediaSource API not supported');
            this.fallbackToImageStream();
            return;
        }
        
        this.mediaSource = new MediaSource();
        this.videoElement.src = URL.createObjectURL(this.mediaSource);
        
        this.mediaSource.addEventListener('sourceopen', () => {
            console.log('MediaSource opened');
            // We'll add source buffer when we receive the first chunk
        });
    }
    
    handleVideoData(data) {
        if (data instanceof ArrayBuffer) {
            this.handleBinaryData(new Uint8Array(data));
        } else if (typeof data === 'string') {
            this.handleTextData(data);
        }
    }
    
    handleBinaryData(data) {
        try {
            if (!this.isInitialized && this.mediaSource && this.mediaSource.readyState === 'open') {
                // Try to determine MIME type from data
                let mimeType = [
                    'video/webm; codecs="vp9,opus"',
                    'video/webm; codecs="vp8,opus"',
                    'video/webm'
                ].find(type => MediaSource.isTypeSupported(type));
                
                if (!mimeType) {
                    console.error('No compatible MIME type found');
                    this.fallbackToImageStream();
                    return;
                }                
                
                try {
                    this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
                    this.sourceBuffer.addEventListener('updateend', () => {
                        if (this.chunks.length > 0) {
                            const nextChunk = this.chunks.shift();
                            if (!this.sourceBuffer.updating) {
                                this.sourceBuffer.appendBuffer(nextChunk);
                            }
                        }
                    });
                    this.isInitialized = true;
                } catch (e) {
                    console.error('Failed to add source buffer:', e);
                    this.fallbackToImageStream();
                    return;
                }
            }
            
            if (this.sourceBuffer && !this.sourceBuffer.updating) {
                this.sourceBuffer.appendBuffer(data);
                document.getElementById('connection-status').textContent = 'Streaming...';
                document.getElementById('connection-status').className = 'alert alert-success';
            } else if (this.sourceBuffer) {
                this.chunks.push(data);
            }
        } catch (error) {
            console.error('Error handling binary data:', error);
            this.fallbackToImageStream();
        }
    }
    
    handleTextData(data) {
        // Handle base64 encoded data or other text formats
        if (data.startsWith('data:image/')) {
            // Display as image for now
            const img = document.createElement('img');
            img.src = data;
            img.style.width = '100%';
            img.style.height = 'auto';
            
            const container = this.videoElement.parentElement;
            container.innerHTML = '';
            container.appendChild(img);
        }
    }
    
    fallbackToImageStream() {
        console.log('Falling back to image stream mode');
        document.getElementById('connection-status').textContent = 'Connected - Image mode (limited browser support)';
        document.getElementById('connection-status').className = 'alert alert-success';
    }
    
    cleanup() {
        if (this.sourceBuffer) {
            try {
                this.sourceBuffer.abort();
            } catch (e) {
                console.log('Error aborting source buffer:', e);
            }
        }
        
        this.isInitialized = false;
        this.chunks = [];
    }
    
    disconnect() {
        this.cleanup();
        if (this.ws) {
            this.ws.close();
        }
    }
}

// Push notification functionality
async function subscribeToPushNotifications(cameraId) {
    if ('serviceWorker' in navigator && 'PushManager' in window) {
        try {
            const registration = await navigator.serviceWorker.register('/static/sw.js');
            const subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array('your-vapid-public-key')
            });
            
            const response = await fetch(`/subscribe/${cameraId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(subscription)
            });
            
            if (response.ok) {
                showAlert('Successfully subscribed to notifications!', 'success');
                document.getElementById('subscribe-btn').textContent = 'Subscribed!';
                document.getElementById('subscribe-btn').disabled = true;
            } else {
                showAlert('Failed to subscribe to notifications', 'error');
            }
        } catch (error) {
            console.error('Error subscribing to notifications:', error);
            showAlert('Push notifications are not supported in this browser', 'error');
        }
    } else {
        showAlert('Push notifications are not supported in this browser', 'error');
    }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');
    
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Utility functions
function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type}`;
    alertDiv.textContent = message;
    
    const container = document.querySelector('.container');
    container.insertBefore(alertDiv, container.firstChild);
    
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

function showModal(title, content) {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');
    
    modalTitle.textContent = title;
    modalBody.innerHTML = content;
    modal.style.display = 'block';
}

function closeModal() {
    document.getElementById('modal').style.display = 'none';
}

function toggleDebugInfo() {
    const debugDiv = document.getElementById('debug-info');
    const debugContent = document.getElementById('debug-content');
    
    if (debugDiv.style.display === 'none') {
        debugDiv.style.display = 'block';
        updateDebugInfo();
        // Update debug info every 2 seconds
        window.debugInterval = setInterval(updateDebugInfo, 2000);
    } else {
        debugDiv.style.display = 'none';
        if (window.debugInterval) {
            clearInterval(window.debugInterval);
        }
    }
}

function updateDebugInfo() {
    const debugContent = document.getElementById('debug-content');
    if (!debugContent) return;
    
    const info = {
        'Browser': navigator.userAgent.split(' ').slice(-2).join(' '),
        'WebRTC Support': !!window.RTCPeerConnection,
        'MediaRecorder Support': !!window.MediaRecorder,
        'MediaSource Support': !!window.MediaSource,
        'WebSocket State': window.videoViewer ? (window.videoViewer.ws ? window.videoViewer.ws.readyState : 'Not connected') : 'No viewer',
        'Current URL': window.location.href,
        'Protocol': window.location.protocol,
        'Timestamp': new Date().toLocaleTimeString()
    };
    
    if (window.MediaRecorder) {
        const supportedTypes = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm;codecs=vp8',
            'video/webm',
            'video/mp4'
        ];
        info['MediaRecorder MIME Types'] = supportedTypes.filter(type => MediaRecorder.isTypeSupported(type)).join(', ') || 'None';
    }
    
    let html = '';
    for (const [key, value] of Object.entries(info)) {
        html += `<div><strong>${key}:</strong> ${value}</div>`;
    }
    
    debugContent.innerHTML = html;
}

// Initialize based on page
document.addEventListener('DOMContentLoaded', function() {
    // Search functionality
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('keyup', function(e) {
            if (e.key === 'Enter') {
                searchCameras();
            }
        });
    }
    
    // Modal close functionality
    const modal = document.getElementById('modal');
    if (modal) {
        window.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeModal();
            }
        });
    }
    
    // Initialize based on page type
    if (window.location.pathname.includes('/camera/')) {
        const token = window.location.pathname.split('/').pop();
        // Use enhanced streamer if available, otherwise fallback to basic
        if (typeof EnhancedVideoStreamer !== 'undefined') {
            window.cameraStreamer = new EnhancedVideoStreamer(token);
        } else {
            window.cameraStreamer = new CameraStreamer(token);
        }
    } else if (window.location.pathname.includes('/view/')) {
        const cameraToken = document.querySelector('[data-camera-token]')?.dataset.cameraToken;
        if (cameraToken) {
            // Use enhanced viewer if available, otherwise fallback to basic
            if (typeof EnhancedVideoViewer !== 'undefined') {
                window.videoViewer = new EnhancedVideoViewer(cameraToken);
            } else {
                window.videoViewer = new VideoViewer(cameraToken);
            }
            window.videoViewer.connect();
        }
    }
});
