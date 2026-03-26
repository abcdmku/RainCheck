from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from raincheck_weather.app import app
from raincheck_weather import derivations


client = TestClient(app)


def _time_window() -> dict:
    return {
        "start": "2026-03-24T12:00:00Z",
        "end": "2026-03-24T18:00:00Z",
        "referenceTime": "2026-03-24T12:00:00Z",
        "recentHours": 6,
    }


def _region() -> dict:
    return {
        "type": "point",
        "location": {
            "query": "Oklahoma City, OK",
            "name": "Oklahoma City, OK",
            "latitude": 35.4676,
            "longitude": -97.5164,
            "region": "Oklahoma",
            "country": "United States",
            "resolvedBy": "pytest",
        },
        "radiusKm": 120.0,
    }


def _derive_request(*, workflow: str, domain: str, question: str, focus: str) -> dict:
    return {
        "userQuestion": question,
        "workflow": workflow,
        "domain": domain,
        "region": _region(),
        "timeWindow": _time_window(),
        "focus": focus,
        "variables": ["cape", "shear", "storm-mode"],
        "requestedArtifacts": [
            {
                "type": "single-model-panel",
                "required": True,
            }
        ],
        "includeOfficialContext": True,
    }


GENERIC_SOURCE_PREFIXES = {
    "https://nomads.ncep.noaa.gov/",
    "https://www.wpc.ncep.noaa.gov/",
    "https://www.spc.noaa.gov/products/",
    "https://www.nssl.noaa.gov/projects/mrms/",
    "https://www.noaa.gov/nodd/datasets",
}


def _public_provenance(body: dict) -> list[dict]:
    provenance: list[dict] = []
    for product in body["evidenceProducts"]:
        for item in product.get("provenance", []):
            if item.get("kind") == "derived":
                continue
            if item.get("url") or item.get("contextUrl"):
                provenance.append(item)
    return provenance


def _assert_public_provenance_is_concrete(body: dict) -> None:
    provenance = _public_provenance(body)
    assert provenance
    for item in provenance:
        assert item["kind"] in {"api", "page", "image", "dataset", "artifact"}
        url = item.get("url") or item.get("contextUrl")
        assert url
        assert url not in GENERIC_SOURCE_PREFIXES
        assert "gribfilter.php?ds=" not in url
        assert not url.rstrip("/").endswith("nomads.ncep.noaa.gov")
        display_url = item.get("displayUrl")
        assert display_url
        if isinstance(display_url, str) and display_url.startswith("http"):
            assert display_url not in GENERIC_SOURCE_PREFIXES
            assert "gribfilter.php?ds=" not in display_url
            assert not display_url.rstrip("/").endswith("nomads.ncep.noaa.gov")


def _provenance_by_source(body: dict, source_family: str) -> dict:
    for product in body["evidenceProducts"]:
        if product.get("sourceFamily") == source_family:
            return product["provenance"][0]
    raise AssertionError(f"Missing provenance for {source_family}")


def _is_artifact_href(value: str) -> bool:
    return "/artifacts/" in value


def _is_mag_image(value: str, family: str) -> bool:
    return value.startswith(f"https://mag.ncep.noaa.gov/data/{family}/")


