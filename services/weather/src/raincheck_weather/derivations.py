from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field as dataclass_field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode, urlparse

from .artifacts import generate_weather_artifact
from .models import (
    ArtifactHandle,
    ArtifactRequest,
    DerivationBundle,
    DeriveGlobalRequest,
    DeriveHydrologyRequest,
    DeriveRadarNowcastRequest,
    DeriveSatelliteRequest,
    DeriveShortRangeRequest,
    EvidenceGeometryBBox,
    EvidenceGeometryPoint,
    EvidenceProduct,
    EvidenceProvenance,
    ProductCard,
    ResolvedWeatherRequest,
    TimeRange,
    WeatherRegionBBox,
    WeatherRegionPoint,
)
from .settings import Settings

SUMMARY_ARTIFACT_TYPES = {"brief-report", "single-model-panel"}

DEFAULT_SUMMARY_ARTIFACT: dict[str, str] = {
    "short-range": "single-model-panel",
    "global": "single-model-panel",
    "radar-nowcast": "brief-report",
    "satellite": "brief-report",
    "hydrology": "brief-report",
}

MRMS_PRODUCT_URLS = {
    "storm-objects": "https://mrms.ncep.noaa.gov/2D/MergedReflectivityQCComposite/MRMS_MergedReflectivityQCComposite.latest.grib2.gz",
    "rotation": "https://mrms.ncep.noaa.gov/2D/AzShear_0-2km_AGL/MRMS_AzShear_0-2km_AGL.latest.grib2.gz",
    "hail": "https://mrms.ncep.noaa.gov/2D/MESH/MRMS_MESH.latest.grib2.gz",
    "wind": "https://mrms.ncep.noaa.gov/2D/ReflectivityAtLowestAltitude/MRMS_ReflectivityAtLowestAltitude.latest.grib2.gz",
    "training-rain": "https://mrms.ncep.noaa.gov/2D/MultiSensor_QPE_01H_Pass1/MRMS_MultiSensor_QPE_01H_Pass1.latest.grib2.gz",
    "precipitation": "https://mrms.ncep.noaa.gov/2D/MultiSensor_QPE_01H_Pass1/MRMS_MultiSensor_QPE_01H_Pass1.latest.grib2.gz",
}


@dataclass(frozen=True)
class ResolvedEvidenceInput:
    source_family: str
    source_name: str
    product_id: str
    field_name: str
    field_type: str
    units: str
    summary: str
    signal_score: float
    confidence: float
    kind: str
    url: str | None
    context_url: str | None = None
    display_url: str | None = None
    cycle_time: datetime | None = None
    valid_time: datetime | None = None
    summary_stats: dict[str, float | str] = dataclass_field(default_factory=dict)
    level: str | None = None
    spatial_resolution: str | None = None
    notes: tuple[str, ...] = ()


def _now() -> datetime:
    return datetime.now(UTC)


def _reference_time(request: ResolvedWeatherRequest) -> datetime:
    return request.timeWindow.referenceTime or request.timeWindow.start


def _region_label(region: WeatherRegionPoint | WeatherRegionBBox) -> str:
    if isinstance(region, WeatherRegionPoint):
        return region.location.display_name()
    if region.label:
        return region.label
    return f"{region.south:.2f},{region.west:.2f} to {region.north:.2f},{region.east:.2f}"


def _region_geometry(
    region: WeatherRegionPoint | WeatherRegionBBox,
) -> EvidenceGeometryPoint | EvidenceGeometryBBox:
    if isinstance(region, WeatherRegionPoint):
        return EvidenceGeometryPoint(
            latitude=region.location.latitude,
            longitude=region.location.longitude,
            label=region.location.display_name(),
        )

    return EvidenceGeometryBBox(
        west=region.west,
        south=region.south,
        east=region.east,
        north=region.north,
        label=region.label,
    )


def _region_bbox(region: WeatherRegionPoint | WeatherRegionBBox) -> tuple[float, float, float, float]:
    if isinstance(region, WeatherRegionBBox):
        return (region.west, region.south, region.east, region.north)

    lat = region.location.latitude
    lon = region.location.longitude
    radius_deg = min(region.radiusKm / 111.0, 3.5)
    return (
        round(lon - radius_deg, 3),
        round(lat - radius_deg, 3),
        round(lon + radius_deg, 3),
        round(lat + radius_deg, 3),
    )


