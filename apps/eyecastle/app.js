(() => {
  const root = document;
  const stage = root.getElementById("stage");
  const gazePoint = root.getElementById("gazePoint");
  const gazeTrail = root.getElementById("gazeTrail");
  const outline = root.getElementById("surfaceOutline");
  const slider = root.getElementById("timeSlider");
  const playPause = root.getElementById("playPause");
  const speedSelect = root.getElementById("speed");
  const invertY = root.getElementById("invertY");
  const showTrail = root.getElementById("showTrail");
  const confidenceFilter = root.getElementById("confidenceFilter");
  const minConfidence = root.getElementById("minConfidence");
  const status = root.getElementById("status");

  const stat = {
    sx: root.getElementById("sx"),
    sy: root.getElementById("sy"),
    confidence: root.getElementById("confidence"),
    step: root.getElementById("step"),
    sample: root.getElementById("sampleIndex"),
    time: root.getElementById("timeLabel"),
    duration: root.getElementById("durationLabel")
  };

  // Initial estimates from the experiment screenshot, expressed as image percentages.
  // They are intentionally editable; this is a starting calibration, not a claim of exactness.
  const DEFAULT_MARKERS = {
    tl: { x: 28.2, y: 15.3 },
    tr: { x: 61.5, y: 19.7 },
    bl: { x: 26.0, y: 43.0 },
    br: { x: 59.5, y: 47.2 }
  };
  let markers = structuredClone(DEFAULT_MARKERS);
  const markerEls = {
    tl: root.getElementById("markerTL"),
    tr: root.getElementById("markerTR"),
    bl: root.getElementById("markerBL"),
    br: root.getElementById("markerBR")
  };

  let rows = [];
  let startTs = 0;
  let endTs = 0;
  let duration = 0;
  let currentTime = 0;
  let playing = false;
  let lastAnimation = 0;
  let raf = 0;

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function fmtTime(sec) {
    sec = Math.max(0, sec || 0);
    const m = Math.floor(sec / 60);
    const s = sec - m * 60;
    return `${String(m).padStart(2,"0")}:${s.toFixed(3).padStart(6,"0")}`;
  }

  function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines.shift().split(",");
    const idx = Object.fromEntries(headers.map((h,i)=>[h.trim(),i]));
    return lines.map(line => {
      const p = line.split(",");
      return {
        localTimestamp: Number(p[idx.localTimestamp]),
        deviceTimestamp: Number(p[idx.deviceTimestamp]),
        step: (p[idx.step] || "").trim(),
        confidence: Number(p[idx.confidence]),
        surfaceX: Number(p[idx.surfaceX]),
        surfaceY: Number(p[idx.surfaceY]),
        imageX: Number(p[idx.imageX]),
        imageY: Number(p[idx.imageY])
      };
    }).filter(r =>
      Number.isFinite(r.deviceTimestamp) &&
      Number.isFinite(r.surfaceX) &&
      Number.isFinite(r.surfaceY)
    );
  }

  function renderMarkerInputs() {
    const box = root.getElementById("markerInputs");
    box.innerHTML = "";
    ["tl","tr","bl","br"].forEach(k => {
      const row = document.createElement("div");
      row.className = "marker-row";
      row.innerHTML = `<strong>${k.toUpperCase()}</strong>
        <label>X %<input type="number" min="0" max="100" step="0.1" data-k="${k}" data-axis="x"></label>
        <label>Y %<input type="number" min="0" max="100" step="0.1" data-k="${k}" data-axis="y"></label>`;
      box.appendChild(row);
    });
    box.querySelectorAll("input").forEach(input => {
      input.addEventListener("input", () => {
        const k = input.dataset.k, axis = input.dataset.axis;
        const n = Number(input.value);
        if (Number.isFinite(n)) {
          markers[k][axis] = clamp(n, 0, 100);
          renderMarkers();
          renderAt(currentTime);
        }
      });
    });
    syncMarkerInputs();
  }

  function syncMarkerInputs() {
    root.querySelectorAll("#markerInputs input").forEach(input => {
      const k = input.dataset.k, axis = input.dataset.axis;
      input.value = markers[k][axis].toFixed(1);
    });
  }

  function renderMarkers() {
    Object.entries(markerEls).forEach(([k,el]) => {
      el.style.left = markers[k].x + "%";
      el.style.top = markers[k].y + "%";
    });
    outline.innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="${markers.tl.x},${markers.tl.y} ${markers.tr.x},${markers.tr.y} ${markers.br.x},${markers.br.y} ${markers.bl.x},${markers.bl.y}"
        fill="rgba(242,201,76,.035)" stroke="rgba(242,201,76,.75)" stroke-width=".35" vector-effect="non-scaling-stroke"/>
    </svg>`;
    syncMarkerInputs();
  }

  function beginDrag(el, ev) {
    ev.preventDefault();
    const key = el.dataset.marker;
    el.setPointerCapture(ev.pointerId);
    const move = e => {
      const r = stage.getBoundingClientRect();
      markers[key].x = clamp(((e.clientX-r.left)/r.width)*100, 0, 100);
      markers[key].y = clamp(((e.clientY-r.top)/r.height)*100, 0, 100);
      renderMarkers();
      renderAt(currentTime);
    };
    const end = e => {
      el.releasePointerCapture(e.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", end);
      el.removeEventListener("pointercancel", end);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  // Solve an 8x8 linear system (Gaussian elimination) for a homography
  // mapping normalized surface coordinates (u,v) to stage percentages (x,y).
  function solve(A, b) {
    const n = b.length;
    const M = A.map((row,i)=>row.concat([b[i]]));
    for (let col=0; col<n; col++) {
      let pivot = col;
      for (let r=col+1; r<n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      [M[col],M[pivot]] = [M[pivot],M[col]];
      const div = M[col][col];
      if (Math.abs(div) < 1e-10) return null;
      for (let c=col; c<=n; c++) M[col][c] /= div;
      for (let r=0; r<n; r++) {
        if (r===col) continue;
        const f = M[r][col];
        for (let c=col; c<=n; c++) M[r][c] -= f*M[col][c];
      }
    }
    return M.map(row=>row[n]);
  }

  function homography() {
    // Surface coordinates use bottom-left origin conceptually when invertY is checked.
    const dst = [markers.bl, markers.br, markers.tr, markers.tl];
    const src = [[0,0],[1,0],[1,1],[0,1]];
    const A=[], b=[];
    for (let i=0;i<4;i++) {
      const [u,v]=src[i], {x,y}=dst[i];
      A.push([u,v,1,0,0,0,-u*x,-v*x]); b.push(x);
      A.push([0,0,0,u,v,1,-u*y,-v*y]); b.push(y);
    }
    const h = solve(A,b);
    if (!h) return null;
    return [h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
  }

  function mapSurface(u,v) {
    if (!invertY.checked) v = 1-v;
    const H = homography();
    if (!H) return {x:50,y:50};
    const d = H[6]*u + H[7]*v + H[8];
    return {
      x:(H[0]*u + H[1]*v + H[2])/d,
      y:(H[3]*u + H[4]*v + H[5])/d
    };
  }

  function nearestIndex(ts) {
    let lo=0, hi=rows.length-1;
    while (lo<hi) {
      const mid=(lo+hi)>>1;
      if (rows[mid].deviceTimestamp < ts) lo=mid+1; else hi=mid;
    }
    if (lo>0 && Math.abs(rows[lo-1].deviceTimestamp-ts) < Math.abs(rows[lo].deviceTimestamp-ts)) return lo-1;
    return lo;
  }

  function renderTrail(index) {
    gazeTrail.innerHTML = "";
    if (!showTrail.checked) return;
    const count = 35;
    const start = Math.max(0,index-count);
    for (let i=start;i<index;i+=3) {
      const r = rows[i];
      if (confidenceFilter.checked && r.confidence < Number(minConfidence.value)) continue;
      const p = mapSurface(r.surfaceX, r.surfaceY);
      const d = document.createElement("i");
      d.className = "trail-dot";
      const age = (i-start)/Math.max(1,index-start);
      d.style.opacity = String(0.15 + age*.65);
      d.style.left = p.x+"%";
      d.style.top = p.y+"%";
      gazeTrail.appendChild(d);
    }
  }

  function renderAt(sec) {
    if (!rows.length) return;
    currentTime = clamp(sec,0,duration);
    slider.value = String(Math.round((currentTime/duration)*1000));
    stat.time.textContent = fmtTime(currentTime);

    const ts = startTs + currentTime;
    const i = nearestIndex(ts);
    const r = rows[i];
    const p = mapSurface(r.surfaceX, r.surfaceY);
    const hide = confidenceFilter.checked && r.confidence < Number(minConfidence.value);
    gazePoint.style.display = hide ? "none" : "block";
    gazePoint.style.left = p.x + "%";
    gazePoint.style.top = p.y + "%";

    stat.sx.textContent = r.surfaceX.toFixed(4);
    stat.sy.textContent = r.surfaceY.toFixed(4);
    stat.confidence.textContent = r.confidence.toFixed(3);
    stat.step.textContent = r.step || "—";
    stat.sample.textContent = `${i+1} / ${rows.length}`;
    renderTrail(i);
  }

  function animation(now) {
    if (!playing) return;
    if (!lastAnimation) lastAnimation=now;
    const dt=(now-lastAnimation)/1000;
    lastAnimation=now;
    const speed=Number(speedSelect.value)||1;
    const next=currentTime+dt*speed;
    if (next>=duration) {
      renderAt(duration);
      stop();
      return;
    }
    renderAt(next);
    raf=requestAnimationFrame(animation);
  }
  function play() {
    if (!rows.length) return;
    if (currentTime >= duration) currentTime=0;
    playing=true; lastAnimation=0;
    playPause.textContent="❚❚";
    playPause.setAttribute("aria-label","Pause gaze data");
    raf=requestAnimationFrame(animation);
  }
  function stop() {
    playing=false;
    cancelAnimationFrame(raf);
    playPause.textContent="▶";
    playPause.setAttribute("aria-label","Play gaze data");
  }

  playPause.addEventListener("click",()=> playing ? stop() : play());
  slider.addEventListener("input",()=> {
    stop();
    renderAt((Number(slider.value)/1000)*duration);
  });
  [invertY,showTrail,confidenceFilter,minConfidence].forEach(el => el.addEventListener("input",()=>renderAt(currentTime)));
  Object.values(markerEls).forEach(el => el.addEventListener("pointerdown", ev => beginDrag(el,ev)));

  root.getElementById("resetMarkers").addEventListener("click",()=> {
    markers=structuredClone(DEFAULT_MARKERS);
    renderMarkers();
    renderAt(currentTime);
  });

  root.getElementById("exportConfig").addEventListener("click",()=> {
    const payload = {
      image: "assets/facade.png",
      markerPositionsPercent: markers,
      invertSurfaceY: invertY.checked,
      note: "Marker centers are user-adjusted reference points for mapping normalized Pupil Surface coordinates to the facade image."
    };
    const blob = new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="P03-surface-marker-config.json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),500);
  });

  renderMarkerInputs();
  renderMarkers();

  fetch("data/P03-gaze.csv")
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      rows=parseCSV(text);
      if (!rows.length) throw new Error("No valid gaze rows");
      rows.sort((a,b)=>a.deviceTimestamp-b.deviceTimestamp);
      startTs=rows[0].deviceTimestamp;
      endTs=rows[rows.length-1].deviceTimestamp;
      duration=endTs-startTs;
      stat.duration.textContent=fmtTime(duration);
      status.textContent=`P03 · ${rows.length.toLocaleString()} gaze samples · ${fmtTime(duration)}`;
      renderAt(0);
    })
    .catch(err => {
      status.textContent="Could not load gaze CSV";
      console.error(err);
    });
})();
