from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from pathlib import Path

from .models import ArtifactRequest, ArtifactResponse, ChartPoint
from .settings import Settings


def _timestamp() -> datetime:
    return datetime.now(timezone.utc)


def _write_file(directory: Path, name: str, contents: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(contents, encoding="utf-8")
    return path


def _artifact_id(prefix: str, suffix: str, created_at: datetime) -> str:
    return f"{prefix}-{int(created_at.timestamp())}.{suffix}"


def _point_values(points: list[ChartPoint]) -> list[float]:
    return [point.value for point in points]


def _primary_points(payload: ArtifactRequest) -> list[ChartPoint]:
    if payload.chartPoints:
        return payload.chartPoints

    if payload.chartSeries and payload.chartSeries[0].points:
        return payload.chartSeries[0].points

    return [
        ChartPoint(label="Now", value=62.0),
        ChartPoint(label="+3h", value=65.0),
        ChartPoint(label="+6h", value=64.0),
        ChartPoint(label="+9h", value=60.0),
        ChartPoint(label="+12h", value=57.0),
    ]


def _multi_line_svg(
    title: str,
    subtitle: str,
    series: list[list[ChartPoint]],
    *,
    stroke_colors: list[str],
    fill_colors: list[str],
    height: int = 280,
) -> str:
    all_values = [point.value for line in series for point in line]
    min_value = min(all_values)
    max_value = max(all_values)
    value_span = max(max_value - min_value, 1)
    width = 720
    left = 70
    right = 620
    top = 34
    bottom = 210

    lines = []
    legend = []
    for index, line in enumerate(series):
        if not line:
            continue

        x_step = (right - left) / max(len(line) - 1, 1)
        coords = []
        for point_index, point in enumerate(line):
            x = left + point_index * x_step
            normalized = (point.value - min_value) / value_span
            y = bottom - normalized * 110
            coords.append(f"{x:.1f},{y:.1f}")

        path_data = " L".join(coords)
        stroke = stroke_colors[index % len(stroke_colors)]
        fill = fill_colors[index % len(fill_colors)]
        lines.append(
            f'<path d="M{path_data}" fill="none" stroke="{stroke}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />'
        )
        lines.append(
            f'<polygon points="{coords[0]} {coords[-1]} {right:.1f},{bottom:.1f} {left:.1f},{bottom:.1f}" fill="{fill}" opacity="0.12" />'
        )
        legend.append(
            f'<text x="34" y="{240 + index * 18}" fill="{stroke}" font-family="sans-serif" font-size="12">{escape(line[0].label if line else "Series")}</text>'
        )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" rx="24" fill="#091419" />
  <text x="34" y="40" fill="#eef5f5" font-family="sans-serif" font-size="20">{escape(title)}</text>
  <text x="34" y="64" fill="#9cb0b4" font-family="sans-serif" font-size="13">{escape(subtitle)}</text>
  {''.join(lines)}
  {''.join(legend)}
</svg>"""
    return svg


def _chart_svg(
    title: str,
    subtitle: str,
    points: list[ChartPoint],
    *,
    stroke: str,
    fill: str,
) -> str:
    return _multi_line_svg(title, subtitle, [points], stroke_colors=[stroke], fill_colors=[fill])


def _bar_svg(
    title: str,
    subtitle: str,
    points: list[ChartPoint],
    *,
    bar_color: str,
) -> str:
    values = _point_values(points)
    min_value = min(0.0, min(values))
    max_value = max(values)
    value_span = max(max_value - min_value, 1)
    width = 720
    height = 280
    left = 68
    chart_right = 640
    chart_bottom = 206
    chart_top = 66
    bar_width = (chart_right - left) / max(len(points), 1) * 0.65
    x_step = (chart_right - left) / max(len(points), 1)
    bars = []

    for index, point in enumerate(points):
        x = left + index * x_step
        normalized = (point.value - min_value) / value_span
        y = chart_bottom - normalized * (chart_bottom - chart_top)
        bar_height = chart_bottom - y
        bars.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bar_width:.1f}" height="{bar_height:.1f}" rx="8" fill="{bar_color}" opacity="0.9" />'
        )
        bars.append(
            f'<text x="{x:.1f}" y="232" fill="#9cb0b4" font-family="sans-serif" font-size="11">{escape(point.label)}</text>'
        )

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">
  <rect width="{width}" height="{height}" rx="24" fill="#091419" />
  <text x="34" y="40" fill="#eef5f5" font-family="sans-serif" font-size="20">{escape(title)}</text>
  <text x="34" y="64" fill="#9cb0b4" font-family="sans-serif" font-size="13">{escape(subtitle)}</text>
  {''.join(bars)}
</svg>"""
    return svg


def _html_page(title: str, body: str) -> str:
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{escape(title)}</title>
    <style>
      body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #071217; color: #eef5f5; }}
      main {{ max-width: 860px; margin: 0 auto; padding: 52px 24px 80px; }}
      h1 {{ margin: 0 0 10px; font-size: 34px; }}
      h2 {{ margin: 24px 0 8px; font-size: 20px; }}
      p, li, td, th {{ color: #afc0c3; line-height: 1.65; }}
      table {{ width: 100%; border-collapse: collapse; margin-top: 16px; }}
      th, td {{ border-bottom: 1px solid #173039; padding: 10px 8px; text-align: left; vertical-align: top; }}
      .eyebrow {{ color: #79ddd0; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; }}
      .panel {{ background: #0b171c; border: 1px solid #173039; border-radius: 18px; padding: 18px 20px; margin-top: 18px; }}
      .muted {{ color: #8fa7ab; }}
      .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-top: 16px; }}
      .card {{ background: #0b171c; border: 1px solid #173039; border-radius: 16px; padding: 14px 16px; }}
      .frame {{ display: flex; justify-content: space-between; gap: 12px; align-items: baseline; }}
      .label {{ color: #79ddd0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; }}
    </style>
  </head>
  <body>
    <main>
      {body}
    </main>
  </body>
</html>"""


def _build_report_body(payload: ArtifactRequest, created_at: datetime, *, brief: bool) -> str:
    sections = payload.sections or (
        ["Situation", "Near-term impacts", "Uncertainty"]
        if brief
        else ["Situation", "Official forecast baseline", "Hazards", "Uncertainty"]
    )
    section_html = "".join(f"<li>{escape(section)}</li>" for section in sections)
    title = "Brief weather report" if brief else "RainCheck research report"
    return f"""
      <div class="eyebrow">{title}</div>
      <h1>{escape(payload.display_location())}</h1>
      <p>Generated {created_at.isoformat()}</p>
      <p>{escape(payload.prompt)}</p>
      <div class="panel">
        <h2>Sections</h2>
        <ul>{section_html}</ul>
      </div>
    """


def generate_meteogram(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("meteogram", "svg", created_at)
    points = _primary_points(payload)
    svg = _chart_svg(
        "RainCheck Meteogram",
        payload.display_location(),
        points,
        stroke="#79ddd0",
        fill="#79ddd0",
    )
    _write_file(settings.artifacts_dir, artifact_id, svg)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="meteogram",
        title=f"Meteogram for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="image/svg+xml",
        createdAt=created_at,
    )


def generate_report(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    brief = payload.artifactType == "brief-report"
    prefix = "brief-report" if brief else "research-report"
    artifact_id = _artifact_id(prefix, "html", created_at)
    body = _build_report_body(payload, created_at, brief=brief)
    html = _html_page("RainCheck Brief Report" if brief else "RainCheck Research Report", body)
    _write_file(settings.artifacts_dir, artifact_id, html)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType=payload.artifactType,
        title=f"{'Brief' if brief else 'Research'} report for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="text/html",
        createdAt=created_at,
    )


def _loop_storyboard(
    settings: Settings,
    payload: ArtifactRequest,
    *,
    artifact_type: str,
    title: str,
    accent: str,
) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id(artifact_type, "html", created_at)
    frames = payload.frames or [
        {"label": "Frame 1", "description": payload.prompt},
        {"label": "Frame 2", "description": payload.display_location()},
    ]
    frame_cards = []
    for index, frame in enumerate(frames, start=1):
        label = frame.label if hasattr(frame, "label") else frame["label"]
        description = frame.description if hasattr(frame, "description") else frame.get("description", "")
        timestamp = frame.timestamp if hasattr(frame, "timestamp") else frame.get("timestamp")
        stamp = timestamp.isoformat() if timestamp else f"Step {index}"
        frame_cards.append(
            f"""
            <div class="card">
              <div class="frame"><span class="label">{escape(label)}</span><span class="muted">{escape(stamp)}</span></div>
              <p>{escape(description or payload.prompt)}</p>
            </div>
            """
        )

    body = f"""
      <div class="eyebrow">{escape(title)}</div>
      <h1>{escape(payload.display_location())}</h1>
      <p>{escape(payload.prompt)}</p>
      <div class="panel" style="border-color: {accent};">
        <div class="grid">{''.join(frame_cards)}</div>
      </div>
    """
    html = _html_page(title, body)
    _write_file(settings.artifacts_dir, artifact_id, html)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType=artifact_type,
        title=f"{title} for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="text/html",
        createdAt=created_at,
    )


def generate_radar_loop(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    return _loop_storyboard(
        settings,
        payload,
        artifact_type="radar-loop",
        title="RainCheck Radar Loop",
        accent="#ff7a59",
    )


def generate_satellite_loop(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    return _loop_storyboard(
        settings,
        payload,
        artifact_type="satellite-loop",
        title="RainCheck Satellite Loop",
        accent="#6b9cff",
    )


def generate_model_comparison_panel(
    settings: Settings, payload: ArtifactRequest
) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("model-comparison-panel", "html", created_at)
    rows = payload.comparisonModels or []
    table_rows = "".join(
        f"""
        <tr>
          <td>{escape(model.modelLabel)}</td>
          <td>{escape(model.sourceId)}</td>
          <td>{escape(model.summary)}</td>
          <td>{escape(model.confidence or "unknown")}</td>
        </tr>
        """
        for model in rows
    )
    if not table_rows:
        table_rows = """
        <tr>
          <td colspan="4">No model comparison rows were supplied.</td>
        </tr>
        """

    body = f"""
      <div class="eyebrow">RainCheck model comparison</div>
      <h1>{escape(payload.display_location())}</h1>
      <p>{escape(payload.prompt)}</p>
      <div class="panel">
        <table>
          <thead>
            <tr><th>Model</th><th>Source</th><th>Summary</th><th>Confidence</th></tr>
          </thead>
          <tbody>{table_rows}</tbody>
        </table>
      </div>
    """
    html = _html_page("RainCheck Model Comparison", body)
    _write_file(settings.artifacts_dir, artifact_id, html)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="model-comparison-panel",
        title=f"Model comparison for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="text/html",
        createdAt=created_at,
    )


def generate_hydrograph(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("hydrograph", "svg", created_at)
    points = _primary_points(payload)
    svg = _chart_svg(
        "RainCheck Hydrograph",
        payload.display_location(),
        points,
        stroke="#4cc9f0",
        fill="#4cc9f0",
    )
    _write_file(settings.artifacts_dir, artifact_id, svg)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="hydrograph",
        title=f"Hydrograph for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="image/svg+xml",
        createdAt=created_at,
    )


def generate_rainfall_chart(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("rainfall-chart", "svg", created_at)
    points = _primary_points(payload)
    svg = _bar_svg("RainCheck Rainfall Chart", payload.display_location(), points, bar_color="#79ddd0")
    _write_file(settings.artifacts_dir, artifact_id, svg)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="rainfall-chart",
        title=f"Rainfall chart for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="image/svg+xml",
        createdAt=created_at,
    )


def generate_snowfall_chart(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("snowfall-chart", "svg", created_at)
    points = _primary_points(payload)
    svg = _bar_svg("RainCheck Snowfall Chart", payload.display_location(), points, bar_color="#b8d6ff")
    _write_file(settings.artifacts_dir, artifact_id, svg)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="snowfall-chart",
        title=f"Snowfall chart for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="image/svg+xml",
        createdAt=created_at,
    )


def generate_skewt(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = _artifact_id("skewt", "svg", created_at)
    levels = payload.soundingLevels or []
    if not levels:
        levels = []
        for index, point in enumerate(_primary_points(payload), start=1):
            levels.append(
                {
                    "pressureHpa": 1000 - index * 100,
                    "temperatureC": point.value,
                    "dewpointC": point.value - 4.0,
                }
            )

    pressures = [level.pressureHpa if hasattr(level, "pressureHpa") else level["pressureHpa"] for level in levels]
    temps = [
        level.temperatureC if hasattr(level, "temperatureC") else level.get("temperatureC")
        for level in levels
    ]
    dewpoints = [
        level.dewpointC if hasattr(level, "dewpointC") else level.get("dewpointC")
        for level in levels
    ]
    min_temp = min(value for value in temps + dewpoints if value is not None)
    max_temp = max(value for value in temps + dewpoints if value is not None)
    temp_span = max(max_temp - min_temp, 1)
    y_min = min(pressures)
    y_max = max(pressures)
    y_span = max(y_max - y_min, 1)
    x_left = 120
    x_width = 460
    y_top = 60
    y_bottom = 210

    def x_for(temp: float | None) -> float:
        if temp is None:
            return x_left
        return x_left + ((temp - min_temp) / temp_span) * x_width

    def y_for(pressure: float) -> float:
        return y_bottom - ((pressure - y_min) / y_span) * (y_bottom - y_top)

    temp_points = []
    dew_points = []
    for level in levels:
        pressure = level.pressureHpa if hasattr(level, "pressureHpa") else level["pressureHpa"]
        temperature = level.temperatureC if hasattr(level, "temperatureC") else level.get("temperatureC")
        dewpoint = level.dewpointC if hasattr(level, "dewpointC") else level.get("dewpointC")
        temp_points.append(f"{x_for(temperature):.1f},{y_for(pressure):.1f}")
        dew_points.append(f"{x_for(dewpoint):.1f},{y_for(pressure):.1f}")

    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280">
  <rect width="720" height="280" rx="24" fill="#091419" />
  <text x="34" y="40" fill="#eef5f5" font-family="sans-serif" font-size="20">RainCheck Skew-T</text>
  <text x="34" y="64" fill="#9cb0b4" font-family="sans-serif" font-size="13">{escape(payload.display_location())}</text>
  <path d="M{' L'.join(temp_points)}" fill="none" stroke="#79ddd0" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M{' L'.join(dew_points)}" fill="none" stroke="#6b9cff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
  <text x="34" y="236" fill="#79ddd0" font-family="sans-serif" font-size="12">Temperature</text>
  <text x="138" y="236" fill="#6b9cff" font-family="sans-serif" font-size="12">Dewpoint</text>
</svg>"""
    _write_file(settings.artifacts_dir, artifact_id, svg)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="skewt",
        title=f"Skew-T for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="image/svg+xml",
        createdAt=created_at,
    )


def generate_weather_artifact(
    settings: Settings, payload: ArtifactRequest
) -> ArtifactResponse:
    match payload.artifactType:
        case "meteogram":
            return generate_meteogram(settings, payload)
        case "research-report" | "brief-report":
            return generate_report(settings, payload)
        case "radar-loop":
            return generate_radar_loop(settings, payload)
        case "satellite-loop":
            return generate_satellite_loop(settings, payload)
        case "model-comparison-panel":
            return generate_model_comparison_panel(settings, payload)
        case "hydrograph":
            return generate_hydrograph(settings, payload)
        case "skewt":
            return generate_skewt(settings, payload)
        case "rainfall-chart":
            return generate_rainfall_chart(settings, payload)
        case "snowfall-chart":
            return generate_snowfall_chart(settings, payload)
    raise ValueError(f"Unsupported artifact type: {payload.artifactType}")
