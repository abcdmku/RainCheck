from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
import re
from zoneinfo import ZoneInfo
from urllib.parse import urlparse

from .artifacts import generate_weather_artifact
from .models import (
    ArtifactHandle,
    ArtifactRequest,
    CitationBundle,
    EvidenceProduct,
    ProductCard,
    SynthesisBundle,
    SynthesizeRequest,
    WeatherConfidence,
    WeatherRegionBBox,
    WeatherRegionPoint,
)
from .settings import Settings

_CASUAL_TONE_REPLACEMENTS: list[tuple[str, str]] = [
    (r"\bWPC hazard framing\b", "The WPC hazards outlook"),
    (r"\bmeaningful impact corridor\b", "decent storm corridor"),
    (
        r"\bensemble spread still needs to be accounted for\b",
        "the models still disagree enough that the setup could shift",
    ),
    (r"\bensemble spread\b", "model disagreement"),
    (r"\bsynoptic\b", "large-scale"),
    (r"\bmesoscale details\b", "small setup details"),
    (r"\bmesoscale\b", "storm-scale"),
    (r"\bdiscrete storms\b", "separate storms"),
    (r"\bupscale growth\b", "storms merging together"),
    (r"\bboundary placement\b", "where the boundary sets up"),
    (r"\bstorm mode\b", "storm type"),
    (r"\bweighted strength\b", "overall strength"),
    (r"\bunresolved conflicts\b", "open questions"),
]


def _now() -> datetime:
    return datetime.now(UTC)


def _region_label(region: WeatherRegionPoint | WeatherRegionBBox) -> str:
    if isinstance(region, WeatherRegionPoint):
        return region.location.display_name()
    if region.label:
        return region.label
    return f"{region.south:.2f},{region.west:.2f} to {region.north:.2f},{region.east:.2f}"


def _weight(product: EvidenceProduct) -> float:
    base = {
        "observation": 1.2,
        "official_product": 1.15,
        "probability": 1.0,
        "derived_diagnostic": 0.98,
        "raw_field": 0.9,
    }[product.fieldType]
    if product.sourceFamily in {"spc", "wpc", "nwps", "nexrad", "mrms", "goes"}:
        base += 0.03
    return base


def _sort_evidence(products: list[EvidenceProduct]) -> list[EvidenceProduct]:
    return sorted(
        products,
        key=lambda product: (_weight(product), product.signalScore, product.confidence),
        reverse=True,
    )


def _weighted_average(products: list[EvidenceProduct], attr: str) -> float:
    total = sum(_weight(product) for product in products)
    if total <= 0:
        return 0.0
    return sum(getattr(product, attr) * _weight(product) for product in products) / total


def _confidence_level(score: float) -> str:
    if score >= 0.8:
        return "high"
    if score >= 0.6:
        return "medium"
    return "low"


def _confidence(reason: str, score: float) -> WeatherConfidence:
    return WeatherConfidence(level=_confidence_level(score), reason=reason)


def _normalize_spacing(text: str) -> str:
    return re.sub(r"\s+", " ", text).replace(" ,", ",").strip()


def _tone_text(text: str, tone: str) -> str:
    if tone == "professional":
        return _normalize_spacing(text)

    output = text
    for pattern, replacement in _CASUAL_TONE_REPLACEMENTS:
        output = re.sub(pattern, replacement, output, flags=re.IGNORECASE)
    return _normalize_spacing(output)


def _tone_list(values: list[str], tone: str) -> list[str]:
    return [_tone_text(value, tone) for value in values]


def _artifact_handle(response) -> ArtifactHandle:
    return ArtifactHandle(
        artifactId=response.artifactId,
        type=response.artifactType,
        title=response.title,
        href=response.href,
        mimeType=response.mimeType,
    )


def _is_generic_homepage_url(url: str | None) -> bool:
    if not url or url.startswith("/"):
        return False

    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return False

    if not parsed.path or parsed.path == "/":
        return True

    return "gribfilter.php?ds=" in url.lower()


