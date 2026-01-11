from lxml import etree  # type: ignore
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Collection, Dict, Iterator, List, Optional, Set, Union


@dataclass(frozen=True, slots=True)
class HealthRecord:
    """Immutable representation of a single Apple Health XML element."""
    tag: str
    record_type: str
    start_dt: Optional[datetime]
    end_dt: Optional[datetime]
    attributes: Dict[str, Any] = field(repr=False)

    @classmethod
    def from_element(cls, elem: etree._Element) -> "HealthRecord":
        attrs = cls._parse_attributes(elem)
        tag = elem.tag
        attrs["_tag"] = tag
        record_type = cls._determine_record_type(tag, attrs)
        attrs["_type"] = record_type
        start_dt, end_dt = cls._derive_time_window(attrs)
        return cls(tag=tag, record_type=record_type, start_dt=start_dt, end_dt=end_dt, attributes=attrs)

    @classmethod
    def from_dict(cls, attrs: Dict[str, Any]) -> "HealthRecord":
        if not isinstance(attrs, dict):
            raise TypeError("from_dict expects an attributes dict")
        attrs = dict(attrs)
        tag = attrs.get("_tag") or attrs.get("tag") or "Record"
        attrs["_tag"] = tag
        record_type = attrs.get("_type") or cls._determine_record_type(tag, attrs)
        attrs["_type"] = record_type
        start_dt, end_dt = cls._derive_time_window(attrs)
        return cls(tag=tag, record_type=record_type, start_dt=start_dt, end_dt=end_dt, attributes=attrs)

    def intersects_time_window(self, window_start: Optional[datetime], window_end: Optional[datetime]) -> bool:
        if window_start is None and window_end is None:
            return True
        if self.start_dt is None or self.end_dt is None:
            return False
        if window_start and self.end_dt < window_start:
            return False
        if window_end and self.start_dt > window_end:
            return False
        return True

    def is_any_of_types(self, allowed: Optional[Collection[str]]) -> bool:
        if allowed is None:
            return True
        return (self.record_type in allowed) or (self.tag in allowed)

    def to_dict(self) -> Dict[str, Any]:
        return dict(self.attributes)

    @staticmethod
    def _determine_record_type(tag: str, attrs: Dict[str, Any]) -> str:
        typ = attrs.get("type")
        if tag == "Workout":
            return attrs.get("workoutActivityType") or tag
        if tag in ("Correlation", "Audiogram", "ClinicalRecord"):
            return typ or tag
        if tag in ("ActivitySummary", "Me", "ExportDate"):
            return tag
        return typ or tag

    @staticmethod
    def _derive_time_window(attrs: Dict[str, Any]) -> tuple[Optional[datetime], Optional[datetime]]:
        s = to_datetime(attrs.get("startDate"))
        c = to_datetime(attrs.get("creationDate"))
        e = to_datetime(attrs.get("endDate"))
        start_dt = s or c or e
        end_dt = e or s or c
        if start_dt and end_dt and end_dt < start_dt:
            end_dt = start_dt
        return start_dt, end_dt

    @staticmethod
    def _parse_attributes(elem: etree._Element) -> Dict[str, Any]:
        attrs: Dict[str, Any] = dict(elem.attrib)
        for child in elem.iterchildren():
            if child.tag == "MetadataEntry":
                key, value = child.get("key"), child.get("value")
                if key and value is not None:
                    attrs[key] = value
            else:
                nested = HealthRecord._parse_attributes(child)
                nested.setdefault("_tag", child.tag)
                attrs.setdefault(child.tag, []).append(nested)
        return attrs


def iter_health_records(
    file_path: str,
    types: Optional[Collection[str]] = None,
    start: Optional[Union[str, datetime]] = None,
    end: Optional[Union[str, datetime]] = None,
) -> Iterator[HealthRecord]:
    """Stream Apple Health export records as HealthRecord objects (constant memory)."""
    start_dt = to_datetime(start)
    end_dt = to_datetime(end)
    if start_dt and end_dt and end_dt < start_dt:
        raise ValueError(f"end date ({end_dt}) cannot be before start date ({start_dt})")
    types_set: Optional[Set[str]] = set(types) if types else None

    try:
        context = etree.iterparse(
            file_path,
            events=("end",),
            resolve_entities=False,
            no_network=True,
            load_dtd=False,
            recover=True,
            huge_tree=True,
        )
    except OSError as e:
        raise FileNotFoundError(file_path) from e

    root_tag: Optional[str] = None
    for _, elem in context:
        if root_tag is None:
            root_tag = elem.getroottree().getroot().tag
        
        # Only process direct children of root
        parent = elem.getparent()
        if parent is None or parent.tag != root_tag:
            continue
        
        # Early type pre-filter
        if types_set:
            elem_type = elem.get("type") or elem.get("workoutActivityType")
            if elem_type and elem_type not in types_set and elem.tag not in types_set:
                _cleanup(elem)
                continue
        
        # Early time pre-filter
        if start_dt or end_dt:
            elem_start = to_datetime(elem.get("startDate"))
            elem_end = to_datetime(elem.get("endDate"))
            if (start_dt and elem_end and elem_end < start_dt) or \
               (end_dt and elem_start and elem_start > end_dt):
                _cleanup(elem)
                continue
        
        # Full parsing and final validation
        record = HealthRecord.from_element(elem)
        if record.is_any_of_types(types_set) and record.intersects_time_window(start_dt, end_dt):
            yield record
        _cleanup(elem)


def _cleanup(elem: etree._Element) -> None:
    """Free memory for parsed elements by clearing and removing previous siblings."""
    parent = elem.getparent()
    elem.clear()
    if parent is not None:
        while elem.getprevious() is not None:
            parent.remove(elem.getprevious())


def to_datetime(value: Optional[Union[str, datetime]]) -> Optional[datetime]:
    """Best-effort parser returning a timezone-aware datetime or None."""
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None

    # 1) ISO Zulu (ends with 'Z' or 'z') — keep 'T' or ' ' as-is, map Z → +00:00
    if s[-1:] in {"Z", "z"}:
        try:
            return datetime.fromisoformat(s[:-1] + "+00:00")
        except ValueError:
            return None

    # 2) Apple Health canonical export format: 'YYYY-MM-DD HH:MM:SS -0700'
    try:
        return datetime.strptime(s, "%Y-%m-%d %H:%M:%S %z")
    except ValueError:
        pass

    # 3) ISO with explicit offset (e.g., 'YYYY-MM-DDTHH:MM:SS-07:00')
    try:
        dt = datetime.fromisoformat(s)
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    # 4) Naive forms — assume UTC by policy
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue

    return None


def parse_health_data(
    file_path: str,
    types: Optional[Collection[str]] = None,
    start: Optional[Union[str, datetime]] = None,
    end: Optional[Union[str, datetime]] = None,
) -> List[Dict[str, Any]]:
    """Convenience wrapper returning a list of attribute dicts."""
    return [rec.to_dict() for rec in iter_health_records(file_path, types=types, start=start, end=end)]