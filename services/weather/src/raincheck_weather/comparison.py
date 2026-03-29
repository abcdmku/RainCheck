from __future__ import annotations

import re
from typing import Any

from .models import (
    CitationBundle,
    CompareWeatherBundle,
    CompareWeatherRequest,
    ComparedCandidate,
    ComparisonCandidate,
    ComparisonCandidateAnalysis,
    ComparisonContext,
    ProductCard,
    WeatherConfidence,
)

_CASUAL_TONE_REPLACEMENTS: list[tuple[str, str]] = [
    (r"\bmesoscale\b", "storm-scale"),
    (r"\bdiscrete storms\b", "separate storms"),
    (r"\bcandidate evidence\b", "information for each option"),
    (r"\bcandidate\b", "option"),
    (r"\bweighted\b", "looked at"),
]

SEVERE_SOURCE_FAMILIES = {"hrrr", "href", "rap", "nam", "rtma", "urma", "spc", "nbm"}
RADAR_SOURCE_FAMILIES = {"nexrad", "mrms"}
PRECIP_WORDS = ("rain", "shower", "storm", "thunder", "drizzle")
SUN_WORDS = ("sunny", "mostly sunny", "partly sunny", "fair", "clear")
ROUGH_SURF_WORDS = ("rough", "high surf", "dangerous surf", "rip current", "hazardous seas")


def _clamp(value: float, minimum: float = 0.0, maximum: float = 1.0) -> float:
    return max(minimum, min(maximum, value))


def _confidence_level(value: float) -> str:
    if value >= 0.8:
        return "high"
    if value >= 0.6:
        return "medium"
    return "low"


def _confidence(reason: str, value: float) -> WeatherConfidence:
    return WeatherConfidence(level=_confidence_level(value), reason=reason)


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


def _normalized_forecast(envelope: Any) -> dict[str, Any]:
    if envelope is None or not isinstance(envelope.normalizedForecast, dict):
        return {}
    return envelope.normalizedForecast


def _candidate_alias(candidate: ComparisonCandidate) -> str:
    return candidate.label or candidate.location.display_name()


