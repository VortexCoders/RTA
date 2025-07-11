from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.camera import Camera

router = APIRouter()
templates = Jinja2Templates(directory="templates")

@router.get("/view/{slug}", response_class=HTMLResponse)
async def view_camera(request: Request, slug: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.public_slug == slug, Camera.is_active == True).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    return templates.TemplateResponse("view.html", {"request": request, "camera": camera})

@router.get("/camera/{token}", response_class=HTMLResponse)
async def camera_page(request: Request, token: str, db: Session = Depends(get_db)):
    camera = db.query(Camera).filter(Camera.camera_token == token, Camera.is_active == True).first()
    if not camera:
        raise HTTPException(status_code=404, detail="Camera not found")
    
    return templates.TemplateResponse("camera.html", {"request": request, "camera": camera})
