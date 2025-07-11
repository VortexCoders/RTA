class EnhancedVideoStreamer {
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
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 15, max: 30 }
                },
                audio: false
            });

            const video = document.getElementById('local-video');
            video.srcObject = this.mediaStream;

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
            console.log("WebSocket connected");
            this.setStatus("Streaming...", "success");
            this.isStreaming = true;
            this.startMediaRecorder();
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
    }

    startMediaRecorder() {
        const mimeTypes = [
            'video/webm;codecs=vp9',
            'video/webm;codecs=vp8',
            'video/webm'
        ];
        const selected = mimeTypes.find(m => MediaRecorder.isTypeSupported(m));
        if (!selected) {
            console.error("No supported mime types for MediaRecorder");
            return;
        }
    
        const recordChunk = () => {
            if (!this.isStreaming) return;
    
            try {
                const recorder = new MediaRecorder(this.mediaStream, {
                    mimeType: selected,
                    videoBitsPerSecond: 1000000
                });
    
                recorder.ondataavailable = (e) => {
                    if (e.data.size > 0 && this.ws.readyState === WebSocket.OPEN) {
                        e.data.arrayBuffer().then(buf => {
                            this.ws.send(buf);
                        });
                    }
                };
    
                recorder.onstop = () => {
                    // Schedule next chunk after 1 second
                    setTimeout(recordChunk, 0);
                };
    
                recorder.start(); // start recording
                setTimeout(() => {
                    if (recorder.state === "recording") {
                        recorder.stop(); // flush after 1 second
                    }
                }, 1000);
            } catch (err) {
                console.error("Chunked MediaRecorder error:", err);
                this.setStatus("MediaRecorder error", "error");
            }
        };
    
        recordChunk(); // start first chunk
    }
    

    stopStreaming() {
        this.isStreaming = false;

        if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
            this.mediaRecorder.stop();
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }

        if (this.ws) {
            this.ws.close();
        }

        document.getElementById('local-video').srcObject = null;
        document.getElementById("start-btn").style.display = "inline-block";
        document.getElementById("stop-btn").style.display = "none";
        this.setStatus("Stopped", "error");
    }

    setStatus(msg, type) {
        const statusEl = document.getElementById("status");
        statusEl.textContent = msg;
        statusEl.className = `alert alert-${type}`;
    }
}
