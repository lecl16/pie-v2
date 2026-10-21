from mitmproxy import http
from urllib.parse import urlsplit, urljoin
import os
import sys

# Written by DevApp-main when the student joins: the exam link (if the exam
# is a link) and the session's allowed links, comma-separated.
WHITELIST_FILE = "/etc/iptables/whitelist.txt"
print(f"Using whitelist file at: {WHITELIST_FILE}")

# Hosts always allowed: UA's login (SSO) and its static files.
WHITELIST_HOSTS = {
    "idp.ua.pt",
    "static.ua.pt",
}

# The elearning login flow, always allowed.
MANUAL_WHITELIST_URLS = {
    "https://elearning.ua.pt/Shibboleth.sso/SAML2/POST",
    "https://elearning.ua.pt/login/index.php",
    "https://elearning.ua.pt/auth/shibboleth/index.php",
}

# How an allowed entry matches a URL:
# - "https://www.sony.pt/" allows everything under that path (the whole site);
#   "https://docs.python.org/3/" only that part of it;
# - an entry with a query string ("…/mod/quiz/view.php?id=123") allows that
#   page only, so one quiz link doesn't open the other quizzes.
ALLOWED_ENTRIES = set()

# Origins of the pages the student was allowed to open. Files those pages
# load (images, scripts, styles, fonts, XHR) are allowed from any host; the
# pages themselves (navigations) must match an entry.
allowed_page_origins = set()

_whitelist_stat = None


def normalize(url, default_scheme="https"):
    """scheme://host[:port]/path[?query], host lowercased; None if unusable."""
    url = url.strip()
    if not url:
        return None
    if "://" not in url:
        url = f"{default_scheme}://{url}"
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    host = parts.hostname.lower()
    if parts.port:
        host = f"{host}:{parts.port}"
    normalized = f"{parts.scheme}://{host}{parts.path or '/'}"
    if parts.query:
        normalized += f"?{parts.query}"
    return normalized


def origin_of(url):
    parts = urlsplit(url)
    if not parts.hostname:
        return None
    host = parts.hostname.lower()
    if parts.port:
        host = f"{host}:{parts.port}"
    return f"{parts.scheme}://{host}"


def entry_matches(entry, url):
    if "?" in entry:
        return url == entry
    if not url.startswith(entry):
        return False
    # ".../pt" must not match ".../ptx"
    rest = url[len(entry):]
    return entry.endswith("/") or rest == "" or rest[0] in "/?#"


def is_allowed_url(url):
    normalized = normalize(url)
    if normalized is None:
        return False
    if urlsplit(normalized).hostname in WHITELIST_HOSTS:
        return True
    return any(entry_matches(entry, normalized) for entry in ALLOWED_ENTRIES)


def reload_whitelist():
    """Re-reads the file whenever it changes, so links written when the
    student joins apply to the very next request."""
    global _whitelist_stat, ALLOWED_ENTRIES
    try:
        stat = os.stat(WHITELIST_FILE)
        current = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        current = None
    if current == _whitelist_stat:
        return
    _whitelist_stat = current

    entries = {normalize(url) for url in MANUAL_WHITELIST_URLS}
    if current is not None:
        try:
            with open(WHITELIST_FILE, "r") as f:
                content = f.read()
            for url in content.replace("\n", ",").split(","):
                normalized = normalize(url)
                if normalized:
                    entries.add(normalized)
                elif url.strip():
                    print(f"Ignoring unusable whitelist entry: {url.strip()!r}")
        except Exception as e:
            print(f"Error reloading whitelist: {e}", file=sys.stderr)
    else:
        print(f"WARNING: Whitelist file not found at {WHITELIST_FILE}")
    ALLOWED_ENTRIES = entries
    print(f"Whitelist now contains {len(ALLOWED_ENTRIES)} entries: {sorted(ALLOWED_ENTRIES)}")


def is_navigation(flow):
    """A page the student opens (address bar, link, form, redirect, frame),
    as opposed to a file a page loads. Requests without Firefox's
    Sec-Fetch-Mode header are treated as navigations, the strict case."""
    mode = flow.request.headers.get("Sec-Fetch-Mode")
    return mode is None or mode == "navigate"


def request(flow: http.HTTPFlow) -> None:
    """
    Allow pages that match the whitelist, and the files those pages load.
    Block everything else.
    """
    reload_whitelist()

    url = flow.request.pretty_url

    if is_allowed_url(url):
        if is_navigation(flow):
            allowed_page_origins.add(origin_of(url))
        return

    if not is_navigation(flow):
        referer = flow.request.headers.get("Referer")
        if referer and origin_of(referer) in allowed_page_origins:
            return

    flow.response = http.Response.make(
        403,  # Forbidden
        b"Access to url blocked by PIE.",
        {"Content-Type": "text/plain"}
    )


def response(flow: http.HTTPFlow) -> None:
    """
    Block a page redirecting to one that isn't allowed. (The redirected
    request would be blocked anyway; this gives the clearer message.)
    """
    if flow.response.status_code in [301, 302, 303, 307, 308] and is_navigation(flow):
        location = flow.response.headers.get("Location")
        if location:
            full_redirect_url = urljoin(flow.request.url, location)

            if not is_allowed_url(full_redirect_url):
                flow.response = http.Response.make(
                    403,
                    b"Access denied: Redirect to unauthorized URL.",
                    {"Content-Type": "text/plain"}
                )
                return

reload_whitelist()
