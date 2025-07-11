class EnhancedVideoViewer {
    constructor(cameraToken) {
      this.cameraToken = cameraToken;
      this.videoElement = document.getElementById('stream-video');
      this.statusElement = document.getElementById('connection-status');
  
      this.queue = [];              // Clip URLs
      this.playing = false;
      this.websocket = null;
      this.minBufferSize = 2;       // ⏳ Buffer threshold
      this.waitingForBuffer = true;
    }
  
    connect() {
      this.updateStatus("Connecting...", "info");
  
      const wsUrl = `wss://${location.host}/ws/view/${this.cameraToken}`;
      this.websocket = new WebSocket(wsUrl);
      this.websocket.binaryType = 'arraybuffer';
  
      this.websocket.onopen = () => {
        this.updateStatus("Connected", "success");
      };
  
      this.websocket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          const blob = new Blob([event.data], { type: 'video/mp4' });
          const url = URL.createObjectURL(blob);
  
          this.queue.push(url);
          console.log("Queued clip:", url);
  
          if (!this.playing && this.queue.length >= this.minBufferSize && this.waitingForBuffer) {
            this.waitingForBuffer = false;
            this.playNext();
          } else if (!this.playing) {
            this.updateStatus(`Buffering... (${this.queue.length}/${this.minBufferSize})`, "warning");
          }
        }
      };
  
      this.websocket.onerror = (err) => {
        console.error("WebSocket error:", err);
        this.updateStatus("WebSocket error", "danger");
      };
  
      this.websocket.onclose = () => {
        this.updateStatus("Disconnected", "danger");
      };
  
      this.videoElement.addEventListener('ended', () => {
        this.playNext();
      });
  
      this.videoElement.addEventListener('error', (e) => {
        console.error("Video error:", e);
        this.updateStatus("Playback error", "danger");
        this.playNext(); // Skip to next
      });
    }
  
    playNext() {
      if (this.queue.length === 0) {
        this.playing = false;
        this.waitingForBuffer = true;
        this.updateStatus("Buffering...", "warning");
        this.videoElement.removeAttribute("src");
        this.videoElement.load();
        return;
      }
  
      if (this.queue.length < this.minBufferSize && !this.playing) {
        this.waitingForBuffer = true;
        this.updateStatus(`Buffering... (${this.queue.length}/${this.minBufferSize})`, "warning");
        return;
      }
  
      const nextUrl = this.queue.shift();
      this.playing = true;
  
      console.log("Playing clip:", nextUrl);
  
      this.updateStatus("Playing", "success");
      this.videoElement.src = nextUrl;
      this.videoElement.play().catch((err) => {
        console.error("Video play() failed", err);
        this.updateStatus("Autoplay blocked or error", "danger");
      });
    }
  
    updateStatus(text, type = 'info') {
      if (!this.statusElement) return;
      this.statusElement.className = `alert alert-${type}`;
      this.statusElement.textContent = text;
    }
  
    reset() {
      if (this.websocket) {
        this.websocket.close();
        this.websocket = null;
      }
  
      if (this.videoElement) {
        this.videoElement.pause();
        this.videoElement.removeAttribute('src');
        this.videoElement.load();
      }
  
      this.queue.forEach(url => URL.revokeObjectURL(url));
      this.queue = [];
  
      this.playing = false;
      this.waitingForBuffer = true;
  
      this.updateStatus("Reset", "secondary");
    }
  }
  