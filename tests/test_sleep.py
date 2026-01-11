import pytest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from apple_health_parser.sleep import (
    SLEEP_TYPE,
    SLEEP_STAGES,
    SleepSegment,
    SleepSession,
    iter_sleep_segments,
    build_sleep_sessions,
)


@pytest.fixture
def sample_xml_path() -> str:
    return str(Path(__file__).parent / "fixtures" / "sample_data.xml")


# === SleepSegment Tests ===

def test_sleep_segment_basic():
    """SleepSegment constructs with valid inputs."""
    s = datetime(2024, 1, 5, 23, 20, tzinfo=timezone.utc)
    e = datetime(2024, 1, 6, 1, 10, tzinfo=timezone.utc)
    seg = SleepSegment(start_dt=s, end_dt=e, stage="Core")
    assert seg.duration == timedelta(hours=1, minutes=50)


def test_sleep_segment_rejects_reversed_times():
    """SleepSegment rejects end_dt < start_dt."""
    s = datetime(2024, 1, 6, 1, 10, tzinfo=timezone.utc)
    e = datetime(2024, 1, 5, 23, 20, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="before"):
        SleepSegment(start_dt=s, end_dt=e, stage="Core")


def test_sleep_segment_rejects_invalid_stage():
    """SleepSegment rejects unknown stage."""
    s = datetime(2024, 1, 5, 23, 20, tzinfo=timezone.utc)
    e = datetime(2024, 1, 6, 1, 10, tzinfo=timezone.utc)
    with pytest.raises(ValueError, match="Invalid stage"):
        SleepSegment(start_dt=s, end_dt=e, stage="Unknown")


def test_sleep_segment_frozen():
    """SleepSegment is immutable."""
    seg = SleepSegment(
        start_dt=datetime(2024, 1, 5, 23, 20, tzinfo=timezone.utc),
        end_dt=datetime(2024, 1, 6, 1, 10, tzinfo=timezone.utc),
        stage="Core",
    )
    with pytest.raises(AttributeError):
        seg.stage = "REM"  # type: ignore


# === SleepSession._normalize Tests ===

def test_normalize_filters_inbed():
    """_normalize removes InBed segments."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="InBed"),
        SleepSegment(start_dt=s + timedelta(hours=1), end_dt=s + timedelta(hours=3), stage="Core"),
    ]
    result = SleepSession._normalize(segs)
    assert len(result) == 1
    assert result[0].stage == "Core"


def test_normalize_merges_adjacent_same_stage():
    """_normalize merges consecutive same-stage segments."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="Core"),
        SleepSegment(start_dt=s + timedelta(hours=1), end_dt=s + timedelta(hours=2), stage="Core"),
    ]
    result = SleepSession._normalize(segs)
    assert len(result) == 1
    assert result[0].duration == timedelta(hours=2)


def test_normalize_resolves_overlaps_by_priority():
    """_normalize picks highest-priority stage in overlaps."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=2), stage="Core"),
        SleepSegment(start_dt=s + timedelta(minutes=30), end_dt=s + timedelta(hours=1, minutes=30), stage="Awake"),
    ]
    result = SleepSession._normalize(segs)
    # Should have: Core [0:30], Awake [30:90], Core [90:120]
    assert len(result) == 3
    assert result[0].stage == "Core" and result[0].duration == timedelta(minutes=30)
    assert result[1].stage == "Awake" and result[1].duration == timedelta(minutes=60)
    assert result[2].stage == "Core" and result[2].duration == timedelta(minutes=30)


def test_normalize_sorts_by_start_time():
    """_normalize sorts unordered input."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s + timedelta(hours=2), end_dt=s + timedelta(hours=3), stage="REM"),
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="Core"),
    ]
    result = SleepSession._normalize(segs)
    assert result[0].stage == "Core"
    assert result[1].stage == "REM"


# === SleepSession Tests ===

def test_sleep_session_from_segments_basic():
    """SleepSession.from_segments builds a valid session."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="Core"),
        SleepSegment(start_dt=s + timedelta(hours=1), end_dt=s + timedelta(hours=2), stage="REM"),
    ]
    sess = SleepSession.from_segments(segs)
    assert sess.duration == timedelta(hours=2)
    assert sess.asleep_duration == timedelta(hours=2)
    assert sess.awake_duration == timedelta(0)


def test_sleep_session_awakenings_threshold():
    """awakenings counts only Awake periods >= 2 minutes."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="Core"),
        SleepSegment(start_dt=s + timedelta(hours=1), end_dt=s + timedelta(hours=1, minutes=1), stage="Awake"),
        SleepSegment(start_dt=s + timedelta(hours=1, minutes=1), end_dt=s + timedelta(hours=1, minutes=3), stage="Awake"),
        SleepSegment(start_dt=s + timedelta(hours=1, minutes=3), end_dt=s + timedelta(hours=2), stage="Core"),
    ]
    sess = SleepSession.from_segments(segs)
    assert sess.awakenings == 1  # only the 2-minute one counts


def test_sleep_session_to_dict():
    """to_dict serializes correctly with camelCase keys."""
    s = datetime(2024, 1, 5, 23, 0, tzinfo=timezone.utc)
    segs = [
        SleepSegment(start_dt=s, end_dt=s + timedelta(hours=1), stage="Core"),
    ]
    sess = SleepSession.from_segments(segs)
    d = sess.to_dict()
    assert d["duration"] == 3600
    assert d["asleepDuration"] == 3600
    assert d["awakeDuration"] == 0
    assert d["awakenings"] == 0
    assert isinstance(d["segments"], list)
    assert len(d["segments"]) == 1


# === Integration Tests ===

def test_iter_sleep_segments_smoke(sample_xml_path: str):
    """iter_sleep_segments produces valid segments from real data."""
    segs = list(iter_sleep_segments(sample_xml_path))
    assert segs
    assert all(isinstance(s, SleepSegment) for s in segs)
    assert all(s.stage in SLEEP_STAGES.values() for s in segs)
    assert all(s.end_dt >= s.start_dt for s in segs)


def test_build_sleep_sessions_smoke(sample_xml_path: str):
    """build_sleep_sessions produces valid sessions from real data."""
    segs = list(iter_sleep_segments(sample_xml_path))
    sessions = build_sleep_sessions(segs)
    assert sessions
    for sess in sessions:
        assert sess.start_dt == sess.segments[0].start_dt
        assert sess.end_dt == sess.segments[-1].end_dt
        assert sess.awake_duration + sess.asleep_duration <= sess.duration


def test_build_sleep_sessions_respects_gap(sample_xml_path: str):
    """Sessions are separated by gap parameter."""
    segs = list(iter_sleep_segments(sample_xml_path))
    sessions = build_sleep_sessions(segs, gap=timedelta(hours=1))
    
    # Check that gaps between sessions are > 1 hour
    for a, b in zip(sessions, sessions[1:]):
        gap_between = b.start_dt - a.end_dt
        assert gap_between > timedelta(hours=1)