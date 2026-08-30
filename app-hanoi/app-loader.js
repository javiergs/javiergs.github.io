"use strict";

(async function loadDashboardApp() {
  const response = await fetch("app.js?v=20260829-calhci", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Could not load app.js: ${response.status} ${response.statusText}`);
  }

  let source = await response.text();

  // Bright, high-separation chart palette.
  source = source.replace(
    /const COLORS\s*=\s*\[[^\]]*\];/,
    'const COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9", "#7A4CC2"];'
  );

  // Keep Tower of Hanoi disks visually distinct as well.
  source = source.replace(
    /const DISK_COLORS\s*=\s*\[[^\]]*\];/,
    'const DISK_COLORS = ["#0072B2", "#E69F00", "#009E73", "#CC79A7", "#D55E00", "#56B4E9"];'
  );

  // The footer no longer shows a participant ID. Remove the stale assignment if present.
  source = source.replace(
    /el\("footerParticipant"\)\.textContent\s*=\s*`Participant \$\{id\}`;\s*/,
    ""
  );

  // Execute the otherwise unchanged dashboard application.
  // SourceURL keeps browser debugging readable.
  const run = new Function(`${source}\n//# sourceURL=app.js`);
  run();
})().catch(err => {
  console.error(err);
  const status = document.getElementById("status");
  if (status) {
    status.textContent = `Could not start dashboard: ${err.message}`;
    status.classList.add("error");
  }
});
