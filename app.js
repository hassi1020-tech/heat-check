import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm";

const $ = id => document.getElementById(id);
const STORAGE_KEY = "heatCheckV12Records";
const MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

let stream = null;
let landmarker = null;
let running = false;
let measuring = false;
let rafId = null;
let latestFace = null;

const measurement = {
  startedAt: 0,
  greenSignal: [],
  motionSignal: [],
  eyeSignal: [],
  timestamps: [],
  blinkCount: 0,
  eyeWasClosed: false,
  headPoints: [],
  colorSamples: [],
  brightnessSamples: [],
  faceFrames: 0,
  totalFrames: 0
};

function records() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}
function saveRecords(rows) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 5000)));
}
function mean(a) { return a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0; }
function std(a) {
  const m=mean(a);
  return a.length ? Math.sqrt(mean(a.map(v=>(v-m)**2))) : 0;
}
function clamp(v,min,max){ return Math.max(min,Math.min(max,v)); }
function distance(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }
function median(a){
  if(!a.length) return 0;
  const x=[...a].sort((p,q)=>p-q), m=Math.floor(x.length/2);
  return x.length%2?x[m]:(x[m-1]+x[m])/2;
}

async function initLandmarker() {
  if (landmarker) return;
  $("cameraStatus").textContent = "顔解析モデルを読み込み中…";
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm"
  );
  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
    minFaceDetectionConfidence: 0.6,
    minFacePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6
  });
}

async function startCamera() {
  try {
    await initLandmarker();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false
    });
    $("video").srcObject = stream;
    await $("video").play();
    running = true;
    $("startCamera").disabled = true;
    $("measure").disabled = false;
    $("stopCamera").disabled = false;
    $("cameraStatus").textContent = "顔を正面に合わせてください。";
    renderLoop();
  } catch (e) {
    console.error(e);
    $("cameraStatus").textContent = "カメラ開始エラー：" + (e.message || e);
  }
}

function stopCamera() {
  running = false;
  measuring = false;
  cancelAnimationFrame(rafId);
  stream?.getTracks().forEach(t => t.stop());
  stream = null;
  $("video").srcObject = null;
  $("startCamera").disabled = false;
  $("measure").disabled = true;
  $("stopCamera").disabled = true;
  $("cameraStatus").textContent = "カメラを開始してください。";
}

function eyeAspectRatio(lm, side) {
  // MediaPipe iris/eye周辺の代表点。顔の向きに強く依存するため品質判定と併用。
  const idx = side === "left"
    ? {l:33,r:133,u1:159,u2:160,d1:145,d2:144}
    : {l:362,r:263,u1:386,u2:385,d1:374,d2:380};
  const width = distance(lm[idx.l], lm[idx.r]) || 1e-6;
  const h1 = distance(lm[idx.u1], lm[idx.d1]);
  const h2 = distance(lm[idx.u2], lm[idx.d2]);
  return (h1+h2)/(2*width);
}

function foreheadSample(video, lm) {
  const canvas = document.createElement("canvas");
  canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(video,0,0,canvas.width,canvas.height);

  const forehead = lm[10], left = lm[127], right = lm[356];
  const faceW = Math.abs(right.x-left.x)*canvas.width;
  const cx = forehead.x*canvas.width;
  const cy = clamp((forehead.y+0.055)*canvas.height,0,canvas.height-1);
  const w = clamp(faceW*0.28,8,45);
  const h = clamp(faceW*0.12,5,22);
  const x = clamp(cx-w/2,0,canvas.width-w);
  const y = clamp(cy-h/2,0,canvas.height-h);
  const data = ctx.getImageData(x,y,w,h).data;
  let r=0,g=0,b=0,n=0;
  for(let i=0;i<data.length;i+=16){
    r+=data[i];g+=data[i+1];b+=data[i+2];n++;
  }
  return {r:r/n,g:g/n,b:b/n,brightness:(r+g+b)/(3*n)};
}

function drawFace(result) {
  const video=$("video"), canvas=$("overlay");
  canvas.width=video.videoWidth; canvas.height=video.videoHeight;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(!result?.faceLandmarks?.length) return;
  const drawingUtils = new DrawingUtils(ctx);
  drawingUtils.drawConnectors(result.faceLandmarks[0], FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {lineWidth:2});
  drawingUtils.drawConnectors(result.faceLandmarks[0], FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {lineWidth:2});
  drawingUtils.drawConnectors(result.faceLandmarks[0], FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {lineWidth:2});
}

