# Heart Castle Facade Study Dashboard v7

This version uses the **full 4:19 visual-stimulus video as the fixed master timeline**.

## Recognized stimulus zones

1. 00:08–00:18 — Door opens (primary behavioral synchronization anchor)
2. 00:54–01:10 — Top figure
3. 01:19–01:43 — Central group above door
4. 01:52–02:37 — Two Wild Men
5. 02:44–03:02 — Door brightened
6. 03:14–03:35 — Two corner elements
7. 03:42–03:48 — Two lateral figures
8. 03:53–04:00 — Upper four figures / elements

The neutral intervals between numbered zones are explicitly rendered as **wait / baseline** periods. The final 04:00–04:19 interval is treated in the same way rather than as a ninth event.

## Synchronization

Participant recordings are not assumed to begin or end with the video. The app estimates a participant-specific offset by finding the first sustained gaze response inside the Door AOI and aligning that response to the door-opening stimulus at 00:08. Later AOI responses are used as a validation score. Manual offset nudging remains available.

The participant-data coverage bar shows which part of the 4:19 stimulus timeline has synchronized participant data. Recorder lead-in or tail outside the stimulus video is reported separately.

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.
