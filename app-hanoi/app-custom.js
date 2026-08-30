"use strict";

/*
 * AppHanoi 2026-08-30 refinements
 *
 * - Restores the original Head Motion / Head Orientation drawing from app.js:
 *   this file DOES NOT override drawCartoonHead().
 * - Facial Expression laugh uses one clean rotated-D mouth.
 * - Time plots occupy a common left column; current/context boxes are on right.
 * - Master Timeline gets a Trial Completion summary box.
 * - Quality 4 is bright leaf green; quality 3 is lighter green.
 * - EEG sensor inset dots reflect current contact quality.
 */

/* ---------- Bright quality status palette ---------- */

qualityColor = function(value) {
  const colors = ["#969b98", "#d32f2f", "#f57c00", "#66d17a", "#00b83f"];
  const i = Math.max(0, Math.min(4, Math.round(value)));
  return colors[i];
};

wirelessColor = function(value) {
  if (value === null || !Number.isFinite(value)) return "#969b98";
  if (value >= 0.999) return "#00b83f";
  if (value <= 0) return "#969b98";
  if (value <= 1/3) return "#d32f2f";
  if (value <= 2/3) return "#f57c00";
  return "#66d17a";
};

/* ---------- Keep chart insets OUT of the time plot itself ---------- */

chartInsetWidth = function(chart, w) {
  return 0;
};

/* ---------- EEG context head: dots follow current contact quality ---------- */

drawEEGMapInset = function(chart, ctx, x, y, w, h) {
  ctx.fillStyle = "#778078";
  ctx.font = "700 10px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText("INSIGHT SENSORS", x+w/2, y+9);

  const cx=x+w/2, cy=y+h*.56;
  const rx=Math.min(w*.34,48), ry=Math.min(h*.33,55);

  ctx.strokeStyle="#8c9690";
  ctx.lineWidth=2;
  ctx.beginPath(); ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx-6,cy-ry+1); ctx.lineTo(cx,cy-ry-8); ctx.lineTo(cx+6,cy-ry+1); ctx.stroke();

  const pts = {
    AF3:{p:[-.35,-.58], q:"Quality Sensor 0"},
    AF4:{p:[ .35,-.58], q:"Quality Sensor 4"},
    T7 :{p:[-.78,-.12], q:"Quality Sensor 1"},
    T8 :{p:[ .78,-.12], q:"Quality Sensor 3"},
    Pz :{p:[ 0,.62],    q:"Quality Sensor 2"}
  };

  const qualityRow = latestRowAtOrBefore(state.data.device || [], state.currentTime);

  for (const [label,def] of Object.entries(pts)) {
    const [px,py] = def.p;
    const sx=cx+px*rx, sy=cy+py*ry;
    const q=qualityRow ? asNumber(qualityRow[def.q]) : null;

    ctx.fillStyle = q===null ? "#c8cfcb" : qualityColor(q);
    ctx.beginPath(); ctx.arc(sx,sy,7,0,Math.PI*2); ctx.fill();
    ctx.strokeStyle="#38413c"; ctx.lineWidth=1.4; ctx.stroke();

    ctx.fillStyle="#26302a";
    ctx.font="700 9px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="bottom";
    ctx.fillText(label,sx,sy-9);
  }

  const cmsX=cx-rx*.82, cmsY=cy+ry*.18;
  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#4f5752";
  ctx.lineWidth=2;
  ctx.beginPath(); ctx.arc(cmsX,cmsY,6,0,Math.PI*2); ctx.fill(); ctx.stroke();
  ctx.fillStyle="#4f5752";
  ctx.font="700 7px system-ui";
  ctx.textAlign="left";
  ctx.textBaseline="middle";
  ctx.fillText("CMS/DRL",cmsX+8,cmsY);
};

/* ---------- Facial Expression only: replace laugh with a D-shaped mouth ---------- */

