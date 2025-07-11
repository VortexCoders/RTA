#!/usr/bin/env python3
"""
Quick Start Script for Camera Streaming Service
Automatically sets up SSL and starts the server
"""

import os
import sys
import subprocess
from pathlib import Path

def check_dependencies():
    """Check if required dependencies are installed."""
    try:
        import fastapi
        import uvicorn
        import sqlalchemy
        print("✅ Dependencies are installed")
        return True
    except ImportError as e:
        print(f"❌ Missing dependency: {e}")
        print("💡 Run: pip install -r requirements.txt")
        return False

def setup_ssl():
    """Set up SSL certificates if they don't exist."""
    ssl_cert = Path("ssl/cert.pem")
    ssl_key = Path("ssl/key.pem")
    
    if ssl_cert.exists() and ssl_key.exists():
        print("✅ SSL certificates found")
        return True
    
    print("🔐 Generating SSL certificates...")
    try:
        result = subprocess.run([sys.executable, "generate_ssl.py"], 
                              capture_output=True, text=True, check=True)
        print("✅ SSL certificates generated successfully")
        return True
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to generate SSL certificates: {e}")
        print("🔓 Will start in HTTP mode")
        return False

def start_server():
    """Start the camera streaming server."""
    print("🚀 Starting Camera Streaming Service...")
    try:
        subprocess.run([sys.executable, "main.py"], check=True)
    except KeyboardInterrupt:
        print("\n🛑 Server stopped by user")
    except subprocess.CalledProcessError as e:
        print(f"❌ Server failed to start: {e}")

def main():
    """Main function to set up and start the service."""
    print("🎥 Camera Streaming Service - Quick Start")
    print("=" * 50)
    
    # Check dependencies
    if not check_dependencies():
        sys.exit(1)
    
    # Set up SSL
    ssl_available = setup_ssl()
    
    print()
    print("📋 Server Information:")
    if ssl_available:
        print("🔐 HTTPS Mode: https://localhost:8443")
        print("🔧 Admin Panel: https://localhost:8443/admin")
        print("⚠️  You may see a security warning for self-signed certificates")
        print("   Click 'Advanced' -> 'Proceed to localhost (unsafe)' to continue")
    else:
        print("🔓 HTTP Mode: http://localhost:8000")
        print("🔧 Admin Panel: http://localhost:8000/admin")
        print("⚠️  WebRTC features may not work without HTTPS")
    
    print()
    print("👤 Admin Credentials:")
    print("   Username: admin")
    print("   Password: admin123")
    print()
    
    # Start server
    start_server()

if __name__ == "__main__":
    main()
