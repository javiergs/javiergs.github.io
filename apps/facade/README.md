# Heart Castle Facade Study Dashboard — v14

This version fixes the v13 browser freeze. Auto-synchronization no longer performs repeated full scans of the gaze CSV on the main thread. It precomputes AOI prefix indexes, limits redundant fixation hypotheses, and scores candidates in small animation-frame batches so the timeline remains interactive during synchronization.

The generalized synchronization model is unchanged: no participant-specific offset is hard-coded; all eight known stimulus zones may generate anchor candidates and the best multi-zone agreement wins. P12 remains the default validation participant and P03 remains selectable.

The cumulative heatmap retains the selective blue → cyan → green → yellow → orange → red scale, with red reserved for approximately the highest-density tail.
