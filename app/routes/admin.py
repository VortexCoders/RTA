from fastapi import APIRouter, Depends, HTTPException, Request, Form, status
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import authenticate_admin, generate_slug, generate_camera_token
from app.models.camera import Camera

router = APIRouter(prefix="/admin")
templates = Jinja2Templates(directory="templates")

@router.get("/", response_class=HTMLResponse)
async def admin_panel(request: Request, username: str = Depends(authenticate_admin), db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    return templates.TemplateResponse("admin.html", {"request": request, "cameras": cameras})

@router.post("/camera")
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

@router.delete("/camera/{camera_id}")
async def delete_camera(camera_id: int, username: str = Depends(authenticate_admin), db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.id == camera_id).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    camera.is_active = False
    db.commit()
    return {"message": "Camera deleted"}

@router.get("/dashboard", response_class=HTMLResponse)
async def processing_dashboard(request: Request, username: str = Depends(authenticate_admin)):
    """Video processing dashboard with queue stats"""
    return templates.TemplateResponse("dashboard.html", {"request": request})

@router.get("/cameras")
async def get_cameras_json(username: str = Depends(authenticate_admin), db: Session = Depends(get_db)):
    """Get list of cameras for dashboard"""
    cameras = db.query(Camera).filter(Camera.is_active == True).all()
    return [
        {
            "id": camera.id,
            "name": camera.name,
            "location": camera.location,
            "camera_token": camera.camera_token,
            "public_slug": camera.public_slug
        }
        for camera in cameras
    ]
