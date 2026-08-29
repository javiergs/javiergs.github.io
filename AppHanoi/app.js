"use strict";

const FILES = {
  affect: "affect.txt",
  device: "device.txt",
  eeg: "eeg.txt",
  pad: "pad.txt",
  face: "face.txt",
  motion: "motion.txt",
  trials: "trials.txt"
};

const COLORS = ["#ff9364", "#f2763f", "#f2f2f2", "#b8b8b8", "#d9653a", "#8f8f8f"];
const MAX_DRAW_POINTS = 4200;
const EXPERIMENT_PADDING_SECONDS = 60;
const DISK_COUNT = 6; // The recorded move sequences solve a six-disk Tower of Hanoi.
const DEFAULT_SMOOTH_SECONDS = 5;

const state = {
  participant: null,
  data: {},
  trials: [],
  trialGroups: [],
  domain: [0, 1],
  currentTime: 0,
  charts: [],
  playing: false,
  animationFrame: null,
  lastFrame: null,
  chartMode: "raw",       // raw | smooth
  smoothSeconds: DEFAULT_SMOOTH_SECONDS
};

const el = id => document.getElementById(id);

function setStatus(message, isError = false) {
  el("status").textContent = message;
  el("status").classList.toggle("error", isError);
}

function parseCSV(text) {
  text = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else {
      if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === '\n') {
        row.push(field); field = "";
        if (row.some(v => v !== "")) rows.push(row);
        row = [];
      } else field += ch;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? "");
    return obj;
  });
}