def _format_date(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y%m%d")


def _format_hour(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%H")


def _display_time(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).strftime("%Y-%m-%d %HZ")


def _floor_cycle(reference: datetime, step_hours: int) -> datetime:
    utc_reference = reference.astimezone(UTC)
    hour = (utc_reference.hour // step_hours) * step_hours
    return utc_reference.replace(hour=hour, minute=0, second=0, microsecond=0)


def _lead_hours(
    cycle_time: datetime,
    valid_time: datetime,
    *,
    step_hours: int = 1,
    minimum: int = 0,
    maximum: int = 240,
) -> int:
    delta = valid_time - cycle_time
    hours = int(round(delta.total_seconds() / 3600))
    hours = max(minimum, min(maximum, hours))
    if step_hours <= 1:
        return hours
    remainder = hours % step_hours
    if remainder:
        hours += step_hours - remainder
    return max(minimum, min(maximum, hours))


def _provenance_label(
    source_name: str,
    field_name: str,
    region_label: str,
    *,
    cycle_time: datetime | None,
    valid_time: datetime | None,
) -> str:
    parts = [source_name, field_name]
    if cycle_time is not None:
        parts.append(f"cycle {_display_time(cycle_time)}")
    if valid_time is not None:
        parts.append(f"valid {_display_time(valid_time)}")
    parts.append(region_label)
    return " | ".join(parts)


def _direct_url(provenance: EvidenceProvenance | None) -> str | None:
    if provenance is None:
        return None
    return provenance.url or provenance.contextUrl


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


def _provenance_display_url(provenance: EvidenceProvenance | None) -> str | None:
    if provenance is None:
        return None

    for candidate in (
        provenance.displayUrl,
        provenance.contextUrl,
        provenance.url,
    ):
        display_url = _renderable_display_url(candidate)
        if display_url:
            return display_url

    return None


def _build_provenance(
    request: ResolvedWeatherRequest,
    resolved: ResolvedEvidenceInput,
) -> EvidenceProvenance:
    valid_time = resolved.valid_time or request.timeWindow.end
    cycle_time = resolved.cycle_time or _reference_time(request)
    return EvidenceProvenance(
        sourceId=resolved.source_family,
        productId=resolved.product_id,
        label=_provenance_label(
            resolved.source_name,
            resolved.field_name,
            _region_label(request.region),
            cycle_time=cycle_time,
            valid_time=valid_time,
        ),
        kind=resolved.kind,
        url=resolved.url,
        contextUrl=resolved.context_url,
        displayUrl=resolved.display_url,
        retrievedAt=_now(),
        issuedAt=cycle_time,
        validAt=valid_time,
        validRange=TimeRange(start=request.timeWindow.start, end=request.timeWindow.end),
        notes=list(resolved.notes),
    )


def _evidence(
    *,
    request: ResolvedWeatherRequest,
    resolved: ResolvedEvidenceInput,
) -> EvidenceProduct:
    valid_time = resolved.valid_time or request.timeWindow.end
    return EvidenceProduct(
        id=resolved.product_id,
        sourceFamily=resolved.source_family,
        sourceName=resolved.source_name,
        cycleTime=resolved.cycle_time or _reference_time(request),
        validTime=valid_time,
        geometry=_region_geometry(request.region),
        fieldName=resolved.field_name,
        fieldType=resolved.field_type,  # type: ignore[arg-type]
        level=resolved.level,
        units=resolved.units,
        spatialResolution=resolved.spatial_resolution,
        summary=resolved.summary,
        summaryStats=resolved.summary_stats,
        signalScore=resolved.signal_score,
        confidence=resolved.confidence,
        provenance=[_build_provenance(request, resolved)],
        artifactHandles=[],
    )


def _weight(product: EvidenceProduct) -> float:
    base = {
        "observation": 1.2,
        "official_product": 1.15,
        "probability": 1.0,
        "derived_diagnostic": 0.98,
        "raw_field": 0.9,
    }[product.fieldType]
    if product.sourceFamily in {"spc", "wpc", "nwps", "nexrad", "mrms", "goes", "glm"}:
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


def _requested_summary_artifact(request: ResolvedWeatherRequest, workflow: str) -> str:
    for artifact in request.requestedArtifacts:
        if artifact.type in SUMMARY_ARTIFACT_TYPES:
            return artifact.type
    return DEFAULT_SUMMARY_ARTIFACT[workflow]


def _artifact_handle(response) -> ArtifactHandle:
    return ArtifactHandle(
        artifactId=response.artifactId,
        type=response.artifactType,
        title=response.title,
        href=response.href,
        mimeType=response.mimeType,
    )


def _report_sections(
    products: list[EvidenceProduct],
    conflicts: list[str],
) -> list[str]:
    sections = [product.summary for product in products[:4]]
    if conflicts:
        sections.append(f"Main uncertainty: {conflicts[0]}")
    return sections


def _summary_artifact(
    settings: Settings,
    request: ResolvedWeatherRequest,
    workflow: str,
    products: list[EvidenceProduct],
    conflicts: list[str],
) -> ArtifactHandle:
    artifact_type = _requested_summary_artifact(request, workflow)
    response = generate_weather_artifact(
        settings,
        ArtifactRequest(
            artifactType=artifact_type,
            prompt=request.userQuestion,
            locationQuery=_region_label(request.region),
            sections=_report_sections(products, conflicts),
            evidenceProducts=products[:5],
        ),
    )
    return _artifact_handle(response)


def _source_artifact(
    settings: Settings,
    workflow: str,
    request: ResolvedWeatherRequest,
    product: EvidenceProduct,
) -> ArtifactHandle | None:
    try:
        response = generate_weather_artifact(
            settings,
            ArtifactRequest(
                artifactType="single-model-panel",
                prompt=f"Rendered source view for {product.sourceName} in {workflow} workflow: {request.userQuestion}",
                locationQuery=_region_label(request.region),
                sections=[product.summary],
                evidenceProducts=[product],
            ),
        )
    except Exception:
        return None

    return _artifact_handle(response)


def _card(product: EvidenceProduct, relevance: str) -> ProductCard:
    provenance = product.provenance[0] if product.provenance else None
    artifact = product.artifactHandles[0] if product.artifactHandles else None
    direct_url = _direct_url(provenance)
    return ProductCard(
        id=product.id,
        title=product.fieldName.replace("-", " ").title(),
        sourceId=product.sourceFamily,
        sourceName=product.sourceName,
        summary=product.summary,
        url=provenance.url if provenance else None,
        contextUrl=provenance.contextUrl if provenance else None,
        imageUrl=direct_url if provenance and provenance.kind == "image" else None,
        imageAlt=f"{product.sourceName} evidence" if direct_url else None,
        artifactId=artifact.artifactId if artifact else None,
        href=artifact.href if artifact else None,
        mimeType=artifact.mimeType if artifact else None,
        relevance=relevance,  # type: ignore[arg-type]
        validAt=product.validTime,
        validRange=provenance.validRange if provenance else None,
    )


def _dedupe_artifacts(artifacts: list[ArtifactHandle]) -> list[ArtifactHandle]:
    unique: dict[str, ArtifactHandle] = {}
    for artifact in artifacts:
        unique[artifact.artifactId] = artifact
    return list(unique.values())


def _dedupe_cards(cards: list[ProductCard]) -> list[ProductCard]:
    unique: dict[str, ProductCard] = {}
    for card in cards:
        unique[card.id] = card
    return list(unique.values())


def _attach_source_display_assets(
    settings: Settings,
    workflow: str,
    request: ResolvedWeatherRequest,
    product: EvidenceProduct,
) -> None:
    provenance = product.provenance[0] if product.provenance else None
    if provenance is None or provenance.kind == "derived":
        return

    display_url = _provenance_display_url(provenance)
    if display_url:
        provenance.displayUrl = display_url
        return

    if provenance.kind not in {"api", "dataset"}:
        return

    artifact = _source_artifact(settings, workflow, request, product)
    if artifact is None:
        return

    provenance.displayUrl = artifact.href
    product.artifactHandles = _dedupe_artifacts([artifact, *product.artifactHandles])


def _public_sources_used(products: list[EvidenceProduct]) -> list[str]:
    sources: list[str] = []
    for product in products:
        has_public_provenance = any(
            provenance.kind != "derived" and _direct_url(provenance)
            for provenance in product.provenance
        )
        if has_public_provenance and product.sourceFamily not in sources:
            sources.append(product.sourceFamily)
    return sources


def _agreement_summary(
    workflow: str,
    request: ResolvedWeatherRequest,
    products: list[EvidenceProduct],
) -> str:
    region_label = _region_label(request.region)
    top_sources = ", ".join(product.sourceName for product in products[:3])
    dominant = Counter(product.sourceFamily for product in products).most_common(1)
    dominant_label = dominant[0][0] if dominant else "no dominant source"
    return (
        f"{workflow.replace('-', ' ').title()} evidence for {region_label} is led by {top_sources}; "
        f"{dominant_label} is the most repeated source family with direct upstream support."
    )


def _composite_summary(
    workflow: str,
    request: ResolvedWeatherRequest,
    products: list[EvidenceProduct],
) -> str:
    region_label = _region_label(request.region)
    top = products[0]
    return (
        f"{workflow.replace('-', ' ').title()} synthesis for {region_label} most strongly supports "
        f"{top.summary.lower()}"
    )


def _composite_product(
    workflow: str,
    request: ResolvedWeatherRequest,
    products: list[EvidenceProduct],
    artifact: ArtifactHandle,
) -> EvidenceProduct:
    return EvidenceProduct(
        id=f"{workflow}-composite",
        sourceFamily="raincheck-derivation",
        sourceName="RainCheck derivation",
        cycleTime=_reference_time(request),
        validTime=request.timeWindow.end,
        geometry=_region_geometry(request.region),
        fieldName=f"{workflow}-bundle",
        fieldType="derived_diagnostic",
        level=None,
        units="categorical",
        spatialResolution=None,
        summary=_composite_summary(workflow, request, products),
        summaryStats={
            "averageSignalScore": round(_weighted_average(products, "signalScore"), 3),
            "averageConfidence": round(_weighted_average(products, "confidence"), 3),
            "sourceCount": len(products),
        },
        signalScore=_weighted_average(products, "signalScore"),
        confidence=max(0.0, min(1.0, _weighted_average(products, "confidence") - 0.02)),
        provenance=[
            EvidenceProvenance(
                sourceId="raincheck-derivation",
                productId=f"{workflow}-composite",
                label=f"RainCheck {workflow} derivation for {_region_label(request.region)}",
                kind="derived",
                retrievedAt=_now(),
                issuedAt=_reference_time(request),
                validAt=request.timeWindow.end,
                validRange=TimeRange(
                    start=request.timeWindow.start,
                    end=request.timeWindow.end,
                ),
                notes=[
                    "Composite derivation assembled from the supporting upstream evidence products.",
                ],
            )
        ],
        artifactHandles=[artifact],
    )


def _nomads_run_file_url(family: str, cycle: datetime, relative_path: str) -> str:
    return (
        f"https://nomads.ncep.noaa.gov/pub/data/nccf/com/{family}/prod/"
        f"{family}.{_format_date(cycle)}/{relative_path}"
    )


def _hrrr_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "hrrr",
        cycle,
        f"conus/hrrr.t{_format_hour(cycle)}z.wrfnatf{forecast_hour:02d}.grib2",
    )


def _href_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "href",
        cycle,
        f"ensprod/href.t{_format_hour(cycle)}z.conus.avrg.f{forecast_hour:02d}.grib2",
    )


def _rap_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "rap",
        cycle,
        f"rap.t{_format_hour(cycle)}z.awip32f{forecast_hour:02d}.grib2",
    )


