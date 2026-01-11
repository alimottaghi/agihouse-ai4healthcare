# tests/test_api.py

import pytest
from pathlib import Path
from fastapi import Response, HTTPException
from fastapi.testclient import TestClient
from api.main import list_records, app


@pytest.fixture
def sample_xml_path() -> str:
    return str(Path(__file__).parent / "fixtures" / "sample_data.xml")


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# === /records endpoint tests ===

def test_list_records_direct_call(sample_xml_path: str):
    """list_records function returns filtered records."""
    resp = Response()
    out = list_records(
        response=resp,
        file_path=sample_xml_path,
        types=["HKCategoryTypeIdentifierSleepAnalysis"],
        start=None,
        end=None,
    )
    assert isinstance(out, list)
    assert len(out) > 0
    assert resp.headers.get("X-Total-Count")
    assert all(r.get("type") == "HKCategoryTypeIdentifierSleepAnalysis" for r in out)


def test_list_records_raises_404_on_missing_file():
    """list_records raises 404 for missing file."""
    resp = Response()
    with pytest.raises(HTTPException) as exc:
        list_records(
            response=resp,
            file_path="nonexistent.xml",
            types=None,
            start=None,
            end=None,
        )
    assert exc.value.status_code == 404


def test_list_records_raises_422_on_reversed_range(sample_xml_path: str):
    """list_records raises 422 for invalid date range."""
    resp = Response()
    with pytest.raises(HTTPException) as exc:
        list_records(
            response=resp,
            file_path=sample_xml_path,
            start="2024-01-21 00:00:00 -0700",
            end="2024-01-20 00:00:00 -0700",
        )
    assert exc.value.status_code == 422


def test_http_records_returns_all(client: TestClient, sample_xml_path: str):
    """GET /records returns all records and sets header."""
    r = client.get("/records", params={"file_path": sample_xml_path})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 1
    assert r.headers.get("X-Total-Count")


def test_http_records_422_on_reversed_dates(client: TestClient, sample_xml_path: str):
    """GET /records returns 422 for reversed date range."""
    r = client.get(
        "/records",
        params={
            "file_path": sample_xml_path,
            "start": "2024-01-21 00:00:00 -0700",
            "end": "2024-01-20 00:00:00 -0700",
        },
    )
    assert r.status_code == 422
    assert "end date" in r.json()["detail"].lower()


# === /sessions endpoint tests ===

def test_http_sessions_returns_valid_structure(client: TestClient, sample_xml_path: str):
    """GET /sessions returns valid sleep session structure."""
    r = client.get("/sessions", params={"file_path": sample_xml_path})
    assert r.status_code == 200
    data = r.json()
    assert isinstance(data, list)
    assert len(data) > 0
    assert r.headers.get("X-Total-Count") == str(len(data))
    
    for session in data:
        assert "startDate" in session
        assert "endDate" in session
        assert "duration" in session
        assert "asleepDuration" in session
        assert "awakeDuration" in session
        assert "awakenings" in session
        assert "segments" in session
        assert isinstance(session["segments"], list)
        assert all("stage" in seg for seg in session["segments"])


def test_http_sessions_404_on_missing_file(client: TestClient):
    """GET /sessions returns 404 for missing file."""
    r = client.get("/sessions", params={"file_path": "nonexistent.xml"})
    assert r.status_code == 404


def test_http_sessions_422_on_reversed_dates(client: TestClient, sample_xml_path: str):
    """GET /sessions returns 422 for reversed date range."""
    r = client.get(
        "/sessions",
        params={
            "file_path": sample_xml_path,
            "start": "2024-01-21 00:00:00 -0700",
            "end": "2024-01-20 00:00:00 -0700",
        },
    )
    assert r.status_code == 422
    assert "end date" in r.json()["detail"].lower()


def test_http_sessions_filters_by_date_range(client: TestClient, sample_xml_path: str):
    """GET /sessions respects start/end parameters."""
    all_resp = client.get("/sessions", params={"file_path": sample_xml_path})
    all_sessions = all_resp.json()
    assert len(all_sessions) >= 2
    
    start = all_sessions[0]["startDate"]
    end = all_sessions[0]["endDate"]
    
    filtered_resp = client.get(
        "/sessions",
        params={"file_path": sample_xml_path, "start": start, "end": end},
    )
    filtered = filtered_resp.json()
    assert len(filtered) > 0
    assert all(s["startDate"] >= start and s["endDate"] <= end for s in filtered)


def test_http_sessions_respects_gap_parameter(client: TestClient, sample_xml_path: str):
    """GET /sessions gap_hours parameter affects session count."""
    r1 = client.get("/sessions", params={"file_path": sample_xml_path})
    default_sessions = r1.json()
    
    r2 = client.get("/sessions", params={"file_path": sample_xml_path, "gap_hours": 1.0})
    tight_sessions = r2.json()
    
    assert len(tight_sessions) >= len(default_sessions)


def test_http_sessions_matches_module(client: TestClient, sample_xml_path: str):
    """GET /sessions matches direct module call (integration test)."""
    from apple_health_parser.sleep import iter_sleep_segments, build_sleep_sessions
    
    segs = list(iter_sleep_segments(sample_xml_path))
    direct_sessions = build_sleep_sessions(segs)
    
    r = client.get("/sessions", params={"file_path": sample_xml_path})
    api_sessions = r.json()
    
    assert len(api_sessions) == len(direct_sessions)
    
    for api, direct in zip(api_sessions, direct_sessions):
        assert api["startDate"] == direct.start_dt.isoformat(timespec="seconds")
        assert api["endDate"] == direct.end_dt.isoformat(timespec="seconds")
        assert api["duration"] == direct.duration.total_seconds()
        assert api["asleepDuration"] == direct.asleep_duration.total_seconds()
        assert api["awakeDuration"] == direct.awake_duration.total_seconds()
        assert api["awakenings"] == direct.awakenings
        assert len(api["segments"]) == len(direct.segments)
