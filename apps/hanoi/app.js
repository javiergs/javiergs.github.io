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

const COLORS = ["#154734", "#d9a928", "#477b9d", "#a44949", "#735b8f", "#5b7d64"];
const DISK_COLORS = ["#BD8B13", "#477b9d", "#d9a928", "#735b8f", "#5b7d64", "#a44949"];
const FACE_ACTION_COLORS = {
  neutral: "#9ca3a0",
  blink: "#0066ff",
  winkl: "#00a9a5",
  winkr: "#7a4cff",
  lookl: "#00c853",
  lookr: "#ff1744",
  frown: "#d84315",
  surprise: "#8e24aa",
  smile: "#00bfa5",
  laugh: "#ffb300",
  smirkright: "#e91e63"
};
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
  smoothSeconds: DEFAULT_SMOOTH_SECONDS,
  visibleSeries: {},
  visibleFaceActions: {
    eye: {},
    upper: {},
    lower: {}
  },
  visibleQualityValues: {0:true,1:true,2:true,3:true,4:true}
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
      const text = await loadText(`data/${encodeURIComponent(id)}/${filename}`);
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
    setStatus(`Participant ${id} loaded · ${state.trialGroups.length} trials · ${state.trials.length} moves · ${totalRows.toLocaleString()} sensor samples.  Orange markers = Help used · current-time cursor uses the moving plot marker.`);
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
      return `<div class="disk${pending}" style="width:${width}%;background:${DISK_COLORS[(d - 1) % DISK_COLORS.length]}" title="Disk ${d}">${d}</div>`;
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

function latestRowAtOrBefore(rows,time){
  if(!rows || !rows.length) return null;
  let lo=0, hi=rows.length-1, best=-1;
  while(lo<=hi){
    const mid=(lo+hi)>>1;
    if(rows[mid]._t<=time){ best=mid; lo=mid+1; }
    else hi=mid-1;
  }
  return best>=0 ? rows[best] : null;
}

function snapshotAffectValue(row,key,digits=2){
  if(!row) return "—";
  const activeKey = `Active ${key}`;
  if(Object.prototype.hasOwnProperty.call(row,activeKey)){
    const active=String(row[activeKey]).trim().toLowerCase()==="true";
    if(!active) return "—";
  }
  const n=asNumber(row[key]);
  if(n===null || n===-1) return "—";
  return n.toFixed(digits);
}

function renderSnapshot() {
  const a = nearestRow(state.data.affect, state.currentTime);
  const p = nearestRow(state.data.pad, state.currentTime);
  const e = nearestRow(state.data.eeg, state.currentTime);
  const f = nearestRow(state.data.face, state.currentTime);
  const m = nearestRow(state.data.motion, state.currentTime);
  const d = nearestRow(state.data.device, state.currentTime);
  const groups = [
    ["Affect", [["Attention",snapshotAffectValue(a,"Focus")],["Engagement",snapshotAffectValue(a,"Engagement")],["Interest",snapshotAffectValue(a,"Interest")],["Stress",snapshotAffectValue(a,"Stress")]]],
    ["PAD", [["Pleasure",snapshotValue(p,"Pleasure")],["Arousal",snapshotValue(p,"Arousal")],["Dominance",snapshotValue(p,"Dominance")]]],
    ["EEG", [["AF3",snapshotValue(e,"AF3",1)],["T7",snapshotValue(e,"T7",1)],["Pz",snapshotValue(e,"Pz",1)],["T8",snapshotValue(e,"T8",1)],["AF4",snapshotValue(e,"AF4",1)]]],
    ["Face", [["Eye",snapshotValue(f,"Action Eye",0)],["Upper",snapshotValue(f,"Action Upper Face",0)],["Upper power",snapshotValue(f,"Power Upper Face")],["Lower",snapshotValue(f,"Action Lower Face",0)],["Lower power",snapshotValue(f,"Power Lower Face")]]],
    ["Motion", [["Movement",movementSnapshotValue(state.data.motion,state.currentTime)],["Heading",magneticHeadingLabel(m)],["Tilt",tiltSnapshotValue(m)]]],
    ["Device", [["Battery", `${snapshotValue(d,"Battery Percent",0)}%`],["Wireless",wirelessSnapshotValue(d)],["AF3 CQ",snapshotValue(d,"Quality Sensor 0",0)],["T7 CQ",snapshotValue(d,"Quality Sensor 1",0)],["Pz CQ",snapshotValue(d,"Quality Sensor 2",0)],["T8 CQ",snapshotValue(d,"Quality Sensor 3",0)],["AF4 CQ",snapshotValue(d,"Quality Sensor 4",0)]]]
  ];
  el("snapshot").innerHTML = groups.map(([name, rows]) => `<div class="snapshot-group"><h3>${name}</h3>${rows.map(([k,v]) => `<div class="snapshot-row"><span>${escapeHTML(k)}</span><strong>${escapeHTML(v)}</strong></div>`).join("")}</div>`).join("");
}

function wirelessSnapshotValue(row) {
  if (!row) return "—";
  const value = asNumber(row["Wireless Signal"]);
  return value === null ? "—" : `${wirelessLabel(value)} (${value.toFixed(2)})`;
}

function displaySeriesLabel(chart, key) {
  if (chart.id === "affect" && key === "Focus") return "Attention";
  return key;
}

function buildCharts() {
  const configs = [
    {
      id:"affect", source:"affect", title:"Affect",
      note:"Active performance metrics only · Attention displayed from recorded Focus field · −1 treated as missing",
      keys:["Focus","Engagement","Excitement","Interest","Relaxation","Stress"],
      activePrefix:"Active ", yDomain:[0,1], yTicks:[0,.25,.5,.75,1],
      selectable:true
    },
    {
      id:"pad", source:"pad", title:"PAD",
      note:"Pleasure · Arousal · Dominance",
      keys:["Pleasure","Arousal","Dominance"],
      yDomain:[-1,1], yTicks:[-1,-.5,0,.5,1],
      selectable:true
    },
    {
      id:"eeg", source:"eeg", title:"EEG",
      note:"AF3 · T7 · Pz · T8 · AF4 (display downsampled)",
      keys:["AF3","T7","Pz","T8","AF4"],
      selectable:true
    },
    {
      id:"deviceQuality", source:"device", type:"qualityLanes", title:"EEG Sensor Contact Quality",
      note:"Insight sensor order: AF3 · T7 · Pz · T8 · AF4 · discrete 0–4 · no smoothing",
      keys:["Quality Sensor 0","Quality Sensor 1","Quality Sensor 2","Quality Sensor 3","Quality Sensor 4"],
      sensorLabels:["AF3","T7","Pz","T8","AF4"],
      noSmooth:true
    },
    {
      id:"wireless", source:"device", type:"wirelessStatus", title:"Device · Wireless Signal Quality",
      note:"EMOTIV wireless signal 0–1 · forest green = 1 · orange/red = reduced · gray = 0",
      keys:["Wireless Signal"],
      noSmooth:true
    },
    {
      id:"faceGroup", source:"face", type:"faceGroup", title:"Facial Expression",
      note:"Current expression at left · Eye / Upper Face / Lower Face timelines at right",
      keys:[],
      selectableActions:true
    },
    {
      id:"motionSummary", source:"motion", type:"motionSummary", title:"Head Motion",
      note:"Movement from raw accelerometer · direction from magnetometer · tilt from gravity vector",
      keys:[]
    },
    {
      id:"battery", source:"device", title:"Device · Battery",
      note:"Battery Percent",
      keys:["Battery Percent"],
      yDomain:[0,100], yTicks:[0,25,50,75,100]
    }
  ];

  el("charts").innerHTML = configs.map(c =>
    `<article class="card chart-card">
      <div class="chart-title-row"><h2>${c.title}</h2><div class="chart-note">${c.note}</div></div>
      <div class="chart-wrap${
        c.type === "faceGroup" ? " face-group-wrap" :
        c.type === "faceCurrent" ? " face-current-wrap" :
        c.type === "faceLane" ? " face-single-wrap" :
        c.type === "heading" ? " heading-chart-wrap" :
        c.type === "motionSummary" ? " motion-summary-wrap" :
        c.type === "wirelessStatus" ? " wireless-status-wrap" :
        c.type === "qualityLanes" ? " quality-lanes-wrap" : ""
      }"><canvas id="chart-${c.id}"></canvas></div>
      <div class="legend${c.selectable ? " selectable-legend" : ""}" id="legend-${c.id}"></div>
    </article>`
  ).join("");

  state.charts = configs.map(c => {
    const rawRows = state.data[c.source] || [];
    if (c.keys && !(c.id in state.visibleSeries)) {
      state.visibleSeries[c.id] = Object.fromEntries(c.keys.map(k => [k, true]));
    }
    return {
      ...c,
      rawRows,
      rows: downsample(rawRows),
      smoothCacheSeconds: null,
      smoothRows: null
    };
  });

  state.charts.forEach(chart => {
    const legend = el(`legend-${chart.id}`);

    if (chart.type === "faceGroup") {
      legend.innerHTML = "";
    } else if (chart.type === "faceCurrent") {
      legend.innerHTML = "";
    } else if (chart.type === "faceLane") {
      const actions = new Set();
      for (const row of chart.rawRows) {
        const action = String(row[chart.actionKey] || "").trim().toLowerCase();
        if (action) actions.add(action);
      }
      legend.innerHTML = [...actions].sort().map(action =>
        `<span class="legend-item" style="color:${faceActionColor(action)}"><span class="legend-swatch face-swatch"></span>${escapeHTML(action)}</span>`
      ).join("");
    } else if (chart.type === "heading" || chart.type === "motionSummary" || chart.type === "wirelessStatus") {
      legend.innerHTML = "";
    } else if (chart.type === "qualityLanes") {
      legend.classList.add("selectable-legend");
      legend.innerHTML = [0,1,2,3,4].map(v =>
        `<label class="series-check quality-value-check">
          <input type="checkbox" data-quality-value="${v}" ${state.visibleQualityValues[v] !== false ? "checked" : ""}>
          <span class="quality-chip q${v}"></span>${v}
        </label>`
      ).join("");
    } else if (chart.selectable) {
      legend.innerHTML = chart.keys.map((k,i) =>
        `<label class="series-check" style="color:${COLORS[i % COLORS.length]}">
          <input type="checkbox" data-chart="${chart.id}" data-key="${escapeHTML(k)}" ${state.visibleSeries[chart.id][k] !== false ? "checked" : ""}>
          <span class="legend-swatch"></span>${escapeHTML(displaySeriesLabel(chart,k))}
        </label>`
      ).join("");
    } else {
      legend.innerHTML = (chart.keys || []).map((k,i) =>
        `<span class="legend-item" style="color:${COLORS[i % COLORS.length]}"><span class="legend-swatch"></span>${escapeHTML(displaySeriesLabel(chart,k))}</span>`
      ).join("");
    }
  });

  document.querySelectorAll(".series-check input[data-chart]").forEach(input => {
    input.addEventListener("change", event => {
      const chartId = event.currentTarget.dataset.chart;
      const key = event.currentTarget.dataset.key;
      state.visibleSeries[chartId][key] = event.currentTarget.checked;
      drawAllCharts();
    });
  });

  document.querySelectorAll(".quality-value-check input").forEach(input => {
    input.addEventListener("change", event => {
      const value = Number(event.currentTarget.dataset.qualityValue);
      state.visibleQualityValues[value] = event.currentTarget.checked;
      drawAllCharts();
    });
  });  installFaceCanvasClickHandlers();
}


