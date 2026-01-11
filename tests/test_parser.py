import pytest
from pathlib import Path
from lxml import etree  # type: ignore
from apple_health_parser.parser import HealthRecord, iter_health_records, parse_health_data, to_datetime
from datetime import datetime, timezone
from typing import Any, cast, List


@pytest.fixture
def sample_xml_path() -> str:
    return str(Path(__file__).parent / "fixtures" / "sample_data.xml")


@pytest.fixture
def truncated_xml_path(tmp_path: Path) -> str:
    p = tmp_path / "truncated.xml"
    p.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<HealthData locale="en_US">\n'
        '  <Record type="HKQuantityTypeIdentifierStepCount" value="1"/>\n'
        '  <Workout workoutActivityType="HKWorkoutActivityTypeRunning"/>\n',
        encoding="utf-8",
    )
    return str(p)


@pytest.fixture
def minimal_record_xml_path(tmp_path: Path) -> str:
    """
    Small, valid XML with a record intentionally missing start/end attributes.
    Used to assert the parser retains such records (regardless of fixture contents).
    """
    p = tmp_path / "minimal_record.xml"
    p.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<HealthData locale="en_US">\n'
        '  <Record type="HKQuantityTypeIdentifierStepCount" creationDate="2024-06-01 10:00:00 -0700" unit="count" value="10"/>\n'
        '</HealthData>\n',
        encoding="utf-8",
    )
    return str(p)


def test_parses_one_item_per_top_level_child(sample_xml_path: str):
    root = etree.parse(sample_xml_path).getroot()
    expected = len(root)

    records = parse_health_data(sample_xml_path)

    assert isinstance(records, list)
    assert len(records) == expected


def test_flattens_metadata_entries(sample_xml_path: str) -> None:
    records = parse_health_data(sample_xml_path)

    # Find any Deep sleep segment with algorithm metadata flattened
    deep = next(
        r for r in records
        if r.get("type") == "HKCategoryTypeIdentifierSleepAnalysis"
        and r.get("value", "").endswith("AsleepDeep")
        and r.get("SleepAlgorithmVersion") is not None
    )
    assert "HKTimeZone" in deep
    assert deep.get("SleepAlgorithmVersion") in {"1", "2", "3"}  # common realistic values

    # Find any StepCount record with timezone metadata flattened
    steps = next(
        r for r in records
        if r.get("type") == "HKQuantityTypeIdentifierStepCount"
        and r.get("HKTimeZone") is not None
    )
    assert "HKTimeZone" in steps


def test_parses_all_record_types_and_excludes_metadata(sample_xml_path: str):
    records = parse_health_data(sample_xml_path)

    workouts = [r for r in records if "workoutActivityType" in r]
    assert len(workouts) > 0
    # Ensure at least one running workout exists in the dataset
    assert "HKWorkoutActivityTypeRunning" in {w.get("workoutActivityType") for w in workouts}
    # No raw <MetadataEntry ...> keys should leak through
    assert all("key" not in r for r in records)


def test_parses_workout_with_nested_data_lists(sample_xml_path: str):
    records = parse_health_data(sample_xml_path)

    # Look for any workout that includes nested lists like events/stats/route
    complex_workout = next(
        r for r in records
        if "workoutActivityType" in r
        and any(k in r for k in ("WorkoutEvent", "WorkoutStatistics", "WorkoutRoute"))
    )

    assert complex_workout is not None
    # Presence (non-empty) of nested lists
    if "WorkoutEvent" in complex_workout:
        assert isinstance(complex_workout["WorkoutEvent"], list)
        assert len(complex_workout["WorkoutEvent"]) > 0
    if "WorkoutStatistics" in complex_workout:
        assert isinstance(complex_workout["WorkoutStatistics"], list)
        assert len(complex_workout["WorkoutStatistics"]) > 0
    if "WorkoutRoute" in complex_workout:
        assert isinstance(complex_workout["WorkoutRoute"], list)
        assert len(complex_workout["WorkoutRoute"]) > 0


def test_keeps_records_with_missing_attributes(minimal_record_xml_path: str):
    records = parse_health_data(minimal_record_xml_path)

    record = next(r for r in records if r.get("type") == "HKQuantityTypeIdentifierStepCount")
    assert "startDate" not in record
    assert "endDate" not in record
    assert record.get("value") == "10"


