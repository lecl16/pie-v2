"""The exam device's filtering proxy (mitmproxy add-on, pie-proxy.service).

The exam host's web traffic is redirected here by the Pi's nftables rules
(transparent mode), so the filtering applies whatever system the laptop
boots, and the exam OS carries no rules of its own. The exam OS only trusts
this proxy's CA, which device_identity_server.py serves it.

Two jobs:
- the allowlist: pages that match the session's allowed links, and the
  files those pages load;
- the eLearning account: every eLearning page shows the logged-in user as
  "Name NMEC"; a page for an account other than the student the examiner
  assigned to this device is blocked.

Both come from FILTER_FILE, which device_identity_server.py writes from the
server's answer about the provisioned session.
"""

import html
import json
import os
import re
import sys
from urllib.parse import urljoin, urlsplit

from mitmproxy import http

# {"allowedLinks": [...], "nmec": "..."}; absent while the device has no
# session, and then only the University's login pages are allowed.
FILTER_FILE = "/etc/pie/filter.json"

# Hosts always allowed: UA's login (SSO) and its static files.
WHITELIST_HOSTS = {
    "idp.ua.pt",
    "static.ua.pt",
}

# The elearning login flow, always allowed. Moodle sends the student to
# Shibboleth's Login handler, which redirects to idp.ua.pt; the IdP posts
# the answer back to SAML2/POST. The whole handler path covers both.
MANUAL_WHITELIST_URLS = {
    "https://elearning.ua.pt/Shibboleth.sso/",
    "https://elearning.ua.pt/login/index.php",
    "https://elearning.ua.pt/auth/shibboleth/index.php",
}

# How an allowed entry matches a URL:
# - "https://www.sony.pt/" allows everything under that path (the whole site);
#   "https://docs.python.org/3/" only that part of it;
# - an entry with a query string ("…/mod/quiz/view.php?id=123") allows that
#   page only, so one quiz link doesn't open the other quizzes.
ALLOWED_ENTRIES = set()

# The NMEC of the student assigned to this device, or None without a session.
EXPECTED_NMEC = None

# Pages whose user menu is checked against EXPECTED_NMEC.
ELEARNING_HOSTS = {"elearning.ua.pt"}
# Moodle's user menu: <span class="usertext me-1">Name NMEC</span>.
USERTEXT = re.compile(r'<span class="usertext[^"]*">\s*([^<]*?)\s*</span>')
TRAILING_NUMBER = re.compile(r"(\d+)\s*$")

# Origins of the pages the student was allowed to open. Files those pages
# load (images, scripts, styles, fonts, XHR) are allowed from any host; the
# pages themselves (navigations) must match an entry.
allowed_page_origins = set()

# Origins of files let through for an allowed page (e.g. a CDN). Files they
# load in turn (fonts and images referenced by a CDN's stylesheet, whose
# Referer is that stylesheet) are allowed too. Pages on these hosts are not.
allowed_file_origins = set()

_filter_stat = ()  # never equal to a real stat, so the first call loads


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


def is_allowed_url(url, http_upgrade=False):
    normalized = normalize(url)
    if normalized is None:
        return False
    if urlsplit(normalized).hostname in WHITELIST_HOSTS:
        return True
    if any(entry_matches(entry, normalized) for entry in ALLOWED_ENTRIES):
        return True
    # Typing "www.sony.pt" makes Firefox ask for http:// first; let that
    # page through when its https:// address is allowed, so the site can
    # redirect to it.
    if http_upgrade and normalized.startswith("http://"):
        upgraded = "https://" + normalized[len("http://"):]
        return any(entry_matches(entry, upgraded) for entry in ALLOWED_ENTRIES)
    return False