function collectFrame(lm, now) {
  measurement.totalFrames++;
  if(!lm) return;
  measurement.faceFrames++;

  const leftEAR=eyeAspectRatio(lm,"left"), rightEAR=eyeAspectRatio(lm,"right");
  const ear=(leftEAR+rightEAR)/2;
  const closed=ear<0.17;
  if(closed && !measurement.eyeWasClosed) measurement.eyeWasClosed=true;
  if(!closed && measurement.eyeWasClosed){ measurement.blinkCount++; measurement.eyeWasClosed=false; }

  const nose=lm[1], sample=foreheadSample($("video"),lm);
  measurement.greenSignal.push(sample.g);
  measurement.colorSamples.push(sample.r-(sample.g+sample.b)/2);
  measurement.brightnessSamples.push(sample.brightness);
  measurement.motionSignal.push(nose.y);
  measurement.eyeSignal.push(ear);
  measurement.headPoints.push({x:nose.x,y:nose.y});
  measurement.timestamps.push(now);
}

function renderLoop() {
  if(!running) return;
  const video=$("video");
  if(video.readyState>=2 && landmarker){
    const now=performance.now();
    const result=landmarker.detectForVideo(video,now);
    latestFace=result?.faceLandmarks?.[0] || null;
    drawFace(result);
    $("faceDetected").textContent=latestFace?"○":"×";
    $("cameraStatus").textContent=latestFace?"顔を検出しています。":"顔が見つかりません。正面を向いてください。";
    if(measuring) collectFrame(latestFace,now);
  }
  rafId=requestAnimationFrame(renderLoop);
}

function resetMeasurement(){
  Object.assign(measurement,{
    startedAt:performance.now(),greenSignal:[],motionSignal:[],eyeSignal:[],
    timestamps:[],blinkCount:0,eyeWasClosed:false,headPoints:[],colorSamples:[],
    brightnessSamples:[],faceFrames:0,totalFrames:0
  });
}

function resample(signal,times,targetHz=10){
  if(signal.length<3) return [];
  const start=times[0], end=times[times.length-1], step=1000/targetHz;
  const out=[]; let j=0;
  for(let t=start;t<=end;t+=step){
    while(j<times.length-2 && times[j+1]<t) j++;
    const t1=times[j],t2=times[j+1],v1=signal[j],v2=signal[j+1];
    const f=t2===t1?0:(t-t1)/(t2-t1);
    out.push(v1+(v2-v1)*f);
  }
  return out;
}

function movingAverage(a,w){
  return a.map((_,i)=>{
    const s=Math.max(0,i-w+1), x=a.slice(s,i+1);
    return mean(x);
  });
}

function estimateRate(signal,times,minBpm,maxBpm){
  const hz=10, x=resample(signal,times,hz);
  if(x.length<80) return null;
  const trend=movingAverage(x,Math.round(hz*1.5));
  const y=x.map((v,i)=>v-trend[i]);
  let best={score:-Infinity,bpm:null};
  for(let bpm=minBpm;bpm<=maxBpm;bpm++){
    const f=bpm/60;
    let s=0,c=0;
    for(let i=0;i<y.length;i++){
      const angle=2*Math.PI*f*i/hz;
      s+=y[i]*Math.sin(angle); c+=y[i]*Math.cos(angle);
    }
    const score=s*s+c*c;
    if(score>best.score) best={score,bpm};
  }
  return best.bpm;
}

function qualityMetrics(){
  const faceRatio=measurement.totalFrames?measurement.faceFrames/measurement.totalFrames:0;
  const brightness=mean(measurement.brightnessSamples);
  const brightnessOk=brightness>=55&&brightness<=210;
  const motion=std(measurement.headPoints.map(p=>p.x))+std(measurement.headPoints.map(p=>p.y));
  let score=100;
  if(faceRatio<.9) score-=35;
  else if(faceRatio<.98) score-=15;
  if(!brightnessOk) score-=25;
  if(motion>.018) score-=30;
  else if(motion>.01) score-=12;
  return {score:clamp(Math.round(score),0,100),faceRatio,brightness,motion};
}