def _renderable_display_url(url: str | None) -> str | None:
    if not url:
        return None

    normalized = url.strip()
    if not normalized:
        return None

    if normalized.startswith("/"):
        return normalized

    if _is_generic_homepage_url(normalized):
        return None

    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    path = parsed.path.lower()
    if path.endswith(
        (
            ".gif",
            ".png",
            ".jpg",
            ".jpeg",
            ".svg",
            ".webp",
            ".html",
            ".htm",
            ".php",
            ".shtml",
        )
    ):
        return normalized

    return None


def _citation_display_url(product: EvidenceProduct, provenance) -> str | None:
    artifact = product.artifactHandles[0] if product.artifactHandles else None

    for candidate in (
        artifact.href if artifact else None,
        getattr(provenance, "displayUrl", None),
        provenance.contextUrl,
        provenance.url,
    ):
        display_url = _renderable_display_url(candidate)
        if display_url:
            return display_url

    return None


def _card(product: EvidenceProduct, relevance: str) -> ProductCard:
    provenance = product.provenance[0] if product.provenance else None
    artifact = product.artifactHandles[0] if product.artifactHandles else None
    direct_url = (
        provenance.url if provenance and provenance.url else provenance.contextUrl if provenance else None
    )
    return ProductCard(
        id=product.id,
        title=product.fieldName.replace("-", " ").title(),
        sourceId=product.sourceFamily,
        sourceName=product.sourceName,
        summary=product.summary,
        url=provenance.url if provenance else None,
        contextUrl=provenance.contextUrl if provenance else None,
        imageUrl=(
            direct_url
            if provenance and provenance.kind == "image"
            else artifact.href
            if artifact and artifact.mimeType.startswith("image/")
            else None
        ),
        imageAlt=f"{product.sourceName} evidence" if direct_url or artifact else None,
        artifactId=artifact.artifactId if artifact else None,
        href=artifact.href if artifact else None,
        mimeType=artifact.mimeType if artifact else None,
        relevance=relevance,  # type: ignore[arg-type]
        validAt=product.validTime,
        validRange=provenance.validRange if provenance else None,
    )


def _dedupe_cards(cards: list[ProductCard]) -> list[ProductCard]:
    unique: dict[str, ProductCard] = {}
    for card in cards:
        unique[card.id] = card
    return list(unique.values())


def _dedupe_artifacts(artifacts: list[ArtifactHandle]) -> list[ArtifactHandle]:
    unique: dict[str, ArtifactHandle] = {}
    for artifact in artifacts:
        unique[artifact.artifactId] = artifact
    return list(unique.values())


def _citation_id(source_id: str, product_id: str, valid_at: datetime | None) -> str:
    valid_stamp = valid_at.isoformat() if valid_at else "unknown"
    return f"{source_id}:{product_id}:{valid_stamp}"


def _citations(products: list[EvidenceProduct]) -> list[CitationBundle]:
    unique: dict[str, CitationBundle] = {}
    for product in products:
        for provenance in product.provenance:
            if provenance.kind == "derived":
                continue
            if not provenance.url and not provenance.contextUrl:
                continue
            citation = CitationBundle(
                id=_citation_id(
                    provenance.sourceId,
                    provenance.productId,
                    provenance.validAt,
                ),
                label=provenance.label,
                sourceId=provenance.sourceId,
                productId=provenance.productId,
                kind=provenance.kind,
                url=provenance.url,
                contextUrl=provenance.contextUrl,
                displayUrl=_citation_display_url(product, provenance),
                issuedAt=provenance.issuedAt,
                validAt=provenance.validAt,
                note=provenance.notes[0] if provenance.notes else None,
                fetchedAt=provenance.retrievedAt,
                validRange=provenance.validRange,
            )
            unique[citation.id] = citation
    return list(unique.values())