function visibleChartKeys(chart) {
  if (!chart.keys) return [];
  if (!chart.selectable) return chart.keys;
  const visibility = state.visibleSeries[chart.id] || {};
  return chart.keys.filter(key => visibility[key] !== false);
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
  if (chart.type === "wirelessStatus" || chart.type === "motionSummary" || chart.type === "faceGroup" || chart.type === "faceGroup" || chart.type === "faceCurrent" || chart.type === "faceLane" || chart.type === "qualityLanes" || chart.type === "heading" || chart.noSmooth || state.chartMode !== "smooth") return chart.rows;

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
    const canvas = el(`chart-${chart.id}`);
    if (!canvas) return;

    const card = canvas.closest(".chart-card");
    const note = card ? card.querySelector(".chart-note") : null;
    if (!note) return;

    if (chart.type === "wirelessStatus" || chart.type === "motionSummary" || chart.type === "faceGroup" || chart.type === "faceGroup" || chart.type === "faceCurrent" || chart.type === "faceLane" || chart.type === "qualityLanes") {
      note.textContent = chart.note;
      return;
    }
    if (chart.type === "heading") {
      note.textContent = "Approximate magnetic heading from Magnetometer X/Y · not quaternion-derived";
      return;
    }
    if (chart.noSmooth) {
      note.textContent = chart.note;
      return;
    }

    const base = {
      affect: "Active performance metrics only · −1 treated as missing",
      pad: "Pleasure · Arousal · Dominance",
      eeg: "AF3 · T7 · Pz · T8 · AF4",
      motion: "Accelerometer X · Y · Z",
      battery: "Battery Percent"
    }[chart.id] || chart.note;

    note.textContent = smooth
      ? `${base} · centered ${state.smoothSeconds}s moving average`
      : `${base}${chart.id === "eeg" ? " (display downsampled)" : ""}`;
  });
}

function installFaceCanvasClickHandlers(){
  for(const chart of state.charts){
    if(chart.type!=="faceGroup") continue;
    const canvas=el(`chart-${chart.id}`);
    if(!canvas || canvas._faceClickInstalled) continue;
    canvas._faceClickInstalled=true;
    canvas.addEventListener("click",event=>{
      const rect=canvas.getBoundingClientRect();
      const sx=canvas.width/rect.width;
      const sy=canvas.height/rect.height;
      const px=(event.clientX-rect.left)*sx/window.devicePixelRatio;
      const py=(event.clientY-rect.top)*sy/window.devicePixelRatio;
      for(const hit of chart._faceLegendHits||[]){
        if(px>=hit.x && px<=hit.x+hit.w && py>=hit.y && py<=hit.y+hit.h){
          toggleFaceAction(hit.actionKey,hit.action);
          drawAllCharts();
          break;
        }
      }
    });
  }
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
  if (
    chart.activePrefix &&
    Object.prototype.hasOwnProperty.call(row, chart.activePrefix + key)
  ) {
    const active = String(row[chart.activePrefix + key]).trim().toLowerCase() === "true";
    if (!active) return null;
  }
  const value = asNumber(row[key]);
  if (chart.id === "affect" && value === -1) return null;
  return value;
}

function computeYDomain(chart, rowsInDomain) {
  if (chart.yDomain) return chart.yDomain;

  const values = [];
  const keys = visibleChartKeys(chart);
  for (const r of rowsInDomain) for (const key of keys) {
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
  if (min === max) { min -= .5; max += .5; }
  const pad = (max-min) * .07;
  return [min-pad, max+pad];
}

function drawBackgroundBands(ctx, left, top, width, height, x) {
  ctx.save();

  // General outside-trial background.
  ctx.fillStyle = "rgba(255,255,255,.025)";
  ctx.fillRect(left, top, width, height);

  // Make gaps between trials visually obvious.
  for (let i = 0; i < state.trialGroups.length - 1; i++) {
    const gapStart = state.trialGroups[i].end;
    const gapEnd = state.trialGroups[i + 1].start;
    const gx1 = Math.max(left, x(gapStart));
    const gx2 = Math.min(left + width, x(gapEnd));
    if (gx2 > gx1) {
      ctx.fillStyle = "rgba(245,245,245,.72)";
      ctx.fillRect(gx1, top, gx2 - gx1, height);
    }
  }

  // Trial regions.
  for (const g of state.trialGroups) {
    const x1 = x(g.start), x2 = x(g.end);
    if (x2 < left || x1 > left+width) continue;
    ctx.fillStyle = state.currentTime >= g.start && state.currentTime <= g.end
      ? "rgba(255,147,100,.13)"
      : "rgba(255,255,255,.045)";
    ctx.fillRect(Math.max(left,x1), top, Math.min(left+width,x2)-Math.max(left,x1), height);
  }
  ctx.restore();
}


function normalizeFaceAction(action) {
  return String(action || "neutral").trim().toLowerCase() || "neutral";
}

function faceActionColor(action) {
  const key = normalizeFaceAction(action).replace(/\s+/g, "");
  if (FACE_ACTION_COLORS[key]) return FACE_ACTION_COLORS[key];

  // Stable fallback color for unexpected categories.
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
  return COLORS[Math.abs(hash) % COLORS.length];
}

function drawFaceLane(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;

  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const margin = {l:54,r:15,t:12,b:26};
  const pw = w-margin.l-margin.r, ph = h-margin.t-margin.b;
  const [t0,t1] = state.domain;
  const x = t => margin.l + ((t-t0)/(t1-t0))*pw;

  drawBackgroundBands(ctx, margin.l, margin.t, pw, ph, x);

  const rows = chart.rows.filter(r => r._t >= t0 - 1 && r._t <= t1 + 1);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextT = i + 1 < rows.length ? rows[i+1]._t : row._t + 0.1;
    const x1 = Math.max(margin.l, x(row._t));
    const x2 = Math.min(margin.l + pw, x(nextT));
    if (x2 <= margin.l || x1 >= margin.l + pw || x2 <= x1) continue;

    const action = normalizeFaceAction(row[chart.actionKey]);
    let power = chart.powerKey ? asNumber(row[chart.powerKey]) : 1;
    if (power === null) power = 0;
    power = Math.max(0, Math.min(1, power));

    const alpha = action === "neutral"
      ? 0.18
      : (chart.powerKey ? 0.35 + 0.65 * power : 0.88);

    ctx.globalAlpha = alpha;
    ctx.fillStyle = faceActionColor(action);
    ctx.fillRect(x1, margin.t + 5, Math.max(1, x2-x1+0.5), ph - 10);
  }
  ctx.globalAlpha = 1;

  // Current action label at the left.
  const current = nearestRow(chart.rawRows, state.currentTime);
  const action = current ? normalizeFaceAction(current[chart.actionKey]) : "—";
  const power = current && chart.powerKey ? asNumber(current[chart.powerKey]) : null;
  ctx.fillStyle = "#a8a8a8";
  ctx.font = "11px system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    power === null ? action : `${action} ${power.toFixed(2)}`,
    margin.l - 7,
    margin.t + ph/2
  );

  ctx.fillStyle = "#a8a8a8";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i=0;i<=4;i++) {
    const xx = margin.l + pw*i/4;
    const tt = t0 + (t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt), xx, margin.t+ph+6);
  }

  const cursorX = x(state.currentTime);
  if (cursorX >= margin.l && cursorX <= margin.l + pw) {
    ctx.strokeStyle = "#BD8B13";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, margin.t);
    ctx.lineTo(cursorX, margin.t+ph);
    ctx.stroke();
  }
}