drawExpressionFace = function(ctx,cx,cy,eyeAction,upperAction,lowerAction) {
  ctx.save();
  ctx.lineCap="round";
  ctx.lineJoin="round";

  ctx.fillStyle="#fbfcfb";
  ctx.strokeStyle="#66706a";
  ctx.lineWidth=2.5;
  ctx.beginPath(); ctx.ellipse(cx,cy,44,52,0,0,Math.PI*2); ctx.fill(); ctx.stroke();

  ctx.beginPath(); ctx.ellipse(cx-46,cy,6,11,0,0,Math.PI*2); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(cx+46,cy,6,11,0,0,Math.PI*2); ctx.stroke();

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
      ctx.beginPath(); ctx.moveTo(x-7,eyeY); ctx.quadraticCurveTo(x,eyeY+3,x+7,eyeY); ctx.stroke();
    }else{
      ctx.beginPath(); ctx.ellipse(x,eyeY,7,4.5,0,0,Math.PI*2); ctx.stroke();
      const pupilShift=lookLeft?-3:lookRight?3:0;
      ctx.beginPath(); ctx.arc(x+pupilShift,eyeY,2.2,0,Math.PI*2); ctx.fill();
    }
  };
  drawEye(leftX,blink||winkL);
  drawEye(rightX,blink||winkR);

  let browLift=0,browInner=0;
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

  ctx.strokeStyle="#BD8B13";
  ctx.lineWidth=2.6;
  ctx.beginPath();
  ctx.moveTo(cx,cy-2); ctx.quadraticCurveTo(cx+5,cy+3,cx+1,cy+10); ctx.stroke();

  ctx.strokeStyle="#424a45";
  ctx.fillStyle="#424a45";
  ctx.lineWidth=2.6;
  const my=cy+24;

  if(lowerAction==="laugh"){
    // A single open mouth: rotated D shape, no extra oval/chin line.
    ctx.save();
    ctx.translate(cx,my);
    ctx.rotate(Math.PI/2);
    ctx.beginPath();
    ctx.moveTo(-7,-10);
    ctx.lineTo(7,-10);
    ctx.bezierCurveTo(14,-10,14,10,0,12);
    ctx.bezierCurveTo(-14,10,-14,-10,-7,-10);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }else if(lowerAction==="smile"){
    ctx.beginPath(); ctx.arc(cx,my-4,15,0.12*Math.PI,0.88*Math.PI); ctx.stroke();
  }else if(lowerAction==="smirkright"){
    ctx.beginPath();
    ctx.moveTo(cx-12,my); ctx.quadraticCurveTo(cx+3,my+3,cx+14,my-6); ctx.stroke();
  }else{
    ctx.beginPath(); ctx.moveTo(cx-11,my); ctx.quadraticCurveTo(cx,my+1,cx+11,my); ctx.stroke();
  }

  ctx.restore();
};

/* ---------- DOM layout helpers ---------- */

function ensureMasterTimelineColumns() {
  const card = document.querySelector(".timeline-card");
  if (!card || card.classList.contains("aligned-timeline")) return;

  const main = document.createElement("div");
  main.className = "timeline-main";
  while (card.firstChild) main.appendChild(card.firstChild);

  const summary = document.createElement("aside");
  summary.className = "timeline-summary";
  summary.id = "trialCompletionSummary";

  card.appendChild(main);
  card.appendChild(summary);
  card.classList.add("aligned-timeline");
}

function chartForId(id) {
  return state.charts.find(c => c.id === id) || null;
}


function placeBatteryBelowWireless() {
  const wirelessCanvas = el("chart-wireless");
  const batteryCanvas = el("chart-battery");
  if (!wirelessCanvas || !batteryCanvas) return;

  const wirelessCard = wirelessCanvas.closest(".chart-card");
  const batteryCard = batteryCanvas.closest(".chart-card");
  if (!wirelessCard || !batteryCard) return;

  if (wirelessCard.nextElementSibling !== batteryCard) {
    wirelessCard.insertAdjacentElement("afterend", batteryCard);
  }
}

function ensureChartContextColumns() {
  const contextIds = new Set(["affect","pad","eeg","deviceQuality","wireless","battery","faceGroup"]);

  for (const chart of state.charts) {
    if (!contextIds.has(chart.id)) continue;

    const canvas = el(`chart-${chart.id}`);
    if (!canvas) continue;
    const card = canvas.closest(".chart-card");
    if (!card || card.classList.contains("has-context-column")) continue;

    const context = document.createElement("div");
    context.className = "chart-context";
    context.dataset.chartId = chart.id;

    const sideCanvas = document.createElement("canvas");
    sideCanvas.id = `context-${chart.id}`;
    context.appendChild(sideCanvas);

    card.appendChild(context);
    card.classList.add("has-context-column");
  }
}