def _bundle_conflicts(request: SynthesizeRequest, products: list[EvidenceProduct]) -> list[str]:
    conflicts: list[str] = []
    for bundle in request.supportingBundles:
        conflicts.extend(bundle.keyConflicts)

    if products and max(product.confidence for product in products) - min(
        product.confidence for product in products
    ) >= 0.18:
        conflicts.append("Source confidence is spread enough to keep the scenario conditional.")

    if products and products[0].fieldType == "observation":
        conflicts.append("Observations lead the call right now, so later model cycles can still shift the favored corridor.")

    return list(dict.fromkeys(conflicts))[:4]


def _agreement_summary(request: SynthesizeRequest, products: list[EvidenceProduct]) -> str:
    if request.supportingBundles:
        return request.supportingBundles[0].agreementSummary

    region_label = _region_label(request.region)
    top_sources = ", ".join(product.sourceName for product in products[:3])
    dominant = Counter(product.sourceFamily for product in products).most_common(1)
    dominant_label = dominant[0][0] if dominant else "no dominant source"
    return (
        f"Synthesis for {region_label} is anchored by {top_sources}; "
        f"{dominant_label} is the most repeated source family."
    )


def _short_location(region_label: str) -> str:
    return region_label.split(",")[0].strip() or region_label


def _looks_like_source_led_summary(summary: str) -> bool:
    return bool(
        re.match(r"^(RTMA|URMA|HRRR|RAP|NAM|HREF|SPC|NEXRAD|MRMS|NBM)\b", summary.strip())
    )


def _looks_like_conditional_storm_summary(summary: str) -> bool:
    lowered = summary.lower()
    return any(
        phrase in lowered
        for phrase in (
            "still depends on",
            "can still shift",
            "position errors",
            "conditional",
            "uncertain",
            "boundary placement",
        )
    )


def _normalized_summary_clause(summary: str) -> str:
    normalized = " ".join(summary.split()).strip()
    if not normalized:
        return normalized
    if _looks_like_source_led_summary(normalized):
        return normalized
    if normalized[0].isupper():
        return normalized[0].lower() + normalized[1:]
    return normalized


def _normalized_summary_sentence(summary: str) -> str:
    normalized = " ".join(summary.split()).strip()
    if not normalized:
        return normalized
    if normalized[-1] not in ".!?":
        return f"{normalized}."
    return normalized


def _fallback_bottom_line(
    request: SynthesizeRequest,
    region_label: str,
    top: EvidenceProduct,
) -> str:
    if _looks_like_conditional_storm_summary(top.summary):
        if request.workflow in {"severe-weather", "short-range-model", "blend-analysis", "weather-analysis"}:
            return (
                f"The current storm-scale evidence near {region_label} is still too conditional "
                "to support one best storm target yet."
            )
        return (
            f"The latest evidence near {region_label} is still too conditional "
            "to support a stronger call yet."
        )

    if request.workflow in {"severe-weather", "short-range-model", "blend-analysis", "weather-analysis"}:
        clause = _normalized_summary_clause(top.summary)
        if _looks_like_source_led_summary(clause):
            return f"The strongest supported storm signal near {region_label} currently is that {clause}"
        return f"The strongest supported storm signal near {region_label} currently favors {clause}"

    return _normalized_summary_sentence(top.summary)


def _zoneinfo_or_none(value: str | None) -> ZoneInfo | None:
    if not value:
        return None
    try:
        return ZoneInfo(value)
    except Exception:
        return None


def _target_location_context(request: SynthesizeRequest):
    if request.selectedTarget is not None:
        return request.selectedTarget.location
    if isinstance(request.region, WeatherRegionPoint):
        return request.region.location
    return None


def _origin_short_location(request: SynthesizeRequest, region_label: str) -> str:
    if request.originLocation is not None:
        return _short_location(request.originLocation.display_name())
    return _short_location(region_label)