def reload_filter():
    """Re-reads the file whenever it changes, so a session provisioned or
    ended applies to the very next request."""
    global _filter_stat, ALLOWED_ENTRIES, EXPECTED_NMEC
    try:
        stat = os.stat(FILTER_FILE)
        current = (stat.st_mtime_ns, stat.st_size)
    except OSError:
        current = None
    if current == _filter_stat:
        return
    _filter_stat = current

    entries = {normalize(url) for url in MANUAL_WHITELIST_URLS}
    nmec = None
    if current is not None:
        try:
            with open(FILTER_FILE, "r", encoding="utf-8") as f:
                content = json.load(f)
            for url in content.get("allowedLinks") or []:
                normalized = normalize(str(url))
                if normalized:
                    entries.add(normalized)
                elif str(url).strip():
                    print(f"Ignoring unusable allowlist entry: {str(url).strip()!r}")
            nmec = str(content.get("nmec") or "").strip() or None
        except Exception as e:
            print(f"Error reloading the filter: {e}", file=sys.stderr)
    ALLOWED_ENTRIES = entries
    EXPECTED_NMEC = nmec
    print(f"Filter: {len(ALLOWED_ENTRIES)} entries, assigned NMEC {EXPECTED_NMEC or '(none)'}")


def account_nmec(page_html):
    """The NMEC in an eLearning page's user menu, or None if the page shows
    no logged-in user."""
    match = USERTEXT.search(page_html)
    if not match:
        return None
    number = TRAILING_NUMBER.search(html.unescape(match.group(1)))
    return number.group(1) if number else ""


BLOCKED_ACCOUNT_PAGE = """<!doctype html><html lang="pt"><head><meta charset="utf-8">
<title>Conta não permitida</title></head><body style="font-family:sans-serif;margin:3em">
<h1>Conta não permitida</h1>
<p>Esta conta do eLearning não corresponde ao estudante atribuído a este dispositivo.</p>
<p>Termine a sessão no eLearning e chame o examinador.</p>
</body></html>"""


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
    reload_filter()

    url = flow.request.pretty_url

    if is_allowed_url(url, http_upgrade=is_navigation(flow)):
        if is_navigation(flow):
            allowed_page_origins.add(origin_of(url))
        else:
            allowed_file_origins.add(origin_of(url))
        return

    if not is_navigation(flow):
        referer = flow.request.headers.get("Referer")
        referer_origin = origin_of(referer) if referer else None
        if referer_origin and (
            referer_origin in allowed_page_origins or referer_origin in allowed_file_origins
        ):
            allowed_file_origins.add(origin_of(url))
            return

    if is_navigation(flow):
        print(f"Blocked page: {url}")
    flow.response = http.Response.make(
        403,  # Forbidden
        b"Access to url blocked by PIE.",
        {"Content-Type": "text/plain"}
    )


def response(flow: http.HTTPFlow) -> None:
    """
    Block a page redirecting to one that isn't allowed (the redirected
    request would be blocked anyway; this gives the clearer message), and
    an eLearning page logged in as someone other than the assigned student.
    """
    check_elearning_account(flow)
    if flow.response.status_code in [301, 302, 303, 307, 308] and is_navigation(flow):
        location = flow.response.headers.get("Location")
        if location:
            # pretty_url, not url: in transparent mode the request's host is
            # the server's IP, and a relative Location would resolve to it.
            full_redirect_url = urljoin(flow.request.pretty_url, location)

            if not is_allowed_url(full_redirect_url, http_upgrade=True):
                print(f"Blocked redirect: {flow.request.pretty_url} -> {full_redirect_url}")
                flow.response = http.Response.make(
                    403,
                    b"Access denied: Redirect to unauthorized URL.",
                    {"Content-Type": "text/plain"}
                )
                return

reload_filter()


def check_elearning_account(flow: http.HTTPFlow) -> None:
    host = (flow.request.pretty_host or "").lower()
    if host not in ELEARNING_HOSTS or EXPECTED_NMEC is None:
        return
    if not flow.response or "text/html" not in flow.response.headers.get("Content-Type", ""):
        return
    nmec = account_nmec(flow.response.get_text(strict=False) or "")
    if nmec is None or nmec == EXPECTED_NMEC:
        return
    print(f"Blocked eLearning page for account NMEC {nmec or '?'} (assigned: {EXPECTED_NMEC})")
    flow.response = http.Response.make(
        403,
        BLOCKED_ACCOUNT_PAGE.encode("utf-8"),
        {"Content-Type": "text/html; charset=utf-8"},
    )