function faceLaneKey(actionKey){
  if(actionKey==="Action Eye") return "eye";
  if(actionKey==="Action Upper Face") return "upper";
  return "lower";
}

function isFaceActionVisible(actionKey,action){
  const lane=faceLaneKey(actionKey);
  const map=state.visibleFaceActions[lane] || {};
  return map[action] !== false;
}

function toggleFaceAction(actionKey,action){
  const lane=faceLaneKey(actionKey);
  if(!state.visibleFaceActions[lane]) state.visibleFaceActions[lane]={};
  state.visibleFaceActions[lane][action] = state.visibleFaceActions[lane][action] === false;
}

function faceLaneActions(rows,actionKey){
  const set=new Set();
  for(const row of rows){
    const action=normalizeFaceAction(row[actionKey]);
    if(action) set.add(action);
  }
  return [...set].sort();
}

function drawFaceGroup(chart){
  const canvas=el(`chart-${chart.id}`);
  if(!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const leftW=Math.min(205,Math.max(170,w*.15));
  const gap=20;
  const faceBox={x:8,y:10,w:leftW-8,h:h-20};

  // right-side plot region
  const rightX=leftW+gap;
  const rightW=w-rightX-14;
  const [t0,t1]=state.domain;
  const x=t=>rightX+((t-t0)/(t1-t0))*rightW;

  // Current-expression square
  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#d6ddd8";
  ctx.lineWidth=1.2;
  roundRect(ctx,faceBox.x,faceBox.y,faceBox.w,faceBox.h,10);
  ctx.fill();ctx.stroke();

  const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  const eye=normalizeFaceAction(row?row["Action Eye"]:"neutral");
  const upper=normalizeFaceAction(row?row["Action Upper Face"]:"neutral");
  const lower=normalizeFaceAction(row?row["Action Lower Face"]:"neutral");
  drawExpressionFace(ctx,faceBox.x+faceBox.w/2,faceBox.y+faceBox.h*.42,eye,upper,lower);

  ctx.fillStyle="#18211b";
  ctx.font="700 9px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.fillText(`${eye} · ${upper} · ${lower}`,faceBox.x+faceBox.w/2,faceBox.y+faceBox.h-24);

  const laneDefs=[
    {
      title:"EYES",
      actionKey:"Action Eye",
      powerKey:null
    },
    {
      title:"UPPER FACE",
      actionKey:"Action Upper Face",
      powerKey:"Power Upper Face"
    },
    {
      title:"LOWER FACE",
      actionKey:"Action Lower Face",
      powerKey:"Power Lower Face"
    }
  ];

  // Each lane gets: title, plot bar, and its own small checkbox legend.
  const top=10;
  const bottom=24;
  const laneBlockH=(h-top-bottom)/3;
  const titleH=18;
  const legendH=22;
  const barH=Math.max(28,laneBlockH-titleH-legendH-8);

  drawBackgroundBands(ctx,rightX,top,rightW,h-top-bottom,x);

  laneDefs.forEach((lane,li)=>{
    const blockY=top+li*laneBlockH;
    const titleY=blockY+2;
    const barY=blockY+titleH;
    const legendY=barY+barH+4;

    // lane title ABOVE bar
    ctx.fillStyle="#606a64";
    ctx.font="800 11px system-ui";
    ctx.textAlign="left";
    ctx.textBaseline="top";
    ctx.fillText(lane.title,rightX,titleY);

    // draw categorical bar
    const rows=chart.rows.filter(r=>r._t>=t0-1 && r._t<=t1+1);
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      const nextT=i+1<rows.length?rows[i+1]._t:r._t+.1;
      const x1=Math.max(rightX,x(r._t));
      const x2=Math.min(rightX+rightW,x(nextT));
      if(x2<=x1) continue;

      const action=normalizeFaceAction(r[lane.actionKey]);
      if(!isFaceActionVisible(lane.actionKey,action)) continue;

      let power=lane.powerKey?asNumber(r[lane.powerKey]):1;
      if(power===null) power=0;
      power=Math.max(0,Math.min(1,power));
      const alpha=action==="neutral"?.16:(lane.powerKey?.35+.65*power:.88);

      ctx.globalAlpha=alpha;
      ctx.fillStyle=faceActionColor(action);
      ctx.fillRect(x1,barY,Math.max(1,x2-x1+.5),barH);
    }
    ctx.globalAlpha=1;

    ctx.strokeStyle="#d4d9d6";
    ctx.lineWidth=1;
    ctx.strokeRect(rightX,barY,rightW,barH);

    // lane-specific color / checkbox legend BELOW bar
    const actions=faceLaneActions(chart.rawRows,lane.actionKey);
    let lx=rightX;
    ctx.font="10px system-ui";
    ctx.textAlign="left";
    ctx.textBaseline="middle";

    for(const action of actions){
      const checked=isFaceActionVisible(lane.actionKey,action);
      const box=10;
      const labelW=ctx.measureText(action).width;
      const itemW=box+6+10+4+labelW+16;

      // wrap if needed
      if(lx+itemW>rightX+rightW){
        // keep compact: stop rendering excess items rather than overlap
        break;
      }

      // checkbox
      ctx.fillStyle="#ffffff";
      ctx.strokeStyle="#66706a";
      ctx.lineWidth=1.1;
      ctx.strokeRect(lx,legendY,box,box);
      if(checked){
        ctx.fillStyle="#18211b";
        ctx.fillRect(lx+2,legendY+2,box-4,box-4);
      }

      // color swatch
      ctx.fillStyle=faceActionColor(action);
      ctx.fillRect(lx+box+6,legendY+1,10,8);

      // label
      ctx.fillStyle="#4d5651";
      ctx.fillText(action,lx+box+20,legendY+box/2);

      lx+=itemW;
    }

    // separator between lane blocks
    if(li<laneDefs.length-1){
      ctx.strokeStyle="#e3e6e4";
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(rightX,blockY+laneBlockH-2);
      ctx.lineTo(rightX+rightW,blockY+laneBlockH-2);
      ctx.stroke();
    }
  });

  // x-axis at the bottom only
  ctx.fillStyle="#a8a8a8";
  ctx.font="11px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  for(let i=0;i<=4;i++){
    const xx=rightX+rightW*i/4;
    const tt=t0+(t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt),xx,h-19);
  }

  const cursorX=x(state.currentTime);
  if(cursorX>=rightX && cursorX<=rightX+rightW){
    ctx.strokeStyle="#BD8B13";
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX,top);
    ctx.lineTo(cursorX,h-bottom);
    ctx.stroke();
  }

  // Hit boxes for per-lane checkboxes, used by canvas click handler.
  chart._faceLegendHits=[];
  laneDefs.forEach((lane,li)=>{
    const blockY=top+li*laneBlockH;
    const barY=blockY+titleH;
    const legendY=barY+barH+4;
    const actions=faceLaneActions(chart.rawRows,lane.actionKey);
    let lx=rightX;
    ctx.font="10px system-ui";
    for(const action of actions){
      const box=10;
      const labelW=ctx.measureText(action).width;
      const itemW=box+6+10+4+labelW+16;
      if(lx+itemW>rightX+rightW) break;
      chart._faceLegendHits.push({x:lx,y:legendY,w:itemW,h:14,action,actionKey:lane.actionKey});
      lx+=itemW;
    }
  });
}