async function loadText(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${response.statusText}`);
  return response.text();
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRows(name, rows) {
  return rows.map(r => ({ ...r, _t: asNumber(r.Timestamp) })).filter(r => r._t !== null).sort((a,b) => a._t - b._t);
}

function downsample(rows, maxPoints = MAX_DRAW_POINTS) {
  if (rows.length <= maxPoints) return rows;
  const stride = rows.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i++) out.push(rows[Math.floor(i * stride)]);
  out.push(rows[rows.length - 1]);
  return out;
}

function buildTrialModel(rows) {
  const parsed = rows.map(r => ({
    ...r,
    _t: asNumber(r.Timestamp),
    _trial: Number(r.Trial),
    _move: Number(r.MoveNumber),
    _duration: asNumber(r.MoveDurationSeconds) || 0,
    _help: String(r.HelpUsed).trim().toUpperCase() === "TRUE",
    _errors: Number(r.ErrorsThisMove) || 0
  })).filter(r => r._t !== null).sort((a,b) => a._t - b._t);

  const groups = [];
  for (const row of parsed) {
    let g = groups.find(x => x.trial === row._trial);
    if (!g) { g = { trial: row._trial, moves: [] }; groups.push(g); }
    g.moves.push(row);
  }

  for (const g of groups) {
    g.moves.sort((a,b) => a._move - b._move);
    g.start = g.moves[0]._t - g.moves[0]._duration;
    g.end = g.moves[g.moves.length - 1]._t;
    let poles = initialPoles();
    g.moves.forEach(m => {
      m.start = m._t - m._duration;
      m.end = m._t;
      m.before = clonePoles(poles);
      const disk = topDisk(poles[m.From]);
      m.disk = disk;
      if (disk != null) {
        poles[m.From].pop();
        poles[m.To].push(disk);
      }
      m.after = clonePoles(poles);
    });
    g.final = clonePoles(poles);
  }
  groups.sort((a,b) => a.trial - b.trial);
  return { parsed, groups };
}

function initialPoles() {
  return { A: Array.from({length: DISK_COUNT}, (_, i) => DISK_COUNT - i), B: [], C: [] };
}
function clonePoles(p) { return { A: [...p.A], B: [...p.B], C: [...p.C] }; }
function topDisk(stack) { return stack.length ? stack[stack.length - 1] : null; }

async function initParticipants() {
  try {
    const config = JSON.parse(await loadText("participants.json"));
    const participants = Array.isArray(config.participants) ? config.participants : [];
    if (!participants.length) throw new Error("participants.json contains no participants");
    el("participantSelect").innerHTML = participants.map(p => `<option value="${escapeHTML(String(p))}">${escapeHTML(String(p))}</option>`).join("");
    const requested = new URLSearchParams(location.search).get("participant");
    if (requested && participants.map(String).includes(requested)) el("participantSelect").value = requested;
    setStatus("Participant list loaded.");
    await loadParticipant(el("participantSelect").value);
  } catch (err) {
    console.error(err);
    setStatus(`Could not load participants.json: ${err.message}`, true);
  }
}

async function loadParticipant(id) {
  stopPlayback();
  state.participant = id;
  setStatus(`Loading participant ${id}… EEG and motion files may take a few seconds.`);
  el("loadParticipant").disabled = true;
  try {
    const entries = await Promise.all(Object.entries(FILES).map(async ([key, filename]) => {
      const text = await loadText(`${encodeURIComponent(id)}/${filename}`);
      return [key, parseCSV(text)];
    }));
    const raw = Object.fromEntries(entries);
    const { parsed, groups } = buildTrialModel(raw.trials);
    state.trials = parsed;
    state.trialGroups = groups;
    state.data = {
      affect: normalizeRows("affect", raw.affect),
      device: normalizeRows("device", raw.device),
      eeg: normalizeRows("eeg", raw.eeg),
      pad: normalizeRows("pad", raw.pad),
      face: normalizeRows("face", raw.face),
      motion: normalizeRows("motion", raw.motion)
    };
    buildCharts();
    refreshChartModeUI();
    updateDomain();
    state.currentTime = state.domain[0];
    el("timeSlider").value = 0;
    el("footerParticipant").textContent = `Participant ${id}`;
    const url = new URL(location.href);
    url.searchParams.set("participant", id);
    history.replaceState(null, "", url);
    updateAll();
    const totalRows = Object.values(state.data).reduce((n, rows) => n + rows.length, 0);
    setStatus(`Participant ${id} loaded · ${state.trialGroups.length} trials · ${state.trials.length} moves · ${totalRows.toLocaleString()} sensor samples.`);
  } catch (err) {
    console.error(err);
    setStatus(`Could not load participant ${id}: ${err.message}`, true);
  } finally {
    el("loadParticipant").disabled = false;
  }
}

function allSensorBounds() {
  const mins = [], maxs = [];
  for (const rows of Object.values(state.data)) {
    if (!rows.length) continue;
    mins.push(rows[0]._t); maxs.push(rows[rows.length - 1]._t);
  }
  if (state.trialGroups.length) {
    mins.push(state.trialGroups[0].start); maxs.push(state.trialGroups[state.trialGroups.length-1].end);
  }
  return [Math.min(...mins), Math.max(...maxs)];
}

function updateDomain() {
  if (!state.trialGroups.length) return;
  if (el("viewSelect").value === "full") state.domain = allSensorBounds();
  else {
    const first = state.trialGroups[0].start - EXPERIMENT_PADDING_SECONDS;
    const last = state.trialGroups[state.trialGroups.length-1].end + EXPERIMENT_PADDING_SECONDS;
    const bounds = allSensorBounds();
    state.domain = [Math.max(first, bounds[0]), Math.min(last, bounds[1])];
  }
  state.currentTime = Math.min(state.domain[1], Math.max(state.domain[0], state.currentTime || state.domain[0]));
  syncSliderFromTime();
  el("rangeStart").textContent = formatClock(state.domain[0]);
  el("rangeEnd").textContent = formatClock(state.domain[1]);
  drawAllCharts();
  drawTrialStrip();
}

function timeFromSlider() {
  const f = Number(el("timeSlider").value) / Number(el("timeSlider").max);
  return state.domain[0] + f * (state.domain[1] - state.domain[0]);
}
function syncSliderFromTime() {
  const [a,b] = state.domain;
  const f = b > a ? (state.currentTime - a) / (b - a) : 0;
  el("timeSlider").value = Math.round(Math.max(0, Math.min(1, f)) * Number(el("timeSlider").max));
}

function formatClock(ts) {
  if (!Number.isFinite(ts)) return "--:--:--.---";
  const d = new Date(ts * 1000);
  return new Intl.DateTimeFormat(undefined, { timeZone: "America/Los_Angeles", hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit", fractionalSecondDigits: 3 }).format(d);
}
function formatElapsed(seconds) {
  seconds = Math.max(0, seconds);
  const m = Math.floor(seconds / 60), s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4,"0")}`;
}