def _is_broad_region_request(request: SynthesizeRequest, region_label: str) -> bool:
    if request.selectedTarget is not None:
        return False
    if not isinstance(request.region, WeatherRegionPoint):
        return True

    short_location = _short_location(region_label).lower()
    region_name = (request.region.location.region or "").strip().lower()
    country_name = (request.region.location.country or "").strip().lower()

    return short_location in {region_name, country_name}


def _format_clock(value: datetime) -> str:
    hour = value.hour % 12 or 12
    suffix = "AM" if value.hour < 12 else "PM"
    if value.minute:
        return f"{hour}:{value.minute:02d} {suffix}"
    return f"{hour} {suffix}"


def _display_timezones(request: SynthesizeRequest) -> tuple[ZoneInfo | None, ZoneInfo | None]:
    target_location = _target_location_context(request)
    target_tz = _zoneinfo_or_none(target_location.timezone if target_location else None)
    user_tz = _zoneinfo_or_none(request.displayTimezone)
    if user_tz is None and request.originLocation is not None:
        user_tz = _zoneinfo_or_none(request.originLocation.timezone)
    if user_tz is None:
        user_tz = target_tz
    return user_tz, target_tz


def _format_time_range(start: datetime, end: datetime) -> str:
    return f"{_format_clock(start)} to {_format_clock(end)}"


def _time_window_label(request: SynthesizeRequest) -> str:
    start = request.timeWindow.start
    end = request.timeWindow.end
    user_tz, target_tz = _display_timezones(request)

    if request.timeDisplay == "target-local" and target_tz is not None:
        return f"{_format_time_range(start.astimezone(target_tz), end.astimezone(target_tz))} target local time"

    if (
        request.timeDisplay == "dual"
        and user_tz is not None
        and target_tz is not None
        and user_tz.key != target_tz.key
    ):
        return (
            f"{_format_time_range(start.astimezone(user_tz), end.astimezone(user_tz))} local time "
            f"({_format_time_range(start.astimezone(target_tz), end.astimezone(target_tz))} target time)"
        )

    if user_tz is not None:
        return f"{_format_time_range(start.astimezone(user_tz), end.astimezone(user_tz))} local time"

    if target_tz is not None:
        return f"{_format_time_range(start.astimezone(target_tz), end.astimezone(target_tz))} target local time"

    return _format_time_range(start, end)


def _effective_chase_guidance_level(request: SynthesizeRequest, confidence_score: float) -> str:
    level = request.chaseGuidanceLevel

    if level == "full-route" and confidence_score < 0.78:
        level = "exact-target"
    if level in {"full-route", "exact-target"} and confidence_score < 0.68:
        level = "general-target"
    if level in {"full-route", "exact-target", "general-target"} and confidence_score < 0.56:
        level = "analysis-only"

    return level


def _direction_phrase(question: str) -> str | None:
    match = re.search(
        r"\b((?:north|south|east|west|northeast|northwest|southeast|southwest)(?:\s*(?:to|and)\s*(?:north|south|east|west|northeast|northwest|southeast|southwest))?\s+of\s+[a-z0-9 .'-]+)\b",
        question,
        re.IGNORECASE,
    )
    if not match:
        return None
    return match.group(1).strip()


def _target_label(request: SynthesizeRequest, region_label: str, guidance_level: str) -> str:
    if request.selectedTarget is not None:
        return request.selectedTarget.label

    directional_hint = _direction_phrase(request.userQuestion)
    if directional_hint:
        return directional_hint

    short_location = _short_location(region_label)
    broad_region = _is_broad_region_request(request, region_label)
    if guidance_level == "analysis-only":
        return f"the broader {region_label} corridor"
    if broad_region:
        return f"the better-supported corridor within {short_location}"
    if guidance_level == "general-target":
        return f"the south to southwest corridor from {short_location}"
    if guidance_level == "exact-target":
        return f"the south to southwest corridor from {short_location}"
    return f"the roads southwest of {short_location}"


def _hours_label(value: float) -> str:
    rounded = round(value, 1)
    if abs(rounded - 1.0) < 0.05:
        return "about 1 hour"
    if float(rounded).is_integer():
        return f"about {int(rounded)} hours"
    return f"about {rounded:.1f} hours"


