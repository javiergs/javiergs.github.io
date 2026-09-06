(() => {
  const $ = id => document.getElementById(id);
  const stage = $("stage"), slider = $("timeSlider"), heatmap = $("heatmap"), heatCtx = heatmap.getContext("2d");
  const affectHeatmap = $("affectHeatmap"), affectHeatCtx = affectHeatmap ? affectHeatmap.getContext("2d") : null;
  const gazePoint = $("gazePoint"), gazeTrail = $("gazeTrail"), outline = $("surfaceOutline");
  const status = $("status"), syncOffsetInput = $("syncOffset"), overlayMode = $("overlayMode"), facadeView = $("facadeView"), facade = $("facade");
  const showTrail = $("showTrail"), showHeatmap = $("showHeatmap"), showAffectHeatmap = $("showAffectHeatmap"), showSurface = $("showSurface"), confidenceFilter = $("confidenceFilter"), minConfidence = $("minConfidence"), minAffect = $("minAffect"), affectHeatMetricSelect = $("affectHeatMetric");

  const DEFAULT_MARKERS = {
    tl:{x:6.7,y:3.6}, tr:{x:95.3,y:3.6}, bl:{x:6.0,y:94.9}, br:{x:94.8,y:95.1}
  };
  let markers = structuredClone(DEFAULT_MARKERS);
  const markerEls = {tl:$("markerTL"),tr:$("markerTR"),bl:$("markerBL"),br:$("markerBR")};

  let gaze=[], fixations=[], affect=[], stimuli={duration:259,events:[]};
  let recordingZero=0, recordingStartSec=0, recordingEndSec=0, sessionTime=0, playing=false, raf=0, lastAnimation=0;
  let sessionDuration=0;
  let currentGazeIndex=-1, currentParticipant="P12";
  const PARTICIPANTS={P12:{gaze:"data/P12/gaze.csv",fixations:"data/P12/fixations.csv",affect:"data/P12/affect.txt"},P03:{gaze:"data/P03/gaze.csv",fixations:"data/P03/fixations.csv",affect:"data/P03/affect.txt"}};
  const AFFECT_METRICS=["Focus","Engagement","Excitement","Interest","Relaxation","Stress"];
  const AFFECT_COLORS={Focus:"#7B2CBF",Engagement:"#009E73",Excitement:"#E69F00",Interest:"#0072B2",Relaxation:"#CC79A7",Stress:"#D55E00"};
  let affectRecordingZeroLocal=0;
  let gazeTimes=[];
  let eventPrefix=new Map();
  let syncRunToken=0;

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

  function parseAffect(text){
    const {headers,rows}=parseCSV(text), idx=Object.fromEntries(headers.map((h,i)=>[h,i]));
    return rows.map(p=>{
      const r={timestamp:+p[idx.Timestamp], localTime:(p[idx["Local time"]]||"").trim(), values:{}, active:{}};
      for(const m of AFFECT_METRICS){
        const activeRaw=(p[idx[`Active ${m}`]]||"").trim().toLowerCase();
        const v=+p[idx[m]];
        r.active[m]=activeRaw==="true";
        r.values[m]=(r.active[m] && Number.isFinite(v) && v>=0) ? v : null;
      }
      return r;
    }).filter(r=>Number.isFinite(r.timestamp)).sort((a,b)=>a.timestamp-b.timestamp);
  }

  function affectSec(r){return r.timestamp-affectRecordingZeroLocal;}
  function nearestAffect(recSec){
    if(!affect.length||!Number.isFinite(recSec))return null;
    const target=affectRecordingZeroLocal+recSec;let lo=0,hi=affect.length-1;
    while(lo<hi){const m=(lo+hi)>>1;if(affect[m].timestamp<target)lo=m+1;else hi=m;}
    let r=affect[lo];
    if(lo>0&&Math.abs(affect[lo-1].timestamp-target)<Math.abs(r.timestamp-target))r=affect[lo-1];
    return Math.abs(r.timestamp-target)<=0.8?r:null;
  }
  function selectedAffectMetrics(){return [...document.querySelectorAll('#affectControls input[data-affect]:checked')].map(i=>i.dataset.affect);}
  function selectedAffectHeatMetric(){
    return affectHeatMetricSelect?.value || "Engagement";
  }
  function validAffectHeatMetrics(){
    return AFFECT_METRICS.filter(m=>affect.some(r=>r.values[m]!=null && affectSec(r)>=0 && affectSec(r)<=recordingEndSec));
  }
  function renderAffectChart(){
    const canvas=$("affectChart"); if(!canvas)return;
    const rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    const ctx=canvas.getContext('2d');ctx.clearRect(0,0,w,h);ctx.save();ctx.scale(dpr,dpr);
    const W=rect.width,H=rect.height,pad={l:42,r:14,t:14,b:28},pw=Math.max(1,W-pad.l-pad.r),ph=Math.max(1,H-pad.t-pad.b);
    ctx.fillStyle='#fbfcfb';ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#e3e8e5';ctx.lineWidth=1;ctx.fillStyle='#7a847e';ctx.font='10px system-ui';
    for(let k=0;k<=4;k++){const y=pad.t+ph*(1-k/4);ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.fillText((k/4).toFixed(2),5,y+3);}
    const dur=Math.max(recordingEndSec,1);
    const ticks=Math.min(6,Math.max(2,Math.floor(pw/120)));
    for(let k=0;k<=ticks;k++){const sec=dur*k/ticks,x=pad.l+pw*k/ticks;ctx.strokeStyle='#eef1ef';ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,pad.t+ph);ctx.stroke();ctx.fillStyle='#7a847e';ctx.textAlign=k===0?'left':k===ticks?'right':'center';ctx.fillText(fmt(sec),x,pad.t+ph+17);}
    const chosen=selectedAffectMetrics();
    for(const m of chosen){
      ctx.strokeStyle=AFFECT_COLORS[m];ctx.lineWidth=1.7;ctx.beginPath();let started=false;
      for(const r of affect){const sec=affectSec(r);if(sec<0||sec>recordingEndSec)continue;const v=r.values[m];if(v==null){started=false;continue;}const x=pad.l+pw*(sec/dur),y=pad.t+ph*(1-clamp(v,0,1));if(!started){ctx.moveTo(x,y);started=true}else ctx.lineTo(x,y);}
      ctx.stroke();
    }
    if(sessionTime>=0&&sessionTime<=recordingEndSec){const x=pad.l+pw*(sessionTime/dur);ctx.strokeStyle='#d6a500';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(x,pad.t);ctx.lineTo(x,pad.t+ph);ctx.stroke();}
    ctx.restore();
  }
  function renderAffectCurrent(recSec){
    const r=nearestAffect(recSec),box=$("affectNow");
    for(const m of AFFECT_METRICS){const el=$("state"+m);if(el)el.textContent='—';}
    if(!r){if(box)box.textContent='No valid affective sample at this synchronized moment.';return;}
    const vals=AFFECT_METRICS.filter(m=>r.values[m]!=null).map(m=>`${m} ${r.values[m].toFixed(3)}`);
    if(box)box.textContent=vals.length?`${fmt(recSec)} · ${vals.join(' · ')}`:'Affective sample present, but all channels are inactive.';
    for(const m of AFFECT_METRICS){const el=$("state"+m);if(el)el.textContent=r.values[m]==null?'—':r.values[m].toFixed(3);}
  }
  function zoneAffectStats(event,cutoff){
    const start=videoStartOnSession()+event.start,end=Math.min(videoStartOnSession()+event.end,cutoff);if(end<=start)return null;
    const sums=Object.fromEntries(AFFECT_METRICS.map(m=>[m,0])),counts=Object.fromEntries(AFFECT_METRICS.map(m=>[m,0]));
    for(const r of affect){const sec=affectSec(r);if(sec<start)continue;if(sec>end)break;for(const m of AFFECT_METRICS){const v=r.values[m];if(v!=null){sums[m]+=v;counts[m]++;}}}
    const means={};for(const m of AFFECT_METRICS)means[m]=counts[m]?sums[m]/counts[m]:null;return means;
  }
  function dominantAffect(st){
    if(!st)return null;
    const valid=AFFECT_METRICS.filter(m=>st[m]!=null).sort((a,b)=>st[b]-st[a]);
    return valid.length?{metric:valid[0],value:st[valid[0]]}:null;
  }
  function renderAffectProminence(){
    const dom=$("dominantZones");if(!dom)return;dom.innerHTML='';
    const stats=stimuli.events.map(e=>zoneAffectStats(e,sessionTime));
    stats.forEach((st,i)=>{
      const chip=document.createElement('div');chip.className='affective-zone-chip';
      const top=dominantAffect(st);
      if(!st){chip.innerHTML=`<strong>Z${i+1}</strong><span>not reached</span>`;chip.classList.add('not-reached');}
      else if(!top){chip.innerHTML=`<strong>Z${i+1}</strong><span>no valid affect</span>`;chip.classList.add('not-reached');}
      else{
        const c=AFFECT_COLORS[top.metric];
        chip.style.setProperty('--zone-color',c);
        chip.innerHTML=`<strong>Z${i+1}</strong><span class="zone-top">${top.metric}</span><b>${top.value.toFixed(3)}</b>`;
        chip.title=`${stimuli.events[i].label} · dominant ${top.metric} ${top.value.toFixed(3)}`;
      }
      dom.appendChild(chip);
    });
  }
  function hexToRgb(hex){const h=hex.replace('#','');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16)];}
  function affectTone(metric,value){
    const base=hexToRgb(AFFECT_COLORS[metric]||"#009E73"),v=clamp(value,0,1);
    // Hue identifies the affective measure. Tone/saturation and alpha encode its 0–1 value.
    // At 0 the mark is effectively absent; at 1 the measure reaches its full canonical color.
    const tone=Math.pow(v,.82);
    const rgb=base.map(c=>Math.round(255+(c-255)*tone));
    return {rgb,alpha:.92*Math.pow(v,.90)};
  }
  function renderAffectHeatmap(){
    if(!affectHeatmap||!affectHeatCtx)return;
    const rect=affectHeatmap.getBoundingClientRect(),dpr=window.devicePixelRatio||1,w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(affectHeatmap.width!==w||affectHeatmap.height!==h){affectHeatmap.width=w;affectHeatmap.height=h;}
    affectHeatCtx.clearRect(0,0,w,h);
    affectHeatmap.style.display=showAffectHeatmap?.checked?"block":"none";
    if(!showAffectHeatmap?.checked || !affect.length || !gaze.length)return;

    const metric=selectedAffectHeatMetric();
    const combined=metric==="Combined";
    const heatMetrics=combined?validAffectHeatMetrics():[metric];
    if(!heatMetrics.length)return;
    const recEnd=Math.min(sessionTime,recordingEndSec);
    if(recEnd<=recordingStartSec)return;

    // Persistent affective memory heatmap.
    // Single-affect mode keeps one canonical hue. Combined mode keeps a field per affect and,
    // at each pixel, renders only the affect with the strongest local mean response.
    // Old evidence fades to a light residual tone but remains visible; repeated/recent evidence reinforces it.
    const scale=.30, fw=Math.max(120,Math.round(w*scale)), fh=Math.max(80,Math.round(h*scale));
    const fieldSize=fw*fh;
    const valueFields=Object.fromEntries(heatMetrics.map(m=>[m,new Float32Array(fieldSize)]));
    const supportFields=Object.fromEntries(heatMetrics.map(m=>[m,new Float32Array(fieldSize)]));
    const radius=Math.max(7,Math.round(fw*.016)),r2=radius*radius;
    const memoryFloor=.10;
    const decaySeconds=42;
    const affectThreshold=clamp(+(minAffect?.value ?? 0.5),0,1);
    let i=nearestGazeIndex(recordingStartSec),sample=0;if(i<0)return;
    while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>recordingStartSec)i--;
    for(;i<gaze.length;i++){
      const recSec=gaze[i].deviceTimestamp-recordingZero;if(recSec>recEnd)break;
      const gr=gaze[i];if(recSec<recordingStartSec||!validGaze(gr))continue;
      if(sample++%16)continue;
      const ar=nearestAffect(recSec);if(!ar)continue;
      const activeValues=[];
      for(const m of heatMetrics){const value=ar.values?.[m];if(value!=null&&value>=affectThreshold)activeValues.push([m,value]);}
      if(!activeValues.length)continue;
      const age=Math.max(0,recEnd-recSec);
      const temporalWeight=memoryFloor+(1-memoryFloor)*Math.exp(-age/decaySeconds);
      const p=mapSurface(gr.surfaceX,gr.surfaceY),cx=Math.round(p.x/100*(fw-1)),cy=Math.round(p.y/100*(fh-1));
      const x0=Math.max(0,cx-radius),x1=Math.min(fw-1,cx+radius),y0=Math.max(0,cy-radius),y1=Math.min(fh-1,cy+radius);
      for(let yy=y0;yy<=y1;yy++){
        const dy=yy-cy;
        for(let xx=x0;xx<=x1;xx++){
          const dx=xx-cx,d2=dx*dx+dy*dy;if(d2>r2)continue;
          const q=1-d2/r2,kernel=q*q,idx=yy*fw+xx;
          const evidence=kernel*temporalWeight;
          for(const [m,value] of activeValues){
            valueFields[m][idx]+=evidence*value;
            supportFields[m][idx]+=evidence;
          }
        }
      }
    }

    const out=new ImageData(fw,fh);
    for(let idx=0;idx<fieldSize;idx++){
      let winner=null,winnerValue=-1,winnerSupport=0;
      for(const m of heatMetrics){
        const support=supportFields[m][idx];if(support<=.008)continue;
        const mean=clamp(valueFields[m][idx]/support,0,1);
        if(mean>winnerValue){winner=m;winnerValue=mean;winnerSupport=support;}
      }
      if(!winner||winnerValue<=.01)continue;
      const {rgb,alpha}=affectTone(winner,winnerValue);
      const supportMask=clamp(Math.log1p(winnerSupport*2.2)/Math.log1p(5.5),0,1);
      const k=idx*4;out.data[k]=rgb[0];out.data[k+1]=rgb[1];out.data[k+2]=rgb[2];out.data[k+3]=Math.round(255*alpha*supportMask);
    }
    const colored=document.createElement('canvas');colored.width=fw;colored.height=fh;colored.getContext('2d').putImageData(out,0,0);
    affectHeatCtx.imageSmoothingEnabled=true;affectHeatCtx.drawImage(colored,0,0,w,h);
  }
  function updateAffectAvailability(){
    const statusEl=$("affectStatus"),coverage=$("affectCoverage");
    const has=affect.length>0;if(statusEl){statusEl.className='quality '+(has?'good':'weak');statusEl.textContent=has?`${affect.length.toLocaleString()} samples`:'No file';}
    if(coverage){if(!has)coverage.textContent='not available';else{const inStart=Math.max(0,affectSec(affect[0])),inEnd=Math.min(recordingEndSec,affectSec(affect.at(-1)));coverage.textContent=inEnd>inStart?`${fmt(inStart)}–${fmt(inEnd)}`:'outside gaze window';}}
    for(const input of document.querySelectorAll('#affectControls input[data-affect]')){const m=input.dataset.affect,valid=affect.some(r=>r.values[m]!=null && affectSec(r)>=0 && affectSec(r)<=recordingEndSec);input.disabled=!valid;if(!valid)input.checked=false;}
    if(affectHeatMetricSelect){
      let currentValid=false, firstValid=null;
      const anyValid=validAffectHeatMetrics().length>0;
      for(const option of [...affectHeatMetricSelect.options]){
        const m=option.value,valid=m==="Combined"?anyValid:affect.some(r=>r.values[m]!=null && affectSec(r)>=0 && affectSec(r)<=recordingEndSec);
        option.disabled=!valid;if(valid&&!firstValid)firstValid=m;if(valid&&m===affectHeatMetricSelect.value)currentValid=true;
      }
      if(!currentValid&&firstValid)affectHeatMetricSelect.value=firstValid;
    }
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
    const vv=v,d=H[6]*u+H[7]*vv+H[8];
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
    const e=activeEvent(t);
    const inVideo=t>=0 && t<=stimuli.duration;
    $("activeStimulus").textContent=e?e.label:(inVideo?"Wait / baseline":"Outside stimulus video");
    $("stimulusBadge").textContent=e?e.label:(inVideo?"Wait / baseline":"Outside stimulus video");

    const analysis=facadeView.value==="analysis";
    const wantedSrc=analysis ? (stimuli.baselineFrame||"assets/stimulus/baseline.jpg") : (e?.frame || stimuli.baselineFrame || "assets/stimulus/baseline.jpg");
    if(facade.getAttribute("src")!==wantedSrc) facade.setAttribute("src",wantedSrc);
    facade.classList.toggle("desaturated",analysis);

    // AOI geometry remains in stimuli.json for synchronization/scoring, but is not
    // drawn over the stimulus image. The stimulus frames themselves highlight
    // the active architectural elements.
    document.querySelectorAll(".stimulus-segment").forEach(b=>b.classList.toggle("active",e&&b.dataset.id===e.id));
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
      b.addEventListener("click",()=>{stop();renderAt(videoStart+e.start);b.blur();});
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
    const participantWindow=$("participantWindow"), videoWindow=$("videoWindow"), outside=$("outsideStimulus");
    if(participantWindow) participantWindow.textContent=`${fmt(start)}–${fmt(end)}`;
    if(videoWindow) videoWindow.textContent=`${fmt(videoStart)}–${fmt(videoEnd)}`;
    if(outside){
      const outsideParts=[];
      if(before>0) outsideParts.push(`${fmt(before)} before`);
      if(after>0) outsideParts.push(`${fmt(after)} after`);
      if(missingTail>0) outsideParts.push(`${fmt(missingTail)} stimulus after data`);
      outside.textContent=outsideParts.length?outsideParts.join(" · "):"none";
    }
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
  function heatColor(v){
    // Density scale intentionally keeps most cumulative gaze in blue/green/yellow.
    // Red is reserved for only the most exceptional hotspots.
    const stops=[
      [0.00,[25,55,190]],
      [0.28,[0,185,255]],
      [0.56,[0,205,105]],
      [0.80,[245,225,20]],
      [0.94,[255,145,0]],
      [0.992,[245,70,20]],
      [1.00,[170,0,0]]
    ];
    v=clamp(v,0,1);
    for(let i=1;i<stops.length;i++){
      if(v<=stops[i][0]){const [p0,c0]=stops[i-1],[p1,c1]=stops[i],q=(v-p0)/(p1-p0);return c0.map((c,j)=>Math.round(c+(c1[j]-c)*q));}
    }
    return stops.at(-1)[1];
  }
  function percentile(sorted,p){
    if(!sorted.length)return 0;
    const x=clamp(p,0,1)*(sorted.length-1),lo=Math.floor(x),hi=Math.ceil(x),q=x-lo;
    return sorted[lo]*(1-q)+sorted[hi]*q;
  }
  function upperBound(sorted,x){
    let lo=0,hi=sorted.length;
    while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<=x)lo=m+1;else hi=m;}
    return lo;
  }
  function renderHeatmap(t){
    ensureCanvas(); clearHeatmap();
    heatmap.style.display=showHeatmap.checked?"block":"none";
    if(!showHeatmap.checked)return;
    const recStart=recordingStartSec, recEnd=Math.min(t,recordingEndSec);
    if(recEnd<=recStart)return;

    // Accumulate density in floating point instead of the canvas alpha channel.
    // Canvas additive alpha saturates at 255 and was the reason large areas became red.
    const scale=.28, w=Math.max(120,Math.round(heatmap.width*scale)), h=Math.max(80,Math.round(heatmap.height*scale));
    const field=new Float32Array(w*h);
    const radius=Math.max(7,Math.round(w*.015));
    const r2=radius*radius;
    let i=nearestGazeIndex(recStart), count=0; if(i<0)return;
    while(i>0&&(gaze[i].deviceTimestamp-recordingZero)>recStart)i--;
    for(;i<gaze.length;i++){
      const rt=gaze[i].deviceTimestamp-recordingZero; if(rt>recEnd)break;
      const r=gaze[i]; if(rt<recStart||!validGaze(r))continue;
      if(count++%4)continue;
      const p=mapSurface(r.surfaceX,r.surfaceY),cx=Math.round(p.x/100*(w-1)),cy=Math.round(p.y/100*(h-1));
      const x0=Math.max(0,cx-radius),x1=Math.min(w-1,cx+radius),y0=Math.max(0,cy-radius),y1=Math.min(h-1,cy+radius);
      for(let yy=y0;yy<=y1;yy++){
        const dy=yy-cy;
        for(let xx=x0;xx<=x1;xx++){
          const dx=xx-cx,d2=dx*dx+dy*dy; if(d2>r2)continue;
          // Smooth compact kernel; peak contribution is 1 and never clips.
          const q=1-d2/r2;
          field[yy*w+xx]+=q*q;
        }
      }
    }

    const vals=[];
    for(const a of field)if(a>.02)vals.push(a);
    if(vals.length<8)return;
    vals.sort((a,b)=>a-b);

    // Use the empirical density rank (CDF) rather than mapping broad high-density
    // plateaus directly to the top of the color scale. This guarantees that red is
    // reserved for only the rarest local maxima instead of large contiguous regions.
    const visibleFloor=.10;
    const out=new ImageData(w,h);
    for(let idx=0;idx<field.length;idx++){
      const a=field[idx]; if(a<=0)continue;
      const rank=upperBound(vals,a)/vals.length;
      if(rank<=visibleFloor)continue;

      // Color allocation by density percentile:
      // 10–70% blue/cyan, 70–90% green, 90–98% yellow,
      // 98–99.8% orange, 99.8–99.98% red-orange,
      // and only the hottest ~0.02% can become true red.
      let v;
      if(rank<=.70) v=.00+.28*((rank-visibleFloor)/(.70-visibleFloor));
      else if(rank<=.90) v=.28+.28*((rank-.70)/.20);
      else if(rank<=.98) v=.56+.24*((rank-.90)/.08);
      else if(rank<=.998) v=.80+.14*((rank-.98)/.018);
      else if(rank<=.9998) v=.94+.052*((rank-.998)/.0018);
      else v=.992+.008*((rank-.9998)/.0002);

      const c=heatColor(v),k=idx*4;
      out.data[k]=c[0];out.data[k+1]=c[1];out.data[k+2]=c[2];
      out.data[k+3]=Math.round(18+185*Math.pow(v,.90));
    }
    const colored=document.createElement("canvas");colored.width=w;colored.height=h;colored.getContext("2d").putImageData(out,0,0);
    heatCtx.imageSmoothingEnabled=true;heatCtx.drawImage(colored,0,0,heatmap.width,heatmap.height);
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
    renderAffectChart();
    renderAffectCurrent(hasRecording?recTime:NaN);
    renderAffectProminence();
    renderAffectHeatmap();
    updateCoverage();
  }

  function lowerBoundTime(t){
    let lo=0,hi=gazeTimes.length;
    while(lo<hi){const m=(lo+hi)>>1;if(gazeTimes[m]<t)lo=m+1;else hi=m;}
    return lo;
  }
  function rangeCount(prefix,a,b){
    if(!prefix||b<=a)return 0;
    const i0=lowerBoundTime(a), i1=lowerBoundTime(b);
    return prefix[i1]-prefix[i0];
  }
  function rangeTotal(a,b){
    if(b<=a)return 0;
    return Math.max(0,lowerBoundTime(b)-lowerBoundTime(a));
  }
  function buildSyncIndex(){
    gazeTimes=gaze.map(r=>r.deviceTimestamp-recordingZero);
    eventPrefix=new Map();
    for(const e of stimuli.events.filter(e=>e.id!=="combined")){
      const pref=new Uint32Array(gaze.length+1);
      for(let i=0;i<gaze.length;i++){
        const r=gaze[i];
        const inside=r.confidence>=.55 && eventContains(e,mapSurface(r.surfaceX,r.surfaceY));
        pref[i+1]=pref[i]+(inside?1:0);
      }
      eventPrefix.set(e.id,pref);
    }
  }
  function scoreOffset(offset){
    // Fast, participant-independent validation using precomputed AOI prefix counts.
    // A synchronization is only meaningful when a substantial part of the fixed
    // 4:19 stimulus overlaps the participant gaze stream. This prevents a single
    // late fixation from placing almost the entire stimulus after the recording.
    let weighted=0,possible=0,hits=0,used=0;
    const matches=[];
    for(const e of stimuli.events.filter(e=>e.id!=="combined")){
      const w=e.weight||1, startRec=e.start+offset, endRec=e.end+offset;
      if(endRec<recordingStartSec || startRec>recordingEndSec)continue;
      used++; possible+=w;
      const preStart=Math.max(recordingStartSec,startRec-1.5);
      const responseEnd=Math.min(recordingEndSec,endRec+2.0);
      const pref=eventPrefix.get(e.id);
      const insidePre=rangeCount(pref,preStart,startRec), totalPre=rangeTotal(preStart,startRec);
      const insideActive=rangeCount(pref,startRec,responseEnd), totalActive=rangeTotal(startRec,responseEnd);
      if(!totalActive)continue;
      const activeRatio=insideActive/totalActive, preRatio=totalPre?insidePre/totalPre:0;
      const contrast=Math.max(0,activeRatio-preRatio*.45);
      const occupancy=Math.min(1,activeRatio/.12);
      const s=.60*occupancy+.40*Math.min(1,contrast/.10);
      if(insideActive>=4 && activeRatio>=.035){weighted+=w*s;hits++;matches.push({event:e,score:s,ratio:activeRatio});}
    }
    const agreement=possible?weighted/possible:0;
    const support=used?hits/used:0;
    const baseScore=.78*agreement+.22*support;

    const stimulusStart=offset, stimulusEnd=offset+stimuli.duration;
    const overlap=Math.max(0,Math.min(recordingEndSec,stimulusEnd)-Math.max(recordingStartSec,stimulusStart));
    // Normalize by the greatest overlap this participant could possibly provide.
    // Long recordings can reach 100%; shorter recordings are not unfairly penalized.
    const maxPossibleOverlap=Math.min(stimuli.duration,Math.max(0,recordingEndSec-recordingStartSec));
    const overlapRatio=maxPossibleOverlap?overlap/maxPossibleOverlap:0;
    const zoneCoverage=stimuli.events.length?used/stimuli.events.filter(e=>e.id!=="combined").length:0;
    const score=baseScore*.76+overlapRatio*.18+zoneCoverage*.06;
    return {score,baseScore,hits,used,offset,matches,overlap,overlapRatio,zoneCoverage};
  }
  function fixationCandidatesForEvent(event){
    const minConf=Math.max(.55,+minConfidence.value||0), out=[];
    const pref=eventPrefix.get(event.id);
    if(!pref)return out;
    for(const f of fixations){
      if(f.durationMs<80 || f.confidence<minConf)continue;
      const startSec=f.start-recordingZero, endSec=startSec+f.durationMs/1000;
      if(endSec<recordingStartSec || startSec>recordingEndSec)continue;
      const total=rangeTotal(startSec,endSec);
      if(total<4)continue;
      const inside=rangeCount(pref,startSec,endSec), ratio=inside/total;
      if(ratio>=.55)out.push({event,fixation:f,recordingTime:startSec,ratio});
    }
    // Keep only the strongest candidates per zone. This prevents one frequently viewed AOI
    // from producing thousands of redundant offset hypotheses.
    out.sort((a,b)=>(b.ratio*Math.min(1,b.fixation.durationMs/250))-(a.ratio*Math.min(1,a.fixation.durationMs/250)));
    return out.slice(0,40);
  }
  function buildSyncCandidates(){
    const candidates=[];
    for(const event of stimuli.events.filter(e=>e.id!=="combined")){
      for(const c of fixationCandidatesForEvent(event)){
        for(const latency of [0,.5,1.0,1.75,2.5]){
          const offset=c.recordingTime-event.start-latency;
          if(offset<recordingStartSec-stimuli.duration || offset>recordingEndSec)continue;
          candidates.push({...c,offset,latency});
        }
      }
    }
    return candidates;
  }
  async function findBestSyncAnchorAsync(token){
    const candidates=buildSyncCandidates();
    if(!candidates.length)return null;
    let best=null;
    const chunk=80;
    for(let base=0;base<candidates.length;base+=chunk){
      if(token!==syncRunToken)return null;
      const stop=Math.min(candidates.length,base+chunk);
      for(let i=base;i<stop;i++){
        const c=candidates[i],validation=scoreOffset(c.offset);
        // Reject geometrically plausible one-zone coincidences that leave most of
        // the known stimulus outside the available participant recording.
        // The threshold is relative to this participant's maximum possible overlap,
        // so it also works for recordings shorter than the 4:19 stimulus.
        if(validation.overlapRatio<.80 || validation.used<Math.min(5,stimuli.events.length))continue;
        const fixationQuality=c.ratio*Math.min(1,c.fixation.durationMs/220);
        const distinctive=(c.event.syncAnchor?.045:0)+(c.event.id==="top-figure"?.02:0);
        const combined=validation.score*.82+fixationQuality*.10+distinctive;
        const item={...c,validation,combined};
        if(!best || item.combined>best.combined || (item.combined===best.combined&&item.validation.hits>best.validation.hits))best=item;
      }
      // Yield to the browser so the slider, display toggles, and participant menu remain responsive.
      await new Promise(requestAnimationFrame);
    }
    return best;
  }
  async function autoSync(){
    const token=++syncRunToken;
    const btn=$("autoSync");btn.disabled=true;btn.textContent="Testing stimulus zones…";
    $("syncMessage").textContent="Testing candidate offsets from all known stimulus AOIs. The dashboard remains interactive while synchronization is scored.";
    try{
      const anchor=await findBestSyncAnchorAsync(token);
      if(token!==syncRunToken)return;
      if(!anchor){
        $("syncMessage").textContent="No qualifying multi-zone alignment was found. The offset can still be adjusted manually.";
        return;
      }
      syncOffsetInput.value=anchor.offset.toFixed(2);
      updateQuality(anchor.validation);renderStimulusTrack();renderAt(sessionTime);
      const zone=stimuli.events.indexOf(anchor.event)+1;
      const supported=anchor.validation.matches.map(m=>stimuli.events.indexOf(m.event)+1).join(", ")||"none";
      $("syncMessage").textContent=`Best candidate: Zone ${zone} (${anchor.event.label}), fixation #${anchor.fixation.id} at participant ${fmt(anchor.recordingTime)}. Estimated stimulus-video start: participant ${fmt(anchor.offset)}. Supporting zones: ${supported} (${anchor.validation.hits}/${anchor.validation.used}); stimulus/data overlap ${(anchor.validation.overlapRatio*100).toFixed(0)}%; anchor AOI coverage ${(anchor.ratio*100).toFixed(0)}%.`;
    } finally {
      if(token===syncRunToken){btn.disabled=false;btn.textContent="Auto-sync from stimulus zones";}
    }
  }
  function updateQuality(s=scoreOffset(+syncOffsetInput.value||0)){
    const q=$("syncQuality");q.className="quality";let label="Weak";
    if(s.score>=.55&&s.hits>=4&&s.used>=5&&s.overlapRatio>=.80){label="Strong";q.classList.add("good")}
    else if(s.score>=.30&&s.hits>=2&&s.used>=4&&s.overlapRatio>=.65){label="Moderate";q.classList.add("mid")}
    else q.classList.add("weak");
    q.textContent=`${label} · ${(s.score*100).toFixed(0)}% · overlap ${(s.overlapRatio*100).toFixed(0)}%`;
  }

  function animation(now){if(!playing)return;if(!lastAnimation)lastAnimation=now;const dt=(now-lastAnimation)/1000;lastAnimation=now;const next=sessionTime+dt*(+$("speed").value||1);if(next>=sessionDuration){renderAt(sessionDuration);stop();return}renderAt(next);raf=requestAnimationFrame(animation)}
  function play(){if(sessionTime>=sessionDuration)sessionTime=0;playing=true;lastAnimation=0;$("playPause").textContent="❚❚";raf=requestAnimationFrame(animation)}
  function stop(){playing=false;cancelAnimationFrame(raf);$("playPause").textContent="▶"}

  $("playPause").addEventListener("click",()=>playing?stop():play());
  slider.addEventListener("input",()=>{stop();renderAt(+slider.value/10)});
  syncOffsetInput.addEventListener("input",()=>{updateQuality();renderStimulusTrack();renderAt(sessionTime)});
  $("autoSync").addEventListener("click",autoSync);
  document.querySelectorAll("[data-nudge]").forEach(b=>b.addEventListener("click",()=>{syncOffsetInput.value=(+syncOffsetInput.value + +b.dataset.nudge).toFixed(2);updateQuality();renderStimulusTrack();renderAt(sessionTime)}));
  [facadeView,overlayMode,showTrail,showHeatmap,showAffectHeatmap,showSurface,confidenceFilter,minConfidence,minAffect].filter(Boolean).forEach(el=>el.addEventListener("input",()=>{stage.classList.toggle("show-surface",showSurface.checked);renderAt(sessionTime)}));
  Object.values(markerEls).forEach(el=>el.addEventListener("pointerdown",e=>beginDrag(el,e)));
  $("resetSurface").addEventListener("click",()=>{markers=structuredClone(DEFAULT_MARKERS);renderMarkers();updateQuality();renderAt(sessionTime)});
  $("exportConfig").addEventListener("click",()=>{
    const data={participant:currentParticipant,syncOffsetSeconds:+syncOffsetInput.value,surfaceMarkersPercent:markers,stimulusFile:"data/stimuli.json",note:"Offset is recording time minus stimulus-video time; the dashboard timeline spans all synchronized recording and stimulus data."};
    const a=document.createElement("a"),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});a.href=URL.createObjectURL(blob);a.download=`${currentParticipant}-sync-config.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);
  });
  window.addEventListener("resize",()=>{renderHeatmap(sessionTime);renderAffectChart();renderAffectHeatmap();});
  document.querySelectorAll('#affectControls input[data-affect]').forEach(el=>el.addEventListener('change',()=>{renderAffectChart();renderAffectProminence();renderAffectHeatmap();}));
  if(affectHeatMetricSelect) affectHeatMetricSelect.addEventListener('change',()=>renderAffectHeatmap());
  if(showHeatmap&&showAffectHeatmap){
    showHeatmap.addEventListener('change',()=>{if(showHeatmap.checked){showAffectHeatmap.checked=false;}renderAt(sessionTime);});
    showAffectHeatmap.addEventListener('change',()=>{if(showAffectHeatmap.checked){showHeatmap.checked=false;}renderAt(sessionTime);});
  }


  function formatVideoClock(sec){
    if(!Number.isFinite(sec) || sec < 0) sec=0;
    const total=Math.floor(sec), m=Math.floor(total/60), ss=String(total%60).padStart(2,"0");
    return `${String(m).padStart(2,"0")}:${ss}`;
  }

  function bindParticipantVideoControls(){
    const video=$("participantVideo"), playBtn=$("participantVideoPlay"), seek=$("participantVideoSeek"), time=$("participantVideoTime");
    if(!video || !playBtn || !seek || !time) return;
    const refresh=()=>{
      const d=Number.isFinite(video.duration)?video.duration:0, c=Number.isFinite(video.currentTime)?video.currentTime:0;
      if(d>0) seek.value=String(Math.round((c/d)*1000));
      time.textContent=`${formatVideoClock(c)} / ${formatVideoClock(d)}`;
      playBtn.textContent=video.paused?"▶":"❚❚";
      playBtn.setAttribute("aria-label",video.paused?"Play participant video":"Pause participant video");
    };
    playBtn.addEventListener("click",()=>video.paused?video.play().catch(()=>{}):video.pause());
    seek.addEventListener("input",()=>{if(Number.isFinite(video.duration)&&video.duration>0) video.currentTime=(+seek.value/1000)*video.duration;});
    ["loadedmetadata","durationchange","timeupdate","play","pause","ended","seeking","seeked"].forEach(ev=>video.addEventListener(ev,refresh));
    refresh();
  }

  function updateParticipantVideo(id){
    const video=$("participantVideo");
    const source=$("participantVideoSource");
    const label=$("participantVideoName");
    const missing=$("participantVideoMissing");
    if(!video || !source) return;
    const filename=`${id}.mov`;
    const src=`videos/${filename}`;
    if(label) label.textContent=filename;
    if(missing){
      missing.hidden=true;
      missing.innerHTML=`Add <strong>${filename}</strong> to the <code>videos</code> folder to view the original recording.`;
    }
    video.pause();
    video.currentTime=0;
    const seek=$("participantVideoSeek"); if(seek) seek.value="0";
    const playBtn=$("participantVideoPlay"); if(playBtn) playBtn.textContent="▶";
    const time=$("participantVideoTime"); if(time) time.textContent="00:00 / 00:00";
    source.src=src;
    source.type="video/quicktime";
    const showMissing=()=>{ if(missing) missing.hidden=false; };
    const hideMissing=()=>{ if(missing) missing.hidden=true; };
    video.onerror=showMissing;
    source.onerror=showMissing;
    video.onloadedmetadata=hideMissing;
    video.load();
  }

  async function loadParticipant(id, auto=true){
    updateParticipantVideo(id);
    stop(); syncRunToken++; currentParticipant=id; status.textContent=`Loading ${id}…`;
    const cfg=PARTICIPANTS[id]; if(!cfg){status.textContent=`No data configured for ${id}`;return;}
    try{
      const [g,f,a]=await Promise.all([
        fetch(cfg.gaze).then(r=>{if(!r.ok)throw Error(cfg.gaze);return r.text()}),
        fetch(cfg.fixations).then(r=>{if(!r.ok)throw Error(cfg.fixations);return r.text()}),
        cfg.affect?fetch(cfg.affect).then(r=>r.ok?r.text():"").catch(()=>""):Promise.resolve("")
      ]);
      gaze=parseGaze(g);fixations=parseFixations(f);affect=a?parseAffect(a):[];
      // Gaze is the primary coverage stream. Affect is aligned using the same local/Unix timestamp clock.
      recordingZero=gaze.length?gaze[0].deviceTimestamp:(fixations.length?fixations[0].start:0);
      affectRecordingZeroLocal=gaze.length?gaze[0].localTimestamp:0;
      recordingStartSec=0;
      recordingEndSec=gaze.length?gaze[gaze.length-1].deviceTimestamp-recordingZero:0;
      sessionTime=0; syncOffsetInput.value="0.00";
      buildSyncIndex();
      updateAffectAvailability();
      renderStimulusTrack();renderAt(0);updateQuality();updateCoverage();
      status.innerHTML=`<strong>${id}</strong> · ${gaze.length.toLocaleString()} gaze samples · ${fixations.length.toLocaleString()} fixations · gaze coverage <strong>${fmt(recordingEndSec)}</strong>${affect.length?` · ${affect.length.toLocaleString()} affect samples`:''}`;
      if(auto)setTimeout(()=>{ if(currentParticipant===id) autoSync(); },120);
    }catch(err){console.error(err);status.textContent=`Could not load ${id} participant data`;}
  }

  renderMarkerInputs();
  fetch("data/stimuli.json").then(r=>r.json()).then(s=>{
    stimuli=s;
    $("participant").addEventListener("change",e=>loadParticipant(e.target.value,true));
  bindParticipantVideoControls();
    return loadParticipant($("participant").value,true);
  }).catch(err=>{console.error(err);status.textContent="Could not load stimulus configuration";});
})();