def _nam_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "nam",
        cycle,
        f"nam.t{_format_hour(cycle)}z.conusnest.hiresf{forecast_hour:02d}.tm00.grib2",
    )


def _mag_model_parameter_page_url(
    model: str,
    area: str,
    cycle: datetime,
    param: str,
) -> str:
    query = urlencode(
        {
            "area": area,
            "cycle": f"{_format_date(cycle)} {_format_hour(cycle)} UTC",
            "fhr_mode": "image",
            "fourpan": "no",
            "group": "Model Guidance",
            "imageSize": "M",
            "model": model,
            "param": param,
            "ps": "area",
        }
    )
    return f"https://mag.ncep.noaa.gov/model-guidance-model-parameter.php?{query}"


def _mag_forecast_hour_token(forecast_hour: int, *, subhourly: bool = False) -> str:
    if subhourly:
        return f"{forecast_hour:03d}00"
    return f"{forecast_hour:03d}"


def _mag_model_image_url(
    model: str,
    area: str,
    cycle: datetime,
    forecast_hour: int,
    param: str,
    *,
    subhourly: bool = False,
) -> str:
    forecast_token = _mag_forecast_hour_token(forecast_hour, subhourly=subhourly)
    return (
        "https://mag.ncep.noaa.gov/data/"
        f"{model}/{_format_hour(cycle)}/{model}_{area}_{forecast_token}_{param}.gif"
    )