function drawFaceCurrent(chart){
  const canvas=el(`chart-${chart.id}`);
  if(!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  const eye=normalizeFaceAction(row?row["Action Eye"]:"neutral");
  const upper=normalizeFaceAction(row?row["Action Upper Face"]:"neutral");
  const lower=normalizeFaceAction(row?row["Action Lower Face"]:"neutral");

  const cx=w*.32, cy=h*.50;
  drawExpressionFace(ctx,cx,cy,eye,upper,lower);

  ctx.fillStyle="#18211b";
  ctx.font="800 14px system-ui";
  ctx.textAlign="left";
  ctx.textBaseline="middle";
  const tx=w*.55;
  ctx.fillText(`Eyes: ${eye}`,tx,cy-28);
  ctx.fillText(`Upper: ${upper}`,tx,cy);
  ctx.fillText(`Lower: ${lower}`,tx,cy+28);

  ctx.fillStyle="#778078";
  ctx.font="10px system-ui";
  ctx.fillText("current expression at master cursor",tx,cy+55);
}

function drawExpressionFace(ctx,cx,cy,eyeAction,upperAction,lowerAction){
  ctx.save();
  ctx.lineCap="round";
  ctx.lineJoin="round";

  // Hair-free neutral head.
  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#66706a";
  ctx.lineWidth=2.5;
  ctx.beginPath();ctx.ellipse(cx,cy,44,52,0,0,Math.PI*2);ctx.fill();ctx.stroke();

  // ears
  ctx.beginPath();ctx.ellipse(cx-46,cy,6,11,0,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();ctx.ellipse(cx+46,cy,6,11,0,0,Math.PI*2);ctx.stroke();

  const leftX=cx-15,rightX=cx+15,eyeY=cy-10;
  const lookLeft=eyeAction==="lookl";
  const lookRight=eyeAction==="lookr";
  const blink=eyeAction==="blink";
  const winkL=eyeAction==="winkl";
  const winkR=eyeAction==="winkr";

  ctx.strokeStyle="#424a45";
  ctx.fillStyle="#424a45";
  ctx.lineWidth=2.5;

  const drawEye=(x,isClosed)=>{
    if(isClosed){
      ctx.beginPath();ctx.moveTo(x-7,eyeY);ctx.quadraticCurveTo(x,eyeY+3,x+7,eyeY);ctx.stroke();
    }else{
      ctx.beginPath();ctx.ellipse(x,eyeY,7,4.5,0,0,Math.PI*2);ctx.stroke();
      const pupilShift=lookLeft?-3:lookRight?3:0;
      ctx.beginPath();ctx.arc(x+pupilShift,eyeY,2.2,0,Math.PI*2);ctx.fill();
    }
  };
  drawEye(leftX,blink||winkL);
  drawEye(rightX,blink||winkR);

  // Brows / upper face.
  let browLift=0, browInner=0;
  if(upperAction==="surprise") browLift=-8;
  if(upperAction==="frown") browInner=5;
  ctx.beginPath();
  ctx.moveTo(leftX-8,eyeY-10+browLift);
  ctx.lineTo(leftX+8,eyeY-10+browLift+browInner);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(rightX-8,eyeY-10+browLift+browInner);
  ctx.lineTo(rightX+8,eyeY-10+browLift);
  ctx.stroke();

  // Nose.
  ctx.strokeStyle="#BD8B13";
  ctx.lineWidth=2.6;
  ctx.beginPath();
  ctx.moveTo(cx,cy-2);ctx.quadraticCurveTo(cx+5,cy+3,cx+1,cy+10);ctx.stroke();

  // Lower-face actions.
  ctx.strokeStyle="#424a45";
  ctx.fillStyle="#424a45";
  ctx.lineWidth=2.6;
  const my=cy+24;
  if(lowerAction==="laugh"){
    ctx.beginPath();ctx.arc(cx,my-2,15,0.05*Math.PI,0.95*Math.PI);ctx.stroke();
    ctx.beginPath();ctx.ellipse(cx,my+4,10,5,0,0,Math.PI*2);ctx.fill();
  }else if(lowerAction==="smile"){
    ctx.beginPath();ctx.arc(cx,my-4,15,0.12*Math.PI,0.88*Math.PI);ctx.stroke();
  }else if(lowerAction==="smirkright"){
    ctx.beginPath();
    ctx.moveTo(cx-12,my);ctx.quadraticCurveTo(cx+3,my+3,cx+14,my-6);ctx.stroke();
  }else{
    ctx.beginPath();ctx.moveTo(cx-11,my);ctx.quadraticCurveTo(cx,my+1,cx+11,my);ctx.stroke();
  }

  ctx.restore();
}

function rawAcceleration(row) {
  if (!row) return null;
  const x = asNumber(row["Accelerometer X"]);
  const y = asNumber(row["Accelerometer Y"]);
  const z = asNumber(row["Accelerometer Z"]);
  if (x === null || y === null || z === null) return null;
  return {x,y,z};
}

function localGravityBaseline(rows, time, windowSeconds=2.5) {
  if (!rows || !rows.length) return null;
  const vals = [];
  for (const r of rows) {
    if (Math.abs(r._t - time) > windowSeconds) continue;
    const a = rawAcceleration(r);
    if (a) vals.push(a);
  }
  if (!vals.length) return null;
  return {
    x: vals.reduce((s,a)=>s+a.x,0)/vals.length,
    y: vals.reduce((s,a)=>s+a.y,0)/vals.length,
    z: vals.reduce((s,a)=>s+a.z,0)/vals.length
  };
}

function movementMagnitude(rows, time) {
  const row = nearestRow(rows, time);
  const a = rawAcceleration(row);
  if (!a) return null;

  // Estimate the slowly-changing gravity/posture component with a local mean,
  // then measure instantaneous residual acceleration.
  const g = localGravityBaseline(rows, time, 2.5);
  if (!g) return null;
  return Math.sqrt(
    (a.x-g.x)*(a.x-g.x) +
    (a.y-g.y)*(a.y-g.y) +
    (a.z-g.z)*(a.z-g.z)
  );
}

function movementLabel(value) {
  if (!Number.isFinite(value)) return "—";
  // Relative visualization thresholds; intentionally labeled as descriptive,
  // not clinical/validated categories.
  if (value < 0.025) return "Low";
  if (value < 0.075) return "Moderate";
  return "High";
}

function gravityTilt(row) {
  const a = rawAcceleration(row);
  if (!a) return null;
  const mag = Math.sqrt(a.x*a.x + a.y*a.y + a.z*a.z);
  if (!mag) return null;

  // Roll/pitch estimated from the gravity vector. These are headset-frame
  // tilt angles, not absolute anatomical angles.
  const roll = Math.atan2(a.y, a.z) * 180 / Math.PI;
  const pitch = Math.atan2(-a.x, Math.sqrt(a.y*a.y + a.z*a.z)) * 180 / Math.PI;
  return {roll, pitch};
}


function movementTimeline(rows,t0,t1,targetPoints=400){
  if(!rows || !rows.length) return [];
  const visible=rows.filter(r=>r._t>=t0 && r._t<=t1);
  if(!visible.length) return [];
  const stride=Math.max(1,Math.floor(visible.length/targetPoints));
  const out=[];
  for(let i=0;i<visible.length;i+=stride){
    const r=visible[i];
    out.push({t:r._t,v:movementMagnitude(rows,r._t)});
  }
  return out;
}

function angleDifference(a,b){
  let d=(a-b+540)%360-180;
  return d;
}

function stableScreenBaseline(rows){
  if(!rows || !rows.length) return null;
  // Use the median of the first stable ~20 seconds as the participant-specific
  // screen-facing reference. This avoids assuming magnetic North = screen.
  const start=rows[0]._t;
  const candidates=rows.filter(r=>r._t>=start && r._t<=start+20);
  const headings=[], pitches=[];
  for(const r of candidates){
    const h=magneticHeading(r);
    const t=gravityTilt(r);
    if(h!==null && t){ headings.push(h); pitches.push(t.pitch); }
  }
  if(!headings.length) return null;
  const circularMeanDeg=vals=>{
    let sx=0,sy=0;
    vals.forEach(v=>{ const a=v*Math.PI/180; sx+=Math.cos(a); sy+=Math.sin(a); });
    return (Math.atan2(sy,sx)*180/Math.PI+360)%360;
  };
  pitches.sort((a,b)=>a-b);
  return {heading:circularMeanDeg(headings),pitch:pitches[Math.floor(pitches.length/2)]};
}

function screenRelativeOrientation(rows,time){
  const row=nearestRow(rows,time);
  const base=stableScreenBaseline(rows);
  const heading=magneticHeading(row);
  const tilt=gravityTilt(row);
  if(!base || heading===null || !tilt) return null;
  const yawDelta=angleDifference(heading,base.heading);
  const pitchDelta=tilt.pitch-base.pitch;
  const deviation=Math.sqrt(yawDelta*yawDelta+pitchDelta*pitchDelta);
  return {yawDelta,pitchDelta,deviation};
}

function drawMotionSummary(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;

  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const row = nearestRow(chart.rawRows, state.currentTime);
  const heading = magneticHeading(row);
  const orientation = screenRelativeOrientation(chart.rawRows, state.currentTime);

  const gap = 14;
  const outer = 8;
  const cardW = (w - outer*2 - gap*2) / 3;
  const cardH = h - 16;

  const cards = [
    {x:outer, title:"MOVEMENT ACTIVITY"},
    {x:outer+cardW+gap, title:"HEAD DIRECTION"},
    {x:outer+(cardW+gap)*2, title:"HEAD ORIENTATION"}
  ];

  for (const card of cards) {
    ctx.fillStyle = "rgba(255,255,255,.035)";
    ctx.strokeStyle = "#d7dcda";
    ctx.lineWidth = 1;
    roundRect(ctx, card.x, 8, cardW, cardH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = "#778078";
    ctx.font = "700 11px system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(card.title, card.x+14, 20);
  }

  // Movement Activity timeline.
  const m = cards[0];
  const plot = {x:m.x+16, y:48, w:cardW-32, h:95};
  const [t0,t1] = state.domain;
  const samples = movementTimeline(chart.rawRows, t0, t1, Math.max(100, Math.floor(plot.w)));
  let maxV = 0;
  for (const p of samples) if (p.v !== null) maxV = Math.max(maxV,p.v);
  maxV = Math.max(maxV,0.03);

  ctx.strokeStyle="#e1e5e2"; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(plot.x,plot.y+plot.h); ctx.lineTo(plot.x+plot.w,plot.y+plot.h); ctx.stroke();

  ctx.strokeStyle="#ff7f32"; ctx.lineWidth=2;
  ctx.beginPath();
  let started=false;
  for (const p of samples) {
    if (p.v === null) { started=false; continue; }
    const px=plot.x+((p.t-t0)/(t1-t0))*plot.w;
    const py=plot.y+plot.h-(Math.min(p.v,maxV)/maxV)*plot.h;
    if (!started) { ctx.moveTo(px,py); started=true; } else ctx.lineTo(px,py);
  }
  ctx.stroke();

  const currentMove=movementMagnitude(chart.rawRows,state.currentTime);
  const cursorX=plot.x+((state.currentTime-t0)/(t1-t0))*plot.w;
  if(cursorX>=plot.x && cursorX<=plot.x+plot.w){
    ctx.strokeStyle="#69736c"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(cursorX,plot.y); ctx.lineTo(cursorX,plot.y+plot.h); ctx.stroke();

    // small current-value point
    if(currentMove!==null){
      const py=plot.y+plot.h-(Math.min(currentMove,maxV)/maxV)*plot.h;
      ctx.fillStyle="#BD8B13";
      ctx.beginPath(); ctx.arc(cursorX,py,4,0,Math.PI*2); ctx.fill();
    }
  }

  ctx.fillStyle="#18211b"; ctx.font="700 13px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText(`${movementLabel(currentMove)}${currentMove===null?"":` · ${currentMove.toFixed(3)}`}`,m.x+cardW/2,164);
  ctx.fillStyle="#778078"; ctx.font="10px system-ui";
  ctx.fillText("relative movement activity",m.x+cardW/2,181);

  // Direction compass.
  const d=cards[1], cx=d.x+cardW/2, cy=103, radius=Math.min(55,cardW*.22);
  ctx.strokeStyle="#c9cfcc"; ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(cx,cy,radius,0,Math.PI*2); ctx.stroke();
  ctx.fillStyle="#778078"; ctx.font="700 10px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
  ctx.fillText("N",cx,cy-radius-12); ctx.fillText("S",cx,cy+radius+12);
  ctx.fillText("W",cx-radius-13,cy); ctx.fillText("E",cx+radius+13,cy);
  if(heading!==null){
    const angle=(heading-90)*Math.PI/180;
    const ex=cx+Math.cos(angle)*radius*.76, ey=cy+Math.sin(angle)*radius*.76;
    ctx.strokeStyle="#BD8B13"; ctx.lineWidth=4; ctx.lineCap="round";
    ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(ex,ey); ctx.stroke();
    ctx.fillStyle="#18211b"; ctx.font="800 14px system-ui";
    ctx.fillText(compassDirection(heading),cx,cy+2);
    ctx.font="700 11px system-ui"; ctx.fillText(`${heading.toFixed(0)}°`,cx,cy+19);
  }
  ctx.fillStyle="#778078"; ctx.font="10px system-ui";
  ctx.fillText("magnetic heading",cx,181);

  // Cartoon head orientation relative to participant-specific baseline.
  const o=cards[2], ocx=o.x+cardW/2, ocy=91;

  if(orientation){
    drawCartoonHead(ctx, ocx, ocy, orientation.yawDelta, orientation.pitchDelta);

    const yawText = relativeDirectionText(orientation.yawDelta, "Left", "Right");
    const pitchText = relativeDirectionText(orientation.pitchDelta, "Up", "Down");

    ctx.fillStyle="#18211b"; ctx.font="800 13px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(yawText,ocx,145);
    ctx.fillText(pitchText,ocx,163);

    ctx.fillStyle="#778078"; ctx.font="10px system-ui";
    ctx.fillText("relative to screen-facing baseline",ocx,184);
  } else {
    drawCartoonHead(ctx, ocx, ocy, 0, 0);
    ctx.fillStyle="#778078"; ctx.font="11px system-ui"; ctx.textAlign="center";
    ctx.fillText("No orientation data",ocx,154);
  }
}

function relativeDirectionText(value, negativeLabel, positiveLabel){
  if(!Number.isFinite(value)) return "—";
  const degrees=Math.abs(value);
  if(degrees < 2) return `0° ${negativeLabel}/${positiveLabel}`;
  return `${degrees.toFixed(0)}° ${value < 0 ? negativeLabel : positiveLabel}`;
}

function drawCartoonHead(ctx,cx,cy,yawDeg,pitchDeg){
  const yaw=Math.max(-90,Math.min(90,yawDeg));
  const pitch=Math.max(-45,Math.min(45,pitchDeg));
  const yn=yaw/90;
  const pn=pitch/45;
  const turn=Math.abs(yn);
  const side=yn>=0?1:-1;

  // More polished face inspired by the approved profile illustration:
  // rounded head, hair cap, visible near ear, eye/brow, curved coral nose.
  const rx=40*(1-0.28*turn);
  const ry=48*(1-0.06*Math.abs(pn));
  const featureX=cx+yn*rx*0.42;
  const featureY=cy+pn*10;

  ctx.save();
  ctx.lineCap="round";
  ctx.lineJoin="round";

  // Head
  ctx.fillStyle="#fbfbfa";
  ctx.strokeStyle="#555b57";
  ctx.lineWidth=2.6;
  ctx.beginPath();
  ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);
  ctx.fill();
  ctx.stroke();

  // Hair intentionally omitted for a cleaner sensor-style head.

  // Ears: keep both at frontal views; progressively hide the far ear.
  const nearEarX=cx+side*(rx+2);
  const farEarX=cx-side*(rx+2);
  ctx.strokeStyle="#686d69";
  ctx.lineWidth=2.2;

  ctx.globalAlpha=0.95;
  ctx.beginPath();
  ctx.ellipse(nearEarX,cy+2,6.5,12,0,0,Math.PI*2);
  ctx.stroke();

  ctx.globalAlpha=Math.max(.08,1-turn*1.18);
  ctx.beginPath();
  ctx.ellipse(farEarX,cy+2,6.5,12,0,0,Math.PI*2);
  ctx.stroke();
  ctx.globalAlpha=1;

  // Eye spacing compresses with yaw; far eye fades toward profile.
  const eyeSep=12*(1-.64*turn);
  const eyeY=featureY-8;
  const nearEyeX=featureX+side*eyeSep;
  const farEyeX=featureX-side*eyeSep;

  ctx.fillStyle="#4e5450";
  ctx.globalAlpha=1;
  ctx.beginPath();ctx.ellipse(nearEyeX,eyeY,3.2,4.2,0,0,Math.PI*2);ctx.fill();

  ctx.globalAlpha=Math.max(0,1-turn*1.15);
  ctx.beginPath();ctx.ellipse(farEyeX,eyeY,3.2,4.2,0,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha=1;

  // Brows
  ctx.strokeStyle="#555b57";
  ctx.lineWidth=2.4;
  ctx.beginPath();
  ctx.moveTo(nearEyeX-side*6,eyeY-9);
  ctx.quadraticCurveTo(nearEyeX,eyeY-13,nearEyeX+side*6,eyeY-10);
  ctx.stroke();

  ctx.globalAlpha=Math.max(0,1-turn*1.15);
  ctx.beginPath();
  ctx.moveTo(farEyeX+side*6,eyeY-9);
  ctx.quadraticCurveTo(farEyeX,eyeY-13,farEyeX-side*6,eyeY-10);
  ctx.stroke();
  ctx.globalAlpha=1;

  // Curved coral nose. As yaw approaches 90°, the tip reaches the face edge
  // and the nose becomes a clear profile rather than a straight stick.
  const noseRootX=featureX+side*2;
  const noseRootY=featureY-3;
  const noseTipX=cx+side*rx*(0.28+0.72*turn);
  const noseTipY=featureY+5+pn*3;
  ctx.strokeStyle="#BD8B13";
  ctx.lineWidth=3.2;
  ctx.beginPath();
  ctx.moveTo(noseRootX,noseRootY-8);
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

  // Mouth follows the visible side of the face.
  const mouthX=featureX+side*3*turn;
  const mouthY=featureY+18;
  ctx.strokeStyle="#555b57";
  ctx.lineWidth=2.2;
  ctx.beginPath();
  ctx.moveTo(mouthX-side*8*(1-.35*turn),mouthY);
  ctx.quadraticCurveTo(mouthX,mouthY+5,mouthX+side*9*(1-.15*turn),mouthY-1);
  ctx.stroke();

  // Small chin/profile cue at strong yaw.
  if(turn>.55){
    ctx.globalAlpha=(turn-.55)/.45;
    ctx.strokeStyle="#686d69";
    ctx.lineWidth=1.7;
    ctx.beginPath();
    ctx.moveTo(cx+side*rx*.58,cy+ry*.55);
    ctx.quadraticCurveTo(cx+side*rx*.78,cy+ry*.67,cx+side*rx*.54,cy+ry*.78);
    ctx.stroke();
    ctx.globalAlpha=1;
  }

  ctx.restore();
}


function roundRect(ctx,x,y,w,h,r) {
  const rr=Math.min(r,Math.abs(w)/2,Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
}

function magneticHeading(row) {
  if (!row) return null;
  const mx = asNumber(row["Magnetometer X"]);
  const my = asNumber(row["Magnetometer Y"]);
  if (mx === null || my === null) return null;
  let deg = Math.atan2(my, mx) * 180 / Math.PI;
  deg = (deg + 360) % 360;
  return deg;
}

function compassDirection(deg) {
  if (!Number.isFinite(deg)) return "—";
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function magneticHeadingLabel(row) {
  const deg = magneticHeading(row);
  return deg === null ? "—" : `${compassDirection(deg)} ${deg.toFixed(0)}°`;
}

function movementSnapshotValue(rows,time) {
  const value = movementMagnitude(rows,time);
  return value === null ? "—" : `${movementLabel(value)} (${value.toFixed(3)})`;
}

function tiltSnapshotValue(row) {
  const tilt = gravityTilt(row);
  return tilt ? `P ${tilt.pitch.toFixed(0)}° · R ${tilt.roll.toFixed(0)}°` : "—";
}


function drawHeadingChart(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;
  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const row = nearestRow(chart.rawRows, state.currentTime);
  const heading = magneticHeading(row);

  const cx = w / 2, cy = h / 2;
  const radius = Math.min(w, h) * 0.34;

  ctx.strokeStyle = "#c9cfcc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI*2);
  ctx.stroke();

  ctx.font = "700 13px system-ui";
  ctx.fillStyle = "#626a66";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("N", cx, cy-radius-14);
  ctx.fillText("S", cx, cy+radius+14);
  ctx.fillText("W", cx-radius-16, cy);
  ctx.fillText("E", cx+radius+16, cy);

  if (heading !== null) {
    // atan2(my,mx): 0° at +X. Rotate visualization so 0° displays at North.
    const angle = (heading - 90) * Math.PI / 180;
    const ex = cx + Math.cos(angle) * radius * .78;
    const ey = cy + Math.sin(angle) * radius * .78;

    ctx.strokeStyle = "#BD8B13";
    ctx.fillStyle = "#BD8B13";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.lineTo(ex,ey);
    ctx.stroke();

    // arrow head
    ctx.save();
    ctx.translate(ex,ey);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(8,0);
    ctx.lineTo(-7,-6);
    ctx.lineTo(-7,6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#18211b";
    ctx.font = "750 18px system-ui";
    ctx.fillText(`${compassDirection(heading)} · ${heading.toFixed(0)}°`, cx, cy);
  } else {
    ctx.fillStyle = "#667068";
    ctx.fillText("No heading data", cx, cy);
  }
}


function wirelessColor(value){
  if(value === null || !Number.isFinite(value)) return "#9aa09c";
  if(value >= 0.999) return "#154734";
  if(value <= 0) return "#9aa09c";
  if(value <= 1/3) return "#b23a2b";
  if(value <= 2/3) return "#d97a2b";
  return "#7fa66a";
}

function wirelessLabel(value){
  if(value === null || !Number.isFinite(value)) return "No data";
  if(value >= 0.999) return "Good";
  if(value <= 0) return "No signal";
  if(value <= 1/3) return "Poor";
  if(value <= 2/3) return "Reduced";
  return "Good";
}

function drawWirelessStatus(chart){
  const canvas=el(`chart-${chart.id}`);
  if(!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const margin={l:54,r:15,t:18,b:30};
  const pw=w-margin.l-margin.r;
  const [t0,t1]=state.domain;
  const x=t=>margin.l+((t-t0)/(t1-t0))*pw;

  const barH=22;
  const barY=Math.max(margin.t, Math.round((h-margin.b-barH)/2));

  drawBackgroundBands(ctx,margin.l,barY,pw,barH,x);

  const rows=chart.rawRows.filter(r=>r._t>=t0-2 && r._t<=t1+2);
  for(let i=0;i<rows.length;i++){
    const row=rows[i];
    const nextT=i+1<rows.length?rows[i+1]._t:row._t+0.5;
    const x1=Math.max(margin.l,x(row._t));
    const x2=Math.min(margin.l+pw,x(nextT));
    if(x2<=x1) continue;
    const value=asNumber(row["Wireless Signal"]);
    ctx.fillStyle=wirelessColor(value);
    ctx.fillRect(x1,barY,Math.max(1,x2-x1+0.5),barH);
  }

  ctx.strokeStyle="#c9cfcc";
  ctx.lineWidth=1;
  ctx.strokeRect(margin.l,barY,pw,barH);

  const current=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  const value=current?asNumber(current["Wireless Signal"]):null;

  ctx.fillStyle="#6f7771";
  ctx.font="11px system-ui";
  ctx.textAlign="right";
  ctx.textBaseline="middle";
  ctx.fillText("Wireless",margin.l-8,barY+barH/2);

  ctx.fillStyle=wirelessColor(value);
  ctx.beginPath();
  ctx.arc(margin.l+8,10,4.5,0,Math.PI*2);
  ctx.fill();

  ctx.fillStyle="#18211b";
  ctx.font="700 11px system-ui";
  ctx.textAlign="left";
  ctx.textBaseline="middle";
  ctx.fillText(`${wirelessLabel(value)}${value===null?"":` · ${value.toFixed(2)}`}`,margin.l+17,10);

  ctx.fillStyle="#a8a8a8";
  ctx.font="11px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  for(let i=0;i<=4;i++){
    const xx=margin.l+pw*i/4;
    const tt=t0+(t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt),xx,barY+barH+6);
  }

  const cursorX=x(state.currentTime);
  if(cursorX>=margin.l && cursorX<=margin.l+pw){
    ctx.strokeStyle="#BD8B13";
    ctx.lineWidth=2;
    ctx.beginPath();
    ctx.moveTo(cursorX,barY-4);
    ctx.lineTo(cursorX,barY+barH+4);
    ctx.stroke();

    ctx.strokeStyle="#18211b";
    ctx.lineWidth=1.5;
    ctx.strokeRect(cursorX-3,barY-2,6,barH+4);
  }
}


function qualityColor(value) {
  const colors = ["#969b98","#d32f2f","#f57c00","#9bd47f","#154734"];
  const i = Math.max(0, Math.min(4, Math.round(value)));
  return colors[i];
}

function drawQualityLanes(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;

  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const insetW=chartInsetWidth(chart,w);
  const insetGap=insetW?14:0;
  const margin = {l:54+insetW+insetGap,r:15,t:12,b:26};
  const pw = w-margin.l-margin.r, ph = h-margin.t-margin.b;
  const [t0,t1] = state.domain;
  const x = t => margin.l + ((t-t0)/(t1-t0))*pw;
  const labels = chart.sensorLabels || chart.keys;
  const laneH = ph / chart.keys.length;

  if(insetW) drawChartInset(chart,ctx,8,margin.t,insetW-8,ph);
  drawBackgroundBands(ctx, margin.l, margin.t, pw, ph, x);

  ctx.font = "11px system-ui";
  ctx.textBaseline = "middle";

  chart.keys.forEach((key, laneIndex) => {
    const y0 = margin.t + laneIndex * laneH;
    const centerY = y0 + laneH/2;

    ctx.fillStyle = "#a8a8a8";
    ctx.textAlign = "right";
    ctx.fillText(labels[laneIndex], margin.l - 8, centerY);

    ctx.strokeStyle = "#686868";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.l, y0 + laneH);
    ctx.lineTo(margin.l + pw, y0 + laneH);
    ctx.stroke();
  });

  const rows = chart.rawRows.filter(r => r._t >= t0 - 2 && r._t <= t1 + 2);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nextT = i + 1 < rows.length ? rows[i+1]._t : row._t + 0.5;
    const x1 = Math.max(margin.l, x(row._t));
    const x2 = Math.min(margin.l + pw, x(nextT));
    if (x2 <= x1) continue;

    chart.keys.forEach((key, laneIndex) => {
      const value = asNumber(row[key]);
      if (value === null) return;
      const y0 = margin.t + laneIndex * laneH + 3;
      const rounded = Math.max(0, Math.min(4, Math.round(value)));
      ctx.fillStyle = state.visibleQualityValues[rounded] === false ? "#ffffff" : qualityColor(value);
      ctx.fillRect(x1, y0, Math.max(1, x2-x1+0.5), Math.max(3, laneH-6));
    });
  }

  ctx.fillStyle = "#a8a8a8";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i=0;i<=4;i++) {
    const xx = margin.l + pw*i/4;
    const tt = t0 + (t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt), xx, margin.t+ph+6);
  }

  const cursorX = x(state.currentTime);
  if (cursorX >= margin.l && cursorX <= margin.l + pw) {
    ctx.strokeStyle = "#BD8B13";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, margin.t);
    ctx.lineTo(cursorX, margin.t+ph);
    ctx.stroke();
  }
}


