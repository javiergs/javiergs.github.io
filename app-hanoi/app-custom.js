"use strict";

/*
  AppHanoi direct UI refinements.
  Loaded after app.js so the dashboard keeps its existing data-processing logic.

  Changes:
  1. Bright leaf/grass-green contact and wireless quality palette.
  2. EEG head-map sensor dots show CURRENT contact quality at the master cursor.
  3. Head-orientation cartoon uses a simple D-shaped mouth.
*/

function qualityColor(value) {
  // 0 gray, 1 red, 2 orange, 3 medium forest, 4 deep forest
  const colors = ["#969b98", "#d32f2f", "#f57c00", "#66d17a", "#00b83f"];
  const i = Math.max(0, Math.min(4, Math.round(value)));
  return colors[i];
}

function wirelessColor(value) {
  if (value === null || !Number.isFinite(value)) return "#969b98";
  if (value >= 0.999) return "#00b83f";  // excellent / bright quality green
  if (value <= 0) return "#969b98";
  if (value <= 1/3) return "#d32f2f";
  if (value <= 2/3) return "#f57c00";
  return "#66d17a";                      // good / lighter quality green
}

function drawEEGMapInset(chart, ctx, x, y, w, h) {
  ctx.fillStyle = "#778078";
  ctx.font = "700 10px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("INSIGHT SENSORS", x + w/2, y + 9);

  const cx = x + w/2, cy = y + h*.56;
  const rx = Math.min(w*.34, 48), ry = Math.min(h*.33, 55);

  // Top view of head, nose at top.
  ctx.strokeStyle = "#8c9690";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx-6, cy-ry+1);
  ctx.lineTo(cx,   cy-ry-8);
  ctx.lineTo(cx+6, cy-ry+1);
  ctx.stroke();

  // Sensor positions and their corresponding EMOTIV device quality fields.
  const pts = {
    AF3: {p:[-.35,-.58], q:"Quality Sensor 0"},
    AF4: {p:[ .35,-.58], q:"Quality Sensor 4"},
    T7:  {p:[-.78,-.12], q:"Quality Sensor 1"},
    T8:  {p:[ .78,-.12], q:"Quality Sensor 3"},
    Pz:  {p:[ 0, .62],   q:"Quality Sensor 2"}
  };

  // Contact quality comes from the device stream, not the EEG-value stream.
  const qualityRow = latestRowAtOrBefore(state.data.device || [], state.currentTime);

  for (const [label, def] of Object.entries(pts)) {
    const [px, py] = def.p;
    const sx = cx + px*rx, sy = cy + py*ry;
    const q = qualityRow ? asNumber(qualityRow[def.q]) : null;

    ctx.fillStyle = q === null ? "#c8cfcb" : qualityColor(q);
    ctx.beginPath();
    ctx.arc(sx, sy, 7, 0, Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = q === null ? "#8c9690" : "#26302a";
    ctx.lineWidth = 1.4;
    ctx.stroke();

    ctx.fillStyle = "#26302a";
    ctx.font = "700 9px system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, sx, sy-9);
  }

  // CMS/DRL is a reference marker; this recording has no separate CQ value for it.
  const cmsX = cx-rx*.82, cmsY = cy+ry*.18;
  ctx.fillStyle = "#fbfcfb";
  ctx.strokeStyle = "#4f5752";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cmsX, cmsY, 6, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#4f5752";
  ctx.font = "700 7px system-ui";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("CMS/DRL", cmsX+8, cmsY);
}

function drawCartoonHead(ctx, cx, cy, yawDeg, pitchDeg) {
  const yaw = Math.max(-90, Math.min(90, yawDeg));
  const pitch = Math.max(-45, Math.min(45, pitchDeg));
  const yn = yaw/90;
  const pn = pitch/45;
  const turn = Math.abs(yn);
  const side = yn >= 0 ? 1 : -1;

  const rx = 40*(1-0.28*turn);
  const ry = 48*(1-0.06*Math.abs(pn));
  const featureX = cx + yn*rx*0.42;
  const featureY = cy + pn*10;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Head.
  ctx.fillStyle = "#fbfbfa";
  ctx.strokeStyle = "#555b57";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // Ears.
  const nearEarX = cx + side*(rx+2);
  const farEarX = cx - side*(rx+2);
  ctx.strokeStyle = "#686d69";
  ctx.lineWidth = 2.2;

  ctx.globalAlpha = 0.95;
  ctx.beginPath();
  ctx.ellipse(nearEarX, cy+2, 6.5, 12, 0, 0, Math.PI*2);
  ctx.stroke();

  ctx.globalAlpha = Math.max(.08, 1-turn*1.18);
  ctx.beginPath();
  ctx.ellipse(farEarX, cy+2, 6.5, 12, 0, 0, Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Eyes.
  const eyeSep = 12*(1-.64*turn);
  const eyeY = featureY-8;
  const nearEyeX = featureX + side*eyeSep;
  const farEyeX = featureX - side*eyeSep;

  ctx.fillStyle = "#4e5450";
  ctx.beginPath();
  ctx.ellipse(nearEyeX, eyeY, 3.2, 4.2, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.globalAlpha = Math.max(0,1-turn*1.15);
  ctx.beginPath();
  ctx.ellipse(farEyeX, eyeY, 3.2, 4.2, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Brows.
  ctx.strokeStyle = "#555b57";
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(nearEyeX-side*6, eyeY-9);
  ctx.quadraticCurveTo(nearEyeX, eyeY-13, nearEyeX+side*6, eyeY-10);
  ctx.stroke();

  ctx.globalAlpha = Math.max(0,1-turn*1.15);
  ctx.beginPath();
  ctx.moveTo(farEyeX+side*6, eyeY-9);
  ctx.quadraticCurveTo(farEyeX, eyeY-13, farEyeX-side*6, eyeY-10);
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Curved gold nose.
  const noseRootX = featureX + side*2;
  const noseRootY = featureY - 3;
  const noseTipX = cx + side*rx*(0.28+0.72*turn);
  const noseTipY = featureY + 5 + pn*3;

  ctx.strokeStyle = "#BD8B13";
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(noseRootX, noseRootY-8);
  ctx.quadraticCurveTo(
    noseRootX+side*(7+8*turn),
    noseRootY+2,
    noseTipX,
    noseTipY
  );
  ctx.quadraticCurveTo(
    noseTipX-side*(2+3*turn),
    noseTipY+5,
    noseTipX-side*(7+5*turn),
    noseTipY+5
  );
  ctx.stroke();

  // Simple D-shaped mouth: one straight edge + one smooth curved edge.
  // It mirrors with head direction instead of looking like an oval plus chin line.
  const mouthX = featureX + side*3*turn;
  const mouthY = featureY + 19;
  const flatX = mouthX - side*6;
  const topY = mouthY - 4;
  const bottomY = mouthY + 4;
  const curveX = mouthX + side*8;

  ctx.strokeStyle = "#555b57";
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.moveTo(flatX, topY);
  ctx.lineTo(flatX, bottomY);
  ctx.quadraticCurveTo(curveX, bottomY+1, curveX, mouthY);
  ctx.quadraticCurveTo(curveX, topY-1, flatX, topY);
  ctx.stroke();

  ctx.restore();
}
