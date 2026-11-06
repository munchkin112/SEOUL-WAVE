"""Durability and ownership checks for the recovery paths used in deployment."""
import os
import sqlite3
from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app import database_health_monitor as monitor
from app.main import app
from app.recovery import controller, policies
from app.repositories import itinerary_repository as repository
from app.services.operation_logs_service import start_agent_run


@pytest.fixture
def database():
    with psycopg.connect(
        host=os.environ["DATABASE_HOST"], port=os.environ["DATABASE_PORT"],
        dbname=os.environ["DATABASE_NAME"], user=os.environ["DATABASE_USER"],
        password=os.environ["DATABASE_PASSWORD"],
    ) as connection:
        connection.execute("BEGIN")
        try:
            yield connection
        finally:
            connection.rollback()


@pytest.fixture
def spool(tmp_path, monkeypatch):
    monkeypatch.setattr(monitor, "SPOOL_PATH", tmp_path / "monitor.sqlite3")
    monkeypatch.setattr(monitor, "FAILURE_THRESHOLD", 2)
    monitor.initialize_spool()
    return monitor.SPOOL_PATH


def record_outage(start):
    for offset, is_up in enumerate((True, False, False, False, True)):
        monitor.record_probe_result(is_up, start + timedelta(seconds=offset * 10))


def test_monitor_debounces_outage_and_flushes_once_after_recovery(spool, database, monkeypatch):
    start = datetime.now(timezone.utc)
    record_outage(start)
    # A process restart must retain both current state and the pending event.
    monitor.initialize_spool()
    with sqlite3.connect(spool) as local:
        assert local.execute("SELECT status, failure_count FROM monitor_state").fetchone() == ("UP", 0)
        event = local.execute("SELECT monitor_event_id, flushed FROM database_outages").fetchone()
        assert event[1] == 0
        assert local.execute("SELECT count(*) FROM database_outages").fetchone()[0] == 1
    monkeypatch.setattr(monitor, "connect_database", lambda: nullcontext(database))
    monitor.flush_recovered_outages()
    monitor.flush_recovered_outages()
    incident = database.execute(
        "SELECT incident_id, status, run_id FROM incident_logs WHERE monitor_event_id = %s",
        (event[0],),
    ).fetchone()
    assert incident[1:] == ("RESOLVED", None)
    recovery = database.execute(
        "SELECT status, duration_ms, run_id FROM recovery_logs WHERE incident_id = %s",
        (incident[0],),
    ).fetchall()
    assert recovery == [("RECOVERED", 30000, None)]
    with sqlite3.connect(spool) as local:
        assert local.execute("SELECT flushed FROM database_outages").fetchone()[0] == 1


def test_monitor_ignores_one_transient_failure_and_handles_down_at_startup(spool):
    start = datetime.now(timezone.utc)
    monitor.record_probe_result(False, start)
    monitor.record_probe_result(True, start + timedelta(seconds=1))
    with sqlite3.connect(spool) as local:
        assert local.execute("SELECT count(*) FROM database_outages").fetchone()[0] == 0
    record_outage(start + timedelta(seconds=2))
    assert monitor.parse_timestamp("2026-11-06T00:00:00").tzinfo == timezone.utc
    assert monitor.parse_timestamp("2026-11-06T00:00:00+09:00").utcoffset() == timedelta(hours=9)


def test_probe_reports_database_error_without_leaking_exception(monkeypatch):
    def unavailable():
        raise psycopg.OperationalError("private database detail")
    monkeypatch.setattr(monitor, "connect_database", unavailable)
    assert monitor.probe_database() is False


@pytest.mark.parametrize("error,stage,source,retryable", [
    (psycopg.OperationalError("private"), "queue", "DATABASE", True),
    (ValueError("invalid"), "queue", "UNKNOWN", False),
    (ValueError("invalid"), "langgraph_execution", "LANGGRAPH", False),
])
def test_retry_policy_classifies_failures_without_raw_messages(error, stage, source, retryable):
    decision = policies.classify_worker_error(error, stage)
    assert decision.error_source == source
    assert decision.retryable is retryable
    assert str(error) not in decision.safe_message


def test_retry_policy_respects_external_and_llm_retry_contracts():
    class ApiError(Exception):
        error_code = "culture_api_timeout"
        retryable = True
    assert policies.classify_worker_error(ApiError(), "events").retryable
    error = ApiError()
    error.retryable = False
    assert not policies.classify_worker_error(error, "events").retryable
    error.error_code = "LLM_RATE_LIMIT"
    error.retryable = True
    assert not policies.classify_worker_error(error, "langgraph_execution").retryable
    error.error_code = "OTHER"
    assert policies.classify_worker_error(error, "langgraph_execution").retryable
    error.error_code = "DATABASE_OPERATION_FAILED"
    assert policies.classify_worker_error(error, "queue").error_source == "DATABASE"
    assert [policies.retry_delay_seconds(n) for n in (1, 2, 3, 20)] == [2, 4, 8, 30]


