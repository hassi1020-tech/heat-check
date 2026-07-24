
const $ = id => document.getElementById(id);
const state = {
  stream:null, measuring:false, timer:null, samples:[], lastGray:null,
  faceDetector:null, latestResult:null, roi:null
};

const defaults = {
  durationSec:25, warmupSec:5, yellowDelta:20, orangeDelta:35,
  yellowBpm:100, orangeBpm:120, retryMin:10
};

function loadSettings(){
  const s = {...defaults, ...(JSON.parse(localStorage.getItem("heatSettings")||"{}"))};
  Object.keys(s).forEach(k => { if($(k)) $(k).value=s[k]; });
  return s;
}
function settings(){
  const out={};
  Object.keys(defaults).forEach(k=>{
    const el=$(k);
    const n=el ? Number(el.value) : defaults[k];
    out[k]=Number.isFinite(n) ? n : defaults[k];
  });
  return out;
}
function records(){ return JSON.parse(localStorage.getItem("heatRecords")||"[]"); }
function saveRecords(v){ localStorage.setItem("heatRecords", JSON.stringify(v)); }

document.querySelectorAll(".nav").forEach(b=>b.addEventListener("click",()=>{
  document.querySelectorAll(".nav,.view").forEach(x=>x.classList.remove("active"));
  b.classList.add("active"); $(b.dataset.view).classList.add("active");
  if(b.dataset.view==="dashboard") renderDashboard();
}));

async function startCamera(){
  try{
    state.stream = await navigator.mediaDevices.getUserMedia({
      video:{facingMode:"user",width:{ideal:640},height:{ideal:480}},audio:false
    });
    $("video").srcObject=state.stream; await $("video").play();
    $("startMeasure").disabled=false; $("stopCamera").disabled=false;
    $("startCamera").disabled=true;
    if("FaceDetector" in window){
      try{ state.faceDetector = new FaceDetector({fastMode:true,maxDetectedFaces:1}); }catch{}
    }
    drawOverlay();
  }catch(e){
    alert("カメラを開始できません。HTTPS接続またはブラウザのカメラ許可を確認してください。\n"+e.message);
  }
}

function stopCamera(){
  if(state.measuring) return;
  state.stream?.getTracks().forEach(t=>t.stop());
  state.stream=null; $("video").srcObject=null;
  $("startMeasure").disabled=true; $("stopCamera").disabled=true; $("startCamera").disabled=false;
}

function drawOverlay(){
  const c=$("overlay"), v=$("video");
  c.width=v.videoWidth||640; c.height=v.videoHeight||480;
  const ctx=c.getContext("2d"); ctx.clearRect(0,0,c.width,c.height);
  const w=c.width*.46,h=c.height*.62,x=(c.width-w)/2,y=(c.height-h)/2;
  state.roi={x:x+w*.2,y:y+h*.18,w:w*.6,h:h*.32}; // forehead/upper cheeks
  ctx.strokeStyle="#22c55e";ctx.lineWidth=4;ctx.setLineDash([12,8]);
  ctx.beginPath();ctx.ellipse(c.width/2,c.height/2,w/2,h/2,0,0,Math.PI*2);ctx.stroke();
}

function validateFields(){
  return $("workerId").value.trim() && $("workerName").value.trim() && $("siteName").value.trim();
}

