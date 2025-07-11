import secrets
from fastapi import HTTPException, Depends, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from passlib.context import CryptContext

# Security setup
security = HTTPBasic()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "admin123"  # In production, use environment variables

# WebPush VAPID keys (in production, generate proper keys)
VAPID_PRIVATE_KEY = "your-vapid-private-key"
VAPID_PUBLIC_KEY = "your-vapid-public-key"
VAPID_CLAIMS = {"sub": "mailto:admin@example.com"}

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

# Utility functions
def generate_slug():
    return secrets.token_urlsafe(8)

def generate_camera_token():
    return secrets.token_urlsafe(16)