function drawContextCanvas(chart) {
  const canvas = el(`context-${chart.id}`);
  if (!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  if (chart.id === "faceGroup") {
    const row=latestRowAtOrBefore(chart.rawRows,state.currentTime);
    const eye=normalizeFaceAction(row?row["Action Eye"]:"neutral");
    const upper=normalizeFaceAction(row?row["Action Upper Face"]:"neutral");
    const lower=normalizeFaceAction(row?row["Action Lower Face"]:"neutral");

    ctx.fillStyle="#778078";
    ctx.font="700 10px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="top";
    ctx.fillText("CURRENT EXPRESSION",w/2,10);

    drawExpressionFace(ctx,w/2,h*.47,eye,upper,lower);

    ctx.fillStyle="#18211b";
    ctx.font="700 9px system-ui";
    ctx.textAlign="center";
    ctx.textBaseline="bottom";
    ctx.fillText(`${eye} · ${upper} · ${lower}`,w/2,h-12);
    return;
  }

  drawChartInset(chart,ctx,1,1,w-2,h-2);
}

/* ---------- Facial-expression timeline, now plot-only in the left column ---------- */

drawFaceGroup = function(chart){
  const canvas=el(`chart-${chart.id}`);
  if(!canvas) return;
  const {ctx,w,h}=setupCanvas(canvas);
  ctx.clearRect(0,0,w,h);

  const left=54, right=15;
  const plotX=left;
  const plotW=Math.max(10,w-left-right);
  const [t0,t1]=state.domain;
  const x=t=>plotX+((t-t0)/(t1-t0))*plotW;

  const laneDefs=[
    {title:"EYES", actionKey:"Action Eye", powerKey:null},
    {title:"UPPER FACE", actionKey:"Action Upper Face", powerKey:"Power Upper Face"},
    {title:"LOWER FACE", actionKey:"Action Lower Face", powerKey:"Power Lower Face"}
  ];

  const top=10;
  const bottom=24;
  const laneBlockH=(h-top-bottom)/3;
  const titleH=18;
  const legendH=22;
  const barH=Math.max(28,laneBlockH-titleH-legendH-8);

  drawBackgroundBands(ctx,plotX,top,plotW,h-top-bottom,x);

  chart._faceLegendHits=[];

  laneDefs.forEach((lane,li)=>{
    const blockY=top+li*laneBlockH;
    const titleY=blockY+2;
    const barY=blockY+titleH;
    const legendY=barY+barH+4;

    ctx.fillStyle="#657069";
    ctx.font="800 11px system-ui";
    ctx.textAlign="left";
    ctx.textBaseline="top";
    ctx.fillText(lane.title,plotX,titleY);

    const rows=chart.rawRows.filter(r=>r._t>=t0-2 && r._t<=t1+2);
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      const nextT=i+1<rows.length?rows[i+1]._t:r._t+.05;
      const x1=Math.max(plotX,x(r._t));
      const x2=Math.min(plotX+plotW,x(nextT));
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
    ctx.strokeRect(plotX,barY,plotW,barH);

    const actions=faceLaneActions(chart.rawRows,lane.actionKey);
    let lx=plotX;
    ctx.font="10px system-ui";
    ctx.textAlign="left";
    ctx.textBaseline="middle";

    for(const action of actions){
      const checked=isFaceActionVisible(lane.actionKey,action);
      const box=10;
      const labelW=ctx.measureText(action).width;
      const itemW=box+6+10+4+labelW+16;
      if(lx+itemW>plotX+plotW) break;

      ctx.fillStyle="#ffffff";
      ctx.strokeStyle="#66706a";
      ctx.lineWidth=1.1;
      ctx.strokeRect(lx,legendY,box,box);
      if(checked){
        ctx.fillStyle="#18211b";
        ctx.fillRect(lx+2,legendY+2,box-4,box-4);
      }

      ctx.fillStyle=faceActionColor(action);
      ctx.fillRect(lx+box+6,legendY+1,10,8);

      ctx.fillStyle="#4d5651";
      ctx.fillText(action,lx+box+20,legendY+box/2);

      chart._faceLegendHits.push({x:lx,y:legendY,w:itemW,h:14,action,actionKey:lane.actionKey});
      lx+=itemW;
    }

    if(li<laneDefs.length-1){
      ctx.strokeStyle="#e3e6e4";
      ctx.lineWidth=1;
      ctx.beginPath();
      ctx.moveTo(plotX,blockY+laneBlockH-2);
      ctx.lineTo(plotX+plotW,blockY+laneBlockH-2);
      ctx.stroke();
    }
  });

  ctx.fillStyle="#a8a8a8";
  ctx.font="11px system-ui";
  ctx.textAlign="center";
  ctx.textBaseline="top";
  for(let i=0;i<=4;i++){
    const xx=plotX+plotW*i/4;
    const tt=t0+(t1-t0)*i/4;
    ctx.fillText(formatClockShort(tt),xx,h-19);
  }

  const cursorX=x(state.currentTime);
  if(cursorX>=plotX && cursorX<=plotX+plotW){
    ctx.strokeStyle="#BD8B13";
    ctx.lineWidth=1.5;
    ctx.beginPath();
    ctx.moveTo(cursorX,top);
    ctx.lineTo(cursorX,h-bottom);
    ctx.stroke();
  }
};

/* ---------- Trial completion summary ---------- */

function currentOrNearestTrialGroup(t) {
  if (!state.trialGroups.length) return null;
  const active=state.trialGroups.find(g=>t>=g.start && t<=g.end);
  if(active) return active;
  if(t<state.trialGroups[0].start) return state.trialGroups[0];
  for(let i=0;i<state.trialGroups.length-1;i++){
    if(t>state.trialGroups[i].end && t<state.trialGroups[i+1].start) return state.trialGroups[i];
  }
  return state.trialGroups[state.trialGroups.length-1];
}

function renderTrialCompletionSummary() {
  const box=el("trialCompletionSummary");
  if(!box) return;

  const g=currentOrNearestTrialGroup(state.currentTime);
  if(!g){
    box.innerHTML='<div class="summary-kicker">Session</div><div class="summary-percent">—</div><div class="summary-label">no trial data</div>';
    return;
  }

  const completed=g.moves.filter(m=>m.end<=state.currentTime).length;
  const total=Math.max(1,g.moves.length);
  const percent=Math.max(0,Math.min(100,Math.round(completed/total*100)));
  const help=g.moves.filter(m=>m.end<=state.currentTime && m._help).length;
  const done=percent===100;

  box.innerHTML=
    `<div class="summary-kicker">Trial ${g.trial}</div>`+
    `<div class="summary-percent${done?" summary-complete":""}">${percent}%</div>`+
    `<div class="summary-label">completed</div>`+
    `<div class="summary-meta">${completed} / ${g.moves.length} moves<br>${help} help request${help===1?"":"s"}</div>`;
}

function renderAllContextCanvases() {
  for (const chart of state.charts) {
    if (["affect","pad","eeg","deviceQuality","wireless","faceGroup"].includes(chart.id)) {
      drawContextCanvas(chart);
    }
  }
}

/* The original app's render/update loop remains authoritative. We only wrap it
   to ensure the two-column structure exists before drawing and refresh the
   contextual column after the normal charts are rendered. */
const appOriginalUpdateAll = updateAll;
updateAll = function() {
  ensureMasterTimelineColumns();
  placeBatteryBelowWireless();
  ensureChartContextColumns();
  appOriginalUpdateAll();
  renderTrialCompletionSummary();
  renderAllContextCanvases();
};

/* buildCharts recreates cards, so after each rebuild the next updateAll call
   reconstructs the right-side context column automatically. */

window.addEventListener("resize",()=>{
  if (!state || !state.charts) return;
  requestAnimationFrame(()=>{
    ensureMasterTimelineColumns();
    placeBatteryBelowWireless();
    ensureChartContextColumns();
    drawAllCharts();
    drawTrialStrip();
    renderTrialCompletionSummary();
    renderAllContextCanvases();
  });
});

/* If the main app already completed its first render before this script loaded,
   immediately apply the refinement. */
requestAnimationFrame(()=>{
  try {
    ensureMasterTimelineColumns();
    placeBatteryBelowWireless();
    ensureChartContextColumns();
    drawAllCharts();
    drawTrialStrip();
    renderTrialCompletionSummary();
    renderAllContextCanvases();
  } catch (e) {
    console.warn("AppHanoi refinement deferred until participant data loads.", e);
  }
});


/* ==========================================================================
   Participant Surveys
   Loads <participant>/survey.json. Missing file = section stays hidden.
   ========================================================================== */

state.survey = null;

function ensureSurveySection() {
  let section = el("participantSurveys");
  if (section) return section;

  section = document.createElement("section");
  section.id = "participantSurveys";
  section.className = "survey-section";
  section.hidden = true;
  section.innerHTML = `
    <div class="survey-section-heading">
      <div>
        <div class="eyebrow">Participant-reported data</div>
        <h2>Participant Surveys</h2>
      </div>
      <div class="survey-section-note" id="surveyParticipantLabel"></div>
    </div>
    <div class="survey-grid">
      <article class="survey-card" id="preSurveyCard"></article>
      <article class="survey-card" id="postSurveyCard"></article>
    </div>`;

  const charts = el("charts");
  if (charts && charts.parentNode) charts.insertAdjacentElement("afterend", section);
  else document.querySelector("main")?.appendChild(section);

  return section;
}

function surveySafe(value, fallback="—") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function surveyYesNo(value) {
  if (value === true) return '<span class="survey-pill">Yes</span>';
  if (value === false) return '<span class="survey-pill no">No</span>';
  return '<span class="survey-value">—</span>';
}

function surveyPill(value) {
  if (value === null || value === undefined || value === "") {
    return '<span class="survey-value">—</span>';
  }
  const v = escapeHTML(String(value));
  const noClass = String(value).trim().toLowerCase() === "no" ? " no" : "";
  return `<span class="survey-pill${noClass}">${v}</span>`;
}

function surveyKV(label, valueHTML) {
  return `<div class="survey-kv"><span class="survey-kv-label">${escapeHTML(label)}</span>${valueHTML}</div>`;
}

function surveyTextKV(label, value) {
  return surveyKV(label, `<span class="survey-value">${escapeHTML(String(surveySafe(value)))}</span>`);
}

function surveyRating(label, value, max=5) {
  const n = Number(value);
  const valid = Number.isFinite(n);
  const count = valid ? Math.max(0, Math.min(max, Math.round(n))) : 0;
  let dots = "";
  for (let i=1; i<=max; i++) {
    dots += `<span class="survey-rating-dot${i<=count ? " on" : ""}"></span>`;
  }
  return `<div class="survey-rating-row">
    <span class="survey-rating-label">${escapeHTML(label)}</span>
    <span class="survey-rating-dots" aria-label="${valid ? `${count} of ${max}` : "not available"}">${dots}</span>
    <span class="survey-rating-number">${valid ? `${count}/${max}` : "—"}</span>
  </div>`;
}

function surveyGroup(title, body) {
  return `<section class="survey-group">
    <h4 class="survey-group-title">${escapeHTML(title)}</h4>
    ${body}
  </section>`;
}

function renderPreSurvey(pre) {
  const card = el("preSurveyCard");
  if (!card) return;
  if (!pre) {
    card.innerHTML = `<div class="survey-card-header"><h3 class="survey-card-title">Pre-Survey</h3></div>
      <div class="survey-empty">No pre-survey data.</div>`;
    return;
  }

  const mood = pre.emotional_state_ratings || {};
  const background = [
    surveyTextKV("Age", pre.age),
    surveyTextKV("Gender", pre.gender)
  ].join("");

  const prior = [
    surveyKV("Robot interaction before", surveyYesNo(pre.interacted_with_robot_before)),
    surveyKV("EEG / emotion monitoring before", surveyYesNo(pre.used_eeg_or_emotion_monitoring_before)),
    surveyKV("Tower of Hanoi before", surveyYesNo(pre.done_tower_of_hanoi_before))
  ].join("");

  let emotion = [
    surveyRating("Puzzle confidence", pre.puzzle_confidence),
    surveyRating("Stressed", mood.stressed),
    surveyRating("Calmed", mood.calmed),
    surveyRating("Frustrated", mood.frustrated)
  ].join("");
  if (pre.emotional_state_description) {
    emotion += `<div class="survey-quote">${escapeHTML(String(pre.emotional_state_description))}</div>`;
  }

  card.innerHTML = `
    <div class="survey-card-header">
      <h3 class="survey-card-title">Pre-Survey</h3>
      <span class="survey-card-subtitle">${escapeHTML(String(surveySafe(pre.date, "")))}</span>
    </div>
    ${surveyGroup("Participant", `<div class="survey-kv-grid">${background}</div>`)}
    ${surveyGroup("Prior Experience", `<div class="survey-kv-grid">${prior}</div>`)}
    ${surveyGroup("Before the Study", emotion)}
  `;
}

function renderPostSurvey(post) {
  const card = el("postSurveyCard");
  if (!card) return;
  if (!post) {
    card.innerHTML = `<div class="survey-card-header"><h3 class="survey-card-title">Post-Survey</h3></div>
      <div class="survey-empty">No post-survey data.</div>`;
    return;
  }

  const experience = [
    surveyKV("Overall experience", surveyPill(post.overall_experience_with_robot)),
    surveyKV("Robot helpfulness", surveyPill(post.robot_helpfulness)),
    surveyKV("Response timing", surveyPill(post.robot_response_timing)),
    surveyKV("Awareness of frustration / stress", surveyPill(post.robot_awareness_of_frustration_or_stress))
  ].join("");

  const source = post.frustration_source || {};
  let frustration = surveyKV("Experienced frustration", surveyYesNo(post.experienced_frustration));
  if (post.experienced_frustration === true) {
    frustration += `<div class="survey-kv-grid" style="margin-top:8px">
      ${surveyKV("Puzzle", surveyPill(source.puzzle))}
      ${surveyKV("Robot", surveyPill(source.robot))}
      ${surveyKV("Touch-screen control", surveyPill(source.touch_screen_control))}
      ${surveyKV("Other", surveyPill(source.other))}
    </div>`;
  }

  const attempts = post.attempts || {};
  const attemptRows = [
    surveyTextKV("Attempt 1", attempts.attempt_1),
    surveyTextKV("Attempt 2", attempts.attempt_2)
  ].join("");

  const eeg = post.eeg_headset || {};
  let final = [
    surveyRating("EEG headset comfort", eeg.comfort_level),
    surveyRating("Robot safety concerns", post.robot_safety_concerns),
    surveyRating("Participate in similar study again", post.participate_in_similar_studies_future)
  ].join("");
  if (eeg.discomfort_description) {
    final += `<div class="survey-quote">${escapeHTML(String(eeg.discomfort_description))}</div>`;
  }

  card.innerHTML = `
    <div class="survey-card-header">
      <h3 class="survey-card-title">Post-Survey</h3>
      <span class="survey-card-subtitle">After study</span>
    </div>
    ${surveyGroup("Robot Experience", `<div class="survey-kv-grid">${experience}</div>`)}
    ${surveyGroup("Frustration", frustration)}
    ${surveyGroup("Attempts", `<div class="survey-kv-grid">${attemptRows}</div>`)}
    ${surveyGroup("Comfort, Safety & Future Participation", final)}
  `;
}

function renderSurveySection() {
  const section = ensureSurveySection();
  if (!state.survey) {
    section.hidden = true;
    return;
  }

  const id = state.survey.participant_number ?? state.participant;
  const label = el("surveyParticipantLabel");
  if (label) label.textContent = `Participant ${id} · survey.json`;

  renderPreSurvey(state.survey.pre_survey);
  renderPostSurvey(state.survey.post_survey);
  section.hidden = false;
}

async function loadSurveyForParticipant(id) {
  state.survey = null;
  renderSurveySection();

  try {
    const response = await fetch(`${encodeURIComponent(id)}/survey.json`, {cache:"no-store"});
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`${id}/survey.json: ${response.status} ${response.statusText}`);

    const survey = await response.json();
    // Participant number is useful for validation, but do not reject older files
    // that omit it.
    if (survey.participant_number !== undefined &&
        String(survey.participant_number) !== String(id)) {
      console.warn(`survey.json participant_number (${survey.participant_number}) does not match folder (${id}).`);
    }

    state.survey = survey;
    renderSurveySection();
  } catch (err) {
    console.warn(`Survey data for participant ${id} was not loaded:`, err);
    state.survey = null;
    renderSurveySection();
  }
}

/* Wrap participant loading so survey.json follows the same participant folder. */
const appOriginalLoadParticipant = loadParticipant;
loadParticipant = async function(id) {
  await appOriginalLoadParticipant(id);
  await loadSurveyForParticipant(id);
};


requestAnimationFrame(() => {
  ensureSurveySection();
  if (state.participant) loadSurveyForParticipant(state.participant);
});
