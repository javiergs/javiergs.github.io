# AppHanoi

Static GitHub Pages dashboard for synchronized Tower of Hanoi behavioral, physiological, device, and participant-survey data.

## Application layout

```text
AppHanoi/
├── index.html
├── app.js
├── app-custom.js
├── style.css
├── participants.json
├── calhci-logo.png
└── data/
    ├── 872/
    │   ├── affect.txt
    │   ├── device.txt
    │   ├── eeg.txt
    │   ├── pad.txt
    │   ├── face.txt
    │   ├── motion.txt
    │   ├── trials.txt
    │   └── surveys.json
    └── 873/
        └── ... same standardized files ...
```

## Add a participant

1. Create a folder using the participant ID inside `data/`, for example `data/873/`.
2. Put the seven standardized study data files in that folder.
3. If survey data is available, add it as `surveys.json` in the same folder.
4. Add the participant ID to `participants.json`.

Example:

```json
{
  "participants": ["872", "873"]
}
```

No application code needs to change when another participant is added.

## Survey data

`surveys.json` is optional. When present, the dashboard displays a **Participant Surveys** section at the end of the dashboard.

Expected top-level structure:

```json
{
  "participant_number": 872,
  "pre_survey": {},
  "post_survey": {}
}
```

## Dashboard structure

1. Green header with lab identity and Hanoi Study Dashboard title.
2. Master Timeline | Participant.
3. Tower of Hanoi | Trial Information.
4. Current Snapshot: Affect | PAD | EEG | Face | Motion | Device.
5. Existing charts with their specialized right-side context boxes.
6. Head Motion unchanged.
7. Participant Surveys unchanged.
8. Green footer with copyright and Noyce School research-support acknowledgment.

## Local preview

Because the page loads data with `fetch()`, do not open `index.html` directly with `file://`. Run a local server from the application folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000/`.

## Data interpretation used by the dashboard

- Trial row `Timestamp` is treated as the end of the recorded move.
- Move start is calculated as `Timestamp - MoveDurationSeconds`.
- During a move interval, the Tower of Hanoi visualization shows the before state; the state changes at the row timestamp.
- The current study visualization uses a six-disk Tower of Hanoi.
- Help-used moves are marked on the trial strip and summarized with trial completion.
- Affect values are plotted only when their corresponding `Active ...` field is true.
- EEG is loaded at full resolution but downsampled for screen drawing; cursor values come from the full-resolution data.
- Survey responses are participant-level contextual data and are displayed after the synchronized time-series dashboard.
