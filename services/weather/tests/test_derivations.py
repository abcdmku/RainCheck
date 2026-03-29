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
            "timezone": "America/Chicago",
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


def _location(name: str, latitude: float, longitude: float) -> dict:
    return {
        "query": name,
        "name": name,
        "latitude": latitude,
        "longitude": longitude,
        "resolvedBy": "pytest",
    }


def _comparison_envelope(
    *,
    source_id: str,
    source_name: str,
    product_domain: str,
    location: dict,
    summary: str,
    confidence: float,
    data: dict | None = None,
) -> dict:
    return {
        "sourceId": source_id,
        "sourceName": source_name,
        "retrievedAt": "2026-03-24T12:00:00Z",
        "validAt": "2026-03-24T12:00:00Z",
        "location": location,
        "units": {},
        "confidence": confidence,
        "summary": summary,
        "normalizedForecast": {
            "domain": product_domain,
            "headline": summary,
            "alternateScenarios": [],
            "keySignals": [],
            "conflicts": [],
            "failureModes": [],
            "whatWouldChange": [],
            "productCards": [],
            "recommendedProductIds": [],
        },
        "data": data or {},
        "citations": [],
    }


def _comparison_bundle(
    *,
    workflow: str,
    location: dict,
    source_family: str,
    signal_score: float,
    confidence: float,
    summary: str,
) -> dict:
    return {
        "workflow": workflow,
        "region": {
            "type": "point",
            "location": location,
            "radiusKm": 120,
        },
        "analysisWindow": _time_window(),
        "evidenceProducts": [
            {
                "id": f"{source_family}-signal",
                "sourceFamily": source_family,
                "sourceName": source_family.upper(),
                "validTime": "2026-03-24T18:00:00Z",
                "geometry": {
                    "type": "point",
                    "latitude": location["latitude"],
                    "longitude": location["longitude"],
                },
                "fieldName": "composite_signal",
                "fieldType": "derived_diagnostic",
                "units": "index",
                "summary": summary,
                "signalScore": signal_score,
                "confidence": confidence,
                "provenance": [],
                "artifactHandles": [],
            }
        ],
        "agreementSummary": summary,
        "keyConflicts": [],
        "recommendedCards": [],
        "recommendedArtifacts": [],
        "sourcesUsed": [source_family],
        "sourcesMissing": [],
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


def test_synthesize_avoids_raw_source_summary_as_storm_bottom_line() -> None:
    location = _region()["location"]

    response = client.post(
        "/synthesize",
        json={
            "userQuestion": "Best storm to spot currently?",
            "workflow": "weather-analysis",
            "region": _region(),
            "timeWindow": _time_window(),
            "supportingBundles": [
                _comparison_bundle(
                    workflow="weather-analysis",
                    location=location,
                    source_family="rtma",
                    signal_score=0.61,
                    confidence=0.67,
                    summary=(
                        "RTMA keeps the boundary placement sharp enough that corridor "
                        "placement still depends on mesoscale position errors."
                    ),
                )
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "The best-supported call for" not in body["bottomLine"]
    assert "RTMA keeps the boundary placement" not in body["bottomLine"]
    assert "still too conditional to support one best storm target yet" in body["bottomLine"]


def test_synthesize_uses_plain_english_for_medium_range_bottom_line(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    derive_response = client.post(
        "/derive/global",
        json=_derive_request(
            workflow="global-model",
            domain="pattern",
            question="Any good storms in this upcoming week?",
            focus="medium-range pattern",
        ),
    )

    assert derive_response.status_code == 200
    global_bundle = derive_response.json()

    synthesize_response = client.post(
        "/synthesize",
        json={
            "userQuestion": "Any good storms in this upcoming week?",
            "workflow": "global-model",
            "region": _region(),
            "timeWindow": _time_window(),
            "answerTone": "casual",
            "supportingBundles": [global_bundle],
        },
    )

    assert synthesize_response.status_code == 200
    body = synthesize_response.json()
    assert "The best-supported call for" not in body["bottomLine"]
    assert "hazard framing" not in body["bottomLine"]
    assert "ensemble spread" not in body["bottomLine"]
    assert "The WPC hazards outlook points to a decent storm corridor" in body["bottomLine"]
    assert "the models still disagree enough that the setup could shift" in body["bottomLine"]

    professional_response = client.post(
        "/synthesize",
        json={
            "userQuestion": "Any good storms in this upcoming week?",
            "workflow": "global-model",
            "region": _region(),
            "timeWindow": _time_window(),
            "answerTone": "professional",
            "supportingBundles": [global_bundle],
        },
    )

    assert professional_response.status_code == 200
    professional_body = professional_response.json()
    assert "WPC hazard framing points to a meaningful impact corridor" in professional_body["bottomLine"]
    assert "but ensemble spread still needs to be accounted for" in professional_body["bottomLine"]


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


def test_synthesize_names_nearby_target_and_uses_user_local_time(
    tmp_path: Path, monkeypatch
) -> None:
    monkeypatch.setenv("ARTIFACTS_DIR", str(tmp_path))

    derive_response = client.post(
        "/derive/short-range",
        json=_derive_request(
            workflow="severe-weather",
            domain="storm-mode",
            question="Where should I start chasing from Chicago today?",
            focus="storm mode and initiation",
        ),
    )

    assert derive_response.status_code == 200
    short_range = derive_response.json()

    synthesize_response = client.post(
        "/synthesize",
        json={
            "userQuestion": "Where should I start chasing from Chicago today and how far should I track before dark?",
            "workflow": "severe-weather",
            "region": _region(),
            "timeWindow": _time_window(),
            "chaseGuidanceLevel": "general-target",
            "originLocation": {
                "query": "Chicago, IL",
                "name": "Chicago, Illinois, United States",
                "latitude": 41.8781,
                "longitude": -87.6298,
                "region": "Illinois",
                "country": "United States",
                "timezone": "America/Chicago",
                "resolvedBy": "pytest",
            },
            "displayTimezone": "America/Chicago",
            "timeDisplay": "user-local",
            "selectedTarget": {
                "query": "Springfield, Illinois",
                "label": "Springfield to Bloomington-Normal in central Illinois",
                "location": {
                    "query": "Springfield, Illinois",
                    "name": "Springfield, Illinois, United States",
                    "latitude": 39.7817,
                    "longitude": -89.6501,
                    "region": "Illinois",
                    "country": "United States",
                    "timezone": "America/Chicago",
                    "resolvedBy": "pytest",
                },
                "regionLabel": "central Illinois",
                "startLabel": "Springfield",
                "stopLabel": "Bloomington-Normal",
                "travelHours": 3.1,
                "corridorHours": 1.0,
                "withinNearbyRadius": False,
                "supportScore": 0.78,
            },
            "nightfall": {
                "event": "civil-dusk",
                "occursAt": "2026-03-25T23:15:00Z",
            },
            "supportingBundles": [short_range],
        },
    )

    assert synthesize_response.status_code == 200
    body = synthesize_response.json()
    assert "Nothing within about 3 hours of Chicago" in body["bottomLine"]
    assert "Springfield to Bloomington-Normal in central Illinois" in body["bottomLine"]
    assert "civil dusk around" in body["mostLikelyScenario"]
    assert "UTC" not in body["bottomLine"]
    assert "UTC" not in body["mostLikelyScenario"]


def test_compare_endpoint_ranks_the_stronger_severe_candidate() -> None:
    bloomington = _location(
        "Bloomington, Illinois, United States", 40.4842, -88.9937
    )
    paxton = _location("Paxton, Illinois, United States", 40.4598, -88.0956)

    response = client.post(
        "/compare",
        json={
            "userQuestion": "Compare Bloomington and Paxton for tornado favorability.",
            "workflow": "severe-weather",
            "answerMode": "compare",
            "candidateMode": "named",
            "rankLimit": 2,
            "rankingObjective": "severe-favorability",
            "candidates": [
                {
                    "candidate": {
                        "query": "Bloomington, IL",
                        "label": "Bloomington, IL",
                        "location": bloomington,
                        "source": "user",
                    },
                    "severeContext": _comparison_envelope(
                        source_id="spc",
                        source_name="Storm Prediction Center",
                        product_domain="severe-context",
                        location=bloomington,
                        summary="Slight risk severe context for Bloomington.",
                        confidence=0.72,
                    ),
                    "supportingBundles": [
                        _comparison_bundle(
                            workflow="severe-weather",
                            location=bloomington,
                            source_family="hrrr",
                            signal_score=0.52,
                            confidence=0.58,
                            summary="Short-range severe signal is present but not dominant.",
                        ),
                        _comparison_bundle(
                            workflow="severe-weather",
                            location=bloomington,
                            source_family="nexrad",
                            signal_score=0.44,
                            confidence=0.5,
                            summary="Radar support is weaker here than farther east.",
                        ),
                    ],
                },
                {
                    "candidate": {
                        "query": "Paxton, IL",
                        "label": "Paxton, IL",
                        "location": paxton,
                        "source": "user",
                    },
                    "severeContext": _comparison_envelope(
                        source_id="spc",
                        source_name="Storm Prediction Center",
                        product_domain="severe-context",
                        location=paxton,
                        summary="Enhanced risk severe context for Paxton.",
                        confidence=0.86,
                    ),
                    "supportingBundles": [
                        _comparison_bundle(
                            workflow="severe-weather",
                            location=paxton,
                            source_family="hrrr",
                            signal_score=0.81,
                            confidence=0.8,
                            summary="Short-range severe signal is stronger near Paxton.",
                        ),
                        _comparison_bundle(
                            workflow="severe-weather",
                            location=paxton,
                            source_family="nexrad",
                            signal_score=0.76,
                            confidence=0.74,
                            summary="Radar support is sharper near Paxton.",
                        ),
                    ],
                },
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert "Paxton" in body["bottomLine"]
    assert body["winner"]["candidate"]["label"] == "Paxton, IL"
    assert body["rankedCandidates"][0]["candidate"]["label"] == "Paxton, IL"
    assert body["confidence"]["level"] in {"medium", "high"}


def test_compare_endpoint_supports_casual_and_professional_tone() -> None:
    bloomington = _location(
        "Bloomington, Illinois, United States", 40.4842, -88.9937
    )
    paxton = _location("Paxton, Illinois, United States", 40.4598, -88.0956)

    request_body = {
        "userQuestion": "Compare Bloomington and Paxton for tornado favorability.",
        "workflow": "severe-weather",
        "answerMode": "compare",
        "candidateMode": "named",
        "rankLimit": 2,
        "rankingObjective": "severe-favorability",
        "candidates": [
            {
                "candidate": {
                    "query": "Bloomington, IL",
                    "label": "Bloomington, IL",
                    "location": bloomington,
                    "source": "user",
                },
                "severeContext": _comparison_envelope(
                    source_id="spc",
                    source_name="Storm Prediction Center",
                    product_domain="severe-context",
                    location=bloomington,
                    summary="Slight risk severe context for Bloomington.",
                    confidence=0.72,
                ),
                "supportingBundles": [
                    _comparison_bundle(
                        workflow="severe-weather",
                        location=bloomington,
                        source_family="hrrr",
                        signal_score=0.52,
                        confidence=0.58,
                        summary="Short-range severe signal is present but not dominant.",
                    ),
                ],
            },
            {
                "candidate": {
                    "query": "Paxton, IL",
                    "label": "Paxton, IL",
                    "location": paxton,
                    "source": "user",
                },
                "severeContext": _comparison_envelope(
                    source_id="spc",
                    source_name="Storm Prediction Center",
                    product_domain="severe-context",
                    location=paxton,
                    summary="Enhanced risk severe context for Paxton.",
                    confidence=0.86,
                ),
                "supportingBundles": [
                    _comparison_bundle(
                        workflow="severe-weather",
                        location=paxton,
                        source_family="hrrr",
                        signal_score=0.81,
                        confidence=0.8,
                        summary="Short-range severe signal is stronger near Paxton.",
                    ),
                ],
            },
        ],
    }

    casual_response = client.post(
        "/compare",
        json={**request_body, "answerTone": "casual"},
    )
    professional_response = client.post(
        "/compare",
        json={**request_body, "answerTone": "professional"},
    )

    assert casual_response.status_code == 200
    assert professional_response.status_code == 200

    casual_body = casual_response.json()
    professional_body = professional_response.json()

    assert casual_body["winner"]["candidate"]["label"] == "Paxton, IL"
    assert professional_body["winner"]["candidate"]["label"] == "Paxton, IL"
    assert "looked at storm-scale radar support" in casual_body["whyRainCheckThinksThat"]
    assert "each option" in casual_body["whyRainCheckThinksThat"]
    assert "weighted storm-scale radar support" in professional_body["whyRainCheckThinksThat"]
    assert "each candidate" in professional_body["whyRainCheckThinksThat"]


def test_compare_endpoint_ranks_the_better_beach_day_candidate() -> None:
    south_padre = _location("South Padre Beach, Texas", 26.1118, -97.1681)
    corpus = _location("Corpus Christi Beach, Texas", 27.8006, -97.3964)

    response = client.post(
        "/compare",
        json={
            "userQuestion": "Top beach locations for tomorrow.",
            "workflow": "forecast",
            "answerMode": "rank",
            "candidateMode": "discovered",
            "rankLimit": 2,
            "rankingObjective": "beach-day",
            "candidates": [
                {
                    "candidate": {
                        "query": "South Padre Beach",
                        "label": "South Padre Beach",
                        "location": south_padre,
                        "source": "beach-discovery",
                    },
                    "currentConditions": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS latest observation",
                        product_domain="current-conditions",
                        location=south_padre,
                        summary="Sunny and warm with light wind.",
                        confidence=0.94,
                    ),
                    "forecast": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS hourly forecast",
                        product_domain="forecast",
                        location=south_padre,
                        summary="Sunny, near 84F, with light southeast wind.",
                        confidence=0.9,
                        data={
                            "periods": [
                                {
                                    "temperature": 84,
                                    "temperatureUnit": "F",
                                    "wind": "8 mph SE",
                                    "shortForecast": "Sunny",
                                    "detailedForecast": "Sunny and warm.",
                                }
                            ]
                        },
                    ),
                    "alerts": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS active alerts",
                        product_domain="alerts",
                        location=south_padre,
                        summary="No active alerts for South Padre Beach at fetch time.",
                        confidence=0.96,
                        data={"alerts": []},
                    ),
                    "marineContext": _comparison_envelope(
                        source_id="marine",
                        source_name="Marine guidance",
                        product_domain="marine",
                        location=south_padre,
                        summary="Marine guidance is quiet with no rough surf signal.",
                        confidence=0.7,
                    ),
                    "supportingBundles": [],
                },
                {
                    "candidate": {
                        "query": "Corpus Christi Beach",
                        "label": "Corpus Christi Beach",
                        "location": corpus,
                        "source": "beach-discovery",
                    },
                    "currentConditions": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS latest observation",
                        product_domain="current-conditions",
                        location=corpus,
                        summary="Mostly cloudy with gusty wind.",
                        confidence=0.94,
                    ),
                    "forecast": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS hourly forecast",
                        product_domain="forecast",
                        location=corpus,
                        summary="Chance showers, near 74F, and breezy.",
                        confidence=0.9,
                        data={
                            "periods": [
                                {
                                    "temperature": 74,
                                    "temperatureUnit": "F",
                                    "wind": "22 mph SE",
                                    "shortForecast": "Chance Showers",
                                    "detailedForecast": "Cloudy with showers nearby.",
                                }
                            ]
                        },
                    ),
                    "alerts": _comparison_envelope(
                        source_id="weather-gov",
                        source_name="NWS active alerts",
                        product_domain="alerts",
                        location=corpus,
                        summary="1 active alert for Corpus Christi Beach.",
                        confidence=0.96,
                        data={
                            "alerts": [
                                {
                                    "severity": "moderate",
                                    "headline": "Beach Hazards Statement",
                                }
                            ]
                        },
                    ),
                    "marineContext": _comparison_envelope(
                        source_id="marine",
                        source_name="Marine guidance",
                        product_domain="marine",
                        location=corpus,
                        summary="Marine guidance shows rough surf and hazardous seas.",
                        confidence=0.7,
                    ),
                    "supportingBundles": [],
                },
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["rankedCandidates"][0]["candidate"]["label"] == "South Padre Beach"
    assert "South Padre Beach" in body["bottomLine"]
    assert body["rankingObjective"] == "beach-day"
