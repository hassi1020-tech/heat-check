
const $ = id => document.getElementById(id);
const state = {
  stream:null, measuring:false, timer:null, samples:[], lastGray:null,
  faceDetector:null, latestResult:null, roi:null, roiFrames:[]
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
    if(!validateFields()){ alert("作業員ID・作業員名・現場名を入力してください。"); return; }
    if(!state.stream){ guide.textContent="カメラが開始されていません。"; return; }

    const video=$("video");
    if(!video||video.readyState<2){ guide.textContent="映像準備中です。2秒後にもう一度押してください。"; return; }

    const cfg=settings();
    const warmup=Number(cfg.warmupSec)||5;
    const duration=15;

    state.measuring=true; state.samples=[]; state.latestResult=null; state.lastGray=null;
    $("resultCard").classList.add("hidden");
    $("startMeasure").disabled=true; $("stopCamera").disabled=true;
    $("countdown").textContent="準備 "+warmup;
    $("quality").textContent="準備中";
    $("stability").textContent="--";
    $("bpmLive").textContent="--";
    guide.textContent="測定を開始しました。顔を枠内に入れ、正面を向いてください。";

    const started=performance.now();
    const work=document.createElement("canvas");
    work.width=180; work.height=135;
    const ctx=work.getContext("2d",{willReadFrequently:true});
    if(!ctx) throw new Error("画像解析を開始できません");

    let lastSampleAt=0, prevGray=null;

    function roiStats(x,y,w,h){
      const data=ctx.getImageData(x,y,w,h).data;
      let r=0,g=0,b=0,lum=0;
      const gray=new Uint8Array(data.length/4);
      for(let i=0,j=0;i<data.length;i+=4,j++){
        r+=data[i]; g+=data[i+1]; b+=data[i+2];
        const yy=data[i]*.299+data[i+1]*.587+data[i+2]*.114;
        gray[j]=yy; lum+=yy;
      }
      const n=gray.length;
      return {r:r/n,g:g/n,b:b/n,lum:lum/n,redness:(r/n)/Math.max(1,g/n),blueRatio:(b/n)/Math.max(1,r/n),gray};
    }

    function loop(now){
      try{
        if(!state.measuring)return;
        const elapsed=(now-started)/1000;
        const measured=Math.max(0,elapsed-warmup);
        $("countdown").textContent=elapsed<warmup
          ?"準備 "+Math.max(0,Math.ceil(warmup-elapsed))
          :Math.max(0,duration-measured).toFixed(1);

        ctx.drawImage(video,0,0,180,135);
        const forehead=roiStats(66,18,48,24);
        const left=roiStats(43,59,36,28);
        const right=roiStats(101,59,36,28);

        const merged=new Uint8Array(forehead.gray.length+left.gray.length+right.gray.length);
        merged.set(forehead.gray,0); merged.set(left.gray,forehead.gray.length);
        merged.set(right.gray,forehead.gray.length+left.gray.length);

        let motion=0;
        if(prevGray&&prevGray.length===merged.length){
          for(let i=0;i<merged.length;i+=5) motion+=Math.abs(merged[i]-prevGray[i]);
          motion/=Math.ceil(merged.length/5);
        }
        prevGray=merged;

        if(elapsed>=warmup&&now-lastSampleAt>=100){
          state.samples.push({t:now/1000,regions:[forehead,left,right],motion});
          lastSampleAt=now;
          if(state.samples.length>10){
            const q=analyzeFace(state.samples);
            $("quality").textContent=q.qualityLabel;
            $("stability").textContent=q.motionLabel;
            $("bpmLive").textContent=q.colorChangeLabel;
            if($("facePosition"))$("facePosition").textContent=q.positionLabel;
            if($("lightingStatus"))$("lightingStatus").textContent=q.lightingLabel;
          }else $("quality").textContent="取得中 "+state.samples.length;
        }

        if(measured>=duration){ finishMeasure(); return; }
        state.timer=requestAnimationFrame(loop);
      }catch(err){
        state.measuring=false;
        $("startMeasure").disabled=false; $("stopCamera").disabled=false;
        guide.textContent="測定中エラー："+(err?.message||String(err));
      }
    }
    state.timer=requestAnimationFrame(loop);
  }catch(err){
    state.measuring=false;
    if($("startMeasure"))$("startMeasure").disabled=false;
    if($("stopCamera"))$("stopCamera").disabled=false;
    if(guide)guide.textContent="開始エラー："+(err?.message||String(err));
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
function avg(arr){ return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0; }
function pctChange(a,b){ return a===0?0:((b-a)/Math.abs(a))*100; }


function workerFaceBaseline(workerId){
  const list=records()
    .filter(r=>r.workerId===workerId && r.quality>=70 && r.level==="green")
    .slice(-10);
  if(list.length<3) return null;
  return {
    colorChange:avg(list.map(r=>Number(r.colorChange)||0)),
    rednessChange:avg(list.map(r=>Number(r.rednessChange)||0)),
    brightnessChange:avg(list.map(r=>Number(r.brightnessChange)||0)),
    asymmetry:avg(list.map(r=>Number(r.asymmetry)||0)),
    avgMotion:avg(list.map(r=>Number(r.avgMotion)||0))
  };
}

function todayRecords(){
  const today=new Date().toISOString().slice(0,10);
  return records().filter(r=>(r.timestamp||"").slice(0,10)===today);
}

function updateSummary(){
  const list=todayRecords();
  const c={green:0,yellow:0,orange:0,red:0};
  list.forEach(r=>{ if(c[r.level]!==undefined)c[r.level]++; });
  if($("sumTotal"))$("sumTotal").textContent=list.length;
  if($("sumGreen"))$("sumGreen").textContent=c.green;
  if($("sumYellow"))$("sumYellow").textContent=c.yellow;
  if($("sumOrange"))$("sumOrange").textContent=c.orange;
  if($("sumRed"))$("sumRed").textContent=c.red;
}
function analyzeFace(samples){
  if(samples.length<50){
    return {quality:0,qualityLabel:"不足",avgMotion:99,motionLabel:"不足",
      colorChange:0,colorChangeLabel:"不足",rednessChange:0,brightnessChange:0,
      asymmetry:0,asymmetryLabel:"不足",paleScore:0,redScore:0,
      lightingBias:99,lightingLabel:"不足",positionScore:0,positionLabel:"不足"};
  }

  const split=Math.max(10,Math.floor(samples.length*.30));
  const first=samples.slice(0,split), last=samples.slice(-split);
  const regionMean=(list,ri,key)=>avg(list.map(s=>s.regions[ri][key]));

  const firstLum=avg([0,1,2].map(i=>regionMean(first,i,"lum")));
  const lastLum=avg([0,1,2].map(i=>regionMean(last,i,"lum")));
  const firstRed=avg([0,1,2].map(i=>regionMean(first,i,"redness")));
  const lastRed=avg([0,1,2].map(i=>regionMean(last,i,"redness")));
  const firstBlue=avg([0,1,2].map(i=>regionMean(first,i,"blueRatio")));
  const lastBlue=avg([0,1,2].map(i=>regionMean(last,i,"blueRatio")));

  const brightnessChange=pctChange(firstLum,lastLum);
  const rednessChange=pctChange(firstRed,lastRed);
  const blueChange=pctChange(firstBlue,lastBlue);

  const leftLum=regionMean(samples,1,"lum"), rightLum=regionMean(samples,2,"lum");
  const leftRed=regionMean(samples,1,"redness"), rightRed=regionMean(samples,2,"redness");
  const lightingBias=Math.abs(leftLum-rightLum)/Math.max(1,(leftLum+rightLum)/2)*100;

  // 左右照明差がある場合、色の左右差を明るさ比で補正
  const leftNorm=leftRed/Math.max(.2,leftLum/Math.max(1,(leftLum+rightLum)/2));
  const rightNorm=rightRed/Math.max(.2,rightLum/Math.max(1,(leftLum+rightLum)/2));
  const asymmetry=Math.abs(leftNorm-rightNorm)/Math.max(.01,(leftNorm+rightNorm)/2)*100;

  const avgMotion=avg(samples.map(s=>s.motion));
  const lumValues=samples.flatMap(s=>s.regions.map(r=>r.lum));
  const minLum=Math.min(...lumValues), maxLum=Math.max(...lumValues), avgLum=avg(lumValues);

  // 固定ROIの3領域に十分な明るさがあるかを顔位置の簡易指標に使用
  const foreheadLum=regionMean(samples,0,"lum");
  const cheekLum=avg([leftLum,rightLum]);
  const positionScore=Math.max(0,100-Math.abs(foreheadLum-cheekLum)*1.2-Math.min(50,avgMotion*3));

  let quality=100;
  if(avgLum<45||avgLum>220)quality-=40;
  if(maxLum-minLum>90)quality-=15;
  if(lightingBias>35)quality-=25;
  else if(lightingBias>22)quality-=12;
  quality-=Math.min(40,avgMotion*3.2);
  if(positionScore<45)quality-=20;
  quality=Math.max(0,Math.min(100,quality));

  const colorMagnitude=Math.abs(brightnessChange)+Math.abs(rednessChange)+Math.abs(blueChange);
  const colorChangeLabel=colorMagnitude<4?"小":colorMagnitude<9?"中":"大";
  const motionLabel=avgMotion<4?"小":avgMotion<8?"中":"大";
  const asymmetryLabel=asymmetry<12?"小":asymmetry<25?"中":"大";
  const lightingLabel=lightingBias<15?"良好":lightingBias<30?"注意":"不良";
  const positionLabel=positionScore>=70?"良好":positionScore>=45?"注意":"不良";
  const qualityLabel=quality>=75?"良好":quality>=55?"注意":"不足";

  const paleScore=Math.max(0,-brightnessChange)+Math.max(0,blueChange);
  const redScore=Math.max(0,rednessChange)+Math.max(0,brightnessChange*.25);

  return {quality,qualityLabel,avgMotion,motionLabel,colorChange:colorMagnitude,
    colorChangeLabel,rednessChange,brightnessChange,blueChange,asymmetry,
    asymmetryLabel,paleScore,redScore,avgLum,lightingBias,lightingLabel,
    positionScore,positionLabel};
}

function workerBaseline(workerId){
  const rs=records().filter(r=>r.workerId===workerId && r.quality>=65 && r.bpm);
  if(!rs.length) return null;
  const vals=rs.slice(-5).map(r=>r.bpm).sort((a,b)=>a-b);
  return vals[Math.floor(vals.length/2)];
}

function finishMeasure(){
  state.measuring=false;
  cancelAnimationFrame(state.timer);
  $("startMeasure").disabled=false; $("stopCamera").disabled=false;

  const face=analyzeFace(state.samples);
  const context={
    wbgt:Number($("wbgt").value)||null,
    workload:$("workload").value,
    hydration:$("hydration").value,
    selfCondition:$("selfCondition").value,
    symptoms:{
      dizzy:$("symDizzy").checked,nausea:$("symNausea").checked,
      cramp:$("symCramp").checked,confusion:$("symConfusion").checked
    }
  };
  const baseline=workerFaceBaseline($("workerId").value.trim());
  const result=judge(face,context,baseline);
  state.latestResult={...result,...face,context,baseline,
    workerId:$("workerId").value.trim(),workerName:$("workerName").value.trim(),
    siteName:$("siteName").value.trim(),timing:$("timing").value,
    timestamp:new Date().toISOString()};
  showResult(state.latestResult);
}

function judge(face,context,baseline){
  const s=settings(), symptoms=context.symptoms;
  const serious=symptoms.confusion||symptoms.cramp||context.selfCondition==="bad";
  const symptomCount=Object.values(symptoms).filter(Boolean).length;

  if(serious)return {level:"red",label:"赤：作業中止・対面確認",
    instruction:"本人申告または症状に重大な項目があります。顔判定に関係なく作業を中止し、管理者が直ちに対面確認してください。意識障害、会話異常、自力で水分を取れない状態などがあれば現場の救急手順に従ってください。"};

  if(face.quality<55)return {level:"yellow",label:"判定保留：再測定",
    instruction:"映像品質が不足しているため顔状態の判定を保留しました。明るい日陰または室内で、顔を正面に向け、スマホを固定して再測定してください。本人に異常があれば測定結果を待たず作業を中止してください。"};

  let contextScore=0;
  if(context.wbgt!==null){ if(context.wbgt>=31)contextScore+=3; else if(context.wbgt>=28)contextScore+=2; else if(context.wbgt>=25)contextScore+=1; }
  if(context.workload==="high")contextScore+=2; else if(context.workload==="medium")contextScore+=1;
  if(context.hydration==="no")contextScore+=2; else if(context.hydration==="little")contextScore+=1;
  if(context.selfCondition==="slight")contextScore+=2;
  contextScore+=symptomCount*2;

  let baselineScore=0;
  if(baseline){
    if(Math.abs(face.colorChange-baseline.colorChange)>=6)baselineScore+=2;
    else if(Math.abs(face.colorChange-baseline.colorChange)>=3)baselineScore+=1;
    if(Math.abs(face.rednessChange-baseline.rednessChange)>=5)baselineScore+=2;
    else if(Math.abs(face.rednessChange-baseline.rednessChange)>=2.5)baselineScore+=1;
    if(face.avgMotion-baseline.avgMotion>=4)baselineScore+=1;
  }

  let faceScore=0;
  if(face.colorChange>=9)faceScore+=2; else if(face.colorChange>=4)faceScore+=1;
  if(face.redScore>=6||face.paleScore>=6)faceScore+=2; else if(face.redScore>=3||face.paleScore>=3)faceScore+=1;
  if(face.avgMotion>=8)faceScore+=2; else if(face.avgMotion>=4)faceScore+=1;
  if(face.asymmetry>=25)faceScore+=1;

  if(contextScore>=6||(contextScore>=4&&faceScore>=2)||(baselineScore>=4&&contextScore>=2))
    return {level:"orange",label:"橙：休憩・管理者確認",
      instruction:`作業を中断し、涼しい場所で休憩してください。水分・塩分補給後、${s.retryMin}分後に再測定し、管理者が本人の状態を直接確認してください。`};

  if(contextScore>=3||faceScore>=3||baselineScore>=3||(contextScore>=2&&faceScore>=1))
    return {level:"yellow",label:"黄：水分補給・再測定",
      instruction:`顔状態または現場条件に変化要因があります。水分・塩分を補給し、${s.retryMin}分以内に再測定してください。違和感がある場合は作業を中止してください。`};

  return {level:"green",label:"緑：明らかな変化なし",
    instruction:"顔動画・現場条件・本人申告の範囲では、明らかな変化は検出されませんでした。熱中症でないことや就業可能を保証するものではありません。"};
}

function showResult(r){
  $("resultCard").classList.remove("hidden");
  $("resultTime").textContent=new Date(r.timestamp).toLocaleString("ja-JP");
  $("levelBadge").className="badge "+r.level;
  $("levelBadge").textContent=r.label;
  $("resultBpm").textContent=`${r.colorChangeLabel}（${r.colorChange.toFixed(1)}）`;
  $("resultDelta").textContent=r.redScore>r.paleScore
    ?`赤み傾向 ${r.redScore.toFixed(1)}`
    :r.paleScore>0?`青白さ傾向 ${r.paleScore.toFixed(1)}`:"目立つ変化なし";
  $("resultRedness").textContent=Math.abs(r.rednessChange)<3?"通常域":r.rednessChange>0?"赤み増加":"赤み低下";
  $("resultMotion").textContent=r.motionLabel;
  $("resultQuality").textContent=`${r.qualityLabel}（${Math.round(r.quality)}）`;
  $("resultBaseline").textContent=`${r.asymmetryLabel}（${r.asymmetry.toFixed(1)}）`;
  $("resultStability").textContent=`${r.motionLabel}（${r.avgMotion.toFixed(1)}）`;
  const wbgtText=r.context?.wbgt!==null&&r.context?.wbgt!==undefined?`WBGT ${r.context.wbgt}`:"WBGT未入力";
  const symptomN=r.context?.symptoms?Object.values(r.context.symptoms).filter(Boolean).length:0;
  $("resultContext").textContent=`${wbgtText}・症状${symptomN}件`;
  if($("facePosition"))$("facePosition").textContent=r.positionLabel;
  if($("lightingStatus"))$("lightingStatus").textContent=r.lightingLabel;
  if($("baselineStatus")){
    if(r.baseline){
      const d=Math.abs(r.colorChange-r.baseline.colorChange);
      $("baselineStatus").textContent=d<3?"通常範囲":d<6?"やや変化":"大きな変化";
    }else $("baselineStatus").textContent="未登録";
  }
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
    <td>${esc(r.colorChangeLabel||"--")}</td><td>${esc(r.qualityLabel)}</td>
    <td>${esc(r.instruction)}</td></tr>`).join("");
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}

$("exportCsv").addEventListener("click",()=>{
  const rs=records();
  const headers=["日時","現場","作業員ID","作業員名","区分","判定","顔色変化","赤み変化","明るさ変化","顔の動き","映像品質","左右差","WBGT","作業強度","水分補給","本人申告","指示"];
  const rows=rs.map(r=>[
    new Date(r.timestamp).toLocaleString("ja-JP"),r.siteName,r.workerId,r.workerName,r.timing,
    r.label,r.colorChangeLabel||"",r.rednessChange?.toFixed(2)??"",r.brightnessChange?.toFixed(2)??"",r.motionLabel||"",r.qualityLabel,r.asymmetryLabel||"",r.context?.wbgt??"",r.context?.workload??"",r.context?.hydration??"",r.context?.selfCondition??"",r.instruction
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
$("guide").textContent="v9.0プログラム読込済み。カメラを開始してください。";
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations()
    .then(regs=>Promise.all(regs.map(r=>r.unregister())))
    .catch(()=>{});
}
if("caches" in window){
  caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
}
window.addEventListener("beforeunload",()=>state.stream?.getTracks().forEach(t=>t.stop()));
