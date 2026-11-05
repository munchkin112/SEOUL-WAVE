from fastapi import APIRouter, HTTPException, Query

from app.repositories.timetable_repository import TimetableDataUnavailable
from app.schemas.timetable import TripQueryResponse
from app.services.timetable_service import (
    TimetableQueryError,
    list_trip_estimates_by_route,
)
from app.views.timetable_view import render_trip_query_response

router = APIRouter(prefix='/api', tags=['trips'])


@router.get('/trips', response_model=TripQueryResponse)
def list_trips(
    from_stop_id: str = Query(min_length=1, max_length=32),
    to_stop_id: str = Query(min_length=1, max_length=32),
) -> TripQueryResponse:
    try:
        snapshot, estimates = list_trip_estimates_by_route(from_stop_id, to_stop_id)
    except TimetableQueryError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={'code': error.error_code, 'message': error.message},
        ) from error
    except TimetableDataUnavailable as error:
        raise HTTPException(
            status_code=503,
            detail={'code': 'timetable_unavailable', 'message': str(error)},
        ) from error
    return render_trip_query_response(snapshot, estimates)
