# Heart Castle Facade Study Dashboard v28

Changes in v28:
- Replaces the AOI-colored affect overlay with an affect-specific **gaze heatmap**.
- Select one affective measure (Focus, Engagement, Excitement, Interest, Relaxation, Stress).
- Only gaze samples with a valid synchronized value for that selected measure contribute to the affective heatmap.
- Spatial heat value is the local kernel-weighted **mean affect value (0–1)**, not elapsed time or gaze count.
- Hue remains fixed per affective measure; tone/saturation and alpha represent the measure's 0–1 intensity.
- Standard cumulative gaze heatmap and affective gaze heatmap are mutually exclusive to avoid ambiguous overlays.
- Keeps the sticky full-width timeline and per-participant data layout (`data/P12/`, `data/P03/`, etc.).
- `assets/` and `videos/` are intentionally not packaged; the app references the existing shared folders.