async function startMeasure(){
  const guide=$("guide");
  try{
    if(guide) guide.textContent="測定開始を受け付けました。";

    if(!validateFields()){
      alert("作業員ID・作業員名・現場名を入力してください。");
      return;
    }
    if(!state.stream){
      if(guide) guide.textContent="カメラが開始されていません。";
      return;
    }

    const video=$("video");
    if(!video || video.readyState < 2){
      if(guide) guide.textContent="映像準備中です。2秒後にもう一度押してください。";
      return;
    }

    const cfg=settings();
    const warmup=Number(cfg.warmupSec)||5;
    const duration=Number(cfg.durationSec)||25;

    state.measuring=true;
    state.samples=[];
    state.lastGray=null;
    state.latestResult=null;

    $("resultCard").classList.add("hidden");
    $("startMeasure").disabled=true;
    $("stopCamera").disabled=true;
    $("countdown").textContent="準備 "+warmup;
    guide.textContent="測定を開始しました。顔を動かさないでください。";

    const started=performance.now();
    const work=document.createElement("canvas");
    work.width=160;
    work.height=120;
    const ctx=work.getContext("2d");
    if(!ctx) throw new Error("画像解析を開始できません");

    let lastSampleAt=0;

    function loop(now){
      try{
        if(!state.measuring) return;

        const elapsed=(now-started)/1000;
        const measured=Math.max(0,elapsed-warmup);

        $("countdown").textContent = elapsed < warmup
          ? "準備 "+Math.max(0,Math.ceil(warmup-elapsed))
          : Math.max(0,duration-measured).toFixed(1);

        ctx.drawImage(video,0,0,160,120);

        // 額付近の固定領域。スマホ互換性を優先
        const img=ctx.getImageData(50,14,60,38).data;
        let r=0,g=0,b=0,lum=0;
        const gray=new Uint8Array(img.length/4);

        for(let i=0,j=0;i<img.length;i+=4,j++){
          r+=img[i]; g+=img[i+1]; b+=img[i+2];
          const y=img[i]*0.299+img[i+1]*0.587+img[i+2]*0.114;
          gray[j]=y;
          lum+=y;
        }

        const n=gray.length;
        r/=n; g/=n; b/=n; lum/=n;

        let motion=0;
        if(state.lastGray && state.lastGray.length===gray.length){
          for(let i=0;i<n;i+=4) motion+=Math.abs(gray[i]-state.lastGray[i]);
          motion/=(n/4);
        }
        state.lastGray=gray;

        if(elapsed>=warmup && now-lastSampleAt>=60){
          state.samples.push({t:now/1000,g,r,b,lum,motion});
          lastSampleAt=now;
          $("quality").textContent="取得中 "+state.samples.length;
        }

        if(elapsed>=warmup && state.samples.length>120){
          const quick=analyzeSignal(state.samples.slice(-160));
          $("bpmLive").textContent=quick.bpm?Math.round(quick.bpm):"--";
          $("quality").textContent=quick.qualityLabel;
        }

        if(measured>=duration){
          finishMeasure();
          return;
        }

        state.timer=requestAnimationFrame(loop);
      }catch(err){
        state.measuring=false;
        $("startMeasure").disabled=false;
        $("stopCamera").disabled=false;
        guide.textContent="測定中エラー："+(err?.message||String(err));
      }
    }

    state.timer=requestAnimationFrame(loop);
  }catch(err){
    state.measuring=false;
    if($("startMeasure")) $("startMeasure").disabled=false;
    if($("stopCamera")) $("stopCamera").disabled=false;
    if(guide) guide.textContent="開始エラー："+(err?.message||String(err));
  }
}

function movingAverage(arr,win){
  const out=[];let sum=0;
  for(let i=0;i<arr.length;i++){
    sum+=arr[i]; if(i>=win) sum-=arr[i-win];
    out.push(sum/Math.min(i+1,win));
  } return out;
}
function std(arr){
  const m=arr.reduce((a,b)=>a+b,0)/Math.max(1,arr.length);
  return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/Math.max(1,arr.length));
}
function analyzeSignal(samples){
  if(samples.length<180) return {bpm:null,quality:0,qualityLabel:"不足",avgMotion:99,avgLum:0,pulseStrength:0};

  const times=samples.map(x=>x.t);
  const duration=times.at(-1)-times[0];
  const fs=(samples.length-1)/Math.max(.001,duration);
  const gs=samples.map(x=>x.g);
  const rs=samples.map(x=>x.r);

  // 緑成分主体、赤成分を少量差し引き
  const raw=gs.map((v,i)=>v-rs[i]*0.20);
  const trend=movingAverage(raw,Math.max(5,Math.round(fs*1.5)));
  let sig=raw.map((v,i)=>v-trend[i]);
  const mean=sig.reduce((a,b)=>a+b,0)/sig.length;
  sig=sig.map(v=>v-mean);

  // ハニング窓
  const win=sig.map((v,i)=>v*(0.5-0.5*Math.cos(2*Math.PI*i/(sig.length-1))));

  // 0.75–2.5Hz（45–150bpm）を細かく走査
  let bestF=null,bestPower=-1,totalPower=0;
  for(let f=.75;f<=2.5;f+=.01){
    let re=0,im=0;
    for(let i=0;i<win.length;i++){
      const t=times[i]-times[0];
      re+=win[i]*Math.cos(2*Math.PI*f*t);
      im-=win[i]*Math.sin(2*Math.PI*f*t);
    }
    const p=re*re+im*im;
    totalPower+=p;
    if(p>bestPower){bestPower=p;bestF=f;}
  }

  const avgMotion=samples.reduce((a,x)=>a+x.motion,0)/samples.length;
  const avgLum=samples.reduce((a,x)=>a+x.lum,0)/samples.length;
  const pulseStrength=std(sig);
  const peakRatio=bestPower/Math.max(1,totalPower/176);
  let bpm=bestF?bestF*60:null;

  let quality=100;
  quality-=Math.min(60,avgMotion*4.2);
  if(avgLum<55||avgLum>215) quality-=35;
  if(pulseStrength<.08) quality-=25;
  if(peakRatio<4) quality-=30;
  if(bpm<45||bpm>150){bpm=null;quality-=30;}
  quality=Math.max(0,Math.min(100,quality));

  const qualityLabel=quality>=72?"良好":quality>=52?"注意":"不良";
  return {bpm,quality,qualityLabel,avgMotion,avgLum,pulseStrength,peakRatio};
}

