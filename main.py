import os
from datetime import datetime, timedelta
from typing import Optional, List
import json
import base64
import secrets
import hashlib
from pathlib import Path

from fastapi import FastAPI, Depends, HTTPException, Request, Form, status, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, Session
from passlib.context import CryptContext
from pywebpush import webpush, WebPushException
import uvicorn
from ssl_config import run_server_with_ssl

# Database setup
SQLALCHEMY_DATABASE_URL = "sqlite:///./cameras.db"
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Security setup
security = HTTPBasic()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"  # In production, use environment variables

# WebPush VAPID keys (in production, generate proper keys)
VAPID_PRIVATE_KEY = "your-vapid-private-key"
VAPID_PUBLIC_KEY = "your-vapid-public-key"
VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}

app = FastAPI(title="Camera Streaming Service")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Database Models
class Camera(Base):
    __tablename__ = "cameras"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    location = Column(String, index=True)
    is_residential = Column(Boolean, default=False)
    public_slug = Column(String, unique=True, index=True)
    camera_token = Column(String, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class Subscription(Base):
    __tablename__ = "subscriptions"
    
    id = Column(Integer, primary_key=True, index=True)
    camera_id = Column(Integer, index=True)
    endpoint = Column(Text)
    p256dh = Column(Text)
    auth = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

# Create tables
Base.metadata.create_all(bind=engine)

# Dependency to get DB session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Admin authentication
def authenticate_admin(credentials: HTTPBasicCredentials = Depends(security)):
    correct_username = secrets.compare_digest(credentials.username, ADMIN_USERNAME)
    correct_password = secrets.compare_digest(credentials.password, ADMIN_PASSWORD)
    if not (correct_username and correct_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    return credentials.username

# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}  # camera_token -> websocket
        self.viewers: dict = {}  # camera_token -> list of viewer websockets
    
    async def connect_camera(self, websocket: WebSocket, camera_token: str):
        await websocket.accept()
        # Disconnect existing camera if any
        if camera_token in self.active_connections:
            try:
                await self.active_connections[camera_token].close()
            except:
                pass
        self.active_connections[camera_token] = websocket
        if camera_token not in self.viewers:
            self.viewers[camera_token] = []
    
    async def connect_viewer(self, websocket: WebSocket, camera_token: str):
        await websocket.accept()
        if camera_token not in self.viewers:
            self.viewers[camera_token] = []
        self.viewers[camera_token].append(websocket)
    
    def disconnect_camera(self, camera_token: str):
        if camera_token in self.active_connections:
            del self.active_connections[camera_token]
    
    def disconnect_viewer(self, websocket: WebSocket, camera_token: str):
        if camera_token in self.viewers:
            if websocket in self.viewers[camera_token]:
                self.viewers[camera_token].remove(websocket)
    
    async def broadcast_to_viewers(self, camera_token: str, data, is_binary=False):
        if camera_token in self.viewers:
            disconnected = []
            for viewer_ws in self.viewers[camera_token]:
                try:
                    if is_binary:
                        await viewer_ws.send_bytes(data)
                    else:
                        await viewer_ws.send_text(data)
                except Exception as e:
                    print(f"Error broadcasting to viewer: {e}")
                    disconnected.append(viewer_ws)
            # Remove disconnected viewers
            for ws in disconnected:
                self.viewers[camera_token].remove(ws)
    
    async def disconnect_all(self):
        print("🔌 Force-closing all WebSocket connections...")

        # Close all camera connections
        for token, ws in self.active_connections.items():
            try:
                await ws.close(code=1001)
                print(f"Closed camera connection for {token}")
            except Exception as e:
                print(f"Error closing camera {token}: {e}")
        self.active_connections.clear()

        # Close all viewer connections
        for token, viewer_list in self.viewers.items():
            for ws in viewer_list:
                try:
                    await ws.close(code=1001)
                    print(f"Closed viewer for camera {token}")
                except Exception as e:
                    print(f"Error closing viewer for {token}: {e}")
        self.viewers.clear()


manager = ConnectionManager()

@app.on_event("shutdown")
async def shutdown_event():
    await manager.disconnect_all()

# Utility functions
def generate_slug():
    return secrets.token_urlsafe(8)

def generate_camera_token():
    return secrets.token_urlsafe(16)

# Routes

@app.get("/", response_class=HTMLResponse)
async def home(request: Request, db: Session = Depends(get_db)):
    cameras = db.query(Camera).filter(Camera.is_active == True).all()
    return templates.TemplateResponse("home.html", {"request": request, "cameras": cameras})

@app.get("/search")
async def search_cameras(q: str = "", db: Session = Depends(get_db)):
    cameras = db.query(Camera).filter(
        Camera.is_active == True,
        (Camera.name.contains(q) | Camera.location.contains(q))
    ).all()
    return [{"id": c.id, "name": c.name, "location": c.location, "slug": c.public_slug} for c in cameras]

@app.get("/admin", response_class=HTMLResponse)
async def admin_panel(request: Request, username: str = Depends(authenticate_admin), db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    return templates.TemplateResponse("admin.html", {"request": request, "cameras": cameras})

@app.post("/admin/camera")
async def create_camera(
    name: str = Form(...),
    location: str = Form(...),
    is_residential: bool = Form(False),
    public_slug: str = Form(""),
    username: str = Depends(authenticate_admin),
    db: Session = Depends(get_db)
):
    # Generate slug if not provided
    if not public_slug:
        public_slug = generate_slug()
    
    # Check if slug exists
    existing = db.query(Camera).filter(Camera.public_slug == public_slug).first()
    if existing:
        raise HTTPException(status_code=400, detail="Slug already exists")
    
    camera = Camera(
        name=name,
        location=location,
        is_residential=is_residential,
        public_slug=public_slug,
        camera_token=generate_camera_token()
    )
    db.add(camera)
    db.commit()
    db.refresh(camera)
    
    return JSONResponse({
        "id": camera.id,
        "public_url": f"/view/{camera.public_slug}",
        "camera_url": f"/camera/{camera.camera_token}"
    })

@app.delete("/admin/camera/{camera_id}")
async def delete_camera(camera_id: int, username: str = Depends(authenticate_admin), db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    camera.is_active = False
    db.commit()
    return {"message": "Camera deleted"}

@app.get("/view/{slug}", response_class=HTMLResponse)
async def view_camera(request: Request, slug: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.public_slug == slug, Camera.is_active == True).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    return templates.TemplateResponse("view.html", {"request": request, "camera": camera})

@app.get("/camera/{token}", response_class=HTMLResponse)
async def camera_page(request: Request, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token, Camera.is_active == True).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    return templates.TemplateResponse("camera.html", {"request": request, "camera": camera})


from starlette.websockets import WebSocketState

@app.websocket("/ws/camera/{token}")
async def camera_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        await websocket.close(code=4404)
        return

    await manager.connect_camera(websocket, token)

    try:
        while websocket.application_state == WebSocketState.CONNECTED:
            message = await websocket.receive()

            if message["type"] == "websocket.disconnect":
                break

            elif "bytes" in message and message["bytes"] is not None:
                print(f"Received binary: {len(message['bytes'])} bytes from {token}")
                await manager.broadcast_to_viewers(token, message["bytes"], is_binary=True)

            elif "text" in message and message["text"] is not None:
                print(f"Received text from {token}: {message['text']}")
                await manager.broadcast_to_viewers(token, message["text"], is_binary=False)

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect_camera(token)


@app.websocket("/ws/view/{token}")
async def viewer_websocket(websocket: WebSocket, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token).first()
    if not camera:
        await websocket.close(code=4404)
        return
    
    await manager.connect_viewer(websocket, token)
    try:
        while True:
            # Keep connection alive with ping/pong
            try:
                await websocket.receive_text()
            except:
                break
    except WebSocketDisconnect:
        manager.disconnect_viewer(websocket, token)

@app.post("/subscribe/{camera_id}")
async def subscribe_to_notifications(
    camera_id: int,
    subscription_data: dict,
    db: Session = Depends(get_db)
):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    subscription = Subscription(
        camera_id=camera_id,
        endpoint=subscription_data.get("endpoint"),
        p256dh=subscription_data.get("keys", {}).get("p256dh"),
        auth=subscription_data.get("keys", {}).get("auth")
    )
    db.add(subscription)
    db.commit()
    
    return {"message": "Subscribed successfully"}

@app.post("/trigger-notification/{camera_id}")
async def trigger_notification(camera_id: int, message: str = "Motion detected!", db: Session = Depends(get_db)):
    subscriptions = db.query(Subscription).filter(Subscription.camera_id == camera_id).all()
    
    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth}
                },
                data=json.dumps({"title": "Camera Alert", "body": message}),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS
            )
        except WebPushException as e:
            print(f"Failed to send notification: {e}")
    
    return {"message": f"Notifications sent to {len(subscriptions)} subscribers"}

if __name__ == "__main__":
    # Create directories
    Path("static").mkdir(exist_ok=True)
    Path("templates").mkdir(exist_ok=True)
    Path("ssl").mkdir(exist_ok=True)
    
    # Run server with SSL configuration
    run_server_with_ssl(app)
