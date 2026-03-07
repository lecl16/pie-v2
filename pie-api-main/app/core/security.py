import os
import re
import magic
import logging
import zipfile
from io import BytesIO
from fastapi import HTTPException, UploadFile
from unidecode import unidecode
from typing import List, Tuple, Dict
import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import base64
import secrets
import clamd
import socket
import time
import hmac
import hashlib

# Set up logging
logger = logging.getLogger("app.security")

MAX_FILE_SIZE = 10 * 1024 * 1024 
MAX_ZIP_EXTRACTED_SIZE = 50 * 1024 * 1024 
MAX_ZIP_FILES = 50 
ZIP_RECURSION_LIMIT = 2 

ALLOWED_EXTENSIONS = {
    # Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'txt': 'text/plain',
    
    # Images
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    
    # Archives
    'zip': 'application/zip',
    
    # Programming files
    'java': 'text/plain',
    'py': 'text/plain',
    'c': 'text/plain',
    'cpp': 'text/plain',
    'h': 'text/plain',
}

async def validate_file(file: UploadFile) -> Tuple[bytes, str]:
    """Validates a file for size, type, and security."""
    try:
        content = await file.read()
        if len(content) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, 
                              detail=f"File too large. Maximum size is {MAX_FILE_SIZE/1024/1024}MB")
        
        _, ext = os.path.splitext(file.filename)
        ext = ext[1:].lower() if ext else ""
        
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, 
                              detail=f"Unsupported file type. Allowed types: {', '.join(ALLOWED_EXTENSIONS.keys())}")
        
        mime = magic.Magic(mime=True)
        detected_type = mime.from_buffer(content)
        expected_type = ALLOWED_EXTENSIONS[ext]
        
        # For programming files and text files, be more lenient
        if ext in ['java', 'py', 'c', 'cpp', 'h', 'txt']:
            if not detected_type.startswith('text/'):
                raise HTTPException(
                    status_code=400,
                    detail=f"File content doesn't match extension. Expected text file, got {detected_type}"
                )
        elif not detected_type.startswith(expected_type.split('/')[0]):
            raise HTTPException(status_code=400, 
                             detail=f"File content doesn't match extension. Expected {expected_type}, got {detected_type}")
        
        # Special handling for ZIP files
        if ext == 'zip':
            validate_zip_contents(content)
        
        # Check for malware signatures and patterns
        scan_for_malicious_patterns(content, file.filename)
    
        await file.seek(0)
        
        return content, sanitize_filename(file.filename)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"File validation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error validating file: {str(e)}")

def validate_zip_contents(zip_content: bytes, recursion_level: int = 0) -> None:

    if recursion_level > ZIP_RECURSION_LIMIT:
        raise HTTPException(status_code=400, detail="ZIP contains too many nested archives")
    
    try:
        with zipfile.ZipFile(BytesIO(zip_content), 'r') as zip_ref:
            if len(zip_ref.namelist()) > MAX_ZIP_FILES:
                raise HTTPException(
                    status_code=400, 
                    detail=f"ZIP contains too many files (limit: {MAX_ZIP_FILES})"
                )
            
            # Check for ZIP bomb (compressed vs uncompressed size)
            total_size = 0
            for info in zip_ref.infolist():
                if info.file_size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ZIP contains a file larger than the allowed limit: {info.filename}"
                    )
                
                total_size += info.file_size
                if total_size > MAX_ZIP_EXTRACTED_SIZE:
                    raise HTTPException(
                        status_code=400,
                        detail="ZIP contents exceed maximum allowed extracted size"
                    )
                
                if ".." in info.filename or info.filename.startswith("/"):
                    raise HTTPException(
                        status_code=400,
                        detail=f"ZIP contains unsafe path: {info.filename}"
                    )
                
                _, ext = os.path.splitext(info.filename)
                ext = ext[1:].lower() if ext else ""
                
                if ext and ext not in ALLOWED_EXTENSIONS:
                    raise HTTPException(
                        status_code=400,
                        detail=f"ZIP contains unsupported file type: {info.filename}"
                    )
                
                file_content = zip_ref.read(info.filename)
                
                if ext == 'zip':
                    validate_zip_contents(file_content, recursion_level + 1)
                
                scan_for_malicious_patterns(file_content, info.filename)
                
    except zipfile.BadZipFile:
        raise HTTPException(status_code=400, detail="Invalid ZIP file")
    except zipfile.LargeZipFile:
        raise HTTPException(status_code=400, detail="ZIP file too large to process")

def scan_for_malicious_patterns(content: bytes, filename: str) -> None:
    # Check for executable content or suspicious patterns
    header = content[:500].lower() if len(content) >= 500 else content.lower()
    
    suspicious_patterns = [
        # Windows executables
        b'MZ', 
        # ELF (Linux executables)
        b'\x7fELF',
        # Shell scripts - be careful with python files that might legitimately have shebangs
        b'#!/bin/sh', b'#!/bin/bash',
        # PHP code
        b'<?php',
        # Java class files
        b'\xCA\xFE\xBA\xBE',
        # Windows scripts
        b'@echo off', b'CreateObject',
        # PowerShell
        b'powershell'
    ]
    
    _, ext = os.path.splitext(filename.lower())
    ext = ext[1:] if ext else ""
    
    is_programming_file = ext in ['py', 'java', 'c', 'cpp', 'h', 'sh', 'txt']
    
    for pattern in suspicious_patterns:
        if pattern in header:
            if is_programming_file and pattern in [b'#!/bin/sh', b'#!/bin/bash', b'#!/usr/bin/env']:
                continue
                
            raise HTTPException(
                status_code=400,
                detail=f"Potential security threat detected in {filename}"
            )
    
    if not scan_with_clamav(content):
        raise HTTPException(status_code=400, detail=f"Malware detected in {filename}")
    
