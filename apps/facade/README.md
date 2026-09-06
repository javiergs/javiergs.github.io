# Heart Castle Facade Study Dashboard — v25

This update keeps the shared `assets/` and `videos/` directories external to the package. Deploy v25 into the same application root where those existing directories already live.

Participant data is organized by participant:

```text
data/
  stimuli.json
  P12/
    gaze.csv
    fixations.csv
    affect.txt
  P03/
    gaze.csv
    fixations.csv
```

A participant may omit a modality file such as `affect.txt`; the dashboard treats it as unavailable.

v25 also adds a spatial affective-zone overlay, consistent affect colors across the chart controls/current state/zone summary, a simplified dominant-affect-by-zone summary, a full-width sticky synchronized timeline, and places Participant & Recording below the original participant video.
