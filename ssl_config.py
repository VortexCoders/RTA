"""
Production HTTPS Configuration for Camera Streaming Service
"""

import os
import ssl
from pathlib import Path
import uvicorn

def get_ssl_config():
    """Get SSL configuration based on environment."""
    
    # Check for Let's Encrypt certificates (production)
    letsencrypt_cert = "/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
    letsencrypt_key = "/etc/letsencrypt/live/yourdomain.com/privkey.pem"
    
    # Check for custom certificates
    custom_cert = os.environ.get("SSL_CERT_PATH", "ssl/cert.pem")
    custom_key = os.environ.get("SSL_KEY_PATH", "ssl/key.pem")
    
    # Production Let's Encrypt certificates
    if os.path.exists(letsencrypt_cert) and os.path.exists(letsencrypt_key):
        return {
            "ssl_keyfile": letsencrypt_key,
            "ssl_certfile": letsencrypt_cert,
            "ssl_version": ssl.PROTOCOL_TLS,
            "ssl_ciphers": "ECDHE+AESGCM:ECDHE+CHACHA20:DHE+AESGCM:DHE+CHACHA20:!aNULL:!MD5:!DSS",
            "type": "production"
        }
    
    # Custom certificates
    elif os.path.exists(custom_cert) and os.path.exists(custom_key):
        return {
            "ssl_keyfile": custom_key,
            "ssl_certfile": custom_cert,
            "ssl_version": ssl.PROTOCOL_TLS,
            "type": "custom"
        }
    
    # Development self-signed certificates
    elif os.path.exists("ssl/cert.pem") and os.path.exists("ssl/key.pem"):
        return {
            "ssl_keyfile": "ssl/key.pem",
            "ssl_certfile": "ssl/cert.pem",
            "type": "development"
        }
    
    return None

def run_server_with_ssl(app, host="0.0.0.0", port=8444):
    """Run the server with appropriate SSL configuration."""
    
    ssl_config = get_ssl_config()
    
    if ssl_config:
        print(f"🔐 Starting HTTPS server ({ssl_config['type']} certificates)...")
        
        if ssl_config['type'] == 'development':
            print("⚠️  Using self-signed certificates - browsers will show security warnings")
            print("   Click 'Advanced' -> 'Proceed to localhost (unsafe)' to continue")
        
        print(f"🌐 HTTPS Server: https://{host}:{port}")
        print(f"🔧 Admin Panel: https://{host}:{port}/admin")
        
        # Remove 'type' from config before passing to uvicorn
        uvicorn_config = {k: v for k, v in ssl_config.items() if k != 'type'}
        
        uvicorn.run(
            app,
            host=host,
            port=port,
            **uvicorn_config
        )
    else:
        print("⚠️  No SSL certificates found!")
        print("🔓 Starting HTTP server (not recommended for production)...")
        print(f"🌐 HTTP Server: http://{host}:{port}")
        print(f"🔧 Admin Panel: http://{host}:{port}/admin")
        print()
        print("📋 To enable HTTPS:")
        print("1. Run 'python generate_ssl.py' for development certificates")
        print("2. For production, use Let's Encrypt: certbot --nginx -d yourdomain.com")
        print("3. Or set SSL_CERT_PATH and SSL_KEY_PATH environment variables")
        
        uvicorn.run(app, host=host, port=port)

# Environment-specific configurations
def get_production_config():
    """Get production server configuration."""
    return {
        "host": "0.0.0.0",
        "port": int(os.environ.get("PORT", 443)),
        "workers": int(os.environ.get("WORKERS", 4)),
        "loop": "uvloop",
        "http": "httptools",
    }

def get_development_config():
    """Get development server configuration."""
    return {
        "host": "127.0.0.1",
        "port": 8000,
        "reload": True,
        "debug": True,
    }
