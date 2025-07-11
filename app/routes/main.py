from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.camera import Camera

router = APIRouter()
templates = Jinja2Templates(directory="templates")

@router.get("/", response_class=HTMLResponse)
async def home(request: Request, db: Session = Depends(get_db)):
    cameras = db.query(Camera).filter(Camera.is_active == True).all()
    return templates.TemplateResponse("home.html", {"request": request, "cameras": cameras})

@router.get("/search")
async def search_cameras(q: str = "", db: Session = Depends(get_db)):
    cameras = db.query(Camera).filter(
        Camera.is_active == True,
        (Camera.name.contains(q) | Camera.location.contains(q))
    ).all()
    return [{"id": c.id, "name": c.name, "location": c.location, "slug": c.public_slug} for c in cameras]
