import os
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


import logging

logging.basicConfig(
    level=logging.DEBUG,  # or INFO, WARNING, etc.
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

# Import route modules
from app.routes import main, admin, camera, websocket, notifications
from app.core.database import engine
from app.core.websocket_manager import manager
from app.models.camera import Base

# Create tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Camera Streaming Service")

# Mount static files and templates
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# Include routers
app.include_router(main.router)
app.include_router(admin.router)
app.include_router(camera.router)
app.include_router(websocket.router)
app.include_router(notifications.router)

@app.on_event("shutdown")
async def shutdown_event():
    await manager.disconnect_all()

if __name__ == "__main__":
    # Create directories
    Path("static").mkdir(exist_ok=True)
    Path("templates").mkdir(exist_ok=True)
    Path("ssl").mkdir(exist_ok=True)
    
    # Import and run server with SSL configuration
    from ssl_config import run_server_with_ssl
    run_server_with_ssl(app)
