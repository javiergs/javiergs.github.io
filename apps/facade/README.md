# Heart Castle Facade Study Dashboard — v4

Static dashboard prototype for synchronized Pupil Labs gaze/fixation analysis against the canonical Heart Castle façade.

## v4 changes
- CALHCI banner using the supplied logo and consistent lab identity.
- Title: **Heart Castle Facade Study Dashboard**.
- Participant/sample/fixation/event counts moved from the banner into the working area.
- Removed the “Analysis model” note.
- Added **Show cumulative heatmap** as an independent Display option.
- The heatmap accumulates from the beginning of the participant recording to the current synchronized slider time. Moving the slider backward reconstructs the heatmap for that earlier point; moving forward adds later gaze again.
- Gaze point/trail, active stimulus AOI, heatmap, and surface calibration can be independently displayed.
- Participant recording duration is computed from the fixation data rather than assumed from the stimulus duration.

## Run locally
Because the app loads CSV/JSON files with `fetch`, serve the folder over HTTP:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Data
- `data/P03-gaze.csv`
- `data/P03-fixations.csv`
- `data/stimuli.json`

`stimuli.json` still contains starter AOI timing/geometry inferred from the sampled stimulus frames. These should be refined as exact event boundaries are established.