function getBaseline(workerId){
  const good=records().filter(r=>r.workerId===workerId && r.level==="green" && r.qualityScore>=70).slice(0,20);
  if(good.length<3) return null;
  return {
    heartRate:median(good.map(r=>r.heartRate).filter(Number.isFinite)),
    respRate:median(good.map(r=>r.respRate).filter(Number.isFinite)),
    blinkRate:median(good.map(r=>r.blinkRate).filter(Number.isFinite)),
    redness:median(good.map(r=>r.redness).filter(Number.isFinite)),
    headSway:median(good.map(r=>r.headSway).filter(Number.isFinite))
  };
}

function assess(features){
  let score=0, reasons=[];
  const add=(n,msg)=>{score+=n;reasons.push(msg);};
  const wbgt=features.wbgt;

  if(features.selfReport==="confused") add(100,"受け答え・意識の異常申告");
  else if(["headache","dizzy","nausea"].includes(features.selfReport)) add(45,"頭痛・めまい・吐き気の申告");
  else if(features.selfReport==="tired") add(18,"疲労・だるさの申告");

  if(wbgt>=31) add(28,`WBGT ${wbgt}℃`);
  else if(wbgt>=28) add(16,`WBGT ${wbgt}℃`);
  else if(wbgt>=25) add(7,`WBGT ${wbgt}℃`);

  if(features.hydration==="none") add(25,"水分補給なし");
  else if(features.hydration==="partial") add(10,"水分補給が少なめ");
  if(features.sleep==="poor") add(18,"睡眠が大幅に不足");
  else if(features.sleep==="short") add(8,"睡眠不足");

  if(Number.isFinite(features.heartRate) && features.heartRate>=115) add(18,`推定心拍 ${features.heartRate} bpm`);
  else if(Number.isFinite(features.heartRate) && features.heartRate>=100) add(9,`推定心拍 ${features.heartRate} bpm`);
  if(Number.isFinite(features.respRate) && features.respRate>=24) add(12,`推定呼吸数 ${features.respRate} 回/分`);
  if(Number.isFinite(features.blinkRate) && (features.blinkRate<4 || features.blinkRate>35)) add(6,"瞬き頻度が通常範囲から外れています");
  if(features.headSway>=0.02) add(12,"頭部の揺れが大きい");
  if(Math.abs(features.redness)>=28) add(8,"顔色の変化が大きい");

  if(features.baselineDelta>=2.5) add(18,"本人の通常値から大きく変化");
  else if(features.baselineDelta>=1.5) add(9,"本人の通常値から変化");

  if(features.qualityScore<55){
    score=Math.max(score,35);
    reasons.push("撮影品質が低いため再測定が必要");
  }
  score=clamp(Math.round(score),0,100);

  let level="green";
  if(score>=75) level="red";
  else if(score>=50) level="orange";
  else if(score>=25) level="yellow";

  if(features.selfReport==="confused") level="red";
  if(!reasons.length) reasons.push("大きなリスク要因は検出されませんでした");

  const actions={
    green:["定期的な水分・塩分補給を継続する","予定された休憩を実施する"],
    yellow:["日陰・冷房場所で短時間休憩する","水分・塩分を補給し、再測定する","管理者が本人へ声掛けする"],
    orange:["作業を中断して涼しい場所へ移動する","管理者が症状を確認する","冷却・水分補給後に再評価する"],
    red:["直ちに作業を中止する","涼しい場所で身体を冷却する","意識異常や自力飲水不可の場合は救急要請を検討する"]
  }[level];
  return {score,level,reasons,actions};
}

function baselineDelta(features,base){
  if(!base) return 0;
  const parts=[];
  const push=(v,b,scale)=>{if(Number.isFinite(v)&&Number.isFinite(b)&&b>0)parts.push(Math.abs(v-b)/scale);};
  push(features.heartRate,base.heartRate,12);
  push(features.respRate,base.respRate,4);
  push(features.blinkRate,base.blinkRate,8);
  push(features.redness,base.redness,10);
  push(features.headSway,base.headSway,.008);
  return parts.length?mean(parts):0;
}

