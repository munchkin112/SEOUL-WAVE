from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.controllers.stop_controller import router as stop_router
from app.controllers.trip_controller import router as trip_router

app = FastAPI(title='한강로컬패스 API')

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173'],
    allow_methods=['GET'],
    allow_headers=['*'],
)

app.include_router(stop_router)
app.include_router(trip_router)


@app.get('/health')
def get_health_status() -> dict[str, str]:
    return {'status': 'ok'}