def test_recovers_from_truncated_xml(truncated_xml_path: str):
    records = parse_health_data(truncated_xml_path)

    assert len(records) > 0
    assert any(r.get("type") == "HKQuantityTypeIdentifierStepCount" for r in records)
    assert any("workoutActivityType" in r for r in records)


def test_raises_on_missing_file():
    with pytest.raises(FileNotFoundError):
        parse_health_data("non_existent_file.xml")


def test_raises_on_reversed_range(sample_xml_path: str):
    with pytest.raises(ValueError):
        parse_health_data(
            sample_xml_path,
            start="2024-01-21 00:00:00 -0700",
            end="2024-01-20 00:00:00 -0700",
        )


def test_filters_by_type_excludes_other_types(sample_xml_path: str):
    target_type = "HKQuantityTypeIdentifierHeartRate"
    records = parse_health_data(sample_xml_path, types=[target_type])

    assert len(records) > 0
    result_types = {r.get("type") for r in records}
    assert result_types == {target_type}
    assert not any("workoutActivityType" in r for r in records)


def test_filters_by_time_range_is_inclusive(sample_xml_path: str):
    all_records = parse_health_data(sample_xml_path)
    starts = [sd for r in all_records if (sd := r.get("startDate")) is not None]
    starts.sort()

    # Require enough data to test boundary + after-window
    assert len(starts) >= 3

    start_str = starts[0]
    end_str = starts[1]
    after_str = starts[2]

    record_on_start_boundary = next(r for r in all_records if r.get("startDate") == start_str)
    record_on_end_boundary = next(r for r in all_records if r.get("startDate") == end_str)
    record_after_window = next(r for r in all_records if r.get("startDate") == after_str)

    records = parse_health_data(sample_xml_path, start=start_str, end=end_str)

    assert len(records) > 0
    assert record_on_start_boundary in records
    assert record_on_end_boundary in records
    assert record_after_window not in records

    for r in records:
        record_start = r.get("startDate") or r.get("creationDate")
        assert record_start is not None
        record_end = r.get("endDate") or record_start
        assert record_end >= start_str
        assert record_start <= end_str


def test_filters_by_type_and_time_range_applies_both(sample_xml_path: str):
    all_records = parse_health_data(sample_xml_path)

    # Build a map of {type: [startDate,...]} with explicit type narrowing to str
    types_with_starts: dict[str, list[str]] = {}
    for r in all_records:
        t = r.get("type")
        sd = r.get("startDate")
        if isinstance(t, str) and isinstance(sd, str):
            types_with_starts.setdefault(t, []).append(sd)

    # If nothing has start dates, there's nothing meaningful to test
    if not types_with_starts:
        pytest.skip("No timestamped records in sample data.")

    # Prefer HeartRate if it has at least 2 samples; otherwise pick any type with >=2
    if "HKQuantityTypeIdentifierHeartRate" in types_with_starts and len(types_with_starts["HKQuantityTypeIdentifierHeartRate"]) >= 2:
        target_type = "HKQuantityTypeIdentifierHeartRate"
        starts_for_type = sorted(types_with_starts[target_type])
    else:
        choice = next(((t, sorted(sds)) for t, sds in types_with_starts.items() if len(sds) >= 2), None)
        if choice is None:
            pytest.skip("No record type has at least two timestamped samples to define a time window.")
        target_type, starts_for_type = choice

    start_str = starts_for_type[0]
    end_str = starts_for_type[1]

    # Find a non-target record in the same window (optional exclusion assertion)
    non_target_in_window = next(
        (
            r for r in all_records
            if r.get("type") != target_type
            and isinstance(r.get("startDate"), str)
            and start_str <= r["startDate"] <= end_str  # type: ignore[index]
        ),
        None,
    )

    records = parse_health_data(sample_xml_path, types=[target_type], start=start_str, end=end_str)

    assert records, f"Expected some {target_type} records between {start_str} and {end_str}"
    assert all(r.get("type") == target_type for r in records)

    # Time window assertions with Optional-safe access
    for r in records:
        record_start = r.get("startDate") or r.get("creationDate")
        assert isinstance(record_start, str)
        record_end = r.get("endDate") or record_start
        assert isinstance(record_end, str)
        assert record_end >= start_str
        assert record_start <= end_str

    if non_target_in_window is not None:
        assert non_target_in_window not in records