function drawQualityBars(chart) {
  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;
  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const margin = {l:52,r:15,t:12,b:26};
  const pw = w-margin.l-margin.r, ph = h-margin.t-margin.b;
  const [t0,t1] = state.domain;
  const x = t => margin.l + ((t-t0)/(t1-t0))*pw;
  const y = v => margin.t + ph - (Math.max(0, Math.min(4, v))/4)*ph;

  drawBackgroundBands(ctx, margin.l, margin.t, pw, ph, x);

  ctx.strokeStyle = "#d7dcda";
  ctx.fillStyle = "#778078";
  ctx.font = "11px system-ui";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (let value=0; value<=4; value++) {
    const yy = y(value);
    ctx.beginPath();
    ctx.moveTo(margin.l,yy);
    ctx.lineTo(margin.l+pw,yy);
    ctx.stroke();
    ctx.fillText(String(value), margin.l-7, yy);
  }

  const rows = chart.rows.filter(r => r._t >= t0 && r._t <= t1);
  const keys = chart.keys;
  const groupWidth = Math.max(1, pw / Math.max(rows.length, 1));
  const barWidth = Math.max(1, Math.min(5, groupWidth / Math.max(keys.length,1)));

  rows.forEach(row => {
    const baseX = x(row._t);
    keys.forEach((key,ki) => {
      const v = asNumber(row[key]);
      if (v === null) return;
      const yy = y(v);
      ctx.fillStyle = qualityColor(v);
      const offset = (ki - (keys.length-1)/2) * barWidth;
      ctx.fillRect(baseX + offset, yy, barWidth, margin.t + ph - yy);
    });
  });

  ctx.fillStyle = "#778078";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i=0;i<=4;i++) {
    const xx = margin.l + pw*i/4;
    const tt = t0 + (t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt), xx, margin.t+ph+6);
  }

  const cursorX = x(state.currentTime);
  if (cursorX >= margin.l && cursorX <= margin.l + pw) {
    ctx.strokeStyle = "#BD8B13";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX, margin.t);
    ctx.lineTo(cursorX, margin.t+ph);
    ctx.stroke();
  }
}

