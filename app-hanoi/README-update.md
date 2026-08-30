# AppHanoi direct update

Keep your existing `app.js` and data folders.

Replace/add:

- `index.html`
- `style.css`
- `calhci-logo.png`
- `app-custom.js`

The page now loads the normal `app.js` first and `app-custom.js` second.

This update:
- uses bright leaf/grass-green contact/wireless quality colors;
- colors the five Insight sensor dots from the current EMOTIV contact-quality values at the master cursor;
- uses a simple D-shaped mouth for the Head Orientation cartoon;
- keeps a hidden `footerParticipant` compatibility target so the current `app.js` does not throw the earlier footer error.

No image-generation assets are used for the face or EEG map; both are drawn by the application canvas code.

Quality palette: 0 gray · 1 red · 2 orange · 3 light green (#66D17A) · 4 bright green (#00B83F).
