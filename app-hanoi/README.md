# HanoiDashboard

Static GitHub Pages dashboard for synchronized Tower of Hanoi behavioral and physiological data.

## Repository layout

```text
HanoiDashboard/
├── index.html
├── app.js
├── style.css
├── participants.json
├── 872/
│   ├── affect.txt
│   ├── device.txt
│   ├── eeg.txt
│   ├── pad.txt
│   ├── face.txt
│   ├── motion.txt
│   └── trials.txt
└── 873/
    └── ... same seven files ...
```

## Add a participant

1. Create a folder using the participant ID, e.g. `873/`.
2. Put the seven files in that folder using the standardized names shown above.
3. Add the participant ID to `participants.json`.

Example:

```json
{
  "participants": ["872", "873"]
}
```

No application code needs to change.

## Local preview

Because the page loads data with `fetch()`, do not open `index.html` directly with `file://`.
Run a tiny local server from the repository folder instead:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## GitHub Pages

Push the repository to GitHub, then open:

**Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**

For repository `HanoiDashboard`, the project page will be under:

`https://javiergs.github.io/HanoiDashboard/`

A participant can be linked directly using:

`https://javiergs.github.io/HanoiDashboard/?participant=872`

## Data interpretation used by the dashboard

- Trial row `Timestamp` is treated as the end of the recorded move.
- Move start is calculated as `Timestamp - MoveDurationSeconds`.
- During a move interval, the Tower of Hanoi visualization shows the **before** state; the state changes at the row timestamp.
- The supplied participant 872 sequences resolve as a six-disk Tower of Hanoi, so the current prototype uses six disks.
- Help-used moves are marked on the trial strip and in the behavior panel.
- Affect values are plotted only when their corresponding `Active ...` field is true.
- EEG is loaded at full resolution but downsampled for screen drawing; cursor values come from the full-resolution data.