def initial_execution(connection):
    visitor = uuid4()
    group, run = repository.create_initial_execution(
        connection, visitor, datetime.now(timezone.utc) + timedelta(hours=1),
        dict(origin_stop_id="MANGWON", destination_stop_id="YEOUIDO",
             service_date=date(2026, 11, 21), preferred_departure_time="11:42",
             companion_type="family", activity_type="exhibition_performance"),
    )
    return visitor, group, run


def test_queue_retry_ownership_expired_lease_and_session_isolation(database):
    visitor, group, run = initial_execution(database)
    assert repository.get_execution_for_session(database, run, uuid4()) is None
    assert repository.get_execution_for_session(database, run, visitor)["status"] == "RUNNING"
    claimed = repository.claim_next_execution(database, "worker-a")
    assert claimed["run_id"] == run and not claimed["lease_expired"]
    assert not repository.renew_execution_lease(database, run, "wrong-owner")
    assert repository.renew_execution_lease(database, run, "worker-a")
    assert not controller.schedule_execution_retry(database, run, "wrong-owner", 30)
    assert controller.schedule_execution_retry(database, run, "worker-a", 30)
    assert repository.claim_next_execution(database, "worker-b") is None
    database.execute("UPDATE itinerary_executions SET next_retry_at = now() - interval '1 second' WHERE run_id = %s", (run,))
    assert repository.claim_next_execution(database, "worker-b")["worker_attempt_count"] == 2
    database.execute("UPDATE itinerary_executions SET worker_lease_until = now() - interval '1 second' WHERE run_id = %s", (run,))
    assert repository.claim_next_execution(database, "worker-c")["lease_expired"]
    with pytest.raises(repository.GenerationAlreadyRunning):
        repository.create_regeneration_execution(database, visitor, group)
    repository.complete_execution_without_result(database, run, "NO_MATCH", "No candidate")
    result = repository.get_execution_for_session(database, run, visitor)
    assert result["status"] == "NO_RESULT" and result["reason"]["code"] == "NO_MATCH"
    next_run, index = repository.create_regeneration_execution(database, visitor, group)
    assert index == 1
    assert repository.create_regeneration_execution(database, visitor, group) == (next_run, 1)
    repository.fail_execution(database, next_run, "TEST_FAILURE", "safe failure", False)
    assert repository.get_execution_for_session(database, next_run, visitor)["error"]["retryable"] is False
    with pytest.raises(repository.ItineraryGroupNotFound):
        repository.create_regeneration_execution(database, uuid4(), group)
    database.execute("UPDATE itinerary_groups SET regeneration_count = 2 WHERE group_id = %s", (group,))
    with pytest.raises(repository.RegenerationLimitReached):
        repository.create_regeneration_execution(database, visitor, group)


def test_recovery_attempts_share_incident_and_finish_terminally(database):
    run = start_agent_run(database)
    fields = dict(run_id=run, error_source="DATABASE", error_code="DB_TEST",
                  error_message="Safe test error", failed_step_name="queue",
                  recovery_action="reconnect")
    incident = controller.start_run_recovery(database, **fields)
    assert controller.start_run_recovery(database, **fields) == incident
    rows = database.execute("SELECT attempt_number, status FROM recovery_logs WHERE incident_id = %s ORDER BY attempt_number", (incident,)).fetchall()
    assert rows == [(1, "FAILED"), (2, "RUNNING")]
    controller.finish_run_recoveries(database, run, "RECOVERED")
    assert database.execute("SELECT status FROM incident_logs WHERE incident_id = %s", (incident,)).fetchone()[0] == "RESOLVED"
    fields.pop("recovery_action")
    terminal = controller.record_terminal_run_failure(database, **fields)
    assert terminal != incident
    controller.resume_agent_run(database, run)
    controller.close_abandoned_step_logs(database, run)


def test_password_login_session_and_logout(monkeypatch):
    monkeypatch.setenv("SITE_ACCESS_PASSWORDS", "test-local-password")
    with TestClient(app) as client:
        assert client.get("/api/auth/session").json() == {"authenticated": False}
        assert client.post("/api/auth/login", json={"password": "wrong"}).status_code == 401
        assert client.post("/api/auth/login", json={"password": "test-local-password"}).status_code == 200
        assert client.get("/api/auth/session").json() == {"authenticated": True}
        assert client.post("/api/auth/logout").json() == {"authenticated": False}
        assert client.get("/api/auth/session").json() == {"authenticated": False}
