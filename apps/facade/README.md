# Heart Castle Facade Study Dashboard — v32

This version adds a **Combined (dominant)** affective gaze heatmap while preserving the existing single-affect heatmaps.

## Combined affective heatmap
- Select **Combined (dominant)** from the Affect selector in the floating timeline controls.
- The dashboard maintains a separate spatial field for every valid affective measure.
- At each heatmap pixel, only the affect with the highest local mean response is shown.
- Hue identifies the winning affect using the existing palette.
- Tone reflects that affect's 0–1 magnitude.
- Recency and repeated gaze/affect evidence reinforce opacity.
- Older evidence remains visible as a lighter residual tone rather than disappearing.
- **Minimum affect** is applied before samples contribute to any affective field.
- Pixels remain transparent when no valid affect exceeds the selected threshold.

Single-affect mode continues to show only the selected affect using the same persistent-memory behavior introduced in v30.

As in recent versions, `assets/` and `videos/` are intentionally not packaged because they are shared by the deployment.