def scan_with_clamav(content: bytes) -> bool:

    #defined on .env file
    clamav_host = os.getenv("CLAMAV_HOST")
    clamav_port = int(os.getenv("CLAMAV_PORT"))
    
    max_retries = 3
    retry_delay = 2  # seconds
    
    for attempt in range(max_retries):
        try:
            cd = clamd.ClamdNetworkSocket(host=clamav_host, port=clamav_port)
            scan_result = cd.instream(BytesIO(content))
            
            if scan_result:
                result_type, result_msg = scan_result['stream']
                if result_type == 'OK':
                    return True  # File is clean
                else:
                    logger.warning(f"ClamAV scan detected: {result_msg}")
                    return False  # Virus detected
            return True  # Default to clean if no result (shouldn't happen)
            
        except (clamd.ConnectionError, socket.error) as e:
            if attempt < max_retries - 1:
                logger.warning(f"ClamAV connection failed (attempt {attempt+1}/{max_retries}): {str(e)}. Retrying...")
                time.sleep(retry_delay)
                continue
            else:
                logger.error(f"Failed to connect to ClamAV after {max_retries} attempts: {str(e)}")
                return True  # Assume clean if ClamAV is unavailable
        except Exception as e:
            logger.error(f"ClamAV scan error: {str(e)}")
            return True  # Assume clean if scan fails

def sanitize_filename(filename: str) -> str:
    if not filename:
        return "unknown"
    
    base_name, extension = os.path.splitext(filename)
    
    sanitized_base = unidecode(base_name)
    sanitized_base = re.sub(r"[^\w]", "_", sanitized_base)
    sanitized_base = re.sub(r"_+", "_", sanitized_base)
    
    if extension:
        clean_ext = extension[1:] if extension.startswith('.') else extension
        clean_ext = re.sub(r"[^a-zA-Z0-9]", "", clean_ext)
        return f"{sanitized_base}.{clean_ext}" if clean_ext else sanitized_base
    
    return sanitized_base

def secure_join_path(*args) -> str:
    if not args:
        return ""
    
    if args[0].startswith("/"): # Absolute path
        root = args[0]
        remaining = args[1:]
        
        sanitized = [sanitize_filename(str(arg)) for arg in remaining]
        return os.path.join(root, *sanitized)
    else:
        sanitized = [sanitize_filename(str(arg)) for arg in args]
        return os.path.join(*sanitized)

def create_secure_directory(path: str) -> None:
    try:
        os.makedirs(path, exist_ok=True)
        os.chmod(path, 0o750)  # rwxr-x---
    except Exception as e:
        logger.error(f"Error creating directory {path}: {str(e)}")
        raise

def hash_password(password: str) -> str:
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if not hashed_password or not hashed_password.startswith('$2'):
            logger.error(f"Invalid hash format: {hashed_password[:10] if hashed_password else 'None'}...")
            return False
            
        password_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hashed_bytes)
    except ValueError as e:
        logger.error(f"Password verification error: {str(e)}")
        if hashed_password:
            logger.error(f"Hash prefix: {hashed_password[:15]}")
        return False
    except Exception as e:
        logger.error(f"Unexpected error in password verification: {str(e)}")
        return False

def generate_encryption_key() -> bytes:
    return secrets.token_bytes(32)

def encrypt_file(file_content: bytes, key: bytes) -> Tuple[bytes, bytes]:

    nonce = secrets.token_bytes(12)
    
    cipher = AESGCM(key)
    encrypted_data = cipher.encrypt(nonce, file_content, None)
    
    return nonce + encrypted_data, nonce

def format_key_for_storage(key: bytes) -> str:
    return base64.urlsafe_b64encode(key).decode('utf-8')

def get_key_from_storage(key_str: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(key_str)
    except Exception:
        raise ValueError("Invalid encryption key format")
    
def generate_hmac(session_key, message):
    if isinstance(session_key, str):
        session_key = session_key.encode('utf-8')
    if isinstance(message, str):
        message = message.encode('utf-8')
    return hmac.new(session_key, message, hashlib.sha256).digest()

def verify_hmac(session_key, message, provided_hmac):
    if isinstance(provided_hmac, str):
        try:
            provided_hmac = base64.b64decode(provided_hmac)
        except Exception:
            return False
    computed_hmac = generate_hmac(session_key, message)
    return hmac.compare_digest(computed_hmac, provided_hmac)

def format_hmac_for_storage(hmac_digest: bytes) -> str:
    return base64.urlsafe_b64encode(hmac_digest).decode('utf-8')