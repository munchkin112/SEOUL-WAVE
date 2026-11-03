"""Transcribe the published table, compare it with OCR, and estimate arrivals.

Run from any directory: python scripts/prepare_timetable.py
Uses data/source inputs and writes data/timetable.json and its validation report.
No directories are created. This regenerates the reviewed manual transcription
of this source image; it is not an automatic extractor for new timetables.
Arrival estimates use the selected origin departure plus the sum of diagram
durations. They do not join departures at different stops into a shared trip.
"""

from __future__ import annotations

import hashlib
import json
import re
from datetime import date
from pathlib import Path



ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data"
WORK = OUT / "source"
SOURCE_FILE = WORK / "timetable_source_20260815.jpg"
DATA_FILE = OUT / "timetable.json"
REPORT_FILE = OUT / "timetable_validation.json"
REVIEW_DATE = "2026-11-03"
PAGE_URL = "https://www.hgbus.co.kr/itc/information/schedule?menuId=5"
IMAGE_URL = "https://www.hgbus.co.kr/images/sub/information/schedule_img4_v260815.jpg"


# These values were transcribed by visually reading the original image.
# Positions 1..12 are SOURCE TABLE rows, not trips or connections.
SOURCE_COLUMNS = [
    ("MAGOK", "여의도행", "departure", "YEOUIDO", 63.5,
     "11:20 12:20 13:20 14:20 15:00 15:30 16:00 17:00 17:40 18:40 - -"),
    ("MAGOK", "도착", "arrival", None, 143.5,
     "12:53 13:53 14:53 15:53 - - 17:33 18:33 19:13 20:13 21:09 21:39"),
    ("MANGWON", "여의도행", "departure", "YEOUIDO", 243.5,
     "11:42 12:42 13:42 14:42 15:22 15:52 16:22 17:22 18:02 19:02 - -"),
    ("MANGWON", "마곡행", "departure", "MAGOK", 323.5,
     "12:34 13:34 14:34 15:34 - - 17:14 18:14 18:54 19:54 20:48 21:18"),
    ("YEOUIDO", "마곡행", "departure", "MAGOK", 423.5,
     "12:12 13:12 14:12 15:12 - - 16:52 17:52 18:32 19:32 20:25 20:55"),
    ("YEOUIDO", "잠실행", "departure", "JAMSIL", 503.5,
     "12:38 13:35 14:40 15:40 16:00 16:30 17:08 18:05 19:05 20:05 - -"),
    ("APGUJEONG", "여의도행", "departure", "YEOUIDO", 603.5,
     "- 12:55 - 14:55 - - - 17:25 - 19:25 - 20:15"),
    ("APGUJEONG", "잠실행", "departure", "JAMSIL", 683.5,
     "- 14:07 - 16:12 - 17:02 - 18:37 - 20:37 - -"),
    ("OKSU", "여의도행", "departure", "YEOUIDO", 793.0,
     "11:52 - 13:52 - - - 16:22 - 18:22 - 19:42 -"),
    ("OKSU", "잠실행", "departure", "JAMSIL", 873.0,
     "13:13 - 15:15 - 16:35 - 17:43 - 19:40 - - -"),
    ("SEOUL_FOREST", "여의도행", "departure", "YEOUIDO", 982.0,
     "11:35 12:35 13:35 14:35 - - 16:05 17:05 18:05 19:05 19:25 19:55"),
    ("SEOUL_FOREST", "잠실행", "departure", "JAMSIL", 1062.0,
     "13:31 14:28 15:33 16:33 16:53 17:23 18:01 18:58 19:58 20:58 - -"),
    ("TTUKSEOM", "여의도행", "departure", "YEOUIDO", 1170.0,
     "11:17 12:17 13:17 14:17 - - 15:47 16:47 17:47 18:47 19:07 19:37"),
    ("TTUKSEOM", "잠실행", "departure", "JAMSIL", 1250.0,
     "13:49 14:46 15:51 16:51 17:11 17:41 18:19 19:16 20:16 21:16 - -"),
    ("JAMSIL", "여의도행", "departure", "YEOUIDO", 1350.0,
     "11:00 12:00 13:00 14:00 - - 15:30 16:30 17:30 18:30 18:50 19:20"),
    ("JAMSIL", "도착", "arrival", None, 1430.0,
     "14:03 15:00 16:05 17:05 17:25 17:55 18:33 19:30 20:30 21:30 - -"),
]