def _nightfall_label(request: SynthesizeRequest) -> str | None:
    if request.nightfall is None:
        return None

    event_label = "civil dusk" if request.nightfall.event == "civil-dusk" else "sunset"
    user_tz, target_tz = _display_timezones(request)
    value = request.nightfall.occursAt

    if request.timeDisplay == "target-local" and target_tz is not None:
        return f"{event_label} around {_format_clock(value.astimezone(target_tz))} target local time"

    if (
        request.timeDisplay == "dual"
        and user_tz is not None
        and target_tz is not None
        and user_tz.key != target_tz.key
    ):
        return (
            f"{event_label} around {_format_clock(value.astimezone(user_tz))} local time "
            f"({_format_clock(value.astimezone(target_tz))} target time)"
        )

    if user_tz is not None:
        return f"{event_label} around {_format_clock(value.astimezone(user_tz))} local time"

    if target_tz is not None:
        return f"{event_label} around {_format_clock(value.astimezone(target_tz))} target local time"

    return f"{event_label} around {_format_clock(value)}"


def _track_limit_sentence(request: SynthesizeRequest) -> str | None:
    target = request.selectedTarget
    nightfall_label = _nightfall_label(request)

    if target is not None and target.stopLabel:
        base = f"Track no farther than {target.stopLabel}"
        if target.corridorHours is not None:
            base = f"{base}, roughly {_hours_label(target.corridorHours)} more down the corridor"
        if nightfall_label:
            return f"{base}, and be wrapping up by {nightfall_label}."
        return f"{base}."

    if nightfall_label:
        return f"Plan to wrap up by {nightfall_label}."

    return None


