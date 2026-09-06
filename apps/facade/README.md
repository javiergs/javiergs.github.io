# Heart Castle Facade Study Dashboard — v15

This version fixes the v13 browser freeze. Auto-synchronization no longer performs repeated full scans of the gaze CSV on the main thread. It precomputes AOI prefix indexes, limits redundant fixation hypotheses, and scores candidates in small animation-frame batches so the timeline remains interactive during synchronization.

The generalized synchronization model is unchanged: no participant-specific offset is hard-coded; all eight known stimulus zones may generate anchor candidates and the best multi-zone agreement wins. P12 remains the default validation participant and P03 remains selectable.

The cumulative heatmap retains the selective blue → cyan → green → yellow → orange → red scale, with red reserved for approximately the highest-density tail.


## v15 synchronization correction

The automatic synchronizer now includes a recording/stimulus overlap constraint. A candidate produced by a single late fixation can no longer place most of the fixed 4:19 stimulus after the participant data. Candidate quality combines AOI agreement across zones with the fraction of the maximum stimulus/data overlap available for that participant. The overlap is normalized to each participant's actual gaze duration, so shorter recordings are still supported without participant-specific constants.

For P12 this rejects the erroneous late Zone 1 match and favors the early door-response family of candidates, while retaining the same general algorithm for future participants.


## v19 heatmap update
The cumulative heatmap now accumulates density in a floating-point field rather than saturated canvas alpha. The visible scale allocates most values to blue/cyan/green/yellow, orange is reserved for high-density regions, and red is restricted to approximately the upper 0.3% of non-zero cumulative density.


## v19
- Moves participant/recording metadata into a dedicated panel above Synchronization.
- Uses the newly supplied 1280×853 baseline façade image as the neutral/baseline stimulus image and analysis reference.
- Keeps the generalized multi-zone synchronization and selective cumulative heatmap from v16.


## v19 adjustments
- Surface mapping defaults updated to TL 6.7/3.6, TR 95.3/3.6, BL 6.0/94.9, BR 94.8/95.1. Reset Surface returns to these values.
- Timeline stimulus blocks now use gold only for the currently active event. Hovering/clicking another block no longer leaves it looking active.
- Heatmap uses a smaller spatial kernel and empirical density-rank coloring. True red is restricted to approximately the hottest 0.02% of visible density pixels.


## v19 layout updates
- Participant & Recording is followed by Display and Current state for common viewing controls.
- Synchronization and Surface mapping are grouped below as administrative/analysis controls.
- Cumulative heatmap is enabled by default.
- The active-stimulus AOI outline display option and visual AOI overlay were removed; AOI geometry is retained internally for synchronization scoring only.

## v20 layout and original participant video

- Synchronization and Surface mapping were moved out of the everyday-use sidebar into an administrative workspace below the main dashboard.
- A new **Original participant video** panel appears on the right side of that lower workspace.
- Participant videos are loaded automatically from `videos/<participant>.mp4` (for example, `videos/P12.mp4`).
- The original video uses its own native playback controls and is intentionally independent of the synchronized dashboard timeline.
- If a participant video is not present, the panel shows the expected filename instead of breaking the dashboard.

## v21 changes
- Original participant reference videos now use `videos/PXX.mov` instead of MP4.
- The original participant video is displayed on the same row as the main façade/gaze visualization so both can be viewed simultaneously.
- The reference video remains independent and retains its own playback/seek controls.
- Synchronization and Surface mapping remain in the lower administrative area.