function nearestRow(rows, t) {
  if (!rows.length) return null;
  let lo = 0, hi = rows.length - 1;
  if (t <= rows[0]._t) return rows[0];
  if (t >= rows[hi]._t) return rows[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]._t < t) lo = mid; else hi = mid;
  }
  return (t - rows[lo]._t <= rows[hi]._t - t) ? rows[lo] : rows[hi];
}

function currentTrialContext(t) {
  for (const g of state.trialGroups) {
    if (t >= g.start && t <= g.end) {
      const current = g.moves.find(m => t >= m.start && t < m.end);
      let completed = null;
      for (const m of g.moves) if (m.end <= t) completed = m;
      const poles = current ? current.before : (completed ? completed.after : initialPoles());
      return { group: g, move: current, completed, poles, inTrial: true };
    }
  }
  if (!state.trialGroups.length) return { inTrial: false, poles: initialPoles() };
  if (t < state.trialGroups[0].start) return { inTrial: false, poles: initialPoles(), phase: "Before trials" };
  for (let i=0; i<state.trialGroups.length-1; i++) {
    if (t > state.trialGroups[i].end && t < state.trialGroups[i+1].start) {
      return { inTrial: false, poles: state.trialGroups[i].final, phase: `Between Trial ${state.trialGroups[i].trial} and ${state.trialGroups[i+1].trial}` };
    }
  }
  return { inTrial: false, poles: state.trialGroups[state.trialGroups.length-1].final, phase: "After trials" };
}

function renderHanoi() {
  const ctx = currentTrialContext(state.currentTime);
  const board = el("hanoiBoard");
  board.innerHTML = ["A","B","C"].map(peg => {
    const stack = ctx.poles[peg] || [];
    // Internal stack is [largest ... smallest/top]. Reverse only for display.
    const disks = [...stack].reverse().map(d => {
      const width = 34 + (d / DISK_COUNT) * 58;
      const pending = ctx.move && peg === ctx.move.From && d === ctx.move.disk ? " pending" : "";
      return `<div class="disk${pending}" style="width:${width}%" title="Disk ${d}">${d}</div>`;
    }).join("");
    return `<div class="peg" data-peg="${peg}">${disks}<span class="peg-label">${peg}</span></div>`;
  }).join("");

  const badge = el("trialBadge");
  if (!ctx.inTrial) {
    badge.className = "badge neutral";
    badge.textContent = ctx.phase || "Outside trial";
    el("moveSummary").textContent = ctx.phase || "Outside trial";
    ["moveNumber","moveDuration","helpUsed","errorsMove"].forEach(id => el(id).textContent = "—");
    return;
  }

  const move = ctx.move;
  badge.className = move && move._help ? "badge help" : "badge active";
  badge.textContent = `Trial ${ctx.group.trial}`;
  if (move) {
    el("moveSummary").textContent = `Moving disk ${move.disk}: ${move.From} → ${move.To} · state changes when the move ends.`;
    el("moveNumber").textContent = `${move._move} / ${ctx.group.moves.length}`;
    el("moveDuration").textContent = `${move._duration.toFixed(0)} s`;
    el("helpUsed").textContent = move._help ? "Yes" : "No";
    el("errorsMove").textContent = String(move._errors);
  } else {
    const next = ctx.group.moves.find(m => m.start > state.currentTime);
    const last = ctx.completed;
    el("moveSummary").textContent = next ? `Between moves · next: ${next.From} → ${next.To}` : `Trial ${ctx.group.trial} complete.`;
    el("moveNumber").textContent = last ? `${last._move} / ${ctx.group.moves.length}` : `0 / ${ctx.group.moves.length}`;
    el("moveDuration").textContent = "—";
    el("helpUsed").textContent = "—";
    el("errorsMove").textContent = "—";
  }
}

function snapshotValue(row, key, digits=2) {
  if (!row) return "—";
  const n = asNumber(row[key]);
  if (n !== null) return n.toFixed(digits);
  const s = String(row[key] ?? "").trim();
  return s || "—";
}

