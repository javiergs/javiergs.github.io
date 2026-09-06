# Heart Castle Facade Study Dashboard v13

Static dashboard prototype for synchronizing the fixed 4:19 visual-stimulus sequence with participant-specific gaze and fixation recordings.

## Participants included
- P12 (default)
- P03

The participant selector reloads each participant's native gaze/fixation files and recalculates coverage and synchronization. Gaze timestamps define the participant-data coverage bar; fixation events are used as behavioral synchronization evidence.

## Synchronization
The 4:19 stimulus sequence is constant. Auto-sync searches fixation responses against all eight known stimulus AOIs. Zone 1 (door opening) receives priority when available, but any zone may provide an anchor. Each candidate offset is validated against the remaining stimulus zones and the best cross-zone match is selected. The offset can still be nudged manually.

## Run
From this folder:

    python3 -m http.server 8000

Open http://localhost:8000/


## v13 coordinate correction
Pupil surface coordinates are mapped with surface Y=0 at the bottom and Y=1 at the top of the surface. The prior build inverted surfaceY a second time before applying the homography. That placed low-Y door fixations near the top of the facade and high-Y upper-figure fixations near the bottom. v13 removes that extra inversion. This correction also applies to gaze trails, heatmaps, AOI hit testing, and automatic synchronization scoring because they all use the same mapSurface() transform.

## v13 synchronization and heatmap
- Synchronization is participant-independent: no P12-specific offset is stored.
- Candidate offsets can originate from any of the eight known stimulus AOIs.
- Each candidate is validated against all stimulus zones that overlap the participant recording.
- Missing/unseen zones are not treated as hard contradictions; multi-zone agreement determines the winning candidate.
- Candidate generation allows a short behavioral response latency instead of requiring fixation onset to equal stimulus onset.
- Heatmap normalization is robust/percentile based. The visible density scale is blue → cyan → green → yellow → orange → red, with red reserved for approximately the highest-density tail rather than ordinary accumulated gaze.
