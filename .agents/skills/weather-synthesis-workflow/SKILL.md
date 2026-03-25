---
name: weather-synthesis-workflow
description: Use when RainCheck weather work needs synthesis-first orchestration, product selection, or chat guidance. Ban comparison-table/model-comparison artifacts, prefer fetch -> normalize -> synthesize -> answer, and keep product cards limited to single relevant products.
---

# Weather Synthesis Workflow

Use this skill for RainCheck weather work that touches chat orchestration, tool routing, or weather-answer framing.

## Rules

- Lead with an expert conclusion, not a model transcript.
- Follow `fetch -> normalize -> synthesize -> answer`.
- Never generate or reference comparison-table or model-comparison artifacts.
- Prefer the smallest relevant set of official products and guidance sources.
- Keep product cards to single products only.
- Preserve uncertainty explicitly: confidence, failure modes, and what would change the forecast.

## Output Shape

For multi-source weather questions, answer in this order:

1. Bottom line
2. Likelihood or confidence
3. Why RainCheck thinks that
4. Main failure modes
5. Supporting products
6. Optional single-product cards

## Coordination

- Use `ui_designer` for message layout and product-card presentation.
- Use `app_engineer` for TanStack AI orchestration, contracts, and chat routing.
- Use `weather_engineer` for deterministic weather analysis, product fetchers, and artifact generation.