function renderSnapshot() {
  const a = nearestRow(state.data.affect, state.currentTime);
  const p = nearestRow(state.data.pad, state.currentTime);
  const e = nearestRow(state.data.eeg, state.currentTime);
  const f = nearestRow(state.data.face, state.currentTime);
  const m = nearestRow(state.data.motion, state.currentTime);
  const d = nearestRow(state.data.device, state.currentTime);
  const groups = [
    ["Affect", [["Focus",snapshotValue(a,"Focus")],["Engagement",snapshotValue(a,"Engagement")],["Interest",snapshotValue(a,"Interest")],["Stress",snapshotValue(a,"Stress")]]],
    ["PAD", [["Pleasure",snapshotValue(p,"Pleasure")],["Arousal",snapshotValue(p,"Arousal")],["Dominance",snapshotValue(p,"Dominance")]]],
    ["EEG", [["AF3",snapshotValue(e,"AF3",1)],["T7",snapshotValue(e,"T7",1)],["Pz",snapshotValue(e,"Pz",1)],["T8",snapshotValue(e,"T8",1)],["AF4",snapshotValue(e,"AF4",1)]]],
    ["Face", [["Upper",snapshotValue(f,"Action Upper Face",0)],["Upper power",snapshotValue(f,"Power Upper Face")],["Lower",snapshotValue(f,"Action Lower Face",0)],["Lower power",snapshotValue(f,"Power Lower Face")]]],
    ["Motion", [["Accel X",snapshotValue(m,"Accelerometer X",3)],["Accel Y",snapshotValue(m,"Accelerometer Y",3)],["Accel Z",snapshotValue(m,"Accelerometer Z",3)]]],
    ["Device", [["Battery", `${snapshotValue(d,"Battery Percent",0)}%`],["Wireless",snapshotValue(d,"Wireless Signal",1)],["Quality",snapshotValue(d,"Overall Quality",0)]]]
  ];
  el("snapshot").innerHTML = groups.map(([name, rows]) => `<div class="snapshot-group"><h3>${name}</h3>${rows.map(([k,v]) => `<div class="snapshot-row"><span>${escapeHTML(k)}</span><strong>${escapeHTML(v)}</strong></div>`).join("")}</div>`).join("");
}

function buildCharts() {
  const configs = [
    { id:"affect", title:"Affect", note:"Active performance metrics", keys:["Focus","Engagement","Excitement","Interest","Relaxation","Stress"], activePrefix:"Active " },
    { id:"pad", title:"PAD", note:"Pleasure · Arousal · Dominance", keys:["Pleasure","Arousal","Dominance"] },
    { id:"eeg", title:"EEG", note:"AF3 · T7 · Pz · T8 · AF4 (display downsampled)", keys:["AF3","T7","Pz","T8","AF4"] },
    { id:"face", title:"Facial Expression", note:"Power of current upper/lower facial action", keys:["Power Upper Face","Power Lower Face"] },
    { id:"motion", title:"Motion", note:"Accelerometer X · Y · Z", keys:["Accelerometer X","Accelerometer Y","Accelerometer Z"] },
    { id:"device", title:"Device", note:"Battery percent · overall contact quality", keys:["Battery Percent","Overall Quality"] }
  ];
  el("charts").innerHTML = configs.map(c => `<article class="card chart-card"><div class="chart-title-row"><h2>${c.title}</h2><div class="chart-note">${c.note}</div></div><div class="chart-wrap"><canvas id="chart-${c.id}"></canvas></div><div class="legend" id="legend-${c.id}"></div></article>`).join("");
  state.charts = configs.map(c => ({
    ...c,
    rawRows: state.data[c.id] || [],
    rows: downsample(state.data[c.id] || []),
    smoothCacheSeconds: null,
    smoothRows: null
  }));
  state.charts.forEach(chart => {
    el(`legend-${chart.id}`).innerHTML = chart.keys.map((k,i) => `<span class="legend-item" style="color:${COLORS[i % COLORS.length]}"><span class="legend-swatch"></span>${escapeHTML(k.replace("Power ",""))}</span>`).join("");
  });
}

