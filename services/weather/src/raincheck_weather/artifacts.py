from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from pathlib import Path

from .models import ArtifactRequest, ArtifactResponse
from .settings import Settings


def _timestamp() -> datetime:
    return datetime.now(timezone.utc)


def _write_file(directory: Path, name: str, contents: str) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / name
    path.write_text(contents, encoding="utf-8")
    return path


def generate_meteogram(settings: Settings, payload: ArtifactRequest) -> ArtifactResponse:
    created_at = _timestamp()
    artifact_id = f"meteogram-{int(created_at.timestamp())}.svg"
    points = payload.chartPoints or [
        {"label": "Now", "value": 62.0},
        {"label": "+3h", "value": 65.0},
        {"label": "+6h", "value": 64.0},
        {"label": "+9h", "value": 60.0},
        {"label": "+12h", "value": 57.0},
    ]
    values = [point["value"] if isinstance(point, dict) else point.value for point in points]
    min_value = min(values)
    max_value = max(values)
    value_span = max(max_value - min_value, 1)
    x_step = 580 / max(len(values) - 1, 1)
    coords = []
    for index, value in enumerate(values):
        x = 70 + index * x_step
        normalized = (value - min_value) / value_span
        y = 210 - normalized * 110
        coords.append(f"{x:.1f} {y:.1f}")

    path_data = " L".join(coords)
    location_text = escape(payload.display_location())
    prompt_text = escape(payload.prompt)
    svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280">
  <rect width="720" height="280" rx="24" fill="#091419" />
  <path d="M{path_data}" fill="none" stroke="#79ddd0" stroke-width="5" stroke-linecap="round" />
  <text x="34" y="42" fill="#eef5f5" font-family="sans-serif" font-size="20">RainCheck Meteogram</text>
  <text x="34" y="68" fill="#9cb0b4" font-family="sans-serif" font-size="13">{location_text}</text>
  <text x="34" y="246" fill="#9cb0b4" font-family="sans-serif" font-size="13">{prompt_text}</text>
</svg>"""
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
    artifact_id = f"research-report-{int(created_at.timestamp())}.html"
    location_text = escape(payload.display_location())
    prompt_text = escape(payload.prompt)
    sections = payload.sections or [
        "Situation",
        "Official forecast baseline",
        "Uncertainty and next checks",
    ]
    section_list = "\n".join(f"<li>{escape(section)}</li>" for section in sections)
    html = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>RainCheck Research Report</title>
    <style>
      body {{ font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #071217; color: #eef5f5; }}
      main {{ max-width: 760px; margin: 0 auto; padding: 52px 24px 80px; }}
      h1 {{ margin: 0 0 10px; font-size: 34px; }}
      p, li {{ color: #afc0c3; line-height: 1.65; }}
      .eyebrow {{ color: #79ddd0; text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; }}
    </style>
  </head>
  <body>
    <main>
      <div class="eyebrow">RainCheck research report</div>
      <h1>{location_text}</h1>
      <p>Generated {created_at.isoformat()}</p>
      <p>{prompt_text}</p>
      <ul>
        {section_list}
      </ul>
    </main>
  </body>
</html>"""
    _write_file(settings.artifacts_dir, artifact_id, html)
    return ArtifactResponse(
        artifactId=artifact_id,
        artifactType="research-report",
        title=f"Research report for {payload.display_location()}",
        href=f"{settings.public_base_path}/{artifact_id}",
        mimeType="text/html",
        createdAt=created_at,
    )