function chartInsetWidth(chart,w){
  if(["affect","pad","eeg","deviceQuality"].includes(chart.id)) return Math.min(165, Math.max(125, w*0.12));
  return 0;
}

function drawChartInset(chart,ctx,x,y,w,h){
  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#d6ddd8";
  ctx.lineWidth=1.2;
  roundRect(ctx,x,y,w,h,10);
  ctx.fill();
  ctx.stroke();

  if(chart.id==="affect") drawAffectInset(chart,ctx,x,y,w,h);
  else if(chart.id==="pad") drawPADInset(chart,ctx,x,y,w,h);
  else if(chart.id==="eeg") drawEEGMapInset(chart,ctx,x,y,w,h);
  else if(chart.id==="deviceQuality") drawContactQualityInset(chart,ctx,x,y,w,h);
}

function currentValidAffect(chart){
  const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  if(!row) return [];
  return chart.keys.map((key,i)=>{
    const value=chartValue(chart,row,key);
    return {key,value,index:i,label:displaySeriesLabel(chart,key)};
  }).filter(d=>d.value!==null);
}

function drawAffectInset(chart,ctx,x,y,w,h){
  const vals=currentValidAffect(chart).filter(d=>d.value>=0.5).sort((a,b)=>b.value-a.value);
  const top=vals[0];

  ctx.fillStyle="#778078";
  ctx.font="700 10px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.fillText("CURRENT TOP",x+w/2,y+10);

  if(!top){
    ctx.fillStyle="#a8afaa";
    ctx.font="700 14px system-ui";
    ctx.textBaseline="middle";
    ctx.fillText("—",x+w/2,y+h/2);
    ctx.font="10px system-ui";
    ctx.textBaseline="bottom";
    ctx.fillText("none ≥ 0.50",x+w/2,y+h-10);
    return;
  }

  const color=COLORS[top.index%COLORS.length];
  const box=Math.min(58,w*.44);
  ctx.fillStyle=color;
  roundRect(ctx,x+(w-box)/2,y+34,box,box,9);
  ctx.fill();

  ctx.fillStyle="#18211b";
  ctx.font="800 13px system-ui";
  ctx.textBaseline="top";
  ctx.fillText(top.label,x+w/2,y+101);
  ctx.font="700 12px system-ui";
  ctx.fillText(top.value.toFixed(2),x+w/2,y+120);
}

