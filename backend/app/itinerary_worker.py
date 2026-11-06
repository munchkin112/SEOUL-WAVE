import logging
import os
import re
import socket
import time
from datetime import date, datetime, time as local_time
from typing import Any
from zoneinfo import ZoneInfo

from app.agents.llm_client import create_openai_agent_models
from app.core.database import create_database_connection
from app.integrations.seoul_culture_api import fetch_event_page
from app.repositories.itinerary_repository import claim_next_execution
from app.repositories.critic_review_repository import save_critic_reviews
from app.repositories.timetable_repository import get_timetable_snapshot
from app.schemas.itinerary import (
    ItineraryItemResponse,
    ItineraryResponse,
    LocationResponse,
    SourceReference,
    StopReference,
)
from app.services.itinerary_agent_service import run_itinerary_agent_flow
from app.services.itinerary_request_service import (
    finish_execution_as_failed,
    finish_execution_as_no_result,
    finish_execution_with_itinerary,
)
from app.services.timetable_service import get_departure_estimate


POLL_INTERVAL_SECONDS = 1.0
WORKER_ID = f"{socket.gethostname()}-itinerary"
LOGGER = logging.getLogger("itinerary_worker")
SEOUL_TIMEZONE = ZoneInfo("Asia/Seoul")
API_PAGE_SIZE = 1000


def process_next_execution() -> bool:
    with create_database_connection() as connection:
        execution = claim_next_execution(connection, WORKER_ID)
    if execution is None:
        return False

    processing_stage = "timetable_lookup"
    try:
        timetable, trip = get_departure_estimate(
            execution["origin_stop_id"],
            execution["destination_stop_id"],
            execution["service_date"],
            execution["preferred_departure_time"],
        )
        processing_stage = "culture_api_lookup"
        events = fetch_events_for_date(execution["service_date"])
        events, filter_metadata = filter_event_rows_for_destination(
            events,
            execution["destination_stop_id"],
        )
        if not events:
            with create_database_connection() as connection:
                finish_execution_as_no_result(
                    connection,
                    execution["run_id"],
                    "NO_EVENTS_ON_SELECTED_DATE",
                    "선택한 날짜에 진행하는 전시·공연 행사를 찾지 못했습니다. 날짜를 바꿔 다시 시도해 주세요.",
                )
            return True

        processing_stage = "candidate_validation"
        candidates = build_candidates(events, execution["service_date"])
        trip_context = build_trip_context(
            execution,
            timetable,
            trip,
            destination_filter=filter_metadata,
        )
        candidates = filter_candidates_after_arrival(candidates, trip.estimated_arrival_time)
        if not candidates:
            with create_database_connection() as connection:
                finish_execution_as_no_result(
                    connection,
                    execution["run_id"],
                    "NO_EVENTS_AFTER_ARRIVAL",
                    "도착 예정 시각 이후 시작하는 행사 정보를 찾지 못했습니다.",
                )
            return True
        processing_stage = "llm_configuration"
        models = create_openai_agent_models()
        processing_stage = "langgraph_execution"
        with create_database_connection() as connection:
            agent_result = run_itinerary_agent_flow(
                connection,
                models,
                trip_context,
                candidates,
                run_id=execution["run_id"],
            )
            save_critic_reviews(
                connection,
                execution["run_id"],
                agent_result.get("critic_reviews", []),
            )
        processing_stage = "itinerary_persistence"
        final_result = agent_result["final_result"]
        if final_result.get("result_type") != "eligible_candidates":
            with create_database_connection() as connection:
                finish_execution_as_no_result(
                    connection,
                    execution["run_id"],
                    "NO_MATCHING_ITINERARY",
                    "조건에 맞는 행사를 코스로 구성하지 못했습니다. 날짜나 조건을 바꿔 다시 시도해 주세요.",
                )
            return True

        itinerary = build_itinerary(execution, timetable, trip, final_result, candidates)
        snapshot = {
            "service_date": execution["service_date"].isoformat(),
            "timetable_dataset_id": timetable.dataset_id,
            "timetable_source_url": timetable.source_url,
            "timetable_assumption": "published departure schedule is reused every calendar day; operation is not confirmed",
            "event_source": "Seoul Open API aiViewCulture",
            "event_candidates": candidates,
            "destination_filter": filter_metadata,
        }
        with create_database_connection() as connection:
            finish_execution_with_itinerary(connection, execution, itinerary, snapshot)
    except Exception as error:
        error_code = getattr(error, "error_code", None) or "ITINERARY_GENERATION_FAILED"
        safe_message = (
            "행사 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            if error_code.startswith("culture_api")
            else "코스를 생성하지 못했습니다. 조건을 확인하고 다시 시도해 주세요."
        )
        with create_database_connection() as connection:
            finish_execution_as_failed(
                connection,
                execution["run_id"],
                error_code.upper(),
                safe_message,
                retryable=error_code.startswith("culture_api") or error_code == "ITINERARY_GENERATION_FAILED",
            )
        LOGGER.warning(
            "Itinerary run %s failed with %s (%s).",
            execution["run_id"],
            error_code,
            f"{processing_stage}:{type(error).__name__}",
        )
    return True