function lowerBoundTime(rows, target) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]._t < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundTime(rows, target) {
  let lo = 0, hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]._t <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildSmoothedRows(chart, windowSeconds) {
  const rows = chart.rawRows;
  if (!rows.length || windowSeconds <= 0) return downsample(rows);

  // Smooth from the full-resolution stream, but only produce enough points to draw.
  // The window is centered on each displayed sample.
  const targetCount = Math.min(rows.length, MAX_DRAW_POINTS);
  const indices = [];
  if (rows.length <= MAX_DRAW_POINTS) {
    for (let i = 0; i < rows.length; i++) indices.push(i);
  } else {
    const stride = (rows.length - 1) / (targetCount - 1);
    for (let i = 0; i < targetCount; i++) indices.push(Math.round(i * stride));
  }

  const prefixes = {};
  for (const key of chart.keys) {
    const sums = new Float64Array(rows.length + 1);
    const counts = new Uint32Array(rows.length + 1);

    for (let i = 0; i < rows.length; i++) {
      const v = chartValue(chart, rows[i], key);
      sums[i + 1] = sums[i] + (v === null ? 0 : v);
      counts[i + 1] = counts[i] + (v === null ? 0 : 1);
    }
    prefixes[key] = { sums, counts };
  }

  const halfWindow = windowSeconds / 2;

  return indices.map(index => {
    const centerTime = rows[index]._t;
    const left = lowerBoundTime(rows, centerTime - halfWindow);
    const right = upperBoundTime(rows, centerTime + halfWindow);
    const out = { _t: centerTime };

    for (const key of chart.keys) {
      const { sums, counts } = prefixes[key];
      const count = counts[right] - counts[left];
      out[key] = count ? (sums[right] - sums[left]) / count : null;
    }
    return out;
  });
}

function processedChartRows(chart) {
  if (state.chartMode !== "smooth") return chart.rows;

  if (chart.smoothCacheSeconds !== state.smoothSeconds || !chart.smoothRows) {
    chart.smoothRows = buildSmoothedRows(chart, state.smoothSeconds);
    chart.smoothCacheSeconds = state.smoothSeconds;
  }
  return chart.smoothRows;
}

function refreshChartModeUI() {
  const smooth = state.chartMode === "smooth";
  const control = el("smoothWindow");
  if (control) control.disabled = !smooth;

  state.charts.forEach(chart => {
    const baseNote = {
      affect: "Active performance metrics",
      pad: "Pleasure · Arousal · Dominance",
      eeg: "AF3 · T7 · Pz · T8 · AF4",
      face: "Power of current upper/lower facial action",
      motion: "Accelerometer X · Y · Z",
      device: "Battery percent · overall contact quality"
    }[chart.id];

    chart.note = smooth
      ? `${baseNote} · centered ${state.smoothSeconds}s moving average`
      : `${baseNote}${chart.id === "eeg" ? " (display downsampled)" : ""}`;

    const canvas = el(`chart-${chart.id}`);
    if (canvas) {
      const card = canvas.closest(".chart-card");
      const note = card ? card.querySelector(".chart-note") : null;
      if (note) note.textContent = chart.note;
    }
  });
}

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(10, Math.floor(rect.width)), h = Math.max(10, Math.floor(rect.height));
  if (canvas.width !== Math.floor(w*ratio) || canvas.height !== Math.floor(h*ratio)) {
    canvas.width = Math.floor(w*ratio); canvas.height = Math.floor(h*ratio);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return { ctx, w, h };
}

function chartValue(chart, row, key) {
  if (chart.activePrefix) {
    const active = String(row[chart.activePrefix + key]).toLowerCase() === "true";
    if (!active) return null;
  }
  return asNumber(row[key]);
}

function computeYDomain(chart, rowsInDomain) {
  const values = [];
  for (const r of rowsInDomain) for (const key of chart.keys) {
    const v = chartValue(chart, r, key);
    if (v !== null) values.push(v);
  }
  if (!values.length) return [0,1];
  values.sort((a,b)=>a-b);
  let min = values[0], max = values[values.length-1];
  if (values.length > 100) {
    min = values[Math.floor(values.length * .005)];
    max = values[Math.floor(values.length * .995)];
  }
  if (chart.id === "affect") { min = 0; max = 1; }
  if (chart.id === "pad") { min = Math.min(-1, min); max = Math.max(1, max); }
  if (min === max) { min -= .5; max += .5; }
  const pad = (max-min) * .07;
  return [min-pad, max+pad];
}

