from mitmproxy import http
from urllib.parse import urlparse, urljoin
import os
import time
import sys

# Use expanduser to resolve ~ in the path
WHITELIST_FILE = os.path.expanduser("/etc/iptables/whitelist.txt")
print(f"Using whitelist file at: {WHITELIST_FILE}")

WHITELIST_DOMAINS = {
    "idp.ua.pt",
    "static.ua.pt",
    "elearning.ua.pt/mod/resource/",
}

MANUAL_WHITELIST_URLS = {
    "https://elearning.ua.pt/Shibboleth.sso/SAML2/POST",
    "https://elearning.ua.pt/login/index.php",
    "https://elearning.ua.pt/auth/shibboleth/index.php",
}

LOADED_WHITELIST_URLS = set(MANUAL_WHITELIST_URLS)

allowed_referers = set()

LAST_CHECK_TIME = 0
CHECK_INTERVAL = 30  # Reduced for debugging

def is_whitelisted_domain(url):
    """Check if the request is part of a whitelisted domain"""
    parsed_url = urlparse(url)
    return parsed_url.hostname in WHITELIST_DOMAINS

def reload_whitelist():
    """Check for changes to the whitelist file and reload if necessary"""
    global LAST_CHECK_TIME, LOADED_WHITELIST_URLS
    
    current_time = time.time()
    if current_time - LAST_CHECK_TIME < CHECK_INTERVAL:
        return
    
    LAST_CHECK_TIME = current_time
    
    try:
        updated_whitelist = set(MANUAL_WHITELIST_URLS)
        
        if os.path.exists(WHITELIST_FILE):
            print(f"Reading whitelist file: {WHITELIST_FILE}")
            with open(WHITELIST_FILE, "r") as f:
                content = f.read()
                
                if "," in content:
                    urls = content.split(",")
                else:
                    urls = content.splitlines()
                
                file_urls = {
                    url.strip()
                    for url in urls
                    if url.strip()
                }
                
                print(f"Found {len(file_urls)} URLs in whitelist file:")
                for url in file_urls:
                    print(f"  - {url}")
                
                updated_whitelist.update(file_urls)
                
                LOADED_WHITELIST_URLS = updated_whitelist
                print(f"Whitelist now contains {len(LOADED_WHITELIST_URLS)} URLs")
                print(f"Contents: {LOADED_WHITELIST_URLS}")
        else:
            print(f"WARNING: Whitelist file not found at {WHITELIST_FILE}")
    except Exception as e:
        print(f"Error reloading whitelist: {e}", file=sys.stderr)

def request(flow: http.HTTPFlow) -> None:
    """
    Allow whitelisted URLs and domains.
    Block unauthorized requests.
    """
    reload_whitelist()
    
    url = flow.request.pretty_url
    referer = flow.request.headers.get("Referer")

    if url in LOADED_WHITELIST_URLS:
        allowed_referers.add(url)  # Allow dependent resources from this page
        return

    if is_whitelisted_domain(url):
        return

    if referer and referer in allowed_referers:
        return

    flow.response = http.Response.make(
        403,  # Forbidden
        b"Access to url blocked by PIE.",
        {"Content-Type": "text/plain"}
    )

def response(flow: http.HTTPFlow) -> None:
    """
    Block redirects unless they point to an allowed URL or domain.
    """
    if flow.response.status_code in [301, 302, 303, 307, 308]:  # Redirects
        location = flow.response.headers.get("Location")
        if location:
            full_redirect_url = urljoin(flow.request.url, location)
            
            if full_redirect_url not in LOADED_WHITELIST_URLS and not is_whitelisted_domain(full_redirect_url):
                flow.response = http.Response.make(
                    403,
                    b"Access denied: Redirect to unauthorized URL.",
                    {"Content-Type": "text/plain"}
                )
                return
reload_whitelist()
