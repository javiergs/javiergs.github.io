(() => {
  const $ = id => document.getElementById(id);
  const stage = $("stage"), slider = $("timeSlider"), heatmap = $("heatmap"), heatCtx = heatmap.getContext("2d");
  const gazePoint = $("gazePoint"), gazeTrail = $("gazeTrail"), stimulusOverlay = $("stimulusOverlay"), outline = $("surfaceOutline");
  const status = $("status"), syncOffsetInput = $("syncOffset"), overlayMode = $("overlayMode");
  const showTrail = $("showTrail"), showStimulus = $("showStimulus"), showHeatmap = $("showHeatmap"), showSurface = $("showSurface"), confidenceFilter = $("confidenceFilter"), minConfidence = $("minConfidence");

  const DEFAULT_MARKERS = {
    tl:{x:8.9,y:12.2}, tr:{x:89.3,y:12.2}, bl:{x:8.9,y:92.5}, br:{x:89.3,y:92.5}
  };
  let markers = structuredClone(DEFAULT_MARKERS);
  const markerEls = {tl:$("markerTL"),tr:$("markerTR"),bl:$("markerBL"),br:$("markerBR")};

  let gaze=[], fixations=[], stimuli={duration:259,events:[]};
  let recordingZero=0, recordingStartSec=0, recordingEndSec=0, sessionTime=0, playing=false, raf=0, lastAnimation=0;
  let sessionDuration=0;
  let currentGazeIndex=-1;

  const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
  const fmt=s=>{s=Math.max(0,Number(s)||0);const m=Math.floor(s/60),ss=s-m*60;return `${String(m).padStart(2,"0")}:${ss.toFixed(1).padStart(4,"0")}`};

  function splitCSVLine(line){
    const out=[]; let cur="", q=false;
    for(let i=0;i<line.length;i++){
      const c=line[i];
      if(c==='"') { if(q && line[i+1]==='"'){cur+='"';i++;} else q=!q; }
      else if(c===',' && !q){out.push(cur);cur="";} else cur+=c;
    }
    out.push(cur); return out;
  }
  function parseCSV(text){
    const lines=text.trim().split(/\r?\n/), headers=splitCSVLine(lines.shift()).map(s=>s.trim());
    return {headers, rows:lines.map(splitCSVLine)};
  }
  function parseGaze(text){
    const {headers,rows}=parseCSV(text), idx=Object.fromEntries(headers.map((h,i)=>[h,i]));
    return rows.map(p=>({
      localTimestamp:+p[idx.localTimestamp], deviceTimestamp:+p[idx.deviceTimestamp], step:(p[idx.step]||"").trim(),
      confidence:+p[idx.confidence], surfaceX:+p[idx.surfaceX], surfaceY:+p[idx.surfaceY], imageX:+p[idx.imageX], imageY:+p[idx.imageY]
    })).filter(r=>Number.isFinite(r.deviceTimestamp)&&Number.isFinite(r.surfaceX)&&Number.isFinite(r.surfaceY)).sort((a,b)=>a.deviceTimestamp-b.deviceTimestamp);
  }
  function parseFixations(text){
    const {headers,rows}=parseCSV(text), idx=Object.fromEntries(headers.map((h,i)=>[h,i]));
    return rows.map(p=>({id:+p[idx.id],start:+p[idx.start_timestamp],durationMs:+p[idx.duration],confidence:+p[idx.confidence]}))
      .filter(r=>Number.isFinite(r.start)).sort((a,b)=>a.start-b.start);
  }

  function solve(A,b){
    const n=b.length,M=A.map((r,i)=>r.concat([b[i]]));
    for(let c=0;c<n;c++){
      let p=c; for(let r=c+1;r<n;r++) if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
      [M[c],M[p]]=[M[p],M[c]]; const d=M[c][c]; if(Math.abs(d)<1e-10)return null;
      for(let j=c;j<=n;j++)M[c][j]/=d;
      for(let r=0;r<n;r++){if(r===c)continue;const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j];}
    }
    return M.map(r=>r[n]);
  }
  function homography(){
    const dst=[markers.bl,markers.br,markers.tr,markers.tl],src=[[0,0],[1,0],[1,1],[0,1]],A=[],b=[];
    for(let i=0;i<4;i++){const [u,v]=src[i],{x,y}=dst[i];A.push([u,v,1,0,0,0,-u*x,-v*x]);b.push(x);A.push([0,0,0,u,v,1,-u*y,-v*y]);b.push(y);}
    const h=solve(A,b); return h?[h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1]:null;
  }
  function mapSurface(u,v){
    const H=homography(); if(!H)return{x:50,y:50};
    const vv=1-v,d=H[6]*u+H[7]*vv+H[8];
    return{x:(H[0]*u+H[1]*vv+H[2])/d,y:(H[3]*u+H[4]*vv+H[5])/d};
  }

  function renderMarkers(){
    for(const [k,el] of Object.entries(markerEls)){el.style.left=markers[k].x+"%";el.style.top=markers[k].y+"%";}
    outline.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${markers.tl.x},${markers.tl.y} ${markers.tr.x},${markers.tr.y} ${markers.br.x},${markers.br.y} ${markers.bl.x},${markers.bl.y}" fill="rgba(242,201,76,.03)" stroke="rgba(242,201,76,.85)" stroke-width=".35" vector-effect="non-scaling-stroke"/></svg>`;
    document.querySelectorAll("#markerInputs input").forEach(i=>i.value=markers[i.dataset.k][i.dataset.axis].toFixed(1));
  }
  function renderMarkerInputs(){
    const box=$("markerInputs"); box.innerHTML="";
    for(const k of ["tl","tr","bl","br"]){
      const row=document.createElement("div");row.className="marker-row";row.innerHTML=`<strong>${k.toUpperCase()}</strong><label>X %<input type="number" data-k="${k}" data-axis="x" step="0.1"></label><label>Y %<input type="number" data-k="${k}" data-axis="y" step="0.1"></label>`;box.appendChild(row);
    }
    box.querySelectorAll("input").forEach(i=>i.addEventListener("input",()=>{const n=+i.value;if(Number.isFinite(n)){markers[i.dataset.k][i.dataset.axis]=clamp(n,0,100);renderMarkers();renderAt(sessionTime);}}));
    renderMarkers();
  }
  function beginDrag(el,ev){
    ev.preventDefault(); const k=el.dataset.marker; el.setPointerCapture(ev.pointerId);
    const move=e=>{const r=stage.getBoundingClientRect();markers[k].x=clamp((e.clientX-r.left)/r.width*100,0,100);markers[k].y=clamp((e.clientY-r.top)/r.height*100,0,100);renderMarkers();renderAt(sessionTime)};
    const end=e=>{el.releasePointerCapture(e.pointerId);el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",end);el.removeEventListener("pointercancel",end)};
    el.addEventListener("pointermove",move);el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
  }

  function videoStartOnSession(){ return +syncOffsetInput.value || 0; }
  function videoTimeFromSession(t){ return t - videoStartOnSession(); }
  function activeEvent(t){return stimuli.events.find(e=>t>=e.start&&t<e.end)||null;}
  function shapeContains(shape,p){
    if(shape.type==="rect")return p.x>=shape.x&&p.x<=shape.x+shape.w&&p.y>=shape.y&&p.y<=shape.y+shape.h;
    if(shape.type==="ellipse")return ((p.x-shape.cx)/shape.rx)**2+((p.y-shape.cy)/shape.ry)**2<=1;
    return false;
  }
  function eventContains(event,p){return event.shapes?.some(s=>shapeContains(s,p));}
  function renderStimulus(t){
    const e=activeEvent(t); $("activeStimulus").textContent=e?e.label:"None"; $("stimulusBadge").textContent=e?e.label:"No active stimulus";
    stimulusOverlay.innerHTML="";
    document.querySelectorAll(".stimulus-segment").forEach(b=>b.classList.toggle("active",e&&b.dataset.id===e.id));
    if(!e||!showStimulus.checked)return;
    for(const s of e.shapes||[]){
      const ns="http://www.w3.org/2000/svg",el=document.createElementNS(ns,s.type==="ellipse"?"ellipse":"rect");
      if(s.type==="rect"){el.setAttribute("x",s.x);el.setAttribute("y",s.y);el.setAttribute("width",s.w);el.setAttribute("height",s.h)}
      else{el.setAttribute("cx",s.cx);el.setAttribute("cy",s.cy);el.setAttribute("rx",s.rx);el.setAttribute("ry",s.ry)}
      el.setAttribute("class","aoi aoi-pulse");stimulusOverlay.appendChild(el);
    }
  }
  function recomputeSessionDuration(){
    const videoStart=videoStartOnSession();
    sessionDuration=Math.max(recordingEndSec, videoStart+stimuli.duration, 0);
    slider.max=Math.round(sessionDuration*10);
    $("durationLabel").textContent=fmt(sessionDuration);
  }

  function renderStimulusTrack(){
    const track=$("stimulusTrack");
    track.innerHTML="";
    recomputeSessionDuration();
    if(!sessionDuration)return;
    const videoStart=videoStartOnSession();
    const videoEnd=videoStart+stimuli.duration;

    const window=document.createElement("div");
    window.className="video-window";
    window.style.left=(videoStart/sessionDuration*100)+"%";
    window.style.width=(stimuli.duration/sessionDuration*100)+"%";
    window.title=`Stimulus video: ${fmt(videoStart)}–${fmt(videoEnd)} on synchronized timeline`;
    track.appendChild(window);

    stimuli.events.forEach((e,idx)=>{
      const n=idx+1,b=document.createElement("button");
      b.className="stimulus-segment"+(e.syncAnchor?" anchor":"");
      b.dataset.id=e.id;
      b.title=`${n}. ${e.label}: video ${fmt(e.start)}–${fmt(e.end)} · synchronized ${fmt(videoStart+e.start)}–${fmt(videoStart+e.end)}${e.syncAnchor?" · primary synchronization anchor":""}`;
      b.textContent=String(n);
      b.style.left=((videoStart+e.start)/sessionDuration*100)+"%";
      b.style.width=((e.end-e.start)/sessionDuration*100)+"%";
      b.addEventListener("click",()=>{stop();renderAt(videoStart+e.start)});
      track.appendChild(b);
    });
    updateCoverage();
  }

  function updateCoverage(){
    const bar=$("participantCoverage"), txt=$("coverageText");
    if(!bar||!txt||!sessionDuration)return;
    const start=Math.max(0,recordingStartSec), end=Math.max(start,recordingEndSec);
    bar.style.left=(start/sessionDuration*100)+"%";
    bar.style.width=((end-start)/sessionDuration*100)+"%";
    const videoStart=videoStartOnSession(), videoEnd=videoStart+stimuli.duration;
    const before=Math.max(0,videoStart-start);
    const after=Math.max(0,end-videoEnd);
    const missingTail=Math.max(0,videoEnd-end);
    const parts=[`participant ${fmt(start)}–${fmt(end)}`, `video placed at ${fmt(videoStart)}–${fmt(videoEnd)}`];
    if(before>0)parts.push(`${fmt(before)} participant data before video`);
    if(after>0)parts.push(`${fmt(after)} participant data after video`);
    if(missingTail>0)parts.push(`${fmt(missingTail)} stimulus video after participant data ends`);
    txt.textContent=parts.join(" · ");
  }

  function nearestGazeIndex(recordingSec){
    if(!gaze.length)return -1;const target=recordingZero+recordingSec;let lo=0,hi=gaze.length-1;
    while(lo<hi){const m=(lo+hi)>>1;if(gaze[m].deviceTimestamp<target)lo=m+1;else hi=m;}
    if(lo>0&&Math.abs(gaze[lo-1].deviceTimestamp-target)<Math.abs(gaze[lo].deviceTimestamp-target))return lo-1;return lo;
  }
  function currentFixation(recordingSec){
    const target=recordingZero+recordingSec;let lo=0,hi=fixations.length-1;
    while(lo<=hi){const m=(lo+hi)>>1,f=fixations[m];if(target<f.start)hi=m-1;else if(target>f.start+f.durationMs/1000)lo=m+1;else return f;}return null;
  }
  function validGaze(r){return !(confidenceFilter.checked&&r.confidence<+minConfidence.value);}

  function renderTrail(index){
    gazeTrail.innerHTML="";if(!showTrail.checked||overlayMode.value!=="gaze"||index<0)return;
    const targetTs=gaze[index].deviceTimestamp,windowSec=1.5;
    for(let i=index;i>=0&&targetTs-gaze[i].deviceTimestamp<=windowSec;i-=4){const r=gaze[i];if(!validGaze(r))continue;const p=mapSurface(r.surfaceX,r.surfaceY),d=document.createElement("i");d.className="trail-dot";d.style.left=p.x+"%";d.style.top=p.y+"%";d.style.opacity=String(clamp(1-(targetTs-r.deviceTimestamp)/windowSec,.12,.9));gazeTrail.appendChild(d)}
  }
  function clearHeatmap(){heatCtx.clearRect(0,0,heatmap.width,heatmap.height)}
  function ensureCanvas(){const r=stage.getBoundingClientRect(),w=Math.max(1,Math.round(r.width*devicePixelRatio)),h=Math.max(1,Math.round(r.height*devicePixelRatio));if(heatmap.width!==w||heatmap.height!==h){heatmap.width=w;heatmap.height=h}}
  function drawHeatPoint(xPct,yPct,alpha=.11){
    const x=xPct/100*heatmap.width,y=yPct/100*heatmap.height,r=Math.max(18,heatmap.width*.028),g=heatCtx.createRadialGradient(x,y,0,x,y,r);g.addColorStop(0,`rgba(255,80,0,${alpha})`);g.addColorStop(.45,`rgba(255,180,0,${alpha*.7})`);g.addColorStop(1,"rgba(255,220,0,0)");heatCtx.fillStyle=g;heatCtx.fillRect(x-r,y-r,r*2,r*2);
  }
  function renderHeatmap(t){
    ensureCanvas(); clearHeatmap();
    heatmap.style.display = showHeatmap.checked ? "block" : "none";
    if(!showHeatmap.checked) return;
    // Cumulative participant heatmap across all recorded data available up to the current synchronized time.
    const recStart=recordingStartSec;
    const recEnd=Math.min(t,recordingEndSec);
    if(recEnd<=recStart) return;
    let i=nearestGazeIndex(recStart);
    if(i<0)return;
    while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>recStart)i--;
    let count=0;
    for(;i<gaze.length;i++){
      const rt=gaze[i].deviceTimestamp-recordingZero;
      if(rt>recEnd)break;
      if(rt<recStart||!validGaze(gaze[i]))continue;
      if(count++%5)continue;
      const p=mapSurface(gaze[i].surfaceX,gaze[i].surfaceY);
      drawHeatPoint(p.x,p.y,.085);
    }
  }

  function renderAt(t){
    recomputeSessionDuration();
    sessionTime=clamp(t,0,sessionDuration);
    slider.value=Math.round(sessionTime*10);
    $("sessionTime").textContent=fmt(sessionTime);
    $("durationLabel").textContent=fmt(sessionDuration);
    const cursorPct=sessionDuration?sessionTime/sessionDuration*100:0;
    [$("timelineCursorSlider"),$("timelineCursorStimulus"),$("timelineCursorCoverage")].forEach(el=>{if(el)el.style.left=cursorPct+"%";});

    const videoStart=videoStartOnSession();
    const videoTime=videoTimeFromSession(sessionTime);
    const inVideo=videoTime>=0 && videoTime<=stimuli.duration;
    $("syncStimulusTime").textContent=inVideo?fmt(videoTime):"—";
    $("recordingTime").textContent=(sessionTime>=recordingStartSec&&sessionTime<=recordingEndSec)?fmt(sessionTime):"—";

    renderStimulus(inVideo?videoTime:-1);
    const recTime=sessionTime;
    const hasRecording=recTime>=recordingStartSec && recTime<=recordingEndSec;
    const i=hasRecording?nearestGazeIndex(recTime):-1; currentGazeIndex=i;
    const mode=overlayMode.value,showGaze=mode==="gaze";
    if(i>=0){
      const r=gaze[i],recordingAtRow=r.deviceTimestamp-recordingZero,close=Math.abs(recordingAtRow-recTime)<0.20,hide=!showGaze||!close||!validGaze(r);
      const p=mapSurface(r.surfaceX,r.surfaceY);
      gazePoint.style.display=hide?"none":"block";gazePoint.style.left=p.x+"%";gazePoint.style.top=p.y+"%";
      $("sx").textContent=r.surfaceX.toFixed(4);$("sy").textContent=r.surfaceY.toFixed(4);$("confidence").textContent=r.confidence.toFixed(3);$("sampleIndex").textContent=`${i+1} / ${gaze.length}`;renderTrail(i);
    } else {
      gazePoint.style.display="none";gazeTrail.innerHTML="";$("sx").textContent="—";$("sy").textContent="—";$("confidence").textContent="—";$("sampleIndex").textContent="—";
    }
    const f=hasRecording?currentFixation(recTime):null;$("fixationId").textContent=f?`#${f.id} · ${Math.round(f.durationMs)} ms`:"—";
    renderHeatmap(sessionTime);
    updateCoverage();
  }

  function scoreOffset(offset,detail=false){
    let weighted=0,max=0,hits=0,used=0;
    for(const e of stimuli.events.filter(e=>e.id!=="combined")){
      const w=e.weight||1;max+=w;used++;
      const startRec=e.start+offset,endRec=startRec+2.5,preStart=startRec-1.2;
      let i=nearestGazeIndex(preStart),best=null,preInside=false;
      while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>preStart)i--;
      for(;i<gaze.length;i++){
        const rt=gaze[i].deviceTimestamp-recordingZero;if(rt>endRec)break;if(rt<preStart||gaze[i].confidence<.55)continue;
        const p=mapSurface(gaze[i].surfaceX,gaze[i].surfaceY),inside=eventContains(e,p);
        if(inside&&rt<startRec)preInside=true;
        if(inside&&rt>=startRec&&best===null)best=rt-startRec;
      }
      if(best!==null){let s=Math.max(0,1-best/2.5);if(preInside)s*=.55;weighted+=w*s;hits++;}
    }
    return {score:max?weighted/max:0,hits,used,offset};
  }
  function fixationDoorCandidates(){
    const door=stimuli.events.find(e=>e.syncAnchor)||stimuli.events.find(e=>e.id==="door-open");
    if(!door)return [];
    const minConf=Math.max(.55,+minConfidence.value||0);
    const out=[];
    for(const f of fixations){
      if(f.durationMs<80 || f.confidence<minConf)continue;
      const startSec=f.start-recordingZero, endSec=startSec+f.durationMs/1000;
      let i=nearestGazeIndex(startSec),inside=0,total=0,sumX=0,sumY=0;
      while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>startSec)i--;
      for(;i<gaze.length;i++){
        const r=gaze[i],rt=r.deviceTimestamp-recordingZero;
        if(rt>endSec)break;
        if(rt<startSec||r.confidence<minConf)continue;
        const p=mapSurface(r.surfaceX,r.surfaceY); total++; sumX+=p.x; sumY+=p.y;
        if(eventContains(door,p))inside++;
      }
      if(total<4)continue;
      const ratio=inside/total;
      if(ratio>=.60)out.push({fixation:f,recordingTime:startSec,ratio,meanX:sumX/total,meanY:sumY/total});
    }
    return out;
  }
  function findDoorFixationAnchor(){
    const door=stimuli.events.find(e=>e.syncAnchor)||stimuli.events.find(e=>e.id==="door-open");
    if(!door)return null;
    const candidates=fixationDoorCandidates();
    if(!candidates.length)return null;
    // Use the current offset as a coarse estimate, then snap to the strongest nearby
    // fixation on the door. This avoids choosing incidental door looks during recorder lead-in.
    const currentOffset=+syncOffsetInput.value||0;
    const expected=currentOffset+door.start;
    const nearby=candidates.filter(c=>Math.abs(c.recordingTime-expected)<=15);
    const pool=nearby.length?nearby:candidates;
    pool.sort((a,b)=>{
      const qa=a.ratio*Math.min(1,a.fixation.durationMs/180);
      const qb=b.ratio*Math.min(1,b.fixation.durationMs/180);
      const da=Math.abs(a.recordingTime-expected), db=Math.abs(b.recordingTime-expected);
      return (qb-.012*db)-(qa-.012*da);
    });
    const c=pool[0];
    return {recordingTime:c.recordingTime,stimulusTime:door.start,offset:c.recordingTime-door.start,event:door,fixation:c.fixation,ratio:c.ratio};
  }

  function autoSync(){
    const btn=$("autoSync");btn.disabled=true;btn.textContent="Finding door gaze…";
    $("syncMessage").textContent="Looking for a fixation on the door near the current synchronization estimate…";
    setTimeout(()=>{
      const anchor=findDoorFixationAnchor();
      if(!anchor){
        $("syncMessage").textContent="No qualifying fixation on the door was found. Use the offset controls to place the video approximately, then try again.";
        btn.disabled=false;btn.textContent="Sync from door fixation";return;
      }
      syncOffsetInput.value=anchor.offset.toFixed(2);
      const validation=scoreOffset(anchor.offset);
      updateQuality(validation);renderStimulusTrack();renderAt(sessionTime);
      $("syncMessage").textContent=`Door fixation #${anchor.fixation.id} at recording ${fmt(anchor.recordingTime)} is aligned to door opening at video ${fmt(anchor.stimulusTime)}. Estimated video start: ${fmt(anchor.offset)} into the participant recording. Door-AOI coverage during the fixation: ${(anchor.ratio*100).toFixed(0)}%. Later AOIs provide a validation score (${validation.hits}/${validation.used}).`;
      btn.disabled=false;btn.textContent="Sync from door fixation";
    },30);
  }
  function updateQuality(s=scoreOffset(+syncOffsetInput.value||0)){
    const q=$("syncQuality");q.className="quality";let label="Weak";if(s.score>=.55&&s.hits>=4){label="Strong";q.classList.add("good")}else if(s.score>=.30&&s.hits>=2){label="Moderate";q.classList.add("mid")}else q.classList.add("weak");q.textContent=`${label} · ${(s.score*100).toFixed(0)}%`;
  }

  function animation(now){if(!playing)return;if(!lastAnimation)lastAnimation=now;const dt=(now-lastAnimation)/1000;lastAnimation=now;const next=sessionTime+dt*(+$("speed").value||1);if(next>=sessionDuration){renderAt(sessionDuration);stop();return}renderAt(next);raf=requestAnimationFrame(animation)}
  function play(){if(sessionTime>=sessionDuration)sessionTime=0;playing=true;lastAnimation=0;$("playPause").textContent="❚❚";raf=requestAnimationFrame(animation)}
  function stop(){playing=false;cancelAnimationFrame(raf);$("playPause").textContent="▶"}

  $("playPause").addEventListener("click",()=>playing?stop():play());
  slider.addEventListener("input",()=>{stop();renderAt(+slider.value/10)});
  syncOffsetInput.addEventListener("input",()=>{updateQuality();renderStimulusTrack();renderAt(sessionTime)});
  $("autoSync").addEventListener("click",autoSync);
  document.querySelectorAll("[data-nudge]").forEach(b=>b.addEventListener("click",()=>{syncOffsetInput.value=(+syncOffsetInput.value + +b.dataset.nudge).toFixed(2);updateQuality();renderStimulusTrack();renderAt(sessionTime)}));
  [overlayMode,showTrail,showStimulus,showHeatmap,showSurface,confidenceFilter,minConfidence].forEach(el=>el.addEventListener("input",()=>{stage.classList.toggle("show-surface",showSurface.checked);renderAt(sessionTime)}));
  Object.values(markerEls).forEach(el=>el.addEventListener("pointerdown",e=>beginDrag(el,e)));
  $("resetSurface").addEventListener("click",()=>{markers=structuredClone(DEFAULT_MARKERS);renderMarkers();updateQuality();renderAt(sessionTime)});
  $("exportConfig").addEventListener("click",()=>{
    const data={participant:"P03",syncOffsetSeconds:+syncOffsetInput.value,surfaceMarkersPercent:markers,stimulusFile:"data/stimuli.json",note:"Offset is recording time minus stimulus-video time; the dashboard timeline spans all synchronized recording and stimulus data."};
    const a=document.createElement("a"),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});a.href=URL.createObjectURL(blob);a.download="P03-sync-config.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  });
  window.addEventListener("resize",()=>renderHeatmap(sessionTime));

  renderMarkerInputs();
  Promise.all([
    fetch("data/P03-gaze.csv").then(r=>r.text()),
    fetch("data/P03-fixations.csv").then(r=>r.text()),
    fetch("data/stimuli.json").then(r=>r.json())
  ]).then(([g,f,s])=>{
    gaze=parseGaze(g);fixations=parseFixations(f);stimuli=s;
    recordingZero=fixations.length?fixations[0].start:(gaze.length?gaze[0].deviceTimestamp:0);
    const gazeStart=gaze.length?gaze[0].deviceTimestamp-recordingZero:0;
    const gazeEnd=gaze.length?gaze[gaze.length-1].deviceTimestamp-recordingZero:0;
    const fixStart=fixations.length?fixations[0].start-recordingZero:gazeStart;
    const fixEnd=fixations.length?Math.max(...fixations.map(x=>x.start+x.durationMs/1000))-recordingZero:gazeEnd;
    recordingStartSec=Math.min(gazeStart,fixStart,0);
    recordingEndSec=Math.max(gazeEnd,fixEnd);
    const recDuration=recordingEndSec-recordingStartSec;
    renderStimulusTrack();
    status.textContent=`P03 · ${gaze.length.toLocaleString()} gaze samples · ${fixations.length} fixations · ${stimuli.events.length} recognized stimulus events · recording ${fmt(recDuration)}`;
    stage.classList.toggle("show-surface",showSurface.checked);renderAt(0);updateQuality();updateCoverage();
  }).catch(err=>{console.error(err);status.textContent="Could not load participant data";});
})();