async function runMeasurement(){
  if(measuring||!stream) return;
  if(!$("workerId").value.trim()) return alert("作業員IDを入力してください。");
  measuring=true; resetMeasurement();
  $("measure").disabled=true; $("result").classList.add("hidden");
  const duration=20000;
  const timer=setInterval(()=>{
    const elapsed=performance.now()-measurement.startedAt;
    $("progress").value=clamp(elapsed/duration*100,0,100);
    $("phaseText").textContent=`測定中…残り ${Math.max(0,Math.ceil((duration-elapsed)/1000))} 秒`;
  },200);

  await new Promise(r=>setTimeout(r,duration));
  clearInterval(timer); measuring=false; $("measure").disabled=false;
  $("progress").value=100; $("phaseText").textContent="測定完了";

  const q=qualityMetrics();
  const heartRate=estimateRate(measurement.greenSignal,measurement.timestamps,45,160);
  const respRate=estimateRate(measurement.motionSignal,measurement.timestamps,6,36);
  const minutes=duration/60000;
  const blinkRate=Math.round(measurement.blinkCount/minutes);
  const headSway=+(std(measurement.headPoints.map(p=>p.x))+std(measurement.headPoints.map(p=>p.y))).toFixed(4);
  const redness=+mean(measurement.colorSamples).toFixed(1);
  const workerId=$("workerId").value.trim().toUpperCase();

  const features={
    workerId,
    workerName:$("workerName").value.trim(),
    wbgt:Number($("wbgt").value),
    hydration:$("hydration").value,
    selfReport:$("selfReport").value,
    sleep:$("sleep").value,
    heartRate,
    respRate,
    blinkRate,
    headSway,
    redness,
    qualityScore:q.score
  };
  const base=getBaseline(workerId);
  features.baselineDelta=+baselineDelta(features,base).toFixed(2);
  const decision=assess(features);
  const row={id:crypto.randomUUID(),createdAt:new Date().toISOString(),...features,...decision};
  const rows=records(); rows.unshift(row); saveRecords(rows);

  showResult(row); renderHistory();
}

function showResult(r){
  $("heartRate").textContent=Number.isFinite(r.heartRate)?r.heartRate:"—";
  $("respRate").textContent=Number.isFinite(r.respRate)?r.respRate:"—";
  $("blinkRate").textContent=Number.isFinite(r.blinkRate)?r.blinkRate:"—";
  $("headSway").textContent=r.headSway;
  $("faceColor").textContent=Math.abs(r.redness)>=28?"大":Math.abs(r.redness)>=16?"中":"小";
  $("quality").textContent=`${r.qualityScore}%`;
  $("baselineDelta").textContent=r.baselineDelta||"—";

  const labels={green:"通常",yellow:"注意",orange:"警戒",red:"作業中止・確認"};
  $("riskLabel").textContent=labels[r.level];
  $("riskScore").textContent=`リスクスコア ${r.score}/100`;
  $("resultHero").className=`hero ${r.level}`;
  $("reasons").innerHTML=r.reasons.map(x=>`<li>${escapeHtml(x)}</li>`).join("");
  $("actions").innerHTML=r.actions.map(x=>`<li>${escapeHtml(x)}</li>`).join("");
  $("result").classList.remove("hidden");
  $("result").scrollIntoView({behavior:"smooth",block:"start"});
}

function escapeHtml(v){
  return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function renderHistory(){
  $("historyBody").innerHTML=records().slice(0,100).map(r=>`
    <tr>
      <td>${new Date(r.createdAt).toLocaleString("ja-JP")}</td>
      <td>${escapeHtml(r.workerId)}</td>
      <td>${({green:"通常",yellow:"注意",orange:"警戒",red:"中止"})[r.level]}</td>
      <td>${r.score}</td><td>${r.wbgt}</td>
      <td>${r.heartRate??"—"}</td><td>${r.respRate??"—"}</td>
      <td>${r.blinkRate??"—"}</td><td>${r.qualityScore}%</td>
    </tr>`).join("");
}

function exportCsv(){
  const rows=records();
  const cols=["createdAt","workerId","workerName","level","score","wbgt","hydration","selfReport","sleep","heartRate","respRate","blinkRate","headSway","redness","qualityScore","baselineDelta"];
  const csv=[cols.join(","),...rows.map(r=>cols.map(k=>`"${String(r[k]??"").replaceAll('"','""')}"`).join(","))].join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`heat-check-${new Date().toISOString().slice(0,10)}.csv`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$("startCamera").onclick=startCamera;
$("stopCamera").onclick=stopCamera;
$("measure").onclick=runMeasurement;
$("exportCsv").onclick=exportCsv;
$("clearHistory").onclick=()=>{if(confirm("測定履歴をすべて削除しますか？")){localStorage.removeItem(STORAGE_KEY);renderHistory();}};
renderHistory();

if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(console.warn);