def test_supports_iso8601_filters(sample_xml_path: str):
    # Pick any record with a startDate, turn that into Zulu time, and query by ISO8601.
    all_records = parse_health_data(sample_xml_path)
    target = next(r for r in all_records if isinstance(r.get("startDate"), str))
    start_str = cast(str, target.get("startDate"))

    dt_local = cast(datetime, to_datetime(start_str))  # tz-aware
    iso_z = dt_local.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    records = parse_health_data(sample_xml_path, start=iso_z, end=iso_z)
    starts = {r.get("startDate") for r in records}
    assert start_str in starts


def test_to_datetime_handles_iso_zulu_time():
    input_str = "2024-01-20 15:30:00Z"
    expected = datetime(2024, 1, 20, 15, 30, 0, tzinfo=timezone.utc)
    assert to_datetime(input_str) == expected


def test_to_dict_returns_attributes_dict():
    attrs = {
        "type": "HKQuantityTypeIdentifierStepCount",
        "startDate": "2024-01-20 08:00:00 -0700",
        "endDate": "2024-01-20 08:05:00 -0700",
        "value": "100",
        "unit": "count",
        "_tag": "Record",
        "_type": "HKQuantityTypeIdentifierStepCount",
    }
    
    record = HealthRecord.from_dict(attrs)
    result = record.to_dict()
    
    assert isinstance(result, dict)
    assert result["type"] == "HKQuantityTypeIdentifierStepCount"
    assert result["value"] == "100"
    assert result["unit"] == "count"
    assert "_tag" in result
    assert "_type" in result