def _severe_bottom_line(
    request: SynthesizeRequest,
    products: list[EvidenceProduct],
    confidence_score: float,
) -> tuple[str, str, str | None]:
    region_label = _region_label(request.region)
    short_location = _short_location(region_label)
    origin_short_location = _origin_short_location(request, region_label)
    time_label = _time_window_label(request)
    effective_level = _effective_chase_guidance_level(request, confidence_score)
    target_label = _target_label(request, region_label, effective_level)
    broad_region = _is_broad_region_request(request, region_label)
    track_limit = _track_limit_sentence(request)
    downgrade_note = None

    if effective_level != request.chaseGuidanceLevel:
        downgrade_note = (
            f"Precision was stepped down from {request.chaseGuidanceLevel.replace('-', ' ')} "
            f"to {effective_level.replace('-', ' ')} because the evidence is not tight enough yet."
        )

    if request.selectedTarget is not None:
        travel_note = (
            f"It is {_hours_label(request.selectedTarget.travelHours)} from {origin_short_location} to the start."
            if request.selectedTarget.travelHours is not None
            else None
        )
        if effective_level == "analysis-only":
            return (
                f"The best-supported severe setup from {origin_short_location} favors {target_label} during the {time_label} window.",
                (
                    f"{travel_note} {track_limit}".strip()
                    if travel_note or track_limit
                    else f"The broader {region_label} setup is still sensitive to boundary placement and storm mode."
                ),
                downgrade_note,
            )

        if effective_level == "general-target":
            if request.selectedTarget.withinNearbyRadius is False:
                return (
                    f"Nothing within about 3 hours of {origin_short_location} is as well supported right now. The nearest better-supported start is {target_label}, with arrival in the {time_label} window.",
                    (
                        f"{travel_note} {track_limit}".strip()
                        if travel_note or track_limit
                        else f"The favored starting corridor is centered on {target_label}, but boundary placement can still shift it."
                    ),
                    downgrade_note,
                )
            return (
                f"From {origin_short_location}, the best-supported start is {target_label}, with arrival in the {time_label} window.",
                (
                    f"{travel_note} {track_limit}".strip()
                    if travel_note or track_limit
                    else f"The favored starting corridor stays centered on {target_label}, but boundary placement can still shift it."
                ),
                downgrade_note,
            )

        if effective_level == "exact-target":
            return (
                f"From {origin_short_location}, the best-supported target right now is {target_label} during the {time_label} window.",
                (
                    f"{travel_note} {track_limit}".strip()
                    if travel_note or track_limit
                    else f"{target_label} offers the best chance to stay near discrete storms before clustering later."
                ),
                downgrade_note,
            )

        return (
            f"From {origin_short_location}, stage toward {target_label} before the {time_label} window and keep the route parallel to the favored storm track.",
            (
                f"{travel_note} {track_limit}".strip()
                if travel_note or track_limit
                else "Leave yourself a south or east adjustment once the dominant storm track is clear."
            ),
            downgrade_note,
        )

    if effective_level == "analysis-only":
        return (
            f"The best-supported severe setup near {region_label} favors {products[0].summary}",
            (
                f"The main severe window is {time_label}, with the broader {region_label} corridor "
                "still sensitive to boundary placement and storm mode."
            ),
            downgrade_note,
        )

    if effective_level == "general-target":
        if broad_region:
            return (
                f"The best-supported starting corridor today is within {short_location} during the {time_label} window, with room to adjust as boundary-focused storms organize.",
                (
                    f"The main chase start window is {time_label}, with the favored area still broad inside {short_location}; "
                    "use later nowcast trends to tighten the exact corridor."
                ),
                downgrade_note,
            )
        return (
            f"From {short_location}, start near {target_label} during the {time_label} window and stay ready to adjust with the strongest boundary-focused storms.",
            (
                f"The main chase start window is {time_label}, with the favored starting corridor centered on {target_label}; "
                f"if storms cluster earlier than expected, widen back to the broader {region_label} area."
            ),
            downgrade_note,
        )

    if effective_level == "exact-target":
        if broad_region:
            return (
                f"The best-supported target right now is within {short_location} during the {time_label} window, but not pinned to one town yet.",
                (
                    f"The main target window is {time_label}, with the favored corridor still broad enough inside {short_location} "
                    "that later mesoscale trends should narrow the exact target."
                ),
                downgrade_note,
            )
        return (
            f"From {short_location}, the best-supported target right now is {target_label} during the {time_label} window.",
            (
                f"The main target window is {time_label}, with {target_label} offering the best chance to stay near discrete storms before clustering later."
            ),
            downgrade_note,
        )

    if broad_region:
        return (
            f"The best-supported route window is {time_label}, with the favored path staying inside {short_location} until the dominant storm track tightens.",
            (
                f"The main route window is {time_label}, and the route should stay flexible inside {short_location} until later nowcast trends support a narrower path."
            ),
            downgrade_note,
        )

    return (
        f"From {short_location}, stage toward {target_label} before the {time_label} window and use the most direct roads that keep you parallel to the favored storm track.",
        (
            f"The main route window is {time_label}. Leave yourself a southwest option first, then a south or east adjustment once the dominant storm track is clear."
        ),
        downgrade_note,
    )


def _fallback_artifact(
    settings: Settings,
    request: SynthesizeRequest,
    products: list[EvidenceProduct],
    conflicts: list[str],
) -> ArtifactHandle:
    response = generate_weather_artifact(
        settings,
        ArtifactRequest(
            artifactType="single-model-panel",
            prompt=request.userQuestion,
            locationQuery=_region_label(request.region),
            sections=[
                *[product.summary for product in products[:4]],
                *([f"Main uncertainty: {conflicts[0]}"] if conflicts else []),
            ],
            evidenceProducts=products[:5],
        ),
    )
    return _artifact_handle(response)


def _all_evidence(request: SynthesizeRequest) -> list[EvidenceProduct]:
    products = list(request.evidenceProducts)
    for bundle in request.supportingBundles:
        products.extend(
            product
            for product in bundle.evidenceProducts
            if product.sourceFamily != "raincheck-derivation"
        )
    return _sort_evidence(products)