def fetch_events_for_date(service_date: date) -> list[dict[str, Any]]:
    api_key = os.environ.get("SEOUL_CULTURE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("culture_api_not_configured")
    total_count, rows = fetch_event_page(api_key, 1, API_PAGE_SIZE)
    collected_rows = list(rows)
    while len(collected_rows) < total_count:
        start_index = len(collected_rows) + 1
        _, page_rows = fetch_event_page(
            api_key,
            start_index,
            min(start_index + API_PAGE_SIZE - 1, total_count),
        )
        if not page_rows:
            raise RuntimeError("culture_api_incomplete_response")
        collected_rows.extend(page_rows)
    return [row for row in collected_rows if event_matches_date(row, service_date)]


def event_matches_date(row: dict[str, Any], service_date: date) -> bool:
    start_date = parse_api_date(row.get("STRTDATE"))
    end_date = parse_api_date(row.get("END_DATE"))
    if start_date is None or end_date is None:
        return False
    # Drop malformed/open-ended API records (the live feed currently includes
    # spans such as 2026–2626 and 2023–2099) rather than treating them as valid
    # events for every selectable date. This is a conservative service rule.
    if end_date < start_date or (end_date - start_date).days > 730:
        return False
    return start_date <= service_date <= end_date


def parse_api_date(value: Any) -> date | None:
    if value is None:
        return None
    normalized = str(value).strip()
    for date_format in ("%Y-%m-%d", "%Y.%m.%d", "%Y/%m/%d"):
        try:
            return datetime.strptime(normalized[:10], date_format).date()
        except ValueError:
            continue
    return None


def build_candidates(rows: list[dict[str, Any]], service_date: date) -> list[dict[str, Any]]:
    candidates = []
    for index, row in enumerate(rows):
        title = str(row.get("TITLE") or "").strip()
        detail_url = str(row.get("HMPG_ADDR") or row.get("ORG_LINK") or "").strip()
        if not title or not detail_url:
            continue
        # These IDs are request-local references, not official Seoul event IDs.
        event_id = f"candidate-{index + 1}"
        event_start_time, event_end_time = parse_event_time_window(
            row.get("PRO_TIME"),
            service_date,
        )
        candidates.append({
            "event_id": event_id,
            "title": title,
            "place": str(row.get("PLACE") or "").strip() or None,
            "category": str(row.get("CODENAME") or "").strip() or None,
            "start_date": str(row.get("STRTDATE") or ""),
            "end_date": str(row.get("END_DATE") or ""),
            "event_date_text": str(row.get("DATE") or ""),
            "program_time_text": str(row.get("PRO_TIME") or "").strip() or None,
            "event_start_time": event_start_time,
            "event_end_time": event_end_time,
            "event_time_status": (
                "parsed_for_service_date"
                if event_start_time is not None
                else "unknown_or_ambiguous"
            ),
            "event_is_active_on_service_date": True,
            "date_evidence": [
                f"STRTDATE:{row.get('STRTDATE')}",
                f"END_DATE:{row.get('END_DATE')}",
            ],
            "detail_url": detail_url,
            "latitude": parse_coordinate(row.get("LAT"), -90, 90),
            "longitude": parse_coordinate(row.get("LOT"), -180, 180),
            "review_status": "verified",
            "eligibility_status": "POSSIBLE",
            "evidence_ids": [f"culture-api:{event_id}"],
        })
        if len(candidates) >= 20:
            break
    return candidates


def parse_event_time_window(
    value: Any,
    service_date: date,
) -> tuple[str | None, str | None]:
    """Parse only an unambiguous time from the API's free-form PRO_TIME field."""
    if value is None:
        return None, None
    text = str(value).strip()
    if not text:
        return None, None

    time_pattern = r"(?P<hour>\d{1,2}):(?P<minute>\d{2})"
    date_marker = rf"{service_date.month}\s*[.]\s*{service_date.day}"
    date_match = re.search(
        rf"{date_marker}[^0-9]{{0,12}}(?P<start>\d{{1,2}}:\d{{2}})"
        rf"(?:\s*[~-]\s*(?P<end>\d{{1,2}}:\d{{2}}))?",
        text,
    )
    if date_match:
        return date_match.group("start"), date_match.group("end")

    # A single time without a date is safe to reuse for the selected date.
    matches = list(re.finditer(time_pattern, text))
    if len(matches) != 1:
        return None, None
    start = matches[0].group(0)
    tail = text[matches[0].end():]
    end_match = re.match(r"\s*[~-]\s*(\d{1,2}:\d{2})", tail)
    return start, end_match.group(1) if end_match else None


def filter_candidates_after_arrival(
    candidates: list[dict[str, Any]],
    estimated_arrival_time: str,
) -> list[dict[str, Any]]:
    try:
        arrival = local_time.fromisoformat(estimated_arrival_time)
    except ValueError:
        return []
    return [
        candidate for candidate in candidates
        if candidate.get("event_start_time")
        and local_time.fromisoformat(candidate["event_start_time"]) >= arrival
    ]


def filter_event_rows_for_destination(
    rows: list[dict[str, Any]],
    destination_stop_id: str,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Use straight-line distance only when verified stop coordinates are supplied."""
    import json
    import math

    raw_coordinates = os.environ.get("FERRY_STOP_COORDINATES_JSON", "").strip()
    if not raw_coordinates:
        return (
            [row for row in rows
             if parse_coordinate(row.get("LAT"), -90, 90) is not None
             and parse_coordinate(row.get("LOT"), -180, 180) is not None],
            {
                "status": "not_applied_missing_destination_stop_coordinates",
                "destination_stop_id": destination_stop_id,
            },
        )
    try:
        coordinates = json.loads(raw_coordinates)
        latitude, longitude = coordinates[destination_stop_id.upper()]
        latitude = float(latitude)
        longitude = float(longitude)
        radius_km = float(os.environ.get("EVENT_DESTINATION_RADIUS_KM", "5"))
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return [], {
            "status": "failed_invalid_destination_stop_coordinates",
            "destination_stop_id": destination_stop_id,
        }

    def distance_km(row: dict[str, Any]) -> float | None:
        event_lat = parse_coordinate(row.get("LAT"), -90, 90)
        event_lon = parse_coordinate(row.get("LOT"), -180, 180)
        if event_lat is None or event_lon is None:
            return None
        lat_delta = math.radians(event_lat - latitude)
        lon_delta = math.radians(event_lon - longitude)
        root = (math.sin(lat_delta / 2) ** 2
                + math.cos(math.radians(latitude))
                * math.cos(math.radians(event_lat))
                * math.sin(lon_delta / 2) ** 2)
        return 6371 * 2 * math.asin(math.sqrt(root))

    filtered = []
    for row in rows:
        distance = distance_km(row)
        if distance is not None and distance <= radius_km:
            filtered.append(row)
    return filtered, {
        "status": "applied_straight_line_distance",
        "destination_stop_id": destination_stop_id,
        "radius_km": radius_km,
    }


def parse_coordinate(value: Any, minimum: float, maximum: float) -> float | None:
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if minimum <= coordinate <= maximum else None


def build_trip_context(
    execution: dict[str, Any],
    timetable: Any,
    trip: Any,
    destination_filter: dict[str, Any] | None = None,
) -> dict[str, Any]:
    stops = {stop.stop_id: stop for stop in timetable.stops}
    destination_filter = destination_filter or {}
    destination_relevance = (
        "verified"
        if destination_filter.get("status") == "applied_straight_line_distance"
        else "unknown"
    )
    return {
        "from_stop_id": trip.from_stop_id,
        "to_stop_id": trip.to_stop_id,
        "from_stop_name": stops[trip.from_stop_id].name_ko,
        "to_stop_name": stops[trip.to_stop_id].name_ko,
        "service_date": execution["service_date"].isoformat(),
        "departure_time": trip.departure_time,
        "requested_departure_time": execution["preferred_departure_time"].strftime("%H:%M"),
        "estimated_arrival_time": trip.estimated_arrival_time,
        "travel_minutes": trip.travel_minutes,
        "arrival_time_source": "calculated",
        "verification_status": "estimated_daily_schedule",
        "operating_days_status": timetable.operating_days_status,
        "destination_relevance": destination_relevance,
        "destination_evidence": (
            [
                "destination_filter:straight_line_distance",
                f"destination_radius_km:{destination_filter.get('radius_km')}",
            ]
            if destination_relevance == "verified"
            else []
        ),
        "evidence_ids": [f"timetable:{timetable.dataset_id}"],
        "companion_type": execution["companion_type"],
        "activity_type": execution["activity_type"],
    }


def build_itinerary(
    execution: dict[str, Any], timetable: Any, trip: Any,
    final_result: dict[str, Any], candidates: list[dict[str, Any]],
) -> ItineraryResponse:
    recommended = final_result["recommendations"][0]
    event = next(item for item in candidates if item["event_id"] == recommended["event_id"])
    stops = {stop.stop_id: stop for stop in timetable.stops}
    service_date = execution["service_date"]
    departure = datetime.combine(service_date, local_time.fromisoformat(trip.departure_time), SEOUL_TIMEZONE)
    arrival = datetime.combine(service_date, local_time.fromisoformat(trip.estimated_arrival_time), SEOUL_TIMEZONE)
    ferry = ItineraryItemResponse(
        sequence_no=1, item_type="FERRY", title=f"{stops[trip.from_stop_id].name_ko}에서 {stops[trip.to_stop_id].name_ko}로 이동",
        start_at=departure, end_at=arrival,
        reason="공식 시간표의 출발 시각과 구간 소요시간으로 계산한 예상 이동입니다. 실제 운항 여부는 별도 공지를 확인해 주세요.",
        sources=[SourceReference(type="TIMETABLE", title="한강버스 공식 시간표", url=timetable.source_url)],
        location=None, place_name=None, address=None,
        departure_stop=StopReference(stop_id=trip.from_stop_id, name=stops[trip.from_stop_id].name_ko),
        arrival_stop=StopReference(stop_id=trip.to_stop_id, name=stops[trip.to_stop_id].name_ko),
    )
    event_start = (
        datetime.combine(service_date, local_time.fromisoformat(event["event_start_time"]), SEOUL_TIMEZONE)
        if event.get("event_start_time") else None
    )
    event_end = (
        datetime.combine(service_date, local_time.fromisoformat(event["event_end_time"]), SEOUL_TIMEZONE)
        if event.get("event_end_time") else None
    )
    event_item = ItineraryItemResponse(
        sequence_no=2, item_type="EVENT", title=event["title"],
        start_at=event_start, end_at=event_end, reason=recommended["reason"],
        sources=[SourceReference(type="CULTURE_EVENT", title=event["title"], url=event["detail_url"])],
        location=(LocationResponse(latitude=event["latitude"], longitude=event["longitude"])
                  if event["latitude"] is not None and event["longitude"] is not None else None),
        place_name=event["place"], address=None, departure_stop=None, arrival_stop=None,
    )
    return ItineraryResponse(id=execution["run_id"], title=f"{stops[trip.from_stop_id].name_ko} 출발 전시·공연 나들이", items=[ferry, event_item])


def run_worker() -> None:
    logging.basicConfig(level=logging.INFO)
    LOGGER.info("Itinerary worker started.")
    while True:
        try:
            if not process_next_execution():
                time.sleep(POLL_INTERVAL_SECONDS)
        except Exception:
            LOGGER.error("Itinerary worker could not process its queue. Retrying.")
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    run_worker()
