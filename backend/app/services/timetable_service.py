from app.models.timetable import Stop, TimetableSnapshot, TripEstimate
from app.repositories.timetable_repository import get_timetable_snapshot


class TimetableQueryError(Exception):
    def __init__(self, status_code: int, error_code: str, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.error_code = error_code
        self.message = message


def list_stops() -> tuple[TimetableSnapshot, tuple[Stop, ...]]:
    snapshot = get_timetable_snapshot()
    return snapshot, tuple(sorted(snapshot.stops, key=lambda stop: stop.display_order))


def list_trip_estimates_by_route(
    from_stop_id: str,
    to_stop_id: str,
) -> tuple[TimetableSnapshot, tuple[TripEstimate, ...]]:
    snapshot = get_timetable_snapshot()
    normalized_from_stop_id = from_stop_id.strip().upper()
    normalized_to_stop_id = to_stop_id.strip().upper()
    stop_ids = {stop.stop_id for stop in snapshot.stops}

    if normalized_from_stop_id not in stop_ids:
        raise TimetableQueryError(404, 'stop_not_found', '출발 선착장을 찾을 수 없습니다.')
    if normalized_to_stop_id not in stop_ids:
        raise TimetableQueryError(404, 'stop_not_found', '도착 선착장을 찾을 수 없습니다.')
    if normalized_from_stop_id == normalized_to_stop_id:
        raise TimetableQueryError(422, 'same_stop', '출발지와 도착지는 서로 달라야 합니다.')

    estimates = tuple(
        sorted(
            (
                estimate
                for estimate in snapshot.trip_estimates
                if estimate.from_stop_id == normalized_from_stop_id
                and estimate.to_stop_id == normalized_to_stop_id
            ),
            key=lambda estimate: estimate.departure_time,
        )
    )
    if not estimates:
        raise TimetableQueryError(
            404,
            'route_not_in_timetable',
            '해당 출발·도착 조합은 현재 시간표 데이터에 없습니다.',
        )

    return snapshot, estimates