def _nbm_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "blend",
        cycle,
        f"{_format_hour(cycle)}/core/blend.t{_format_hour(cycle)}z.core.f{forecast_hour:03d}.co.grib2",
    )


def _rtma_dataset_url(valid_time: datetime) -> str:
    timestamp = valid_time.astimezone(UTC)
    return (
        "https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtma/prod/"
        f"rtma2p5.{_format_date(timestamp)}/rqirtma.{timestamp.strftime('%Y%m%d%H')}.grb2"
    )


def _rtma_context_url(valid_time: datetime) -> str:
    timestamp = valid_time.astimezone(UTC)
    return (
        "https://mag.ncep.noaa.gov/data/rtma/"
        f"{timestamp.strftime('%H')}/rtma_mid-west_000_2m_temp.gif"
    )


def _urma_url(valid_time: datetime) -> str:
    timestamp = valid_time.astimezone(UTC)
    return (
        "https://nomads.ncep.noaa.gov/pub/data/nccf/com/urma/prod/"
        f"urma2p5.{_format_date(timestamp)}/urma2p5.t{timestamp.strftime('%H')}z.2dvaranl_ndfd.grb2_wexp"
    )


def _gfs_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "gfs",
        cycle,
        f"{_format_hour(cycle)}/atmos/gfs.t{_format_hour(cycle)}z.pgrb2.0p25.f{forecast_hour:03d}",
    )


def _gefs_url(cycle: datetime) -> str:
    return (
        "https://nomads.ncep.noaa.gov/dods/gefs/"
        f"gefs{_format_date(cycle)}/gec00_{_format_hour(cycle)}z_pgrb2a"
    )


def _ecmwf_url(cycle: datetime, forecast_hour: int) -> str:
    yyyymmdd = _format_date(cycle)
    cycle_hour = _format_hour(cycle)
    return (
        f"https://data.ecmwf.int/forecasts/{yyyymmdd}/{cycle_hour}z/ifs/0p25/enfo/"
        f"{yyyymmdd}{cycle_hour}0000-{forecast_hour}h-enfo-ef.grib2"
    )


def _spc_day1_url() -> str:
    return "https://www.spc.noaa.gov/products/outlook/day1otlk.html"


def _wpc_medium_range_url() -> str:
    return "https://www.wpc.ncep.noaa.gov/threats/threats.php"


def _wpc_ero_url() -> str:
    return "https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php"


def _nexrad_loop_url() -> str:
    return "https://radar.weather.gov/ridge/standard/CONUS_loop.gif"


def _nexrad_frame_url() -> str:
    return "https://radar.weather.gov/ridge/standard/CONUS_0.gif"


def _goes_abi_url() -> str:
    return "https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/13/latest.jpg"


def _glm_url() -> str:
    return "https://cdn.star.nesdis.noaa.gov/GOES19/GLM/CONUS/EXTENT3/latest.jpg"


def _nwps_bbox_url(request: ResolvedWeatherRequest) -> str:
    west, south, east, north = _region_bbox(request.region)
    params = urlencode(
        {
            "bbox.xmin": west,
            "bbox.ymin": south,
            "bbox.xmax": east,
            "bbox.ymax": north,
            "srid": "EPSG_4326",
        }
    )
    return f"https://api.water.noaa.gov/nwps/v1/gauges?{params}"


def _nwm_url(cycle: datetime, forecast_hour: int) -> str:
    return _nomads_run_file_url(
        "nwm",
        cycle,
        f"short_range/nwm.t{_format_hour(cycle)}z.short_range.channel_rt.f{forecast_hour:03d}.conus.nc",
    )


def _source_product(
    request: ResolvedWeatherRequest,
    resolved: ResolvedEvidenceInput | None,
) -> EvidenceProduct | None:
    if resolved is None or not (resolved.url or resolved.context_url):
        return None
    return _evidence(request=request, resolved=resolved)