function drawBackgroundBands(ctx, left, top, width, height, x) {
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.025)";
  ctx.fillRect(left, top, width, height);
  for (const g of state.trialGroups) {
    const x1 = x(g.start), x2 = x(g.end);
    if (x2 < left || x1 > left+width) continue;
    ctx.fillStyle = state.currentTime >= g.start && state.currentTime <= g.end ? "rgba(255,147,100,.13)" : "rgba(255,255,255,.045)";
    ctx.fillRect(Math.max(left,x1), top, Math.min(left+width,x2)-Math.max(left,x1), height);
  }
  ctx.restore();
}

function drawChart(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;
  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);
  const margin = {l:54,r:15,t:12,b:26};
  const pw = w-margin.l-margin.r, ph = h-margin.t-margin.b;
  const [t0,t1] = state.domain;
  const x = t => margin.l + ((t-t0)/(t1-t0))*pw;
  const displayRows = processedChartRows(chart);
  const domainRows = displayRows.filter(r => r._t >= t0 && r._t <= t1);
  const [y0,y1] = computeYDomain(chart, domainRows);
  const y = v => margin.t + (1-(v-y0)/(y1-y0))*ph;

  drawBackgroundBands(ctx, margin.l, margin.t, pw, ph, x);
  ctx.strokeStyle = "#686868"; ctx.lineWidth = 1;
  ctx.fillStyle = "#a8a8a8"; ctx.font = "11px system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let i=0;i<=4;i++) {
    const yy = margin.t + ph*i/4;
    const value = y1-(y1-y0)*i/4;
    ctx.beginPath(); ctx.moveTo(margin.l,yy); ctx.lineTo(margin.l+pw,yy); ctx.stroke();
    ctx.fillText(formatAxis(value), margin.l-7, yy);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i=0;i<=4;i++) {
    const xx = margin.l + pw*i/4;
    const tt = t0 + (t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt), xx, margin.t+ph+6);
  }

  chart.keys.forEach((key,ki) => {
    ctx.strokeStyle = COLORS[ki % COLORS.length]; ctx.lineWidth = 1.35; ctx.globalAlpha = .92;
    ctx.beginPath(); let started=false;
    for (const r of domainRows) {
      const v = chartValue(chart,r,key);
      if (v === null || v < y0 || v > y1) { started=false; continue; }
      const xx=x(r._t), yy=y(v);
      if (!started) { ctx.moveTo(xx,yy); started=true; } else ctx.lineTo(xx,yy);
    }
    ctx.stroke();
  });
  ctx.globalAlpha=1;

  const cursorX=x(state.currentTime);
  if (cursorX>=margin.l && cursorX<=margin.l+pw) {
    ctx.strokeStyle="#ff9364"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(cursorX,margin.t); ctx.lineTo(cursorX,margin.t+ph); ctx.stroke();
    const nr=nearestRow(displayRows,state.currentTime);
    chart.keys.forEach((key,ki)=>{
      const v=nr?chartValue(chart,nr,key):null;
      if(v!==null && v>=y0 && v<=y1){ ctx.fillStyle=COLORS[ki%COLORS.length]; ctx.beginPath(); ctx.arc(cursorX,y(v),3.2,0,Math.PI*2); ctx.fill(); }
    });
  }
}

