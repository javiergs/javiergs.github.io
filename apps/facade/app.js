(() => {
  const $ = id => document.getElementById(id);
  const stage = $("stage"), slider = $("timeSlider"), heatmap = $("heatmap"), heatCtx = heatmap.getContext("2d");
  const gazePoint = $("gazePoint"), gazeTrail = $("gazeTrail"), stimulusOverlay = $("stimulusOverlay"), outline = $("surfaceOutline");
  const status = $("status"), syncOffsetInput = $("syncOffset"), overlayMode = $("overlayMode");
  const showTrail = $("showTrail"), showStimulus = $("showStimulus"), showSurface = $("showSurface"), confidenceFilter = $("confidenceFilter"), minConfidence = $("minConfidence");

  const DEFAULT_MARKERS = {
    tl:{x:8.9,y:12.2}, tr:{x:89.3,y:12.2}, bl:{x:8.9,y:92.5}, br:{x:89.3,y:92.5}
  };
  let markers = structuredClone(DEFAULT_MARKERS);
  const markerEls = {tl:$("markerTL"),tr:$("markerTR"),bl:$("markerBL"),br:$("markerBR")};

  let gaze=[], fixations=[], stimuli={duration:259,events:[]};
  let recordingZero=0, stimulusTime=0, playing=false, raf=0, lastAnimation=0;
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
    box.querySelectorAll("input").forEach(i=>i.addEventListener("input",()=>{const n=+i.value;if(Number.isFinite(n)){markers[i.dataset.k][i.dataset.axis]=clamp(n,0,100);renderMarkers();renderAt(stimulusTime);}}));
    renderMarkers();
  }
  function beginDrag(el,ev){
    ev.preventDefault(); const k=el.dataset.marker; el.setPointerCapture(ev.pointerId);
    const move=e=>{const r=stage.getBoundingClientRect();markers[k].x=clamp((e.clientX-r.left)/r.width*100,0,100);markers[k].y=clamp((e.clientY-r.top)/r.height*100,0,100);renderMarkers();renderAt(stimulusTime)};
    const end=e=>{el.releasePointerCapture(e.pointerId);el.removeEventListener("pointermove",move);el.removeEventListener("pointerup",end);el.removeEventListener("pointercancel",end)};
    el.addEventListener("pointermove",move);el.addEventListener("pointerup",end);el.addEventListener("pointercancel",end);
  }

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
  function renderStimulusTrack(){
    const track=$("stimulusTrack");track.innerHTML="";
    for(const e of stimuli.events){const b=document.createElement("button");b.className="stimulus-segment";b.dataset.id=e.id;b.title=`${e.label}: ${fmt(e.start)}–${fmt(e.end)}`;b.textContent=e.label;b.style.left=(e.start/stimuli.duration*100)+"%";b.style.width=((e.end-e.start)/stimuli.duration*100)+"%";b.addEventListener("click",()=>{stop();renderAt(e.start)});track.appendChild(b)}
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
    ensureCanvas();clearHeatmap();const mode=overlayMode.value;if(!mode.startsWith("heat"))return;
    const off=+syncOffsetInput.value||0;let a,b;
    if(mode==="heat-current"){const e=activeEvent(t);if(!e)return;a=e.start;b=Math.min(t,e.end)}else{a=Math.max(0,t-3);b=t}
    const ra=a+off,rb=b+off;let i=nearestGazeIndex(ra);if(i<0)return;while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>ra)i--;
    let count=0;for(;i<gaze.length;i++){const rt=gaze[i].deviceTimestamp-recordingZero;if(rt>rb)break;if(rt<ra||!validGaze(gaze[i]))continue;if(count++%5)continue;const p=mapSurface(gaze[i].surfaceX,gaze[i].surfaceY);drawHeatPoint(p.x,p.y,.10)}
  }

  function renderAt(t){
    stimulusTime=clamp(t,0,stimuli.duration);slider.value=Math.round(stimulusTime*10);$("stimulusTime").textContent=fmt(stimulusTime);$("syncStimulusTime").textContent=fmt(stimulusTime);$("durationLabel").textContent=fmt(stimuli.duration);
    const off=+syncOffsetInput.value||0,recTime=stimulusTime+off;$("recordingTime").textContent=fmt(recTime);
    renderStimulus(stimulusTime);
    const i=nearestGazeIndex(recTime);currentGazeIndex=i;
    const mode=overlayMode.value,showGaze=mode==="gaze";
    if(i>=0){const r=gaze[i],recordingAtRow=r.deviceTimestamp-recordingZero,close=Math.abs(recordingAtRow-recTime)<0.20,hide=!showGaze||!close||!validGaze(r);const p=mapSurface(r.surfaceX,r.surfaceY);gazePoint.style.display=hide?"none":"block";gazePoint.style.left=p.x+"%";gazePoint.style.top=p.y+"%";$("sx").textContent=r.surfaceX.toFixed(4);$("sy").textContent=r.surfaceY.toFixed(4);$("confidence").textContent=r.confidence.toFixed(3);$("sampleIndex").textContent=`${i+1} / ${gaze.length}`;renderTrail(i)}
    else{gazePoint.style.display="none";gazeTrail.innerHTML="";}
    const f=currentFixation(recTime);$("fixationId").textContent=f?`#${f.id} · ${Math.round(f.durationMs)} ms`:"—";
    renderHeatmap(stimulusTime);
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
  function autoSync(){
    $("autoSync").disabled=true;$("autoSync").textContent="Estimating…";$("syncMessage").textContent="Searching offsets against the sequence of stimulus AOIs…";
    setTimeout(()=>{
      let best={score:-1,offset:0,hits:0,used:0};
      for(let off=0;off<=90;off+=.10){const s=scoreOffset(off);if(s.score>best.score)best=s;}
      // refine around the coarse maximum
      const coarse=best.offset;for(let off=Math.max(0,coarse-.15);off<=coarse+.15;off+=.01){const s=scoreOffset(off);if(s.score>best.score)best=s;}
      syncOffsetInput.value=best.offset.toFixed(2);updateQuality(best);renderAt(stimulusTime);
      $("syncMessage").textContent=`Best behavioral alignment: ${best.offset.toFixed(2)} s offset; ${best.hits}/${best.used} stimulus AOIs received a gaze response within 2.5 s. Treat this as an estimate until AOI timings are refined.`;
      $("autoSync").disabled=false;$("autoSync").textContent="Estimate from stimulus responses";
    },30);
  }
  function updateQuality(s=scoreOffset(+syncOffsetInput.value||0)){
    const q=$("syncQuality");q.className="quality";let label="Weak";if(s.score>=.55&&s.hits>=4){label="Strong";q.classList.add("good")}else if(s.score>=.30&&s.hits>=2){label="Moderate";q.classList.add("mid")}else q.classList.add("weak");q.textContent=`${label} · ${(s.score*100).toFixed(0)}%`;
  }

  function animation(now){if(!playing)return;if(!lastAnimation)lastAnimation=now;const dt=(now-lastAnimation)/1000;lastAnimation=now;const next=stimulusTime+dt*(+$("speed").value||1);if(next>=stimuli.duration){renderAt(stimuli.duration);stop();return}renderAt(next);raf=requestAnimationFrame(animation)}
  function play(){if(stimulusTime>=stimuli.duration)stimulusTime=0;playing=true;lastAnimation=0;$("playPause").textContent="❚❚";raf=requestAnimationFrame(animation)}
  function stop(){playing=false;cancelAnimationFrame(raf);$("playPause").textContent="▶"}

  $("playPause").addEventListener("click",()=>playing?stop():play());
  slider.addEventListener("input",()=>{stop();renderAt(+slider.value/10)});
  syncOffsetInput.addEventListener("input",()=>{updateQuality();renderAt(stimulusTime)});
  $("autoSync").addEventListener("click",autoSync);
  document.querySelectorAll("[data-nudge]").forEach(b=>b.addEventListener("click",()=>{syncOffsetInput.value=(+syncOffsetInput.value + +b.dataset.nudge).toFixed(2);updateQuality();renderAt(stimulusTime)}));
  [overlayMode,showTrail,showStimulus,showSurface,confidenceFilter,minConfidence].forEach(el=>el.addEventListener("input",()=>{stage.classList.toggle("show-surface",showSurface.checked);renderAt(stimulusTime)}));
  Object.values(markerEls).forEach(el=>el.addEventListener("pointerdown",e=>beginDrag(el,e)));
  $("resetSurface").addEventListener("click",()=>{markers=structuredClone(DEFAULT_MARKERS);renderMarkers();updateQuality();renderAt(stimulusTime)});
  $("exportConfig").addEventListener("click",()=>{
    const data={participant:"P03",syncOffsetSeconds:+syncOffsetInput.value,surfaceMarkersPercent:markers,stimulusFile:"data/stimuli.json",note:"Offset is recording time minus stimulus time."};
    const a=document.createElement("a"),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});a.href=URL.createObjectURL(blob);a.download="P03-sync-config.json";a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  });
  window.addEventListener("resize",()=>renderHeatmap(stimulusTime));

  renderMarkerInputs();
  Promise.all([
    fetch("data/P03-gaze.csv").then(r=>r.text()),
    fetch("data/P03-fixations.csv").then(r=>r.text()),
    fetch("data/stimuli.json").then(r=>r.json())
  ]).then(([g,f,s])=>{
    gaze=parseGaze(g);fixations=parseFixations(f);stimuli=s;
    recordingZero=fixations.length?fixations[0].start:(gaze.length?gaze[0].deviceTimestamp:0);
    slider.max=Math.round(stimuli.duration*10);renderStimulusTrack();status.textContent=`P03 · ${gaze.length.toLocaleString()} gaze samples · ${fixations.length} fixations · ${stimuli.events.length} stimulus events`;stage.classList.toggle("show-surface",showSurface.checked);renderAt(0);updateQuality();
  }).catch(err=>{console.error(err);status.textContent="Could not load participant data";});
})();