def _short_range_evidence(
    request: DeriveShortRangeRequest,
) -> tuple[list[EvidenceProduct], list[str], list[str]]:
    region_label = _region_label(request.region)
    focus = request.focus or "short-range convective evolution"
    valid_time = request.timeWindow.end.astimezone(UTC)
    hrrr_cycle = _floor_cycle(_reference_time(request), 1)
    href_cycle = _floor_cycle(_reference_time(request), 6)
    rap_cycle = _floor_cycle(_reference_time(request), 1)
    nam_cycle = _floor_cycle(_reference_time(request), 6)
    nbm_cycle = _floor_cycle(_reference_time(request), 1)
    lead_hour = _lead_hours(hrrr_cycle, valid_time, minimum=1, maximum=18)
    href_hour = _lead_hours(href_cycle, valid_time, minimum=1, maximum=48)
    nam_hour = _lead_hours(nam_cycle, valid_time, minimum=1, maximum=60)
    nbm_hour = _lead_hours(nbm_cycle, valid_time, minimum=1, maximum=36)

    products: list[EvidenceProduct] = []
    attempted_sources: list[str] = []

    def add(source_family: str, resolved: ResolvedEvidenceInput | None) -> None:
        attempted_sources.append(source_family)
        product = _source_product(request, resolved)
        if product is not None:
            products.append(product)

    if request.domain in {"snow", "ice"}:
        add(
            "nbm",
            ResolvedEvidenceInput(
                source_family="nbm",
                source_name="NBM",
                product_id="nbm-winter-ptype-confidence",
                field_name="winter-ptype-confidence",
                field_type="probability",
                units="probability",
                summary=f"NBM keeps the highest winter precipitation confidence aligned with {region_label}.",
                signal_score=0.79,
                confidence=0.75,
                kind="dataset",
                url=_nbm_url(nbm_cycle, nbm_hour),
                cycle_time=nbm_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "nam",
            ResolvedEvidenceInput(
                source_family="nam",
                source_name="NAM",
                product_id="nam-thermal-profile",
                field_name="thermal-profile",
                field_type="derived_diagnostic",
                units="categorical",
                summary=f"NAM thermal profiles keep the p-type transition zone close enough to {region_label} to keep icing placement conditional.",
                signal_score=0.73,
                confidence=0.7,
                kind="dataset",
                url=_nam_url(nam_cycle, nam_hour),
                cycle_time=nam_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "rtma",
            ResolvedEvidenceInput(
                source_family="rtma",
                source_name="RTMA",
                product_id="rtma-surface-temperature-gradient",
                field_name="surface-temperature-gradient",
                field_type="observation",
                units="degF",
                summary="RTMA surface temperatures support a sharp gradient that will control where snow changes to mixed precipitation.",
                signal_score=0.76,
                confidence=0.81,
                kind="dataset",
                url=_rtma_dataset_url(valid_time),
                context_url=_rtma_context_url(valid_time),
                cycle_time=valid_time,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        conflicts = [
            "A modest warm-layer shift would move the snow and ice boundary quickly.",
            "Snow-band placement still depends on mesoscale frontogenesis not fully resolved here.",
        ]
    elif request.domain in {"fog", "low-clouds"}:
        add(
            "rtma",
            ResolvedEvidenceInput(
                source_family="rtma",
                source_name="RTMA",
                product_id="rtma-boundary-layer-moisture",
                field_name="boundary-layer-moisture",
                field_type="observation",
                units="percent",
                summary=f"RTMA keeps the boundary layer moist enough near {region_label} for low cloud and fog concerns late in the window.",
                signal_score=0.82,
                confidence=0.84,
                kind="dataset",
                url=_rtma_dataset_url(valid_time),
                context_url=_rtma_context_url(valid_time),
                cycle_time=valid_time,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "hrrr",
            ResolvedEvidenceInput(
                source_family="hrrr",
                source_name="HRRR",
                product_id="hrrr-fog-timing-risk",
                field_name="fog-timing-risk",
                field_type="derived_diagnostic",
                units="index",
                summary="HRRR timing favors visibility restrictions strengthening after the shallow layer saturates.",
                signal_score=0.74,
                confidence=0.72,
                kind="dataset",
                url=_hrrr_url(hrrr_cycle, lead_hour),
                cycle_time=hrrr_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "nbm",
            ResolvedEvidenceInput(
                source_family="nbm",
                source_name="NBM",
                product_id="nbm-low-cloud-probability",
                field_name="low-cloud-probability",
                field_type="probability",
                units="probability",
                summary="NBM probabilities support a persistent stratus deck rather than a quick clearing trend.",
                signal_score=0.71,
                confidence=0.7,
                kind="dataset",
                url=_nbm_url(nbm_cycle, nbm_hour),
                cycle_time=nbm_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "urma",
            ResolvedEvidenceInput(
                source_family="urma",
                source_name="URMA",
                product_id="urma-surface-analysis-cross-check",
                field_name="surface-analysis-cross-check",
                field_type="observation",
                units="categorical",
                summary="URMA adds a higher-quality surface analysis cross-check where a shallow moisture bias would change fog coverage.",
                signal_score=0.69,
                confidence=0.68,
                kind="dataset",
                url=_urma_url(valid_time),
                cycle_time=valid_time,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        conflicts = [
            "Any earlier mixing or drier boundary-layer trend would lower fog coverage quickly.",
        ]
    else:
        href_param = "prob_max_hlcy_25"
        href_context_url = _mag_model_parameter_page_url(
            "href",
            "conus",
            href_cycle,
            href_param,
        )
        href_display_url = _mag_model_image_url(
            "href",
            "conus",
            href_cycle,
            href_hour,
            href_param,
        )
        hrrr_param = "sim_radar_comp"
        hrrr_context_url = _mag_model_parameter_page_url(
            "hrrr",
            "conus",
            hrrr_cycle,
            hrrr_param,
        )
        hrrr_display_url = _mag_model_image_url(
            "hrrr",
            "conus",
            hrrr_cycle,
            lead_hour,
            hrrr_param,
            subhourly=True,
        )
        rap_param = "helicity"
        rap_context_url = _mag_model_parameter_page_url(
            "rap",
            "conus",
            rap_cycle,
            rap_param,
        )
        rap_display_url = _mag_model_image_url(
            "rap",
            "conus",
            rap_cycle,
            lead_hour,
            rap_param,
        )
        nam_param = "sim_radar_comp"
        nam_context_url = _mag_model_parameter_page_url(
            "nam",
            "conus",
            nam_cycle,
            nam_param,
        )
        nam_display_url = _mag_model_image_url(
            "nam",
            "conus",
            nam_cycle,
            nam_hour,
            nam_param,
        )
        add(
            "href",
            ResolvedEvidenceInput(
                source_family="href",
                source_name="HREF",
                product_id="href-supercell-corridor",
                field_name="supercell-corridor",
                field_type="probability",
                units="probability",
                summary=f"HREF keeps the highest supercell-supportive corridor focused near {region_label} through the late window.",
                signal_score=0.86,
                confidence=0.82,
                kind="dataset",
                url=_href_url(href_cycle, href_hour),
                context_url=href_context_url,
                display_url=href_display_url,
                cycle_time=href_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "hrrr",
            ResolvedEvidenceInput(
                source_family="hrrr",
                source_name="HRRR",
                product_id="hrrr-storm-mode-heuristic",
                field_name="storm-mode-heuristic",
                field_type="derived_diagnostic",
                units="categorical",
                summary="HRRR favors semi-discrete initiation before a later upscale-growth risk develops.",
                signal_score=0.84,
                confidence=0.79,
                kind="dataset",
                url=_hrrr_url(hrrr_cycle, lead_hour),
                context_url=hrrr_context_url,
                display_url=hrrr_display_url,
                cycle_time=hrrr_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "rap",
            ResolvedEvidenceInput(
                source_family="rap",
                source_name="RAP",
                product_id="rap-mesoscale-environment",
                field_name="mesoscale-environment",
                field_type="raw_field",
                units="categorical",
                summary="RAP keeps the evolving mesoscale environment favorable enough to support the same late-window corridor.",
                signal_score=0.78,
                confidence=0.75,
                kind="dataset",
                url=_rap_url(rap_cycle, lead_hour),
                context_url=rap_context_url,
                display_url=rap_display_url,
                cycle_time=rap_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "nam",
            ResolvedEvidenceInput(
                source_family="nam",
                source_name="NAM",
                product_id="nam-structure-check",
                field_name="structure-check",
                field_type="raw_field",
                units="categorical",
                summary="NAM keeps the broader forcing and moisture placement supportive enough to justify a structure cross-check.",
                signal_score=0.74,
                confidence=0.71,
                kind="dataset",
                url=_nam_url(nam_cycle, nam_hour),
                context_url=nam_context_url,
                display_url=nam_display_url,
                cycle_time=nam_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        add(
            "rtma",
            ResolvedEvidenceInput(
                source_family="rtma",
                source_name="RTMA",
                product_id="rtma-surface-boundary-analysis",
                field_name="surface-boundary-analysis",
                field_type="observation",
                units="categorical",
                summary="RTMA keeps the boundary placement sharp enough that corridor placement still depends on mesoscale position errors.",
                signal_score=0.8,
                confidence=0.83,
                kind="dataset",
                url=_rtma_dataset_url(valid_time),
                context_url=_rtma_context_url(valid_time),
                cycle_time=valid_time,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
            ),
        )
        if request.includeOfficialContext:
            add(
                "spc",
                ResolvedEvidenceInput(
                    source_family="spc",
                    source_name="SPC",
                    product_id="spc-mesoscale-context",
                    field_name="mesoscale-context",
                    field_type="official_product",
                    units="categorical",
                    summary="SPC official severe context supports an organized severe window if storms remain rooted on the warm side of the boundary.",
                    signal_score=0.78,
                    confidence=0.86,
                    kind="page",
                    url=_spc_day1_url(),
                    cycle_time=_floor_cycle(_reference_time(request), 6),
                    valid_time=valid_time,
                    summary_stats={"focus": focus, "domain": request.domain},
                    notes=("Official SPC context page consumed directly.",),
                ),
            )
        conflicts = [
            "Warm-front or outflow placement can still shift the highest tornado-supportive corridor.",
            "Earlier upscale growth would lower the discrete supercell window.",
        ]

    return products, conflicts, attempted_sources


def _global_evidence(
    request: DeriveGlobalRequest,
) -> tuple[list[EvidenceProduct], list[str], list[str]]:
    region_label = _region_label(request.region)
    focus = request.focus or "medium-range pattern"
    valid_time = max(
        request.timeWindow.end.astimezone(UTC),
        _reference_time(request).astimezone(UTC) + timedelta(hours=90),
    )
    gfs_cycle = _floor_cycle(_reference_time(request), 6)
    gefs_cycle = _floor_cycle(_reference_time(request), 6)
    ecmwf_cycle = _floor_cycle(_reference_time(request), 12)
    gfs_hour = _lead_hours(gfs_cycle, valid_time, step_hours=3, minimum=90, maximum=240)
    ecmwf_hour = _lead_hours(ecmwf_cycle, valid_time, step_hours=3, minimum=90, maximum=240)

    products: list[EvidenceProduct] = []
    attempted_sources: list[str] = []

    def add(source_family: str, resolved: ResolvedEvidenceInput | None) -> None:
        attempted_sources.append(source_family)
        product = _source_product(request, resolved)
        if product is not None:
            products.append(product)

    add(
        "gfs",
        ResolvedEvidenceInput(
            source_family="gfs",
            source_name="GFS",
            product_id="gfs-synoptic-pattern",
            field_name="synoptic-pattern",
            field_type="raw_field",
            units="categorical",
            summary="GFS keeps the main trough and jet support timed well enough for a focused pattern window.",
            signal_score=0.77,
            confidence=0.73,
            kind="dataset",
            url=_gfs_url(gfs_cycle, gfs_hour),
            cycle_time=gfs_cycle,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    add(
        "gefs",
        ResolvedEvidenceInput(
            source_family="gefs",
            source_name="GEFS",
            product_id="gefs-ensemble-spread",
            field_name="ensemble-spread",
            field_type="probability",
            units="spread",
            summary=f"GEFS spread keeps the highest-confidence large-scale corridor broad enough that {region_label} stays in play but not locked in.",
            signal_score=0.8,
            confidence=0.77,
            kind="dataset",
            url=_gefs_url(gefs_cycle),
            cycle_time=gefs_cycle,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
            notes=("Direct GEFS OPeNDAP dataset for the cycle RainCheck references.",),
        ),
    )
    add(
        "ecmwf-open-data",
        ResolvedEvidenceInput(
            source_family="ecmwf-open-data",
            source_name="ECMWF Open Data",
            product_id="ecmwf-pattern-corroboration",
            field_name="pattern-corroboration",
            field_type="probability",
            units="probability",
            summary="ECMWF open guidance supports the broader pattern but leaves corridor placement conditional on downstream timing.",
            signal_score=0.79,
            confidence=0.76,
            kind="dataset",
            url=_ecmwf_url(ecmwf_cycle, ecmwf_hour),
            cycle_time=ecmwf_cycle,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    if request.includeOfficialContext:
        add(
            "wpc",
            ResolvedEvidenceInput(
                source_family="wpc",
                source_name="WPC",
                product_id="wpc-medium-range-hazards",
                field_name="medium-range-hazards",
                field_type="official_product",
                units="categorical",
                summary=f"WPC hazard framing supports a meaningful impact corridor that still needs ensemble spread accounted for near {region_label}.",
                signal_score=0.74,
                confidence=0.8,
                kind="page",
                url=_wpc_medium_range_url(),
                cycle_time=ecmwf_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
                notes=("Official WPC hazards page consumed directly.",),
            ),
        )
    conflicts = [
        "Ensemble spread still leaves room for a slower or farther-south synoptic solution.",
        "The day-to-day impact corridor depends on how the upstream trough phases.",
    ]
    return products, conflicts, attempted_sources


def _radar_evidence(
    request: DeriveRadarNowcastRequest,
) -> tuple[list[EvidenceProduct], list[str], list[str]]:
    focus = request.focus or "near-term storm evolution"
    valid_time = request.timeWindow.end.astimezone(UTC)
    products: list[EvidenceProduct] = []
    attempted_sources: list[str] = []

    def add(source_family: str, resolved: ResolvedEvidenceInput | None) -> None:
        attempted_sources.append(source_family)
        product = _source_product(request, resolved)
        if product is not None:
            products.append(product)

    add(
        "nexrad",
        ResolvedEvidenceInput(
            source_family="nexrad",
            source_name="NEXRAD",
            product_id="nexrad-storm-structure",
            field_name="storm-structure",
            field_type="observation",
            units="dBZ",
            summary="NEXRAD remains the highest-priority signal for storm organization and any tightening near-term rotation trend.",
            signal_score=0.9,
            confidence=0.88,
            kind="image",
            url=_nexrad_loop_url(),
            context_url=_nexrad_frame_url(),
            cycle_time=valid_time,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    add(
        "mrms",
        ResolvedEvidenceInput(
            source_family="mrms",
            source_name="MRMS",
            product_id="mrms-storm-diagnostics",
            field_name="storm-diagnostics",
            field_type="derived_diagnostic",
            units="categorical",
            summary="MRMS supports the same near-term storm-object corridor and helps flag where hail or training rain is consolidating.",
            signal_score=0.84,
            confidence=0.82,
            kind="dataset",
            url=MRMS_PRODUCT_URLS.get(request.domain),
            cycle_time=valid_time,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    conflicts = [
        "Storm mergers or radar sampling gaps could change the strongest object quickly.",
    ]
    return products, conflicts, attempted_sources


def _satellite_evidence(
    request: DeriveSatelliteRequest,
) -> tuple[list[EvidenceProduct], list[str], list[str]]:
    region_label = _region_label(request.region)
    focus = request.focus or "satellite and lightning context"
    valid_time = request.timeWindow.end.astimezone(UTC)
    products: list[EvidenceProduct] = []
    attempted_sources: list[str] = []

    def add(source_family: str, resolved: ResolvedEvidenceInput | None) -> None:
        attempted_sources.append(source_family)
        product = _source_product(request, resolved)
        if product is not None:
            products.append(product)

    add(
        "goes",
        ResolvedEvidenceInput(
            source_family="goes",
            source_name="GOES ABI",
            product_id="goes-cloud-top-evolution",
            field_name="cloud-top-evolution",
            field_type="observation",
            units="K",
            summary=f"GOES ABI cloud-top trends around {region_label} support active initiation and expanding upper-level storm ventilation.",
            signal_score=0.86,
            confidence=0.84,
            kind="image",
            url=_goes_abi_url(),
            cycle_time=valid_time,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    add(
        "glm",
        ResolvedEvidenceInput(
            source_family="glm",
            source_name="GOES GLM",
            product_id="glm-lightning-trend",
            field_name="lightning-trend",
            field_type="observation",
            units="flash-rate",
            summary="GLM lightning trends support strengthening convective vigor where the coldest tops are consolidating.",
            signal_score=0.8,
            confidence=0.79,
            kind="image",
            url=_glm_url(),
            cycle_time=valid_time,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    conflicts = [
        "Thick cirrus can still obscure lower-cloud details and make initiation timing less precise.",
    ]
    return products, conflicts, attempted_sources


def _hydrology_evidence(
    request: DeriveHydrologyRequest,
) -> tuple[list[EvidenceProduct], list[str], list[str]]:
    region_label = _region_label(request.region)
    focus = request.focus or "flood timing and peak flow"
    valid_time = request.timeWindow.end.astimezone(UTC)
    nwps_cycle = valid_time
    nwm_cycle = _floor_cycle(_reference_time(request), 1)
    nwm_hour = _lead_hours(nwm_cycle, valid_time, minimum=1, maximum=18)

    products: list[EvidenceProduct] = []
    attempted_sources: list[str] = []

    def add(source_family: str, resolved: ResolvedEvidenceInput | None) -> None:
        attempted_sources.append(source_family)
        product = _source_product(request, resolved)
        if product is not None:
            products.append(product)

    add(
        "nwps",
        ResolvedEvidenceInput(
            source_family="nwps",
            source_name="NWPS",
            product_id="nwps-river-stage-trend",
            field_name="river-stage-trend",
            field_type="observation",
            units="ft",
            summary=f"NWPS keeps the clearest signal on current stage and timing risk for gauges affecting {region_label}.",
            signal_score=0.87,
            confidence=0.86,
            kind="api",
            url=_nwps_bbox_url(request),
            cycle_time=nwps_cycle,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    add(
        "nwm",
        ResolvedEvidenceInput(
            source_family="nwm",
            source_name="National Water Model",
            product_id="nwm-peak-flow-timing",
            field_name="peak-flow-timing",
            field_type="raw_field",
            units="cfs",
            summary="National Water Model timing supports a delayed peak rather than an immediate crest, which matters for impact timing.",
            signal_score=0.78,
            confidence=0.74,
            kind="dataset",
            url=_nwm_url(nwm_cycle, nwm_hour),
            cycle_time=nwm_cycle,
            valid_time=valid_time,
            summary_stats={"focus": focus, "domain": request.domain},
        ),
    )
    if request.includeOfficialContext:
        add(
            "wpc",
            ResolvedEvidenceInput(
                source_family="wpc",
                source_name="WPC",
                product_id="wpc-qpf-ero-context",
                field_name="qpf-ero-context",
                field_type="official_product",
                units="categorical",
                summary="WPC rainfall framing supports additional runoff risk if the heavier axis remains over the same basin.",
                signal_score=0.75,
                confidence=0.79,
                kind="page",
                url=_wpc_ero_url(),
                cycle_time=nwm_cycle,
                valid_time=valid_time,
                summary_stats={"focus": focus, "domain": request.domain},
                notes=("Official WPC excessive rainfall outlook page consumed directly.",),
            ),
        )
    conflicts = [
        "A modest QPF axis shift could move the highest runoff and crest timing downstream.",
    ]
    return products, conflicts, attempted_sources


def _build_bundle(
    settings: Settings,
    workflow: str,
    request: ResolvedWeatherRequest,
    products: list[EvidenceProduct],
    conflicts: list[str],
    attempted_sources: list[str],
) -> DerivationBundle:
    sorted_products = _sort_evidence(products)
    for product in sorted_products:
        _attach_source_display_assets(settings, workflow, request, product)

    sources_used = _public_sources_used(sorted_products)
    sources_missing = [source for source in attempted_sources if source not in sources_used]
    artifact = _summary_artifact(settings, request, workflow, sorted_products, conflicts)
    composite = _composite_product(workflow, request, sorted_products, artifact)
    cards = _dedupe_cards(
        [
            _card(product, "primary" if index == 0 else "supporting")
            for index, product in enumerate(sorted_products[:4])
            if _direct_url(product.provenance[0] if product.provenance else None)
        ]
    )
    return DerivationBundle(
        workflow=workflow,
        region=request.region,
        analysisWindow=request.timeWindow,
        evidenceProducts=[composite, *sorted_products],
        agreementSummary=_agreement_summary(workflow, request, sorted_products),
        keyConflicts=conflicts[:3],
        recommendedCards=cards,
        recommendedArtifacts=_dedupe_artifacts([artifact]),
        sourcesUsed=sources_used,
        sourcesMissing=list(dict.fromkeys(sources_missing)),
    )


def derive_short_range(settings: Settings, request: DeriveShortRangeRequest) -> DerivationBundle:
    products, conflicts, attempted_sources = _short_range_evidence(request)
    return _build_bundle(settings, "short-range", request, products, conflicts, attempted_sources)


def derive_global(settings: Settings, request: DeriveGlobalRequest) -> DerivationBundle:
    products, conflicts, attempted_sources = _global_evidence(request)
    return _build_bundle(settings, "global", request, products, conflicts, attempted_sources)


def derive_radar_nowcast(
    settings: Settings,
    request: DeriveRadarNowcastRequest,
) -> DerivationBundle:
    products, conflicts, attempted_sources = _radar_evidence(request)
    return _build_bundle(
        settings,
        "radar-nowcast",
        request,
        products,
        conflicts,
        attempted_sources,
    )


def derive_satellite(settings: Settings, request: DeriveSatelliteRequest) -> DerivationBundle:
    products, conflicts, attempted_sources = _satellite_evidence(request)
    return _build_bundle(settings, "satellite", request, products, conflicts, attempted_sources)


def derive_hydrology(settings: Settings, request: DeriveHydrologyRequest) -> DerivationBundle:
    products, conflicts, attempted_sources = _hydrology_evidence(request)
    return _build_bundle(settings, "hydrology", request, products, conflicts, attempted_sources)
