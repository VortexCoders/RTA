# HTTPS Setup Guide for Camera Streaming Service

This guide covers setting up HTTPS for the Camera Streaming Service in different environments.

## 🔧 Development Setup (Self-Signed Certificates)

### Quick Setup
```bash
# Generate self-signed certificates
python generate_ssl.py

# Start the server
python main.py
```

### Manual Certificate Generation
```bash
# Using OpenSSL (alternative method)
openssl req -x509 -newkey rsa:4096 -keyout ssl/key.pem -out ssl/cert.pem -days 365 -nodes -subj "/CN=localhost"
```

## 🌐 Production Setup

### Option 1: Let's Encrypt (Recommended)

1. **Install Certbot**:
   ```bash
   # Ubuntu/Debian
   sudo apt update
   sudo apt install certbot python3-certbot-nginx

   # CentOS/RHEL
   sudo yum install certbot python3-certbot-nginx
   ```

2. **Get SSL Certificate**:
   ```bash
   # For Nginx
   sudo certbot --nginx -d yourdomain.com

   # Standalone (if no web server)
   sudo certbot certonly --standalone -d yourdomain.com
   ```

3. **Auto-renewal**:
   ```bash
   # Add to crontab
   0 12 * * * /usr/bin/certbot renew --quiet
   ```

### Option 2: Custom Certificates

1. **Set environment variables**:
   ```bash
   export SSL_CERT_PATH="/path/to/your/certificate.pem"
   export SSL_KEY_PATH="/path/to/your/private-key.pem"
   ```

2. **Start the application**:
   ```bash
   python main.py
   ```

## 🚀 Production Deployment with Docker

### Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .
EXPOSE 443

CMD ["python", "main.py"]
```

### Docker Compose with Let's Encrypt
```yaml
version: '3.8'
services:
  camera-service:
    build: .
    ports:
      - "443:443"
    volumes:
      - /etc/letsencrypt:/etc/letsencrypt:ro
    environment:
      - SSL_CERT_PATH=/etc/letsencrypt/live/yourdomain.com/fullchain.pem
      - SSL_KEY_PATH=/etc/letsencrypt/live/yourdomain.com/privkey.pem
```

## 🔒 Security Configurations

### Strong SSL Configuration
The application automatically uses secure SSL settings:
- TLS 1.2+ only
- Strong cipher suites
- ECDHE for forward secrecy
- No weak algorithms (MD5, DSS)

### Security Headers
Add these headers in production (via reverse proxy):
```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
```

## 🌍 Reverse Proxy Setup (Nginx)

### Nginx Configuration
```nginx
server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    # SSL Security
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS;
    ssl_prefer_server_ciphers off;

    # WebSocket support
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Main application
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

## 📱 Browser Compatibility

### Required Features
- WebRTC support
- WebSocket support
- Service Worker support (HTTPS required)
- MediaRecorder API

### Self-Signed Certificate Warning
For development with self-signed certificates:
1. Browser will show security warning
2. Click "Advanced" 
3. Click "Proceed to localhost (unsafe)"
4. This is normal for development

## 🔍 Troubleshooting

### Common Issues

1. **Certificate not trusted**
   - Use certificates from trusted CA for production
   - For development, accept browser security warning

2. **WebRTC not working**
   - HTTPS is required for WebRTC in most browsers
   - Check camera permissions

3. **Service Worker not registering**
   - HTTPS is required for Service Workers
   - Check browser console for errors

4. **Mixed content warnings**
   - Ensure all resources (CSS, JS, images) use HTTPS
   - Update any hardcoded HTTP URLs

### Testing HTTPS Setup

1. **SSL Labs Test**: https://www.ssllabs.com/ssltest/
2. **Local Testing**:
   ```bash
   # Test certificate
   openssl x509 -in ssl/cert.pem -text -noout
   
   # Test connection
   openssl s_client -connect localhost:8000 -servername localhost
   ```

## 🚨 Production Checklist

- [ ] Use certificates from trusted CA (Let's Encrypt recommended)
- [ ] Set up auto-renewal for certificates
- [ ] Configure strong SSL settings
- [ ] Add security headers
- [ ] Test WebRTC functionality
- [ ] Test Service Worker notifications
- [ ] Monitor certificate expiration
- [ ] Set up reverse proxy (Nginx/Apache)
- [ ] Configure firewall (ports 80, 443)
- [ ] Test from multiple devices/browsers

## 📚 Additional Resources

- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [Mozilla SSL Configuration Generator](https://ssl-config.mozilla.org/)
- [WebRTC Security Guide](https://webrtc-security.github.io/)
- [Service Worker Security](https://web.dev/service-worker-security/)