function drawPADInset(chart,ctx,x,y,w,h){
  const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  const keys=["Pleasure","Arousal","Dominance"];
  const vals=keys.map(k=>row?asNumber(row[k]):null).map(v=>v===null?0:Math.max(-1,Math.min(1,v)));

  ctx.fillStyle="#778078";
  ctx.font="700 10px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.fillText("CURRENT PAD",x+w/2,y+9);

  const cx=x+w/2, cy=y+h*.55;
  const r=Math.min(w,h)*.28;
  const angles=[-Math.PI/2, -Math.PI/2+2*Math.PI/3, -Math.PI/2+4*Math.PI/3];

  // Radar reference triangle + zero-centered rings.
  ctx.strokeStyle="#d2d8d4";
  ctx.lineWidth=1;
  for(const scale of [0.5,1]){
    ctx.beginPath();
    angles.forEach((a,i)=>{
      const px=cx+Math.cos(a)*r*scale, py=cy+Math.sin(a)*r*scale;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    });
    ctx.closePath(); ctx.stroke();
  }
  ctx.strokeStyle="#e1e5e2";
  angles.forEach(a=>{
    ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+Math.cos(a)*r,cy+Math.sin(a)*r);ctx.stroke();
  });

  // Map -1..1 to 0..1 radial distance for compact display; labels retain signed value.
  ctx.fillStyle="rgba(21,71,52,.16)";
  ctx.strokeStyle="#154734";
  ctx.lineWidth=2;
  ctx.beginPath();
  vals.forEach((v,i)=>{
    const norm=(v+1)/2;
    const px=cx+Math.cos(angles[i])*r*norm, py=cy+Math.sin(angles[i])*r*norm;
    if(i===0)ctx.moveTo(px,py); else ctx.lineTo(px,py);
  });
  ctx.closePath();ctx.fill();ctx.stroke();

  ctx.fillStyle="#59625c";
  ctx.font="9px system-ui";
  ctx.textBaseline="middle";
  keys.forEach((k,i)=>{
    const a=angles[i];
    const tx=cx+Math.cos(a)*(r+15), ty=cy+Math.sin(a)*(r+12);
    ctx.fillText(k[0],tx,ty);
  });

  ctx.font="9px system-ui";
  ctx.textBaseline="bottom";
  ctx.fillText(`P ${vals[0].toFixed(2)} · A ${vals[1].toFixed(2)} · D ${vals[2].toFixed(2)}`,x+w/2,y+h-8);
}

