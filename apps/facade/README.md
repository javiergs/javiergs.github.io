# Stimulus-Synchronized Gaze Viewer — v3

This version changes the analysis model so the **stimulus timeline is the master clock**.

## What is new

- Uses the exact canonical façade image as the stable analysis canvas.
- Reconstructs the stimulus sequence from `data/stimuli.json`; the original video is not required for routine analysis.
- Shows the active stimulus as an AOI overlay on the façade.
- Maps Pupil `surfaceX` / `surfaceY` gaze onto the same canvas.
- Provides gaze point + trail and two heatmap modes.
- Uses the fixation recording start as participant recording time zero.
- Supports a participant-specific synchronization offset:

  `recording time = stimulus time + offset`

- Includes an automatic behavioral synchronization prototype. It searches candidate offsets and scores how often gaze enters the corresponding AOI shortly after multiple stimulus onsets. Door events are weighted more strongly, but no single response is treated as definitive.
- Provides manual ±0.1 s / ±1 s synchronization nudges.
- Exports the current participant synchronization + surface configuration as JSON.

## Important: starter stimulus definitions

The times and AOIs in `data/stimuli.json` were derived from the 1-second frame sampling and are intentionally **preliminary**. Refine each onset with dense frame extraction around the transition, then edit the JSON. AOIs are also starter regions and should be adjusted against the exact experimental stimulus geometry.

## Run locally

Browsers usually block `fetch()` from local `file://` pages. Serve the folder:

```bash
cd pupil_surface_viewer_v3
python3 -m http.server 8000
```

Then open:

`http://localhost:8000`

## GitHub Pages

The folder is static HTML/CSS/JS and can be deployed directly to GitHub Pages.

## Next generalization

The current package contains only P03, but the code is structured around a stimulus clock and participant offset. The next step is a participant/session manifest so additional `P04`, `P05`, affect, EEG, and world-camera files can be added without changing the UI.
