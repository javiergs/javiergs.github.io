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
