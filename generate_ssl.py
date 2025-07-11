#!/usr/bin/env python3
"""
SSL Certificate Generator for Camera Streaming Service
Generates self-signed certificates for development/testing purposes.
"""

import os
import ssl
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from datetime import datetime, timedelta
import ipaddress

def generate_self_signed_cert(hostname="localhost", ip_addresses=None, validity_days=365):
    """Generate a self-signed certificate for the given hostname and IP addresses."""
    
    if ip_addresses is None:
        ip_addresses = ["127.0.0.1", "0.0.0.0"]
    
    # Generate private key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )
    
    # Create certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "US"),
        x509.NameAttribute(NameOID.STATE_OR_PROVINCE_NAME, "Development"),
        x509.NameAttribute(NameOID.LOCALITY_NAME, "Local"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Camera Streaming Service"),
        x509.NameAttribute(NameOID.COMMON_NAME, hostname),
    ])
    
    # Build SAN (Subject Alternative Names)
    san_list = [x509.DNSName(hostname)]
    
    # Add localhost variants
    if hostname != "localhost":
        san_list.append(x509.DNSName("localhost"))
    
    # Add IP addresses
    for ip in ip_addresses:
        try:
            san_list.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except ValueError:
            print(f"Warning: Invalid IP address {ip}, skipping...")
    
    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.utcnow()
    ).not_valid_after(
        datetime.utcnow() + timedelta(days=validity_days)
    ).add_extension(
        x509.SubjectAlternativeName(san_list),
        critical=False,
    ).add_extension(
        x509.BasicConstraints(ca=False, path_length=None),
        critical=True,
    ).add_extension(
        x509.KeyUsage(
            digital_signature=True,
            key_encipherment=True,
            content_commitment=False,
            data_encipherment=False,
            key_agreement=False,
            key_cert_sign=False,
            crl_sign=False,
            encipher_only=False,
            decipher_only=False,
        ),
        critical=True,
    ).add_extension(
        x509.ExtendedKeyUsage([
            x509.oid.ExtendedKeyUsageOID.SERVER_AUTH,
        ]),
        critical=True,
    ).sign(private_key, hashes.SHA256())
    
    return private_key, cert

def save_certificates(private_key, cert, cert_path="ssl/cert.pem", key_path="ssl/key.pem"):
    """Save the private key and certificate to files."""
    
    # Create SSL directory if it doesn't exist
    os.makedirs(os.path.dirname(cert_path), exist_ok=True)
    
    # Write private key
    with open(key_path, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ))
    
    # Write certificate
    with open(cert_path, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    
    print(f"✅ SSL Certificate saved to: {cert_path}")
    print(f"✅ Private Key saved to: {key_path}")

def main():
    """Generate SSL certificates for the camera streaming service."""
    print("🔐 Generating SSL Certificate for Camera Streaming Service...")
    print("=" * 60)
    
    # Generate certificate
    hostname = "localhost"
    ip_addresses = ["127.0.0.1", "0.0.0.0", "192.168.1.100"]  # Add your local IP if needed
    
    print(f"🏠 Hostname: {hostname}")
    print(f"🌐 IP Addresses: {', '.join(ip_addresses)}")
    print(f"📅 Validity: 365 days")
    print()
    
    private_key, cert = generate_self_signed_cert(hostname, ip_addresses)
    
    # Save certificates
    save_certificates(private_key, cert)
    
    print()
    print("📋 Next Steps:")
    print("1. The certificates are saved in the 'ssl/' directory")
    print("2. For production, replace with certificates from a trusted CA")
    print("3. Browsers will show a security warning for self-signed certificates")
    print("4. Click 'Advanced' -> 'Proceed to localhost (unsafe)' to continue")
    print("5. The application will now run on https://localhost:8000")
    print()
    print("⚠️  Security Note:")
    print("   Self-signed certificates are for development only!")
    print("   For production, use certificates from Let's Encrypt or other CA.")

if __name__ == "__main__":
    main()
