# Pupil Surface Gaze Viewer

Static web prototype for P03.

## What it does
- Uses the exact façade image supplied in the conversation (`assets/facade.png`).
- Loads `data/P03-gaze.csv`.
- Plays gaze over time with a slider and play/pause button.
- Shows `surfaceX`, `surfaceY`, confidence, step, and sample number.
- Lets you drag four surface reference markers over the façade.
- Uses a projective transform (homography) from normalized surface coordinates to the adjustable quadrilateral.
- Exports the marker configuration as JSON.
- Includes optional confidence filtering and recent gaze trail.

## Run locally
Because the app loads CSV with `fetch()`, use a tiny local web server rather than opening `index.html` directly.

Python:
    cd pupil_surface_viewer
    python3 -m http.server 8000

Then open:
    http://localhost:8000

It can also be deployed directly to GitHub Pages.

## Important calibration note
The initial marker locations are approximate values inferred visually from the experiment screenshot. Adjust them by dragging or entering X/Y percentages.

The marker controls are best treated as a calibration/validation layer. Pupil's `surfaceX` and `surfaceY` are already normalized surface coordinates; therefore the key task is establishing how that normalized surface should be registered to this clean reference image.

## Next extension
Affective data can be loaded into a second time series and synchronized at the same playback cursor using timestamp alignment. A small panel can then show EEG/affect values while gaze moves over the façade.


## v2 reference image
This version uses the exact user-selected black-background façade image `D0034E00-4842-4AB9-8AE1-4E3E7C361162(2).png` as `assets/facade.png`; it is not regenerated or modified.
