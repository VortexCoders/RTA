# Camera Streaming Service

A FastAPI-based live camera streaming service that allows users to set up cameras, stream video in real-time, and view streams from multiple locations.

## Features

### 🔧 Admin Panel (`/admin`)
- **Credentials**: Username: `admin`, Password: `admin123`
- Create and manage cameras
- Each camera has:
  - Name and location
  - Residential/Commercial classification
  - Custom or auto-generated public slug
  - Unique camera streaming token

### 📹 Camera Streaming
- Device-based streaming using WebRTC
- Real-time video and audio transmission
- Automatic disconnection of old devices when new ones connect
- Browser-based camera access

### 👀 Public Viewing
- Search cameras by name or location
- Live stream viewing
- Push notification subscriptions
- Mobile-responsive design

### 🔔 Push Notifications
- Subscribe to motion detection alerts
- Service Worker-based notifications
- Camera-specific subscriptions

## Installation & Setup

1. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

2. **Generate SSL certificates (for HTTPS)**:
   ```bash
   python generate_ssl.py
   ```

3. **Run the application**:
   ```bash
   python main.py
   ```

4. **Access the application**:
   - **HTTPS (Recommended)**: https://localhost:8443
   - **Admin panel**: https://localhost:8443/admin
   - **HTTP Fallback**: http://localhost:8000 (if no SSL certificates)

> **Note**: HTTPS is required for WebRTC camera access and Service Worker notifications. The application will automatically detect SSL certificates and start in HTTPS mode.

## How to Use

### Setting Up a Camera

1. Go to `/admin` and login with credentials
2. Fill out the camera creation form:
   - **Name**: Descriptive name for the camera
   - **Location**: Physical location description
   - **Is Residential**: Check if it's in a residential area
   - **Public Slug**: Custom URL slug (optional)

3. After creation, you'll get two URLs:
   - **Public URL**: For viewers to watch the stream
   - **Camera URL**: For the device that will stream

### Streaming from a Device

1. Open the **Camera URL** on the device with a camera
2. Click "Start Streaming"
3. Allow camera and microphone permissions
4. The device will now broadcast live video

### Viewing a Stream

1. Go to the **Public URL** or search on the home page
2. The page will show the live stream (if active)
3. Subscribe to notifications for motion alerts

## API Endpoints

- `GET /` - Home page with camera search
- `GET /admin` - Admin panel (requires authentication)
- `POST /admin/camera` - Create new camera
- `DELETE /admin/camera/{id}` - Delete camera
- `GET /view/{slug}` - Public viewing page
- `GET /camera/{token}` - Camera streaming page
- `WebSocket /ws/camera/{token}` - Camera streaming WebSocket
- `WebSocket /ws/view/{token}` - Viewer WebSocket
- `POST /subscribe/{camera_id}` - Subscribe to notifications
- `GET /search?q={query}` - Search cameras

## Technology Stack

- **Backend**: FastAPI, SQLAlchemy, SQLite
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **Real-time**: WebSockets
- **Video**: WebRTC, MediaRecorder API
- **Notifications**: Push API, Service Workers
- **Database**: SQLite with SQLAlchemy ORM

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Camera Device │    │   FastAPI       │    │   Viewers       │
│   (Streaming)   │◄──►│   Server        │◄──►│   (Watching)    │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                               │
                       ┌───────▼───────┐
                       │   SQLite DB   │
                       │   - Cameras   │
                       │   - Subscript.│
                       └───────────────┘
```

## Security Features

- HTTP Basic Authentication for admin panel
- Camera tokens for secure streaming
- No video storage (live streaming only)
- CORS protection
- Input validation and sanitization

## Mobile Support

- Responsive design for all screen sizes
- Progressive Web App (PWA) capabilities
- Touch-friendly interface
- Mobile camera access

## Browser Requirements

- Modern browsers with WebRTC support
- **HTTPS connection** (required for camera access and notifications)
- Camera and microphone permissions
- WebSocket support
- Service Worker support (for notifications)

> **Security Note**: Browsers require HTTPS for accessing camera/microphone and Service Workers. The application includes automatic SSL certificate generation for development.

## Production Deployment

For production use:

1. **Use trusted SSL certificates**:
   ```bash
   # Let's Encrypt (recommended)
   certbot --nginx -d yourdomain.com
   
   # Or set custom certificate paths
   export SSL_CERT_PATH="/path/to/cert.pem"
   export SSL_KEY_PATH="/path/to/key.pem"
   ```

2. Change admin credentials in environment variables
3. Configure proper CORS settings
4. Use a production WSGI server like Gunicorn
5. Set up proper logging and monitoring
6. Configure reverse proxy (Nginx/Apache)

See [HTTPS_SETUP.md](HTTPS_SETUP.md) for detailed production deployment guide.

## Troubleshooting

### Camera Not Working
- Check browser permissions for camera/microphone
- Ensure HTTPS in production
- Verify WebRTC support

### Stream Not Visible
- Check if camera device is actively streaming
- Refresh the viewer page
- Check browser console for WebSocket errors

### Notifications Not Working
- Ensure HTTPS in production
- Check if service worker is registered
- Verify VAPID keys configuration

## License

This project is open source and available under the MIT License.
