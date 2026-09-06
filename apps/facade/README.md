# Heart Castle Facade Study Dashboard — v33

This version makes participant management data-driven and makes participant changes reset the dashboard cleanly before loading the next recording.

## Participant menu
The participant selector is now generated from:

`data/participants.json`

Example:

```json
[
  "P12",
  "P03",
  "P15",
  "P18"
]
```

Each participant ID maps automatically to:

- `data/<ID>/gaze.csv`
- `data/<ID>/fixations.csv`
- `data/<ID>/affect.txt` (optional)
- `videos/<ID>.mov` (optional shared video folder)

To add a participant, create the participant folder and add the ID to `participants.json`. No HTML or JavaScript menu editing is needed.

## Clean participant switching
Changing the participant now:

- stops playback and cancels an in-progress auto-sync
- clears gaze, fixation, affect, heatmap, trail, current-state, and zone-summary data
- resets the master slider to zero
- resets the synchronization offset
- resets surface markers to the application defaults
- resets/reloads the independent participant video
- loads the newly selected participant and then runs auto-sync
- uses a load token so a slower previous fetch cannot overwrite a participant selected afterward

Missing `affect.txt` remains supported and is reported as unavailable rather than causing the participant load to fail.

## Affective heatmaps
The v32 single-affect and Combined (dominant) heatmaps are preserved, including minimum-affect filtering and persistent temporal fading/reinforcement.

As in recent versions, `assets/` and `videos/` are intentionally not packaged because they are shared by the deployment.


## v34
Fixed affective controls when switching participants. Participants without affect data temporarily disable the affect controls without clearing the user's selected affect series. When switching back to a participant with affect data, the chart, current-state values, and affective heatmaps become available again automatically.


## v35

- Checks all affect-series checkboxes by default, including Focus.
- Selects **Combined (dominant)** as the default affective heatmap.
- Compresses the sticky timeline card by merging playback and display controls into one slim top row on wide screens.
- Removes the nested display-control box styling and shortens labels so the floating panel consumes less vertical space.
- Keeps gaze and affective heatmaps mutually exclusive; the affective heatmap remains the default.