def test_from_dict_basic():
    attrs = {
        "type": "HKQuantityTypeIdentifierHeartRate",
        "startDate": "2024-03-02 07:30:00 -0800",
        "endDate": "2024-03-02 07:30:00 -0800",
        "value": "88",
        "unit": "count/min",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    assert record.tag == "Record"  # default tag
    assert record.record_type == "HKQuantityTypeIdentifierHeartRate"
    assert record.start_dt is not None
    assert record.end_dt is not None
    assert record.attributes["type"] == "HKQuantityTypeIdentifierHeartRate"
    assert record.attributes["value"] == "88"


def test_from_dict_with_tag():
    attrs = {
        "_tag": "Workout",
        "workoutActivityType": "HKWorkoutActivityTypeRunning",
        "startDate": "2024-03-02 07:30:00 -0800",
        "endDate": "2024-03-02 08:15:00 -0800",
        "duration": "2700",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    assert record.tag == "Workout"
    assert record.record_type == "HKWorkoutActivityTypeRunning"
    assert record.attributes["workoutActivityType"] == "HKWorkoutActivityTypeRunning"


def test_from_dict_with_explicit_type():
    attrs = {
        "_tag": "CustomTag",
        "_type": "CustomType",
        "startDate": "2024-01-20 08:00:00 -0700",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    assert record.tag == "CustomTag"
    assert record.record_type == "CustomType"
    assert record.attributes["_type"] == "CustomType"


def test_from_dict_derives_time_window():
    attrs = {
        "type": "HKQuantityTypeIdentifierStepCount",
        "startDate": "2024-01-20 08:00:00 -0700",
        "endDate": "2024-01-20 08:15:00 -0700",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    expected_start = to_datetime("2024-01-20 08:00:00 -0700")
    expected_end = to_datetime("2024-01-20 08:15:00 -0700")
    
    assert record.start_dt == expected_start
    assert record.end_dt == expected_end


def test_from_dict_missing_dates():
    attrs = {
        "type": "HKQuantityTypeIdentifierStepCount",
        "value": "100",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    assert record.start_dt is None
    assert record.end_dt is None


def test_from_dict_raises_on_invalid_input():
    with pytest.raises(TypeError, match="from_dict expects an attributes dict"):
        HealthRecord.from_dict("not a dict")  # type: ignore
    
    with pytest.raises(TypeError, match="from_dict expects an attributes dict"):
        HealthRecord.from_dict([1, 2, 3])  # type: ignore


def test_to_dict_from_dict_round_trip():
    original_attrs = {
        "type": "HKQuantityTypeIdentifierStepCount",
        "startDate": "2024-01-20 08:00:00 -0700",
        "endDate": "2024-01-20 08:05:00 -0700",
        "value": "100",
        "unit": "count",
        "sourceName": "Apple Watch",
        "HKTimeZone": "America/Los_Angeles",
    }
    
    # Create record from dict
    record1 = HealthRecord.from_dict(original_attrs)
    
    # Convert to dict
    dict1 = record1.to_dict()
    
    # Create new record from that dict
    record2 = HealthRecord.from_dict(dict1)
    
    # Convert back to dict
    dict2 = record2.to_dict()
    
    # Both records should be equivalent
    assert record1.tag == record2.tag
    assert record1.record_type == record2.record_type
    assert record1.start_dt == record2.start_dt
    assert record1.end_dt == record2.end_dt
    
    # Dicts should be identical (including injected _tag and _type)
    assert dict1 == dict2


def test_from_dict_preserves_nested_structures():
    attrs = {
        "type": "Workout",
        "workoutActivityType": "HKWorkoutActivityTypeRunning",
        "startDate": "2024-03-02 07:30:00 -0800",
        "endDate": "2024-03-02 08:15:00 -0800",
        "WorkoutEvent": [
            {"_tag": "WorkoutEvent", "type": "HKWorkoutEventTypeMotionPaused"},
            {"_tag": "WorkoutEvent", "type": "HKWorkoutEventTypeMotionResumed"},
        ],
        "WorkoutStatistics": [
            {"_tag": "WorkoutStatistics", "type": "HKQuantityTypeIdentifierActiveEnergyBurned", "sum": "345.2"},
        ],
    }
    
    record = HealthRecord.from_dict(attrs)
    result = record.to_dict()
    
    assert "WorkoutEvent" in result
    assert isinstance(result["WorkoutEvent"], list)
    assert len(result["WorkoutEvent"]) == 2
    assert result["WorkoutEvent"][0]["type"] == "HKWorkoutEventTypeMotionPaused"
    
    assert "WorkoutStatistics" in result
    assert isinstance(result["WorkoutStatistics"], list)
    assert len(result["WorkoutStatistics"]) == 1


def test_to_dict_does_not_mutate_original():
    attrs = {
        "type": "HKQuantityTypeIdentifierStepCount",
        "value": "100",
    }
    
    record = HealthRecord.from_dict(attrs)
    result1 = record.to_dict()
    result2 = record.to_dict()
    
    # Should be equal but not the same object
    assert result1 == result2
    assert result1 is not result2
    
    # Mutating returned dict should not affect record
    result1["value"] = "999"
    assert record.attributes["value"] == "100"
    assert record.to_dict()["value"] == "100"


def test_from_dict_handles_all_date_formats():
    date_formats = [
        "2024-01-20 08:00:00 -0700",  # Apple Health format
        "2024-01-20T08:00:00-07:00",  # ISO 8601
        "2024-01-20T08:00:00Z",       # Zulu time
        "2024-01-20 08:00:00",        # Naive (assumes UTC)
    ]
    
    for date_str in date_formats:
        attrs = {
            "type": "Test",
            "startDate": date_str,
        }
        record = HealthRecord.from_dict(attrs)
        assert record.start_dt is not None, f"Failed to parse: {date_str}"


def test_from_dict_with_workout_type_fallback():
    attrs = {
        "_tag": "Workout",
        "workoutActivityType": "HKWorkoutActivityTypeCycling",
        "startDate": "2024-06-12 17:30:00 -0700",
        "endDate": "2024-06-12 18:25:00 -0700",
    }
    
    record = HealthRecord.from_dict(attrs)
    
    assert record.record_type == "HKWorkoutActivityTypeCycling"
    assert "type" not in record.attributes  # Should not inject "type" attribute


def test_to_dict_includes_metadata_entries():
    # Use sample data that has metadata
    records = list(iter_health_records(
        str(Path(__file__).parent / "fixtures" / "sample_data.xml"),
        types=["HKCategoryTypeIdentifierSleepAnalysis"],
    ))
    
    # Find a record with metadata
    record_with_metadata = next(
        r for r in records 
        if "HKTimeZone" in r.to_dict()
    )
    
    result = record_with_metadata.to_dict()
    assert "HKTimeZone" in result
    assert result["HKTimeZone"]  # Should have a value


def test_from_dict_consistency_with_real_data(sample_xml_path: str):
    records = list(iter_health_records(sample_xml_path))
    
    for original in records:
        # Convert to dict and back
        attrs = original.to_dict()
        reconstructed = original.from_dict(attrs)
        
        # Verify consistency
        assert original.tag == reconstructed.tag
        assert original.record_type == reconstructed.record_type
        assert original.start_dt == reconstructed.start_dt
        assert original.end_dt == reconstructed.end_dt
        
        # Deep comparison of attributes
        original_dict = original.to_dict()
        reconstructed_dict = reconstructed.to_dict()
        assert original_dict == reconstructed_dict