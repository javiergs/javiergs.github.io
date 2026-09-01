# AppHanoi

Static GitHub Pages dashboard for synchronized Tower of Hanoi behavioral,
physiological, device, and participant-survey data.

## Application layout

```text
AppHanoi/
├── index.html
├── app.js
├── app-custom.js
├── style.css
├── participants.json
├── 872/
│   ├── affect.txt
│   ├── device.txt
│   ├── eeg.txt
│   ├── pad.txt
│   ├── face.txt
│   ├── motion.txt
│   ├── trials.txt
│   └── surveys.json      # optional
└── 873/
    └── ... same standardized files ...
```

## Add a participant

1. Create a folder using the participant ID, for example `873/`.
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

`surveys.json` is optional. When present, the dashboard displays a
**Participant Surveys** section at the end of the dashboard. When it is absent,
the section remains hidden.

Expected top-level structure:

```json
{
  "participant_number": 872,
  "pre_survey": {},
  "post_survey": {}
}
```

The current dashboard supports the pre/post survey fields used by the Hanoi
study, including prior experience, puzzle confidence, emotional-state ratings,
robot experience, frustration source, attempts, EEG-headset comfort, safety
concerns, and willingness to participate in a similar study again.

## Local preview

Because the page loads data with `fetch()`, do not open `index.html` directly
with `file://`.

Run a small local server from the main GitHub Pages repository folder:

```bash
python3 -m http.server 8000
```

Then visit:

`http://localhost:8000/AppHanoi/`

## GitHub Pages

The application is available at:

`https://javiergs.github.io/AppHanoi/`

A participant can be linked directly using:

`https://javiergs.github.io/AppHanoi/?participant=872`

## Data interpretation used by the dashboard

- Trial row `Timestamp` is treated as the end of the recorded move.
- Move start is calculated as `Timestamp - MoveDurationSeconds`.
- During a move interval, the Tower of Hanoi visualization shows the **before**
  state; the state changes at the row timestamp.
- The current study visualization uses a six-disk Tower of Hanoi.
- Help-used moves are marked on the trial strip and summarized with trial
  completion.
- Affect values are plotted only when their corresponding `Active ...` field is
  true.
- EEG is loaded at full resolution but downsampled for screen drawing; cursor
  values come from the full-resolution data.
- Survey responses are participant-level contextual data and are intentionally
  displayed after the synchronized time-series dashboard rather than on the
  Master Timeline.
