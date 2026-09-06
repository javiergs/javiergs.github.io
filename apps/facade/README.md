# Heart Castle Facade Study Dashboard v10

Static web dashboard for synchronized visual-stimulus, gaze, fixation, and later affective data.

## v10 changes
- Uses representative frames from the actual stimulus sequence: baseline plus Zones 1–8.
- `Actual stimulus` view reproduces the corresponding stimulus state; wait periods use a neutral baseline frame.
- `Analysis (desaturated)` uses a grayscale baseline with the AOI overlay, useful for gaze and heatmap inspection.
- Cumulative heatmap now uses a blue → cyan → green → yellow → red density scale rather than only yellow/orange.
- Door synchronization evaluates early door fixations and validates candidate offsets against Zones 2–8.
- Full session slider still spans all participant/stimulus data, while the stimulus video remains fixed at 4:19.

Run from this directory with a local static server, e.g. `python3 -m http.server 8000`.
