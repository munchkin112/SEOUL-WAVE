import os
import secrets

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.controllers.auth_controller import router as auth_router
from app.controllers.stop_controller import router as stop_router
from app.controllers.trip_controller import router as trip_router
from app.security import require_authenticated_session

app = FastAPI(title='한강로컬패스 API')

app_environment = os.getenv('APP_ENV', 'development').lower()
session_secret = os.getenv('SESSION_SECRET', '')
if app_environment == 'production':
    if len(session_secret) < 32:
        raise RuntimeError('Production requires a SESSION_SECRET of at least 32 characters.')
elif not session_secret:
    session_secret = secrets.token_urlsafe(32)

secure_cookie_setting = os.getenv('SESSION_COOKIE_SECURE')
secure_cookie = (
    secure_cookie_setting.lower() in {'1', 'true', 'yes', 'on'}
    if secure_cookie_setting
    else app_environment == 'production'
)

app.add_middleware(
    SessionMiddleware,
    secret_key=session_secret,
    session_cookie='seoul_wave_session',
    max_age=60 * 60 * 8,
    same_site='lax',
    https_only=secure_cookie,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['GET', 'POST'],
    allow_headers=['*'],
    allow_credentials=True,
)

app.include_router(auth_router)
app.include_router(
    stop_router,
    dependencies=[Depends(require_authenticated_session)],
)
app.include_router(
    trip_router,
    dependencies=[Depends(require_authenticated_session)],
)


@app.get('/health')
def get_health_status() -> dict[str, str]:
    return {'status': 'ok'}
