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


## v30
- Moved display controls into the sticky timeline card in a compact single-line/wrapping control strip.
- Added **Minimum affect** threshold for the affective gaze heatmap (default `0.50`). Only synchronized samples at or above the threshold contribute.
- Replaced the affect heatmap radio grid with a compact Affect selector in the timeline controls.
- Removed the low/high color legend for the cumulative gaze heatmap.
- Kept gaze confidence filtering and minimum confidence beside the other display controls.
- `assets/` and `videos/` are still external/shared and are not included in this package.


## v30 affective heatmap memory

The affective gaze heatmap is now persistent with temporal decay. A qualifying gaze/affect response remains visible after it occurs, but fades toward a light residual tone as it becomes older. Repeated or recent evidence at the same location reinforces the overlay. The selected affect keeps its canonical hue; its 0–1 value controls tone, while recency/reinforcement controls alpha. The existing Minimum affect threshold still filters weak responses before they enter the map.