def _dedupe_strings(values: list[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        normalized = value.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        output.append(normalized)
    return output


def _summary_stats_score(bundle: Any, families: set[str] | None = None) -> float:
    products = []
    for product in bundle.evidenceProducts:
        if families is not None and product.sourceFamily not in families:
            continue
        products.append(product)

    if not products:
        return 0.0

    signal = sum(product.signalScore for product in products) / len(products)
    confidence = sum(product.confidence for product in products) / len(products)
    return _clamp((signal * 0.6) + (confidence * 0.4))


def _bundle_conflicts(bundle: Any) -> list[str]:
    return [conflict for conflict in bundle.keyConflicts if isinstance(conflict, str)]


def _forecast_period(candidate: ComparisonCandidateAnalysis) -> dict[str, Any]:
    forecast = candidate.forecast
    if forecast is None or not isinstance(forecast.data, dict):
        return {}
    periods = forecast.data.get("periods")
    if not isinstance(periods, list) or not periods:
        return {}
    first = periods[0]
    return first if isinstance(first, dict) else {}


def _temperature_f(value: Any, unit: Any) -> float | None:
    if not isinstance(value, (int, float)):
        return None
    if unit == "C":
        return (float(value) * 9 / 5) + 32
    return float(value)


def _parse_wind_mph(value: Any) -> float | None:
    if not isinstance(value, str) or not value.strip():
        return None
    matches = [float(match) for match in re.findall(r"\d+(?:\.\d+)?", value)]
    if not matches:
        return None
    return sum(matches) / len(matches)


def _text_has_any(value: str, terms: tuple[str, ...]) -> bool:
    lowered = value.lower()
    return any(term in lowered for term in terms)


def _alert_penalty(candidate: ComparisonCandidateAnalysis) -> float:
    alerts = candidate.alerts
    if alerts is None or not isinstance(alerts.data, dict):
        return 0.0
    items = alerts.data.get("alerts")
    if not isinstance(items, list) or not items:
        return 0.0

    severity_bonus = 0.0
    for item in items:
        if not isinstance(item, dict):
            continue
        severity = str(item.get("severity") or "").lower()
        if severity in {"extreme", "severe"}:
            severity_bonus = max(severity_bonus, 0.22)
        elif severity in {"moderate"}:
            severity_bonus = max(severity_bonus, 0.14)
        else:
            severity_bonus = max(severity_bonus, 0.08)
    return severity_bonus or 0.08


def _current_conditions_text(candidate: ComparisonCandidateAnalysis) -> str:
    current = candidate.currentConditions
    if current is None:
        return ""
    return current.summary or ""


def _forecast_text(candidate: ComparisonCandidateAnalysis) -> str:
    forecast = candidate.forecast
    if forecast is None:
        return ""
    period = _forecast_period(candidate)
    detailed = period.get("detailedForecast") if isinstance(period, dict) else None
    short = period.get("shortForecast") if isinstance(period, dict) else None
    return " ".join(
        value for value in [str(short or ""), str(detailed or ""), forecast.summary] if value
    ).strip()


def _marine_text(candidate: ComparisonCandidateAnalysis) -> str:
    marine = candidate.marineContext
    if marine is None:
        return ""
    return marine.summary or ""


def _candidate_signals(candidate: ComparisonCandidateAnalysis) -> list[str]:
    signals: list[str] = []
    for envelope in [
        candidate.currentConditions,
        candidate.forecast,
        candidate.alerts,
        candidate.severeContext,
        candidate.marineContext,
    ]:
        if envelope is None:
            continue
        normalized = _normalized_forecast(envelope)
        key_signals = normalized.get("keySignals")
        if not isinstance(key_signals, list):
            continue
        for signal in key_signals:
            if not isinstance(signal, dict):
                continue
            detail = signal.get("detail")
            if isinstance(detail, str):
                signals.append(detail)
    for bundle in candidate.supportingBundles:
        for product in bundle.evidenceProducts[:2]:
            signals.append(product.summary)
    return _dedupe_strings(signals)[:4]


def _candidate_conflicts(candidate: ComparisonCandidateAnalysis) -> list[str]:
    conflicts: list[str] = []
    for envelope in [candidate.forecast, candidate.alerts, candidate.severeContext, candidate.marineContext]:
        normalized = _normalized_forecast(envelope)
        envelope_conflicts = normalized.get("conflicts")
        if isinstance(envelope_conflicts, list):
            conflicts.extend(str(value) for value in envelope_conflicts if isinstance(value, str))
    for bundle in candidate.supportingBundles:
        conflicts.extend(_bundle_conflicts(bundle))
    return _dedupe_strings(conflicts)


def _candidate_cards(candidate: ComparisonCandidateAnalysis) -> list[ProductCard]:
    cards: list[ProductCard] = []
    for envelope in [candidate.severeContext, candidate.marineContext, candidate.forecast]:
        normalized = _normalized_forecast(envelope)
        product_cards = normalized.get("productCards")
        if isinstance(product_cards, list):
            for card in product_cards:
                if isinstance(card, dict):
                    cards.append(ProductCard.model_validate(card))
    for bundle in candidate.supportingBundles:
        cards.extend(bundle.recommendedCards[:2])

    deduped: dict[str, ProductCard] = {}
    for card in cards:
        deduped[card.id] = card
    return list(deduped.values())[:3]


def _candidate_citations(candidate: ComparisonCandidateAnalysis) -> list[CitationBundle]:
    citations: list[CitationBundle] = []
    for envelope in [
        candidate.currentConditions,
        candidate.forecast,
        candidate.alerts,
        candidate.severeContext,
        candidate.marineContext,
    ]:
        if envelope is None:
            continue
        citations.extend(envelope.citations)
    for bundle in candidate.supportingBundles:
        for product in bundle.evidenceProducts:
            for provenance in product.provenance:
                citations.append(
                    CitationBundle(
                        id=f"{provenance.sourceId}:{provenance.productId}",
                        label=provenance.label,
                        sourceId=provenance.sourceId,
                        productId=provenance.productId,
                        kind=provenance.kind,
                        url=provenance.url,
                        contextUrl=provenance.contextUrl,
                        displayUrl=provenance.displayUrl,
                        issuedAt=provenance.issuedAt,
                        validAt=provenance.validAt,
                    )
                )

    deduped: dict[str, CitationBundle] = {}
    for citation in citations:
        deduped[citation.id] = citation
    return list(deduped.values())


def _score_severe(candidate: ComparisonCandidateAnalysis) -> tuple[float, str]:
    short_score = 0.0
    radar_score = 0.0
    for bundle in candidate.supportingBundles:
        short_score = max(short_score, _summary_stats_score(bundle, SEVERE_SOURCE_FAMILIES))
        radar_score = max(radar_score, _summary_stats_score(bundle, RADAR_SOURCE_FAMILIES))

    severe_context = candidate.severeContext
    official_score = severe_context.confidence if severe_context is not None else 0.0
    severe_text = " ".join(
        [
            severe_context.summary if severe_context is not None else "",
            str(_normalized_forecast(severe_context).get("headline") or ""),
        ]
    ).lower()
    risk_bonus = 0.0
    if "high risk" in severe_text:
        risk_bonus = 0.18
    elif "moderate risk" in severe_text:
        risk_bonus = 0.14
    elif "enhanced risk" in severe_text:
        risk_bonus = 0.1
    elif "slight risk" in severe_text:
        risk_bonus = 0.06

    conflict_penalty = min(len(_candidate_conflicts(candidate)) * 0.04, 0.16)
    score = _clamp((short_score * 0.45) + (radar_score * 0.35) + (official_score * 0.2) + risk_bonus - conflict_penalty)
    why = "Short-range and radar signals are lining up best here."
    if radar_score > short_score + 0.08:
        why = "Radar and MRMS support is currently sharper here than the nearby alternatives."
    elif official_score > 0.85 and risk_bonus >= 0.1:
        why = "The official severe context is strongest here and the storm-scale support is holding up."
    return score, why


def _score_beach(candidate: ComparisonCandidateAnalysis) -> tuple[float, str]:
    period = _forecast_period(candidate)
    forecast_text = _forecast_text(candidate)
    current_text = _current_conditions_text(candidate)
    marine_text = _marine_text(candidate)

    temperature = _temperature_f(period.get("temperature"), period.get("temperatureUnit"))
    wind = _parse_wind_mph(str(period.get("wind") or ""))
    temp_score = 0.55 if temperature is None else _clamp(1 - (abs(temperature - 82) / 28))
    wind_score = 0.65 if wind is None else _clamp(1 - max(wind - 8, 0) / 22)
    dry_score = 0.3 if _text_has_any(forecast_text, PRECIP_WORDS) else 1.0
    sky_bonus = 0.08 if _text_has_any(" ".join([forecast_text, current_text]), SUN_WORDS) else 0.0
    marine_penalty = 0.12 if _text_has_any(marine_text, ROUGH_SURF_WORDS) else 0.0
    alerts_penalty = _alert_penalty(candidate)

    score = _clamp((temp_score * 0.35) + (dry_score * 0.35) + (wind_score * 0.2) + sky_bonus - marine_penalty - alerts_penalty)
    why = "It looks warmer, drier, and calmer than the nearby beach alternatives."
    if alerts_penalty > 0:
        why = "The weather setup is decent, but active alerts keep it from being the cleanest beach choice."
    elif marine_penalty > 0:
        why = "The land weather is favorable, but surf or marine hazards lower the beach-day quality."
    return score, why


def _score_pleasant(candidate: ComparisonCandidateAnalysis) -> tuple[float, str]:
    period = _forecast_period(candidate)
    forecast_text = _forecast_text(candidate)
    current_text = _current_conditions_text(candidate)
    temperature = _temperature_f(period.get("temperature"), period.get("temperatureUnit"))
    wind = _parse_wind_mph(str(period.get("wind") or ""))
    temp_score = 0.55 if temperature is None else _clamp(1 - (abs(temperature - 72) / 24))
    wind_score = 0.7 if wind is None else _clamp(1 - max(wind - 6, 0) / 24)
    dry_score = 0.3 if _text_has_any(forecast_text, PRECIP_WORDS) else 1.0
    sky_bonus = 0.06 if _text_has_any(" ".join([forecast_text, current_text]), SUN_WORDS) else 0.0
    alerts_penalty = _alert_penalty(candidate)

    score = _clamp((temp_score * 0.4) + (dry_score * 0.35) + (wind_score * 0.2) + sky_bonus - alerts_penalty)
    why = "It keeps the cleanest mix of comfortable temperatures, lower wind, and lower rain risk."
    if alerts_penalty > 0:
        why = "The basic weather looks workable, but active alerts keep it behind the better options."
    return score, why


def _score_candidate(candidate: ComparisonCandidateAnalysis, objective: str) -> tuple[float, str]:
    if objective == "severe-favorability":
        return _score_severe(candidate)
    if objective == "beach-day":
        return _score_beach(candidate)
    return _score_pleasant(candidate)


def _candidate_summary(candidate: ComparisonCandidateAnalysis, objective: str, score: float) -> str:
    label = _candidate_alias(candidate.candidate)
    if objective == "severe-favorability":
        return f"{label} keeps the stronger tornado-supportive storm signal right now." if score >= 0.62 else f"{label} still has a severe-weather signal, but it is less convincing right now."
    if objective == "beach-day":
        return f"{label} currently looks like a better beach-weather setup." if score >= 0.62 else f"{label} has a usable beach window, but the weather setup is not as clean."
    return f"{label} currently looks like the more pleasant weather pick." if score >= 0.62 else f"{label} is still workable, but the weather setup is not as comfortable."


def _overall_confidence(request: CompareWeatherRequest, ranked: list[ComparedCandidate]) -> WeatherConfidence:
    if not ranked:
        return _confidence("RainCheck could not assemble enough candidate analysis to rank these locations.", 0.35)

    winner = ranked[0]
    second_score = ranked[1].score if len(ranked) > 1 else max(0.0, winner.score - 0.12)
    gap = max(0.0, winner.score - second_score)
    coverage = sum(
        1
        for candidate in request.candidates
        if any(
            envelope is not None
            for envelope in [
                candidate.currentConditions,
                candidate.forecast,
                candidate.alerts,
                candidate.severeContext,
                candidate.marineContext,
            ]
        )
        or candidate.supportingBundles
    ) / max(len(request.candidates), 1)
    value = _clamp(0.48 + (gap * 0.35) + (coverage * 0.25))
    return _confidence(
        "Confidence reflects how much the leading candidate separates from the rest and how complete the candidate evidence is.",
        value,
    )


def _build_bottom_line(request: CompareWeatherRequest, ranked: list[ComparedCandidate]) -> str:
    if not ranked:
        return "RainCheck could not find enough supported candidates to compare yet."

    if request.answerMode == "compare" and len(ranked) >= 2:
        winner = ranked[0]
        runner_up = ranked[1]
        return (
            f"{_candidate_alias(winner.candidate)} looks more favorable than {_candidate_alias(runner_up.candidate)} "
            f"for {request.rankingObjective.replace('-', ' ')} right now."
        )

    labels = ", ".join(_candidate_alias(candidate.candidate) for candidate in ranked[: request.rankLimit])
    return f"The best-supported {request.rankingObjective.replace('-', ' ')} picks right now are {labels}."


def _build_reason(request: CompareWeatherRequest, ranked: list[ComparedCandidate]) -> str:
    if not ranked:
        return "RainCheck needs at least one analyzed candidate before it can explain the ranking."

    if request.rankingObjective == "severe-favorability":
        return "RainCheck weighted storm-scale radar support, short-range severe signal, official severe context, and conflict penalties across each candidate."
    if request.rankingObjective == "beach-day":
        return "RainCheck weighted dry conditions, warmer temperatures, lighter wind, active alerts, and any available marine penalties across each beach candidate."
    return "RainCheck weighted dry conditions, comfortable temperatures, lighter wind, and active alerts across each candidate."


def _shared_uncertainty(ranked: list[ComparedCandidate]) -> str | None:
    conflicts = _dedupe_strings(
        [conflict for candidate in ranked[:3] for conflict in candidate.conflicts]
    )
    return conflicts[0] if conflicts else None


def compare_weather(request: CompareWeatherRequest) -> CompareWeatherBundle:
    answer_tone = request.answerTone
    ranked_candidates: list[ComparedCandidate] = []
    for candidate in request.candidates:
        score, why = _score_candidate(candidate, request.rankingObjective)
        supporting_signals = _candidate_signals(candidate)
        conflicts = _candidate_conflicts(candidate)
        confidence = _confidence(
            "Confidence reflects the amount of direct candidate evidence available for this location.",
            _clamp(0.45 + (score * 0.45) - (min(len(conflicts), 3) * 0.04)),
        )
        ranked_candidates.append(
            ComparedCandidate(
                candidate=candidate.candidate,
                rank=1,
                score=score,
                confidence=WeatherConfidence(
                    level=confidence.level,
                    reason=_tone_text(confidence.reason, answer_tone),
                ),
                summary=_tone_text(
                    _candidate_summary(candidate, request.rankingObjective, score),
                    answer_tone,
                ),
                why=_tone_text(why, answer_tone),
                supportingSignals=_tone_list(supporting_signals, answer_tone),
                conflicts=_tone_list(conflicts, answer_tone),
                recommendedCards=_candidate_cards(candidate),
            )
        )

    ranked_candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    for index, candidate in enumerate(ranked_candidates, start=1):
        candidate.rank = index

    visible_ranked = ranked_candidates[: request.rankLimit]
    winner = visible_ranked[0] if visible_ranked else None
    cards = []
    citations = []
    for candidate in visible_ranked:
        cards.extend(candidate.recommendedCards)
    for candidate in request.candidates:
        citations.extend(_candidate_citations(candidate))

    deduped_cards: dict[str, ProductCard] = {}
    for card in cards:
        deduped_cards[card.id] = card

    deduped_citations: dict[str, CitationBundle] = {}
    for citation in citations:
        deduped_citations[citation.id] = citation

    overall_confidence = _overall_confidence(request, visible_ranked)
    shared_uncertainty = _shared_uncertainty(visible_ranked)

    return CompareWeatherBundle(
        answerMode=request.answerMode,
        rankingObjective=request.rankingObjective,
        rankLimit=request.rankLimit,
        bottomLine=_tone_text(_build_bottom_line(request, visible_ranked), answer_tone),
        confidence=WeatherConfidence(
            level=overall_confidence.level,
            reason=_tone_text(overall_confidence.reason, answer_tone),
        ),
        whyRainCheckThinksThat=_tone_text(
            _build_reason(request, visible_ranked),
            answer_tone,
        ),
        sharedUncertainty=_tone_text(shared_uncertainty, answer_tone) if shared_uncertainty else None,
        winner=winner,
        rankedCandidates=visible_ranked,
        recommendedCards=list(deduped_cards.values())[:4],
        citations=list(deduped_citations.values()),
        comparisonContext=ComparisonContext(
            workflow=request.workflow,
            answerMode=request.answerMode,
            candidateMode=request.candidateMode,
            rankLimit=request.rankLimit,
            rankingObjective=request.rankingObjective,
            originLocation=request.originLocation,
            discoveryScope=request.discoveryScope,
            candidates=[candidate.candidate for candidate in request.candidates],
        ),
    )