def test_derive_short_range_and_synthesize(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    derive_response = client.post(
        "/derive/short-range",
        json=_derive_request(
            workflow="severe-weather",
            domain="storm-mode",
            question="What is the most likely storm mode by 00z?",
            focus="storm mode and initiation",
        ),
    )

    assert derive_response.status_code == 200
    short_range = derive_response.json()
    assert short_range["workflow"] == "short-range"
    assert short_range["evidenceProducts"][0]["sourceFamily"] == "raincheck-derivation"
    assert {"href", "hrrr", "rap", "nam", "rtma", "spc"}.issubset(
        set(short_range["sourcesUsed"])
    )
    assert short_range["evidenceProducts"][0]["provenance"][0]["kind"] == "derived"
    _assert_public_provenance_is_concrete(short_range)
    assert _is_mag_image(_provenance_by_source(short_range, "hrrr")["displayUrl"], "hrrr")
    assert _is_mag_image(_provenance_by_source(short_range, "href")["displayUrl"], "href")
    assert _is_mag_image(_provenance_by_source(short_range, "rap")["displayUrl"], "rap")
    assert _is_mag_image(_provenance_by_source(short_range, "nam")["displayUrl"], "nam")
    assert _provenance_by_source(short_range, "rtma")["displayUrl"] == _provenance_by_source(
        short_range, "rtma"
    )["contextUrl"]
    assert "level" not in short_range["evidenceProducts"][0]
    assert "spatialResolution" not in short_range["evidenceProducts"][0]
    assert short_range["recommendedArtifacts"][0]["type"] == "single-model-panel"
    assert (tmp_path / short_range["recommendedArtifacts"][0]["artifactId"]).exists()

    synthesize_response = client.post(
        "/synthesize",
        json={
            "userQuestion": "What is the most likely storm mode by 00z?",
            "workflow": "severe-weather",
            "region": _region(),
            "timeWindow": _time_window(),
            "supportingBundles": [short_range],
        },
    )

    assert synthesize_response.status_code == 200
    synthesis = synthesize_response.json()
    assert "best-supported severe setup" in synthesis["bottomLine"]
    assert synthesis["confidence"]["level"] in {"medium", "high"}
    assert synthesis["recommendedArtifacts"][0]["type"] == "single-model-panel"
    assert synthesis["citations"][0]["id"]
    assert all(citation["kind"] != "derived" for citation in synthesis["citations"])
    assert all(
        citation.get("url") or citation.get("contextUrl")
        for citation in synthesis["citations"]
    )
    assert all(citation.get("displayUrl") for citation in synthesis["citations"])
    assert "imageUrl" not in synthesis["recommendedCards"][0]
    assert "artifactId" not in synthesis["recommendedCards"][0]


def test_other_derivation_endpoints(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    cases = [
        (
            "/derive/global",
            _derive_request(
                workflow="global-model",
                domain="pattern",
                question="Which large-scale pattern favors severe weather?",
                focus="medium-range pattern",
            ),
            {"gfs", "gefs", "ecmwf-open-data"},
        ),
        (
            "/derive/radar-nowcast",
            _derive_request(
                workflow="radar-analysis",
                domain="rotation",
                question="Is there tightening rotation in the leading storm?",
                focus="near-term radar and MRMS trends",
            ),
            {"nexrad", "mrms"},
        ),
        (
            "/derive/satellite",
            _derive_request(
                workflow="satellite",
                domain="convective-initiation",
                question="Is convection initiating on the dryline?",
                focus="satellite and convective initiation",
            ),
            {"goes", "glm"},
        ),
        (
            "/derive/hydrology",
            _derive_request(
                workflow="hydrology",
                domain="river-flood",
                question="How high is the flood risk along the river?",
                focus="flood timing and peak flow",
            ),
            {"nwps", "nwm", "wpc"},
        ),
    ]

    for route, payload, expected_sources in cases:
        response = client.post(route, json=payload)

        assert response.status_code == 200
        body = response.json()
        assert body["evidenceProducts"][0]["sourceFamily"] == "raincheck-derivation"
        assert set(body["sourcesUsed"]).issuperset(expected_sources)
        _assert_public_provenance_is_concrete(body)
        if route == "/derive/global":
            assert _is_artifact_href(_provenance_by_source(body, "gfs")["displayUrl"])
            assert _is_artifact_href(_provenance_by_source(body, "gefs")["displayUrl"])
            assert _is_artifact_href(_provenance_by_source(body, "ecmwf-open-data")["displayUrl"])
        elif route == "/derive/radar-nowcast":
            assert _provenance_by_source(body, "nexrad")["displayUrl"].endswith(".gif")
            assert _is_artifact_href(_provenance_by_source(body, "mrms")["displayUrl"])
        elif route == "/derive/satellite":
            assert _provenance_by_source(body, "goes")["displayUrl"].startswith("https://")
            assert _provenance_by_source(body, "glm")["displayUrl"].startswith("https://")
        elif route == "/derive/hydrology":
            assert _is_artifact_href(_provenance_by_source(body, "nwps")["displayUrl"])
            assert _is_artifact_href(_provenance_by_source(body, "nwm")["displayUrl"])
        assert body["recommendedArtifacts"][0]["type"] in {
            "brief-report",
            "single-model-panel",
        }
        assert (tmp_path / body["recommendedArtifacts"][0]["artifactId"]).exists()
        assert body["recommendedCards"][0]["relevance"] == "primary"


def test_global_missing_sources_under_claim_when_unresolved(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))
    monkeypatch.setattr(derivations, "_gefs_url", lambda cycle: None)

    response = client.post(
        "/derive/global",
        json=_derive_request(
            workflow="global-model",
            domain="pattern",
            question="Which large-scale pattern favors severe weather?",
            focus="medium-range pattern",
        ),
    )

    assert response.status_code == 200
    body = response.json()
    assert "gefs" in body["sourcesMissing"]
    assert "gefs" not in body["sourcesUsed"]


def test_synthesize_returns_low_confidence_without_evidence() -> None:
    response = client.post(
        "/synthesize",
        json={
            "userQuestion": "What is the storm mode by 00z?",
            "workflow": "severe-weather",
            "region": _region(),
            "timeWindow": _time_window(),
            "supportingBundles": [],
            "evidenceProducts": [],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["confidence"]["level"] == "low"
    assert body["keyConflicts"] == ["No evidence products were available."]


def test_synthesize_supports_general_target_chase_guidance(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    derive_response = client.post(
        "/derive/short-range",
        json=_derive_request(
            workflow="severe-weather",
            domain="storm-mode",
            question="What is the most likely storm mode by 00z?",
            focus="storm mode and initiation",
        ),
    )

    assert derive_response.status_code == 200
    short_range = derive_response.json()

    synthesize_response = client.post(
        "/synthesize",
        json={
            "userQuestion": "From Oklahoma City, what time and where should I start the chase?",
            "workflow": "severe-weather",
            "region": _region(),
            "timeWindow": _time_window(),
            "chaseGuidanceLevel": "general-target",
            "supportingBundles": [short_range],
        },
    )

    assert synthesize_response.status_code == 200
    body = synthesize_response.json()
    assert "start near" in body["bottomLine"].lower()
    assert "corridor" in body["bottomLine"].lower()
    assert body["confidence"]["level"] in {"medium", "high"}