def synthesize_weather(settings: Settings, request: SynthesizeRequest) -> SynthesisBundle:
    answer_tone = request.answerTone
    products = _all_evidence(request)
    if not products:
        return SynthesisBundle(
            bottomLine=_tone_text(
                "RainCheck does not have enough derived weather evidence to make a supported call yet.",
                answer_tone,
            ),
            mostLikelyScenario=_tone_text(
                "Fetch one or more derive endpoints before attempting synthesis.",
                answer_tone,
            ),
            alternateScenarios=[],
            confidence=_confidence(
                _tone_text("No derived evidence was supplied to synthesis.", answer_tone),
                0.3,
            ),
            agreementSummary=_tone_text(
                "No derivation bundles or evidence products were supplied.",
                answer_tone,
            ),
            keySupportingSignals=[],
            keyConflicts=[_tone_text("No evidence products were available.", answer_tone)],
            bustRisks=[_tone_text("Fetch derived evidence first.", answer_tone)],
            recommendedCards=[],
            recommendedArtifacts=[],
            citations=[],
            evidenceProducts=[],
        )

    conflicts = _bundle_conflicts(request, products)
    avg_signal = _weighted_average(products, "signalScore")
    avg_confidence = _weighted_average(products, "confidence")
    confidence_score = max(
        0.35,
        min(0.96, (avg_signal * 0.55) + (avg_confidence * 0.45) - (0.03 * len(conflicts))),
    )
    top = products[0]
    region_label = _region_label(request.region)
    cards = _dedupe_cards(
        [_card(product, "primary" if index == 0 else "supporting") for index, product in enumerate(products[:4])]
    )

    artifacts = _dedupe_artifacts(
        [
            *[
                artifact
                for bundle in request.supportingBundles
                for artifact in bundle.recommendedArtifacts
            ],
            *[artifact for product in products for artifact in product.artifactHandles],
        ]
    )
    if not artifacts:
        artifacts = [_fallback_artifact(settings, request, products, conflicts)]

    alternate_scenarios = [
        f"A lower-confidence alternative remains if {product.sourceName.lower()} trends away from the leading corridor."
        for product in products[1:3]
    ]

    severe_bottom_line: str | None = None
    severe_most_likely: str | None = None
    downgrade_note: str | None = None
    if request.workflow == "severe-weather":
        severe_bottom_line, severe_most_likely, downgrade_note = _severe_bottom_line(
            request,
            products,
            confidence_score,
        )

    bust_risks = list(dict.fromkeys(
        ([downgrade_note] if downgrade_note else [])
        + conflicts
        + [
            "Boundary placement and timing remain the quickest way for the favored corridor to shift.",
            f"Confidence will fall quickly if the leading source family over {region_label} changes on the next update.",
        ]
    ))[:3]

    return SynthesisBundle(
        bottomLine=_tone_text(
            severe_bottom_line or _fallback_bottom_line(request, region_label, top),
            answer_tone,
        ),
        mostLikelyScenario=_tone_text(severe_most_likely or top.summary, answer_tone),
        alternateScenarios=_tone_list(alternate_scenarios, answer_tone),
        confidence=_confidence(
            _tone_text(
                (
                "Confidence reflects the weighted strength of the leading evidence and the number of unresolved conflicts."
                if not downgrade_note
                else "Confidence reflects the weighted strength of the leading evidence; RainCheck stepped down the requested chase precision because the signal is not tight enough yet."
                ),
                answer_tone,
            ),
            confidence_score,
        ),
        agreementSummary=_tone_text(_agreement_summary(request, products), answer_tone),
        keySupportingSignals=_tone_list([product.summary for product in products[:5]], answer_tone),
        keyConflicts=_tone_list(conflicts, answer_tone),
        bustRisks=_tone_list(bust_risks, answer_tone),
        recommendedCards=cards,
        recommendedArtifacts=artifacts,
        citations=_citations(products),
        evidenceProducts=products,
    )