STOP_NAMES = [
    ("MAGOK", "마곡"),
    ("MANGWON", "망원"),
    ("YEOUIDO", "여의도"),
    ("APGUJEONG", "압구정"),
    ("OKSU", "옥수"),
    ("SEOUL_FOREST", "서울숲"),
    ("TTUKSEOM", "뚝섬"),
    ("JAMSIL", "잠실"),
]


def column_id(stop_id: str, kind: str, direction: str | None) -> str:
    return f"{stop_id}_TO_{direction}" if kind == "departure" else f"{stop_id}_ARRIVAL"


def normalize_ocr_time(raw: str) -> str | None:
    # OCR sometimes recognizes the colon as a dot or bullet, or omits it.
    # No digit substitutions or expected-value-based correction are performed.
    digits = re.sub(r"[^0-9]", "", raw)
    if len(digits) != 4:
        return None
    value = f"{digits[:2]}:{digits[2:]}"
    return value if re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", value) else None


def add_minutes(departure_time: str, travel_minutes: int) -> tuple[str, int]:
    """Return local clock time and days after the departure's service date."""
    if not re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", departure_time):
        raise ValueError(f"Invalid departure time: {departure_time}")
    if type(travel_minutes) is not int or travel_minutes < 0:
        raise ValueError("Travel minutes must be a nonnegative integer.")
    hours, minutes = map(int, departure_time.split(":"))
    days, minute_of_day = divmod(hours * 60 + minutes + travel_minutes, 24 * 60)
    hour, minute = divmod(minute_of_day, 60)
    return f"{hour:02d}:{minute:02d}", days


def build_arrival_estimates(dataset: dict) -> list[dict]:
    """Build nominal estimates without inferring shared trips or stop calls.

    The source heading limits each departure's direction and terminal. The
    diagram span is a distance/time annotation span, not a list of boat calls.
    Its minute labels are reused in both directions as an estimation assumption.
    """
    stop_ids = [stop["stop_id"] for stop in dataset["stops"]]
    stop_positions = {stop_id: index for index, stop_id in enumerate(stop_ids)}
    labels = dataset["source_diagram"]["adjacent_segment_labels"]
    duration_by_span = {}
    for label in labels:
        a = stop_positions[label["from_stop_id"]]
        b = stop_positions[label["to_stop_id"]]
        duration = label["displayed_minutes"]
        if b != a + 1 or type(duration) is not int or duration <= 0:
            raise ValueError(f"Invalid adjacent diagram duration: {label}")
        if a in duration_by_span:
            raise ValueError("Duplicate diagram span.")
        duration_by_span[a] = duration
    if set(duration_by_span) != set(range(len(stop_ids) - 1)):
        raise ValueError("Missing diagram duration; do not invent travel minutes.")

    restriction = dataset["source_diagram"]["direct_service_restriction"]
    excluded_pair = frozenset(restriction["stop_ids"])
    results = []
    for stop in dataset["stops"]:
        origin = stop["stop_id"]
        origin_index = stop_positions[origin]
        for column in stop["columns"]:
            if column["event_type"] != "departure":
                continue
            terminal = column["direction_to_stop_id"]
            terminal_index = stop_positions[terminal]
            if terminal_index == origin_index:
                raise ValueError("A departure heading must name another terminal.")
            step = 1 if terminal_index > origin_index else -1
            destinations = []
            accumulated_minutes = 0
            span = [origin]
            for index in range(origin_index + step, terminal_index + step, step):
                accumulated_minutes += duration_by_span[min(index, index - step)]
                destination = stop_ids[index]
                span.append(destination)
                # No Oksu <-> Apgujeong direct trip is offered, even though the
                # source has a 9-minute diagram annotation between these stops.
                if not restriction["direct_service_operated"] and frozenset((origin, destination)) == excluded_pair:
                    continue
                destinations.append({
                    "to_stop_id": destination,
                    "travel_minutes": accumulated_minutes,
                    "diagram_span_stop_ids": span.copy(),
                    "stop_call_status": "requires_confirmation" if destination in excluded_pair else "not_certified_by_this_calculation",
                })

            for source_row, departure_time in enumerate(column["times_by_source_row"], start=1):
                if departure_time is None:
                    continue
                arrivals = []
                for destination in destinations:
                    arrival_time, day_offset = add_minutes(departure_time, destination["travel_minutes"])
                    arrivals.append({
                        **destination,
                        "estimated_arrival_time": arrival_time,
                        "arrival_day_offset": day_offset,
                        "arrival_time_source": "calculated_from_origin_departure_and_diagram_durations",
                    })
                results.append({
                    "source_column_id": column["column_id"],
                    "source_row": source_row,
                    "from_stop_id": origin,
                    "direction_to_stop_id": terminal,
                    "departure_time": departure_time,
                    "destinations": arrivals,
                })
    return results