function workerBaseline(workerId){
  const rs=records().filter(r=>r.workerId===workerId && r.quality>=65 && r.bpm);
  if(!rs.length) return null;
  const vals=rs.slice(-5).map(r=>r.bpm).sort((a,b)=>a-b);
  return vals[Math.floor(vals.length/2)];
}

function finishMeasure(){
  state.measuring=false; cancelAnimationFrame(state.timer);
  $("startMeasure").disabled=false; $("stopCamera").disabled=false;
  const a=analyzeSignal(state.samples);
  const reds=state.samples.map(x=>x.r/(x.g||1));
  const redness=reds.reduce((x,y)=>x+y,0)/reds.length;
  const baseline=workerBaseline($("workerId").value.trim());
  const delta=(a.bpm&&baseline)?a.bpm-baseline:null;
  const result=judge(a,redness,baseline,delta);
  state.latestResult={...result,...a,redness,baseline,delta,
    workerId:$("workerId").value.trim(),
    workerName:$("workerName").value.trim(),
    siteName:$("siteName").value.trim(),
    timing:$("timing").value,
    timestamp:new Date().toISOString()
  };
  showResult(state.latestResult);
}

function judge(a,redness,baseline,delta){
  const s=settings();
  if(a.quality<52 || !a.bpm){
    return {level:"yellow",label:"判定保留：再測定",instruction:"測定品質が不十分なため、体調判定は行っていません。明るい日陰または室内でスマホを固定し、マスク・ヘルメットを外せる安全な状況で再測定してください。"};
  }
  const recent=records().filter(r=>r.workerId===$("workerId").value.trim()).slice(-1)[0];
  const repeatedOrange=recent && recent.level==="orange" && (Date.now()-Date.parse(recent.timestamp)<30*60*1000);

  const orange = a.bpm>=s.orangeBpm || (delta!==null&&delta>=s.orangeDelta) ||
                 (a.avgMotion>10 && redness>1.18);
  const yellow = a.bpm>=s.yellowBpm || (delta!==null&&delta>=s.yellowDelta) ||
                 redness>1.16 || a.avgMotion>7;

  if(orange && repeatedOrange){
    return {level:"red",label:"赤：作業中止・対面確認",instruction:"前回に続き高リスク傾向です。作業を中止し、管理者が対面で会話・歩行・自力飲水を確認してください。異常があれば救急要請を含め現場手順に従ってください。"};
  }
  if(orange){
    return {level:"orange",label:"橙：休憩・管理者確認",instruction:`作業を中断し、涼しい場所で休憩してください。水分・塩分を補給し、${s.retryMin}分後に再測定してください。管理者が本人の状態を直接確認してください。`};
  }
  if(yellow){
    return {level:"yellow",label:"黄：水分補給・再測定",instruction:`水分・塩分を補給し、${s.retryMin}分以内に再測定してください。体調に違和感があれば作業を中止してください。`};
  }
  return {level:"green",label:"緑：明らかな変化なし",instruction:"申告を伴わない顔動画解析上、明らかな変化は検出されませんでした。安全や就業可能を保証するものではありません。"};
}

