from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Iterable, Iterator, List, Optional, Tuple, Union, Dict

from .parser import iter_health_records

SLEEP_TYPE = "HKCategoryTypeIdentifierSleepAnalysis"
SLEEP_STAGES = {
    "HKCategoryValueSleepAnalysisAwake": "Awake",
    "HKCategoryValueSleepAnalysisAsleepCore": "Core",
    "HKCategoryValueSleepAnalysisAsleepDeep": "Deep",
    "HKCategoryValueSleepAnalysisAsleepREM": "REM",
    "HKCategoryValueSleepAnalysisInBed": "InBed",
    "HKCategoryValueSleepAnalysisAsleep": "Asleep",
    "HKCategoryValueSleepAnalysisAsleepUnspecified": "Unspecified",
    None: "Unspecified",
}

# Stage priority for overlap resolution: higher = wins
_STAGE_PRIORITY: Dict[str, int] = {
    "Awake": 5,
    "REM": 4,
    "Deep": 3,
    "Core": 2,
    "Asleep": 1,
    "Unspecified": 0,
}


@dataclass(frozen=True, slots=True)
class SleepSegment:
    """Immutable sleep segment (a period with a single stage)."""
    start_dt: datetime
    end_dt: datetime
    stage: str

    def __post_init__(self):
        if not isinstance(self.start_dt, datetime) or not isinstance(self.end_dt, datetime):
            raise TypeError("start_dt and end_dt must be datetime objects")
        if self.end_dt < self.start_dt:
            raise ValueError(f"end_dt ({self.end_dt}) cannot be before start_dt ({self.start_dt})")
        if self.stage not in SLEEP_STAGES.values():
            raise ValueError(f"Invalid stage: {self.stage}")

    @property
    def duration(self) -> timedelta:
        return self.end_dt - self.start_dt


@dataclass(frozen=True, slots=True)
class SleepSession:
    """Aggregation of contiguous sleep segments (one night's sleep)."""
    start_dt: datetime
    end_dt: datetime
    segments: Tuple[SleepSegment, ...] = field(repr=False)

    @property
    def duration(self) -> timedelta:
        return self.end_dt - self.start_dt

    @property
    def asleep_duration(self) -> timedelta:
        return sum(
            (s.duration for s in self.segments if s.stage != "Awake"),
            timedelta(),
        )

    @property
    def awake_duration(self) -> timedelta:
        return sum(
            (s.duration for s in self.segments if s.stage == "Awake"),
            timedelta(),
        )

    @property
    def awakenings(self) -> int:
        """Count of Awake periods >= 2 minutes."""
        return sum(
            1 for s in self.segments 
            if s.stage == "Awake" and s.duration >= timedelta(minutes=2)
        )

    @classmethod
    def from_segments(cls, segments: Iterable[SleepSegment]) -> "SleepSession":
        """Build a session from raw segments, normalizing overlaps and InBed."""
        norm = cls._normalize(list(segments))
        if not norm:
            raise ValueError("SleepSession requires at least one non-InBed segment")
        return cls(start_dt=norm[0].start_dt, end_dt=norm[-1].end_dt, segments=tuple(norm))

    @classmethod
    def _normalize(cls, segs: List[SleepSegment]) -> List[SleepSegment]:
        """Build disjoint, ordered segments from potentially overlapping input."""
        # Filter out InBed and zero-duration segments.
        segs = [s for s in segs if s.stage != "InBed" and s.duration > timedelta(0)]
        if not segs:
            return []

        # Sort by start time.
        segs = sorted(segs, key=lambda s: (s.start_dt, s.end_dt))

        # Build timeline of unique boundaries
        boundaries = sorted(set(t for s in segs for t in (s.start_dt, s.end_dt)))

        # For each interval [a, b), determine which stage covers it
        result: List[SleepSegment] = []
        for a, b in zip(boundaries, boundaries[1:]):
            # Find all segments that overlap [a, b)
            covering = [s for s in segs if s.start_dt < b and s.end_dt > a]
            if not covering:
                continue

            # Pick highest-priority stage
            winner_stage = max(
                covering,
                key=lambda s: _STAGE_PRIORITY.get(s.stage, 0),
            ).stage

            result.append(SleepSegment(start_dt=a, end_dt=b, stage=winner_stage))

        # Merge adjacent same-stage segments
        if not result:
            return []

        merged = [result[0]]
        for seg in result[1:]:
            prev = merged[-1]
            if seg.stage == prev.stage and seg.start_dt == prev.end_dt:
                merged[-1] = SleepSegment(
                    start_dt=prev.start_dt,
                    end_dt=seg.end_dt,
                    stage=seg.stage,
                )
            else:
                merged.append(seg)

        return merged

    def to_dict(self) -> Dict[str, object]:
        return {
            "startDate": self.start_dt.isoformat(timespec="seconds"),
            "endDate": self.end_dt.isoformat(timespec="seconds"),
            "duration": self.duration.total_seconds(),
            "asleepDuration": self.asleep_duration.total_seconds(),
            "awakeDuration": self.awake_duration.total_seconds(),
            "awakenings": self.awakenings,
            "segments": [
                {
                    "stage": s.stage,
                    "startDate": s.start_dt.isoformat(timespec="seconds"),
                    "endDate": s.end_dt.isoformat(timespec="seconds"),
                    "duration": s.duration.total_seconds(),
                }
                for s in self.segments
            ],
        }


def iter_sleep_segments(
    file_path: str,
    start: Optional[Union[str, datetime]] = None,
    end: Optional[Union[str, datetime]] = None,
) -> Iterator[SleepSegment]:
    """Stream SleepSegment objects from raw health records."""
    for rec in iter_health_records(file_path, types=[SLEEP_TYPE], start=start, end=end):
        if rec.start_dt and rec.end_dt and rec.end_dt > rec.start_dt:
            stage = SLEEP_STAGES.get(rec.attributes.get("value"), "Unspecified")
            yield SleepSegment(start_dt=rec.start_dt, end_dt=rec.end_dt, stage=stage)


def build_sleep_sessions(
    segments: Iterable[SleepSegment],
    gap: timedelta = timedelta(hours=2),
) -> List[SleepSession]:
    """Group sleep segments into sessions separated by gaps."""
    segs = [s for s in segments if s.stage != "InBed" and s.duration > timedelta(0)]
    if not segs:
        return []
    
    sessions: List[SleepSession] = []
    current: List[SleepSegment] = []

    for seg in segs:
        if not current:
            current = [seg]
            continue
        if seg.start_dt - current[-1].end_dt > gap:
            sessions.append(SleepSession.from_segments(current))
            current = [seg]
        else:
            current.append(seg)

    if current:
        sessions.append(SleepSession.from_segments(current))

    return sessions