def main() -> None:
    assert OUT.is_dir() and WORK.is_dir(), "Use existing directories only."
    assert SOURCE_FILE.is_file()
    source_hash = hashlib.sha256(SOURCE_FILE.read_bytes()).hexdigest()
    original_ocr = json.loads((WORK / "timetable_ocr.json").read_text(encoding="utf-8-sig"))
    assert (original_ocr["width"], original_ocr["height"]) == (1500, 820)

    columns = []
    for stop_id, heading, kind, direction, x, row_text in SOURCE_COLUMNS:
        cells = [None if token == "-" else token for token in row_text.split()]
        assert len(cells) == 12
        columns.append({
            "column_id": column_id(stop_id, kind, direction),
            "stop_id": stop_id,
            "source_heading": heading,
            "event_type": kind,
            "direction_to_stop_id": direction,
            "times_by_source_row": cells,
        })

    stops = [
        {
            "stop_id": stop_id,
            "name_ko": name,
            "display_order": index + 1,
            "columns": [col for col in columns if col["stop_id"] == stop_id],
        }
        for index, (stop_id, name) in enumerate(STOP_NAMES)
    ]
    # stop_id already belongs to each parent stop; avoid duplicate stored facts.
    for stop in stops:
        for col in stop["columns"]:
            del col["stop_id"]

    dataset = {
        "schema_version": "1.1.0",
        "dataset_id": "hgbus-timetable-20260815-snapshot-20261103",
        "timezone": "Asia/Seoul",
        "time_format": "HH:mm",
        "source": {
            "title": "한강버스 운항 시간표",
            "page_url": PAGE_URL,
            "image_url": IMAGE_URL,
            "image_file": SOURCE_FILE.relative_to(OUT).as_posix(),
            "image_sha256": source_hash,
            "image_width": 1500,
            "image_height": 820,
            "retrieved_on": REVIEW_DATE,
        },
        "validity": {
            "effective_from": "2026-08-15",
            "effective_until": None,
            "effective_until_condition": "until_further_notice",
            "operating_days": None,
            "operating_days_status": "not_specified_in_source_image",
            "separate_operational_notices_reviewed": False,
        },
        "representation": {
            "source_row_count": 12,
            "array_position_rule": "times_by_source_row[0] is source table row 1",
            "blank_cell_rule": "null preserves an empty source cell; do not infer its operational meaning",
            "row_alignment_rule": "Source layout only. The same row across columns is not an established trip relationship.",
            "event_type_rule": "Direction headings are departures; columns explicitly headed 도착 are arrivals.",
            "stop_id_authority": "Local identifiers assigned for this dataset; not operator-issued IDs.",
            "trip_linkage_status": "not_established",
        },
        "stops": stops,
        "source_notes": [
            "표기된 시간은 각 선착장 출발 시간 기준입니다.",
            "옥수-압구정간 직항 노선은 미운항 합니다.",
            "적용기간 : 26.8.15.~별도 공지시까지",
        ],
        "source_diagram": {
            "transfer_stop_ids": ["YEOUIDO"],
            "adjacent_segment_labels": [
                {"from_stop_id": a[0], "to_stop_id": b[0], "displayed_minutes": minutes}
                for a, b, minutes in zip(STOP_NAMES, STOP_NAMES[1:], [21, 26, 29, 9, 15, 14, 15])
            ],
            "use_rule": "Displayed minutes are used for nominal arrival estimates under arrival_estimation_policy. Diagram spans are not certified stop-call sequences or operational routing edges.",
            "direct_service_restriction": {
                "stop_ids": ["OKSU", "APGUJEONG"],
                "source_note_index": 1,
                "direct_service_operated": False,
            },
        },
        "verification": {
            "status": "source_transcription_and_estimate_calculation_verified",
            "verified_on": REVIEW_DATE,
            "reviewed_by": "assistant_visual_review_with_windows_ocr_comparison",
            "report_file": REPORT_FILE.name,
            "scope": "Published image transcription and arithmetic of nominal arrival estimates; not actual arrival, operational availability or trip linkage certification.",
        },
    }

    dataset["arrival_estimation_policy"] = {
        "method": "origin_departure_plus_diagram_duration_sum",
        "formula": "estimated_arrival = selected_origin_departure + sum(displayed_minutes for diagram spans between origin and destination)",
        "decision_basis": "User-selected estimation method when same-trip linkage cannot be confirmed.",
        "time_base": "Only the selected origin departure; intermediate-stop departure times are not joined or substituted.",
        "dwell_and_wait_minutes_added": False,
        "live_delay_adjustment": False,
        "direction_rule": "Generate only destinations between the origin and the terminal named by its source departure heading.",
        "transfers_included": False,
        "reverse_direction_rule": "Reuse the same displayed minutes in both directions as a project estimation assumption, not a confirmed direction-specific duration.",
        "diagram_span_is_stop_call_sequence": False,
        "nonadjacent_duration_rule": "Sum intervening diagram labels even if a stop is bypassed; this is a nominal estimate, not a published duration for the bypass service.",
        "direct_service_exclusions": [["OKSU", "APGUJEONG"], ["APGUJEONG", "OKSU"]],
        "stop_call_rule": "An estimate does not confirm a stop call for that departure. Calls at Oksu and Apgujeong require separate confirmation.",
        "official_arrival_rule": "Explicit source arrival columns are preserved separately and never overwritten or paired with departures without confirmed trip linkage.",
        "day_offset_rule": "arrival_day_offset is the number of local calendar days after the selected departure's date.",
        "blank_cell_rule": "No arrival estimate is generated from an empty source departure cell.",
    }
    dataset["arrival_estimates"] = build_arrival_estimates(dataset)

    checks = []
    def checked(name: str, condition: bool, details=None) -> None:
        assert condition, f"Validation failed: {name}: {details}"
        item = {"name": name, "status": "passed"}
        if details is not None:
            item["details"] = details
        checks.append(item)

    stop_ids = [s["stop_id"] for s in stops]
    checked("stop_count_and_unique_ids", len(stop_ids) == len(set(stop_ids)) == 8)
    checked("source_column_count", len(columns) == 16)
    checked("unique_column_ids", len({c["column_id"] for c in columns}) == 16)
    checked("source_rows_preserved", all(len(c["times_by_source_row"]) == 12 for c in columns))
    checked("direction_ids_reference_known_stops", all(c["direction_to_stop_id"] is None or c["direction_to_stop_id"] in stop_ids for c in columns))
    times = [v for c in columns for v in c["times_by_source_row"] if v is not None]
    checked("time_format_and_range", all(re.fullmatch(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", t) for t in times))
    checked("ascending_unique_times_per_column", all(
        (values := [t for t in c["times_by_source_row"] if t is not None]) == sorted(set(values))
        for c in columns
    ))
    checked("effective_date_is_iso_date", date.fromisoformat(dataset["validity"]["effective_from"]) == date(2026, 8, 15))
    checked("explicit_arrival_headers_preserved", {c["column_id"] for c in columns if c["event_type"] == "arrival"} == {"MAGOK_ARRIVAL", "JAMSIL_ARRIVAL"})
    checked("unknown_calendar_and_trip_links_not_invented", dataset["validity"]["operating_days"] is None and dataset["representation"]["trip_linkage_status"] == "not_established")
    checked("source_image_hash", source_hash == "55346ad1b6761251cb475c33c9ca9dcdc29e42bfaae897bb454184c306320e82")

    estimates = dataset["arrival_estimates"]
    expected_departure_refs = {
        (c["column_id"], row): value
        for c in columns if c["event_type"] == "departure"
        for row, value in enumerate(c["times_by_source_row"], start=1) if value is not None
    }
    checked("every_source_departure_estimated_once", len(estimates) == len(expected_departure_refs) and {
        (e["source_column_id"], e["source_row"]): e["departure_time"] for e in estimates
    } == expected_departure_refs)
    magok_first = next(e for e in estimates if e["source_column_id"] == "MAGOK_TO_YEOUIDO" and e["source_row"] == 1)
    magok_destinations = {d["to_stop_id"]: d for d in magok_first["destinations"]}
    checked("magok_1120_mangwon_1141_yeouido_1207", (
        magok_destinations["MANGWON"]["travel_minutes"], magok_destinations["MANGWON"]["estimated_arrival_time"],
        magok_destinations["YEOUIDO"]["travel_minutes"], magok_destinations["YEOUIDO"]["estimated_arrival_time"],
    ) == (21, "11:41", 47, "12:07"))
    checked("no_transfer_beyond_source_direction_terminal", all(
        stop_ids.index(e["from_stop_id"]) < stop_ids.index(d["to_stop_id"]) <= stop_ids.index(e["direction_to_stop_id"])
        if stop_ids.index(e["from_stop_id"]) < stop_ids.index(e["direction_to_stop_id"])
        else stop_ids.index(e["direction_to_stop_id"]) <= stop_ids.index(d["to_stop_id"]) < stop_ids.index(e["from_stop_id"])
        for e in estimates for d in e["destinations"]
    ))
    checked("no_oksu_apgujeong_direct_estimates", all(
        {e["from_stop_id"], d["to_stop_id"]} != {"OKSU", "APGUJEONG"}
        for e in estimates for d in e["destinations"]
    ))
    checked("arrival_estimates_marked_as_calculated", all(
        d["arrival_time_source"] == "calculated_from_origin_departure_and_diagram_durations"
        for e in estimates for d in e["destinations"]
    ))
    checked("midnight_rollover_retains_day_offset", add_minutes("23:50", 21) == ("00:11", 1))

    ocr = json.loads((WORK / "timetable_ocr_enhanced.json").read_text(encoding="utf-8-sig"))
    checked("ocr_image_size", (ocr["width"], ocr["height"]) == (2468, 595))
    # OCR input: source crop (20,357,1472,707), resized from 1452x350 to 2468x595.
    ocr_cells = {}
    for word in ocr["words"]:
        source_x = 20 + (word["x"] + word["width"] / 2) * 1452 / 2468
        source_y = 357 + (word["y"] + word["height"] / 2) * 350 / 595
        ci = min(range(16), key=lambda i: abs(source_x - SOURCE_COLUMNS[i][4]))
        ri = min(range(12), key=lambda i: abs(source_y - (376.5 + 28.6 * i)))
        assert abs(source_x - SOURCE_COLUMNS[ci][4]) < 20
        assert abs(source_y - (376.5 + 28.6 * ri)) < 10
        assert (ci, ri) not in ocr_cells, f"Multiple OCR words in cell {(ci, ri)}"
        ocr_cells[ci, ri] = word

    cell_results = []
    normalized_matches = 0
    visual_resolutions = []
    blanks = 0
    for ci, col in enumerate(columns):
        for ri, expected in enumerate(col["times_by_source_row"]):
            word = ocr_cells.get((ci, ri))
            normalized = normalize_ocr_time(word["text"]) if word else None
            item = {
                "column_id": col["column_id"],
                "source_row": ri + 1,
                "json_time": expected,
                "ocr_raw": word["text"] if word else None,
                "ocr_normalized": normalized,
            }
            if expected is None:
                assert word is None, f"Unexpected OCR text in source blank: {item}"
                item["result"] = "blank_preserved"
                blanks += 1
            else:
                assert word is not None, f"OCR missed a transcribed time: {item}"
                if normalized == expected:
                    item["result"] = "ocr_match"
                    normalized_matches += 1
                elif col["column_id"] == "MAGOK_ARRIVAL" and ri == 1 and expected == "13:53" and normalized == "13:33":
                    item["result"] = "visual_match_after_ocr_misread"
                    item["review_note"] = "Original image visibly reads 13:53. Enhanced OCR misread the minute tens digit as 3 (13•33). Original-size OCR separately read 1353. JSON follows the image."
                    visual_resolutions.append(item.copy())
                else:
                    raise AssertionError(f"Unresolved source/OCR discrepancy: {item}")
            cell_results.append(item)

    checked("source_cell_count", len(cell_results) == 192)
    checked("nonempty_cells_detected_independently_by_ocr", len(ocr_cells) == len(times) == 140)
    checked("all_52_source_blanks_preserved", blanks == 52)
    checked("all_times_compared_with_source", normalized_matches == 139 and len(visual_resolutions) == 1)

    # Keep generated bytes stable across Windows, Linux and Git line endings.
    DATA_FILE.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    reloaded = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    checked("saved_json_roundtrip", reloaded == dataset)

    column_summary = []
    for stop in stops:
        for col in stop["columns"]:
            values = [t for t in col["times_by_source_row"] if t is not None]
            column_summary.append({
                "stop_id": stop["stop_id"],
                "stop_name": stop["name_ko"],
                "column_id": col["column_id"],
                "source_heading": col["source_heading"],
                "event_type": col["event_type"],
                "time_count": len(values),
                "blank_count": 12 - len(values),
                "first_listed_time": values[0],
                "last_listed_time": values[-1],
            })
    departures = sum(1 for c in columns if c["event_type"] == "departure" for t in c["times_by_source_row"] if t is not None)
    arrivals = len(times) - departures
    report = {
        "report_version": "1.1.0",
        "status": "passed_for_source_transcription_and_estimate_calculation",
        "review_date": REVIEW_DATE,
        "reviewed_by": "assistant_visual_review_with_windows_ocr_comparison",
        "dataset_file": DATA_FILE.name,
        "dataset_sha256": hashlib.sha256(DATA_FILE.read_bytes()).hexdigest(),
        "source_image_file": SOURCE_FILE.relative_to(OUT).as_posix(),
        "source_image_sha256": source_hash,
        "source_page_url": PAGE_URL,
        "source_image_url": IMAGE_URL,
        "summary": {
            "stops": len(stops),
            "columns": len(columns),
            "source_rows": 12,
            "source_cells": len(cell_results),
            "time_cells": len(times),
            "departure_time_cells": departures,
            "arrival_time_cells": arrivals,
            "blank_cells": blanks,
            "ocr_normalized_matches": normalized_matches,
            "ocr_misreads_resolved_visually": len(visual_resolutions),
            "unresolved_transcription_discrepancies": 0,
            "departure_records_with_arrival_estimates": len(estimates),
            "estimated_origin_destination_records": sum(len(e["destinations"]) for e in estimates),
        },
        "method": {
            "transcription": "Assistant visually transcribed all sixteen columns from the downloaded original image, preserving twelve rows per column.",
            "independent_check": "Windows.Media.Ocr (ko) recognized all 140 nonempty cells in a contrast-enhanced crop. Bounding boxes were mapped back to source columns and rows.",
            "ocr_normalization": "Only punctuation removal and HH:mm colon insertion for exactly four recognized digits; no expected-value-based digit correction.",
            "visual_review": "Original image, headings, blank layout, effective-date footnote and displayed diagram annotations were checked. One enhanced-OCR digit error was resolved against the source and original-size OCR.",
            "reviewer_scope": "Assistant review; not a claim of team or operator approval.",
            "arrival_estimation": dataset["arrival_estimation_policy"],
        },
        "structural_checks": checks,
        "column_summary": column_summary,
        "ocr_visual_resolutions": visual_resolutions,
        "known_limits": [
            "No operator trip IDs are published in this image. Same-row cells are not automatically linked as a trip.",
            "Empty cells are preserved as null; no additional cancellation, skip-stop or service-calendar meaning is inferred.",
            "Operating weekdays and holiday exceptions are not stated in the image and remain unspecified.",
            "The displayed applicability is 2026-08-15 until further notice. Separate newer operational or cancellation notices have not been audited.",
            "The general departure-time footnote is retained, while the two explicitly headed arrival columns are typed as arrivals.",
            "Arrival estimates are origin departure plus summed diagram durations, as selected by the user. They omit dwell, waits and live delays and may differ from official arrival or intermediate departure times.",
            "The same diagram durations are reused in reverse as an estimation assumption; direction-specific durations have not been confirmed.",
            "Summed diagram spans are not stop-call sequences. Oksu and Apgujeong calls need confirmation; their direct pair is excluded. Nonadjacent estimates use nominal diagram sums, not a published bypass-service duration.",
            "Local stop IDs are dataset identifiers; they are not claimed to be official operator identifiers.",
        ],
        "cell_comparisons": cell_results,
    }
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    assert json.loads(REPORT_FILE.read_text(encoding="utf-8")) == report
    print(json.dumps({"dataset": str(DATA_FILE), "report": str(REPORT_FILE), "summary": report["summary"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
