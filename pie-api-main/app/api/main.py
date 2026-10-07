import fastapi
from app.core.database import init_db
from app.api.routes.pie import router as pie_router
from app.api.routes.course import router as course_router
from app.api.routes.exam import router as exam_router
from app.api.routes.user import router as user_router
from app.api.routes.session import router as session_router
from app.api.routes.session_user import router as session_user_router
from app.api.routes.submission import router as submission_router
from app.api.routes.device import router as device_router
from app.api.routes.logs import router as logs_router
from app.api.routes.screenshare import router as screenshare_router
from app.api.routes.analytics import router as analytics_router
from app.services.pubsub_service import redis_pubsub
from starlette.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from app.services.elasticsearch_service import elasticsearch_service
from app.services.streams_service import log_service
from app.core.auth import get_current_user, get_teacher_or_admin_user, get_admin_user
from fastapi import Depends
from fastapi.responses import RedirectResponse

app = fastapi.FastAPI(title="PIE API")

# Create a public router for login endpoint
public_user_router = fastapi.APIRouter()

# Include only login route from user_router
for route in user_router.routes:
    if route.path == "/login":
        public_user_router.routes.append(route)

# Add public router without authentication
app.include_router(
    public_user_router,
    prefix="/users",
    tags=["users"]
)

# Create admin-only user router for /create endpoint
admin_user_router = fastapi.APIRouter()
for route in user_router.routes:
    if route.path == "/create":
        admin_user_router.routes.append(route)

# Add admin-only user router with admin authentication
app.include_router(
    admin_user_router,
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(get_admin_user)]
)

# Create protected user router without login and create routes
protected_user_router = fastapi.APIRouter()
for route in user_router.routes:
    if route.path != "/login" and route.path != "/create":
        protected_user_router.routes.append(route)

# Add protected user router with authentication
app.include_router(
    protected_user_router,
    prefix="/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)]
)

# Include the /pie services routes
app.include_router(pie_router, tags=["pie"], dependencies=[Depends(get_current_user)])
# Include the routers for the different resources
app.include_router(course_router, prefix="/course", tags=["course"], dependencies=[Depends(get_teacher_or_admin_user)])
app.include_router(exam_router, prefix="/course/{course_id}", tags=["exam"], dependencies=[Depends(get_teacher_or_admin_user)])
app.include_router(session_router, prefix="/course/{course_id}/{exam_id}", tags=["session"], dependencies=[Depends(get_current_user)])
app.include_router(session_user_router, prefix="/session-users", tags=["session-users"], dependencies=[Depends(get_current_user)])
app.include_router(submission_router, prefix="/submission", tags=["submission"], dependencies=[Depends(get_current_user)])

# Create teacher/admin-only device router for the routes that mint or
# revoke device API-key credentials, or destroy a device's identity outright
# — none of these can stay open to any authenticated user. Matched by
# (path, method) rather than path alone, since DELETE /{device_id} shares
# its path with the GET/PUT routes that are intentionally left at the
# broader get_current_user level below.
TEACHER_ONLY_DEVICE_ROUTES = {
    ("/create", "POST"),
    ("/{device_id}/rotate-key", "POST"),
    ("/{device_id}", "DELETE"),
}

def _device_route_matches(route, wanted_path_methods) -> bool:
    return any((route.path, method) in wanted_path_methods for method in route.methods)

teacher_device_router = fastapi.APIRouter()
for route in device_router.routes:
    if _device_route_matches(route, TEACHER_ONLY_DEVICE_ROUTES):
        teacher_device_router.routes.append(route)

app.include_router(
    teacher_device_router,
    prefix="/device",
    tags=["device"],
    dependencies=[Depends(get_teacher_or_admin_user)]
)

# Routes called by the exam device itself, which has no JWT to satisfy
# get_current_user — mounted with no router-level auth dependency. Each one
# authenticates in its own body (the confirm route checks an HMAC proof of
# the session's provisioning secret, see docs/examiner-trusted-node-provisioning.md;
# the status route takes the device's X-Device-Key).
DEVICE_SELF_AUTH_PATHS = {
    "/{device_id}/provisioning-secret/{session_id}/confirm",
    "/{device_id}/session/{session_id}/status",  # X-Device-Key (get_device)
}
device_self_auth_router = fastapi.APIRouter()
for route in device_router.routes:
    if route.path in DEVICE_SELF_AUTH_PATHS:
        device_self_auth_router.routes.append(route)

app.include_router(device_self_auth_router, prefix="/device", tags=["device"])

# Create protected device router without the teacher-only routes or the
# device-self-authenticated routes above
protected_device_router = fastapi.APIRouter()
for route in device_router.routes:
    if (
        not _device_route_matches(route, TEACHER_ONLY_DEVICE_ROUTES)
        and route.path not in DEVICE_SELF_AUTH_PATHS
    ):
        protected_device_router.routes.append(route)

app.include_router(protected_device_router, prefix="/device", tags=["device"], dependencies=[Depends(get_current_user)])
app.include_router(screenshare_router, prefix="/screenshare", tags=["screenshare"])
app.include_router(logs_router, prefix="/logs", tags=["logs"], dependencies=[Depends(get_current_user)])
app.include_router(analytics_router, prefix="/analytics", tags=["analytics"], dependencies=[Depends(get_teacher_or_admin_user)])

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_event():
    """Connect to Redis when the app starts."""
    await run_in_threadpool(init_db)
    await redis_pubsub.connect()
    await elasticsearch_service.connect()
    await log_service.connect(elasticsearch_service)

@app.on_event("shutdown")
async def shutdown_event():
    """Close Redis connection on shutdown."""
    await redis_pubsub.redis.close()

@app.get("/")
def read_root():
    return RedirectResponse(url="/docs")

@app.middleware("http")
async def add_security_headers(request: fastapi.Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response
