# Heart Castle Facade Study Dashboard — v15

This version fixes the v13 browser freeze. Auto-synchronization no longer performs repeated full scans of the gaze CSV on the main thread. It precomputes AOI prefix indexes, limits redundant fixation hypotheses, and scores candidates in small animation-frame batches so the timeline remains interactive during synchronization.

The generalized synchronization model is unchanged: no participant-specific offset is hard-coded; all eight known stimulus zones may generate anchor candidates and the best multi-zone agreement wins. P12 remains the default validation participant and P03 remains selectable.

The cumulative heatmap retains the selective blue → cyan → green → yellow → orange → red scale, with red reserved for approximately the highest-density tail.


## v15 synchronization correction

The automatic synchronizer now includes a recording/stimulus overlap constraint. A candidate produced by a single late fixation can no longer place most of the fixed 4:19 stimulus after the participant data. Candidate quality combines AOI agreement across zones with the fraction of the maximum stimulus/data overlap available for that participant. The overlap is normalized to each participant's actual gaze duration, so shorter recordings are still supported without participant-specific constants.

For P12 this rejects the erroneous late Zone 1 match and favors the early door-response family of candidates, while retaining the same general algorithm for future participants.
