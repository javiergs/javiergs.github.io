# Heart Castle Facade Study Dashboard v8

This version uses one synchronized session timeline that spans all available participant recording data and the full 4:19 stimulus video.

- The participant recording starts at recording time 0 and may begin before the video.
- The 4:19 stimulus video is positioned on that timeline by the synchronization offset.
- Auto-sync uses the first sustained gaze response inside the door AOI and aligns it to the door-opening stimulus at video 0:08.
- Eight recognized stimulus events are shown as numbered blocks; hover a block for its name and video/synchronized time range.
- Event blocks use exact temporal width and position; there is no minimum visual width that can shift short events.
- The participant-data bar shows the actual recording coverage.
- The slider can travel across the full union of participant data and stimulus video, including data before the video and stimulus time after the participant recording ends.
- The cumulative heatmap includes all recorded gaze from recording start through the selected synchronized time and reconstructs when moving backward.

Run with a local HTTP server, e.g. `python3 -m http.server 8000`.
