# Heart Castle Facade Study Dashboard v11

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