function formatAxis(v) {
  const a=Math.abs(v);
  if(a>=1000) return v.toFixed(0);
  if(a>=10) return v.toFixed(1);
  return v.toFixed(2);
}
function formatClockShort(ts) {
  const d=new Date(ts*1000);
  return new Intl.DateTimeFormat(undefined,{timeZone:"America/Los_Angeles",hour12:false,hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(d);
}
function drawAllCharts(){ state.charts.forEach(drawChart); }

function drawTrialStrip() {
  const canvas=el("trialStrip"); if(!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas); ctx.clearRect(0,0,w,h);
  const left=4,right=4,top=6,bottom=10,pw=w-left-right,ph=h-top-bottom;
  const [t0,t1]=state.domain; const x=t=>left+((t-t0)/(t1-t0))*pw;
  ctx.fillStyle="#555555"; ctx.fillRect(left,top,pw,ph);
  for(const g of state.trialGroups){
    const x1=Math.max(left,x(g.start)), x2=Math.min(left+pw,x(g.end));
    if(x2<=left||x1>=left+pw) continue;
    const active=state.currentTime>=g.start&&state.currentTime<=g.end;
    ctx.fillStyle=active?"rgba(255,147,100,.72)":"rgba(120,120,120,.62)"; ctx.fillRect(x1,top,Math.max(2,x2-x1),ph);
    ctx.fillStyle=active?"#3f3f3f":"#f5f5f5"; ctx.font="bold 11px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    if(x2-x1>45) ctx.fillText(`Trial ${g.trial}`,(x1+x2)/2,top+ph/2);
    for(const m of g.moves){
      if(m._help){ const xx=x(m.start); if(xx>=left&&xx<=left+pw){ ctx.fillStyle="#f2763f"; ctx.fillRect(xx,top,2,ph); } }
    }
  }
  const cx=x(state.currentTime); ctx.strokeStyle="#ff9364"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(cx,2); ctx.lineTo(cx,h-3); ctx.stroke();
}

function updateAll() {
  el("clock").textContent = formatClock(state.currentTime);
  el("elapsed").textContent = `Elapsed ${formatElapsed(state.currentTime-state.domain[0])}`;
  renderHanoi(); renderSnapshot(); drawAllCharts(); drawTrialStrip();
}

function stopPlayback(){
  state.playing=false; state.lastFrame=null;
  if(state.animationFrame) cancelAnimationFrame(state.animationFrame);
  state.animationFrame=null;
  if(el("playPause")) el("playPause").textContent="▶ Play";
}
function togglePlayback(){
  if(state.playing){ stopPlayback(); return; }
  state.playing=true; state.lastFrame=performance.now(); el("playPause").textContent="❚❚ Pause";
  const tick=now=>{
    if(!state.playing) return;
    const dt=(now-state.lastFrame)/1000; state.lastFrame=now;
    const speed=Number(el("speedSelect").value)||1;
    state.currentTime += dt*speed;
    if(state.currentTime>=state.domain[1]){ state.currentTime=state.domain[1]; syncSliderFromTime(); updateAll(); stopPlayback(); return; }
    syncSliderFromTime(); updateAll(); state.animationFrame=requestAnimationFrame(tick);
  };
  state.animationFrame=requestAnimationFrame(tick);
}

function jumpTrial(direction){
  if(!state.trialGroups.length) return;
  const starts=state.trialGroups.map(g=>g.start);
  if(direction>0){ const next=starts.find(t=>t>state.currentTime+0.25); state.currentTime=next??starts[starts.length-1]; }
  else { const prev=[...starts].reverse().find(t=>t<state.currentTime-0.25); state.currentTime=prev??starts[0]; }
  state.currentTime=Math.max(state.domain[0],Math.min(state.domain[1],state.currentTime)); syncSliderFromTime(); updateAll();
}

function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

el("loadParticipant").addEventListener("click",()=>loadParticipant(el("participantSelect").value));
el("participantSelect").addEventListener("change",()=>loadParticipant(el("participantSelect").value));
el("timeSlider").addEventListener("input",()=>{ stopPlayback(); state.currentTime=timeFromSlider(); updateAll(); });
el("playPause").addEventListener("click",togglePlayback);
el("prevTrial").addEventListener("click",()=>jumpTrial(-1));
el("nextTrial").addEventListener("click",()=>jumpTrial(1));
el("viewSelect").addEventListener("change",()=>{ updateDomain(); updateAll(); });
el("trialStrip").addEventListener("click",event=>{
  const rect=event.currentTarget.getBoundingClientRect(); const f=(event.clientX-rect.left)/rect.width;
  state.currentTime=state.domain[0]+Math.max(0,Math.min(1,f))*(state.domain[1]-state.domain[0]); syncSliderFromTime(); updateAll();
});
el("chartMode").addEventListener("change", () => {
  state.chartMode = el("chartMode").value;
  refreshChartModeUI();
  drawAllCharts();
});

el("smoothWindow").addEventListener("change", () => {
  state.smoothSeconds = Math.max(0.5, Number(el("smoothWindow").value) || DEFAULT_SMOOTH_SECONDS);
  // Invalidate cached smoothed data.
  state.charts.forEach(chart => {
    chart.smoothCacheSeconds = null;
    chart.smoothRows = null;
  });
  refreshChartModeUI();
  drawAllCharts();
});

let resizeTimer=null;
window.addEventListener("resize",()=>{ clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>{ drawAllCharts(); drawTrialStrip(); },100); });

initParticipants();
