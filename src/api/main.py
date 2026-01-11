from typing import Any, Dict, List, Optional
from datetime import timedelta

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from apple_health_parser.parser import iter_health_records
from apple_health_parser.sleep import iter_sleep_segments, build_sleep_sessions
        

VITAL_TYPES = [
    "HKQuantityTypeIdentifierHeartRate",
    "HKQuantityTypeIdentifierRestingHeartRate",
    "HKQuantityTypeIdentifierWalkingHeartRateAverage",
    "HKQuantityTypeIdentifierBloodPressureSystolic",
    "HKQuantityTypeIdentifierBloodPressureDiastolic",
    "HKQuantityTypeIdentifierBloodGlucose",
    "HKQuantityTypeIdentifierRespiratoryRate",
    "HKQuantityTypeIdentifierAppleSleepingWristTemperature",
]


def _safe_parse(func, *args, **kwargs) -> List[Dict[str, Any]]:
    """Wraps parsing calls with consistent error handling."""
    try:
        return func(*args, **kwargs)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Unexpected error: {e}") from e


app = FastAPI(
    title="Apple Health API",
    version="0.1.2",
    description="Minimal FastAPI wrapper around apple_health_parser.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/", include_in_schema=False)
def root() -> Dict[str, str]:
    return {"message": "See /docs for the interactive API."}

@app.get("/health", include_in_schema=False)
def health() -> Dict[str, str]:
    return {"status": "ok"}

@app.get("/records", tags=["parse"], response_model=List[Dict[str, Any]])
def list_records(
    response: Response,
    file_path: str = Query(..., description="Absolute or relative path to the Apple Health XML file"),
    types: Optional[List[str]] = Query(None, description="Filter by one or more record types or tags."),
    start: Optional[str] = Query(None, description="Inclusive start (Apple format, ISO-8601, or naive)"),
    end: Optional[str] = Query(None, description="Inclusive end (Apple format, ISO-8601, or naive)"),
) -> List[Dict[str, Any]]:
    def _fetch():
        return [rec.to_dict() for rec in iter_health_records(file_path, types=types, start=start, end=end)]
    out = _safe_parse(_fetch)
    response.headers["X-Total-Count"] = str(len(out))
    return out

@app.get("/sessions", tags=["sleep"], response_model=List[Dict[str, Any]])
def list_sessions(
    response: Response,
    file_path: str = Query(..., description="Path to Apple Health XML export"),
    start: Optional[str] = Query(None, description="Inclusive start (ISO-8601, Apple format, or naive)"),
    end: Optional[str] = Query(None, description="Inclusive end (ISO-8601, Apple format, or naive)"),
    gap_hours: float = Query(
        2.0,
        gt=0,
        description="Maximum gap (in hours) between segments before starting a new session",
    ),
) -> List[Dict[str, Any]]:
    def _fetch():
        segs = iter_sleep_segments(file_path, start=start, end=end)
        sessions = build_sleep_sessions(segs, gap=timedelta(hours=gap_hours))
        return [s.to_dict() for s in sessions]
    out = _safe_parse(_fetch)
    response.headers["X-Total-Count"] = str(len(out))
    return out


@app.get("/vitals", tags=["vitals"], response_model=List[Dict[str, Any]])
def list_vitals(
    response: Response,
    file_path: str = Query(..., description="Path to Apple Health XML export"),
    types: Optional[List[str]] = Query(None, description="Optional override of vital record types"),
    start: Optional[str] = Query(None, description="Inclusive start (ISO-8601, Apple format, or naive)"),
    end: Optional[str] = Query(None, description="Inclusive end (ISO-8601, Apple format, or naive)"),
) -> List[Dict[str, Any]]:
    """
    Return vital sign records (heart rate, blood pressure, glucose, weight, etc.).
    Defaults to a curated list (VITAL_TYPES) but can be narrowed/overridden via ?types=...
    """

    def _fetch():
        # Use provided types if any; otherwise default to VITAL_TYPES
        selected_types = types or VITAL_TYPES
        return [rec.to_dict() for rec in iter_health_records(file_path, types=selected_types, start=start, end=end)]

    out = _safe_parse(_fetch)
    response.headers["X-Total-Count"] = str(len(out))
    return out