function drawContactQualityInset(chart,ctx,x,y,w,h){
  const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
  const overall=row?asNumber(row["Overall Quality"]):null;

  ctx.fillStyle="#778078";
  ctx.font="700 10px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.fillText("OVERALL QUALITY",x+w/2,y+10);

  ctx.fillStyle="#154734";
  ctx.font="800 30px system-ui";
  ctx.textBaseline="middle";
  ctx.fillText(overall===null?"—":overall.toFixed(0),x+w/2,y+h*.47);

  ctx.fillStyle="#778078";
  ctx.font="10px system-ui";
  ctx.textBaseline="top";
  ctx.fillText("aggregate headset quality",x+w/2,y+h*.62);
  ctx.fillText("from EMOTIV device stream",x+w/2,y+h*.62+14);
}

function drawEEGMapInset(chart,ctx,x,y,w,h){
  ctx.fillStyle="#778078";
  ctx.font="700 10px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  ctx.fillText("INSIGHT SENSORS",x+w/2,y+9);

  const cx=x+w/2, cy=y+h*.56;
  const rx=Math.min(w*.34,48), ry=Math.min(h*.33,55);

  // top view of head, nose at top
  ctx.strokeStyle="#8c9690";
  ctx.lineWidth=2;
  ctx.beginPath();ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-6,cy-ry+1);ctx.lineTo(cx,cy-ry-8);ctx.lineTo(cx+6,cy-ry+1);ctx.stroke();

  const pts={
    AF3:[-.35,-.58],
    AF4:[ .35,-.58],
    T7 :[-.78,-.12],
    T8 :[ .78,-.12],
    Pz :[ 0,.62]
  };
  for(const [label,[px,py]] of Object.entries(pts)){
    const sx=cx+px*rx, sy=cy+py*ry;
    ctx.fillStyle="#154734";
    ctx.beginPath();ctx.arc(sx,sy,7,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#0c3829";ctx.lineWidth=1.5;ctx.stroke();
    ctx.fillStyle="#26302a";ctx.font="700 9px system-ui";ctx.textAlign="center";ctx.textBaseline="bottom";
    ctx.fillText(label,sx,sy-9);
  }

  // CMS/DRL reference location on Insight: near T7, shown only as a marker
  // because this recording does not expose a separate contact-quality value for it.
  const cmsX=cx-rx*.82, cmsY=cy+ry*.18;
  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#4f5752";
  ctx.lineWidth=2;
  ctx.beginPath();ctx.arc(cmsX,cmsY,6,0,Math.PI*2);ctx.fill();ctx.stroke();
  ctx.fillStyle="#4f5752";
  ctx.font="700 7px system-ui";
  ctx.textAlign="left";
  ctx.textBaseline="middle";
  ctx.fillText("CMS/DRL",cmsX+8,cmsY);
}

function drawChart(chart) {
  if (chart.type === "wirelessStatus") { drawWirelessStatus(chart); return; }
  if (chart.type === "motionSummary") { drawMotionSummary(chart); return; }
  if (chart.type === "faceGroup") { drawFaceGroup(chart); return; }
  if (chart.type === "faceCurrent") { drawFaceCurrent(chart); return; }
  if (chart.type === "faceLane") { drawFaceLane(chart); return; }
  if (chart.type === "heading") { drawHeadingChart(chart); return; }
  if (chart.type === "qualityLanes") { drawQualityLanes(chart); return; }
  if (chart.type === "qualityBars") { drawQualityBars(chart); return; }

  const canvas = el(`chart-${chart.id}`);
  if (!canvas) return;
  const {ctx,w,h} = setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const insetW=chartInsetWidth(chart,w);
  const insetGap=insetW?14:0;
  const leftBase=54;
  const margin = {l:leftBase+insetW+insetGap,r:15,t:12,b:26};
  const pw = w-margin.l-margin.r, ph = h-margin.t-margin.b;
  const [t0,t1] = state.domain;
  const x = t => margin.l + ((t-t0)/(t1-t0))*pw;
  const displayRows = processedChartRows(chart);
  const keys = visibleChartKeys(chart);
  const domainRows = displayRows.filter(r => r._t >= t0 && r._t <= t1);
  const [y0,y1] = computeYDomain(chart, domainRows);
  const y = v => margin.t + (1-(v-y0)/(y1-y0))*ph;

  if(insetW){
    drawChartInset(chart,ctx,8,margin.t,insetW-8,ph);
  }

  drawBackgroundBands(ctx, margin.l, margin.t, pw, ph, x);
  ctx.strokeStyle = "#686868"; ctx.lineWidth = 1;
  ctx.fillStyle = "#a8a8a8"; ctx.font = "11px system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const yTicks = chart.yTicks || Array.from({length:5}, (_,i) => y1-(y1-y0)*i/4);
  for (const value of yTicks) {
    const yy = y(value);
    ctx.beginPath(); ctx.moveTo(margin.l,yy); ctx.lineTo(margin.l+pw,yy); ctx.stroke();
    ctx.fillText(formatAxis(value), margin.l-7, yy);
  }
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let i=0;i<=4;i++) {
    const xx = margin.l + pw*i/4;
    const tt = t0 + (t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt), xx, margin.t+ph+6);
  }

  keys.forEach((key,ki) => {
    const originalIndex = chart.keys.indexOf(key);
    ctx.strokeStyle = COLORS[originalIndex % COLORS.length]; ctx.lineWidth = 1.35; ctx.globalAlpha = .92;
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
    ctx.strokeStyle="#BD8B13"; ctx.lineWidth=1.5;
    ctx.beginPath(); ctx.moveTo(cursorX,margin.t); ctx.lineTo(cursorX,margin.t+ph); ctx.stroke();
    const nr=nearestRow(displayRows,state.currentTime);
    keys.forEach((key,ki)=>{
      const v=nr?chartValue(chart,nr,key):null;
      const originalIndex = chart.keys.indexOf(key);
      if(v!==null && v>=y0 && v<=y1){ ctx.fillStyle=COLORS[originalIndex%COLORS.length]; ctx.beginPath(); ctx.arc(cursorX,y(v),3.2,0,Math.PI*2); ctx.fill(); }
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
  for(let i=0;i<state.trialGroups.length-1;i++){
    const a=state.trialGroups[i].end, b=state.trialGroups[i+1].start;
    const gx1=x(a), gx2=x(b);
    if(gx2>gx1){ ctx.fillStyle="#f2f2f2"; ctx.fillRect(gx1,top,gx2-gx1,ph); }
  }
  for(const g of state.trialGroups){
    const x1=Math.max(left,x(g.start)), x2=Math.min(left+pw,x(g.end));
    if(x2<=left||x1>=left+pw) continue;
    const active=state.currentTime>=g.start&&state.currentTime<=g.end;
    ctx.fillStyle=active?"rgba(255,147,100,.18)":"rgba(120,120,120,.62)"; ctx.fillRect(x1,top,Math.max(2,x2-x1),ph);
    ctx.fillStyle=active?"#3f3f3f":"#f5f5f5"; ctx.font="bold 11px system-ui"; ctx.textAlign="center"; ctx.textBaseline="middle";
    if(x2-x1>45) ctx.fillText(`Trial ${g.trial}`,(x1+x2)/2,top+ph/2);
    for(const m of g.moves){
      if(m._help){ const xx=x(m.start); if(xx>=left&&xx<=left+pw){ ctx.fillStyle="#f2763f"; ctx.fillRect(xx,top,2,ph); } }
    }
  }
  const cx=x(state.currentTime); ctx.strokeStyle="#BD8B13"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(cx,2); ctx.lineTo(cx,h-3); ctx.stroke();
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

function jumpMove(direction){
  if(!state.trials.length) return;
  stopPlayback();

  const anchors = [];
  for (const g of state.trialGroups) {
    for (const m of g.moves) {
      anchors.push({t:m.start, trial:g.trial, move:m._move});
    }
  }
  anchors.sort((a,b)=>a.t-b.t);

  let target = null;
  if(direction > 0) {
    target = anchors.find(a => a.t > state.currentTime + 0.05) || anchors[anchors.length-1];
  } else {
    target = [...anchors].reverse().find(a => a.t < state.currentTime - 0.05) || anchors[0];
  }

  state.currentTime = Math.max(state.domain[0], Math.min(state.domain[1], target.t));
  syncSliderFromTime();
  updateAll();
}

function escapeHTML(s){ return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }

el("loadParticipant").addEventListener("click",()=>loadParticipant(el("participantSelect").value));
el("participantSelect").addEventListener("change",()=>loadParticipant(el("participantSelect").value));
el("timeSlider").addEventListener("input",()=>{ stopPlayback(); state.currentTime=timeFromSlider(); updateAll(); });
el("playPause").addEventListener("click",togglePlayback);
el("prevTrial").addEventListener("click",()=>jumpTrial(-1));
el("nextTrial").addEventListener("click",()=>jumpTrial(1));
el("prevMove").addEventListener("click",()=>jumpMove(-1));
el("nextMove").addEventListener("click",()=>jumpMove(1));
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