function showResult(r){
  $("resultCard").classList.remove("hidden");
  $("resultTime").textContent=new Date(r.timestamp).toLocaleString("ja-JP");
  $("levelBadge").className="badge "+r.level; $("levelBadge").textContent=r.label;
  $("resultBpm").textContent=r.bpm?Math.round(r.bpm)+" bpm":"測定不能";
  $("resultDelta").textContent=r.delta===null?"基準未登録":`${r.delta>=0?"+":""}${Math.round(r.delta)} bpm`;
  $("resultRedness").textContent=r.redness>1.18?"高め":r.redness>1.16?"やや高め":"通常域";
  $("resultMotion").textContent=r.avgMotion>10?"大":r.avgMotion>7?"中":"小";
  $("resultQuality").textContent=`${r.qualityLabel}（${Math.round(r.quality)}）`;
  $("resultBaseline").textContent=r.baseline?Math.round(r.baseline)+" bpm":"未登録";
  $("instruction").textContent=r.instruction;
}

$("saveResult").addEventListener("click",()=>{
  if(!state.latestResult)return;
  const rs=records();rs.push(state.latestResult);saveRecords(rs);
  alert("結果を端末内に保存しました。顔画像・動画は保存していません。");
});
$("remeasure").addEventListener("click",()=>{ $("resultCard").classList.add("hidden"); startMeasure(); });
$("startMeasure").onclick=function(e){
  e.preventDefault();
  startMeasure();
};
$("startCamera").addEventListener("click",startCamera);
$("stopCamera").addEventListener("click",stopCamera);

function renderDashboard(){
  const rs=records().sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
  const counts={green:0,yellow:0,orange:0,red:0};rs.forEach(r=>counts[r.level]++);
  $("summary").innerHTML=[
    `緑 ${counts.green}`,`黄 ${counts.yellow}`,`橙 ${counts.orange}`,`赤 ${counts.red}`,`合計 ${rs.length}`
  ].map(x=>`<span>${x}</span>`).join("");
  $("recordsBody").innerHTML=rs.map(r=>`<tr>
    <td>${new Date(r.timestamp).toLocaleString("ja-JP")}</td>
    <td>${esc(r.siteName)}</td><td>${esc(r.workerName)}（${esc(r.workerId)}）</td>
    <td>${esc(r.timing)}</td><td class="level-cell">${esc(r.label)}</td>
    <td>${r.bpm?Math.round(r.bpm):"--"}</td><td>${esc(r.qualityLabel)}</td>
    <td>${esc(r.instruction)}</td></tr>`).join("");
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

$("exportCsv").addEventListener("click",()=>{
  const rs=records();
  const headers=["日時","現場","作業員ID","作業員名","区分","判定","推定脈拍","通常値との差","信号品質","指示"];
  const rows=rs.map(r=>[
    new Date(r.timestamp).toLocaleString("ja-JP"),r.siteName,r.workerId,r.workerName,r.timing,
    r.label,r.bpm?Math.round(r.bpm):"",r.delta===null?"":Math.round(r.delta),r.qualityLabel,r.instruction
  ]);
  const csv=[headers,...rows].map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=`暑熱リスク測定_${new Date().toISOString().slice(0,10)}.csv`;a.click();
  URL.revokeObjectURL(a.href);
});
$("clearData").addEventListener("click",()=>{
  if(confirm("保存済み測定結果を全て削除しますか？")){localStorage.removeItem("heatRecords");renderDashboard();}
});
$("saveSettings").addEventListener("click",()=>{
  localStorage.setItem("heatSettings",JSON.stringify(settings()));alert("設定を保存しました。");
});

loadSettings();
$("guide").textContent="v6プログラム読込済み。カメラを開始してください。";
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations()
    .then(regs=>Promise.all(regs.map(r=>r.unregister())))
    .catch(()=>{});
}
if("caches" in window){
  caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
}
window.addEventListener("beforeunload",()=>state.stream?.getTracks().forEach(t=>t.stop()));
