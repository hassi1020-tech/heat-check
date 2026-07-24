
const $ = id => document.getElementById(id);
const state = {
  stream:null, measuring:false, timer:null, samples:[], lastGray:null,
  faceDetector:null, latestResult:null, roi:null, roiFrames:[], landmark:null, landmarkReady:false
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
    if($("trackingStatus"))$("trackingStatus").textContent="AI読込中";
    try{
      let wait=0;
      while(!window.FaceLandmarkTracker && wait<50){
        await new Promise(r=>setTimeout(r,100)); wait++;
      }
      if(window.FaceLandmarkTracker){
        await window.FaceLandmarkTracker.init();
        state.landmarkReady=true;
        $("trackingStatus").textContent="追従可能";
        $("trackingStatus").className="tracking-good";
      }else throw new Error("顔追従モジュール未読込");
    }catch(err){
      state.landmarkReady=false;
      if($("trackingStatus")){
        $("trackingStatus").textContent="固定枠方式";
        $("trackingStatus").className="tracking-warn";
      }
      console.warn("Face Landmarker fallback:",err);
    }
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


function drawLandmarkOverlay(track){
  const c=$("overlay"),v=$("video");
  if(!c||!v)return;
  c.width=v.videoWidth||640;c.height=v.videoHeight||480;
  const ctx=c.getContext("2d");
  ctx.clearRect(0,0,c.width,c.height);

  if(!track){
    drawOverlay();
    return;
  }

  const mirrorX=n=>(1-n)*c.width;
  const regionColors=["#38bdf8","#22c55e","#22c55e"];
  [track.regions.forehead,track.regions.leftCheek,track.regions.rightCheek].forEach((r,i)=>{
    if(!r)return;
    const x=mirrorX(r.x+r.w), y=r.y*c.height, w=r.w*c.width, h=r.h*c.height;
    ctx.strokeStyle=regionColors[i];ctx.lineWidth=3;ctx.setLineDash([7,5]);
    ctx.strokeRect(x,y,w,h);
  });

  ctx.setLineDash([]);
  ctx.fillStyle="rgba(255,255,255,.75)";
  track.points.filter((_,i)=>i%8===0).forEach(p=>{
    ctx.beginPath();ctx.arc(mirrorX(p.x),p.y*c.height,1.2,0,Math.PI*2);ctx.fill();
  });
}

function landmarkRectPixels(rect, width, height){
  if(!rect)return null;
  const x=Math.max(0,Math.floor((1-rect.x-rect.w)*width));
  const y=Math.max(0,Math.floor(rect.y*height));
  const w=Math.max(2,Math.min(width-x,Math.floor(rect.w*width)));
  const h=Math.max(2,Math.min(height-y,Math.floor(rect.h*height)));
  return {x,y,w,h};
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

    state.measuring=true; state.samples=[]; state.latestResult=null; state.lastGray=null; state.landmark=null;
    window.FaceLandmarkTracker?.reset?.();
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

        ctx.save();
        ctx.translate(180,0);ctx.scale(-1,1);
        ctx.drawImage(video,0,0,180,135);
        ctx.restore();

        let track=null;
        if(state.landmarkReady&&window.FaceLandmarkTracker){
          try{ track=window.FaceLandmarkTracker.detect(video,now)||state.landmark; }catch{}
        }
        if(track)state.landmark=track;
        drawLandmarkOverlay(track);

        let fr={x:66,y:18,w:48,h:24};
        let lr={x:43,y:59,w:36,h:28};
        let rr={x:101,y:59,w:36,h:28};
        if(track){
          fr=landmarkRectPixels(track.regions.forehead,180,135)||fr;
          lr=landmarkRectPixels(track.regions.leftCheek,180,135)||lr;
          rr=landmarkRectPixels(track.regions.rightCheek,180,135)||rr;
        }

        const forehead=roiStats(fr.x,fr.y,fr.w,fr.h);
        const left=roiStats(lr.x,lr.y,lr.w,lr.h);
        const right=roiStats(rr.x,rr.y,rr.w,rr.h);

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
          state.samples.push({t:now/1000,regions:[forehead,left,right],motion,
            pose:track?.pose||null,blink:track?.blink||null,headMovement:track?.headMovement||0,tracked:!!track});
          lastSampleAt=now;
          if(state.samples.length>10){
            const q=analyzeFace(state.samples);
            $("quality").textContent=q.qualityLabel;
            $("stability").textContent=q.motionLabel;
            $("bpmLive").textContent=q.colorChangeLabel;
            if($("facePosition"))$("facePosition").textContent=q.positionLabel;
            if($("lightingStatus"))$("lightingStatus").textContent=q.lightingLabel;
            if($("trackingStatus"))$("trackingStatus").textContent=q.trackingRate>=70?"追従良好":q.trackingRate>=35?"追従注意":"固定枠方式";
            if($("poseStatus"))$("poseStatus").textContent=q.poseLabel;
            if($("blinkStatus"))$("blinkStatus").textContent=q.blinkLabel;
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
  const tracked=samples.filter(s=>s.tracked&&s.pose);
  const trackingRate=tracked.length/Math.max(1,samples.length)*100;
  const avgPosition=tracked.length?avg(tracked.map(s=>s.pose.positionScore)):0;
  const avgRoll=tracked.length?avg(tracked.map(s=>Math.abs(s.pose.rollDeg))):0;
  const avgYaw=tracked.length?avg(tracked.map(s=>Math.abs(s.pose.yawIndex))):0;
  const blinkCount=tracked.length?Math.max(...tracked.map(s=>s.blink?.count10s||0)):0;
  const avgHeadMovement=tracked.length?avg(tracked.map(s=>s.headMovement||0)):0;
  const poseLabel=!tracked.length?"固定枠":avgPosition>=75?"正面良好":avgPosition>=50?"向き注意":"正面を向く";
  const blinkLabel=!tracked.length?"未取得":blinkCount===0?"未検出":`${blinkCount}回`;
  const lumValues=samples.flatMap(s=>s.regions.map(r=>r.lum));
  const minLum=Math.min(...lumValues), maxLum=Math.max(...lumValues), avgLum=avg(lumValues);

  // 固定ROIの3領域に十分な明るさがあるかを顔位置の簡易指標に使用
  const foreheadLum=regionMean(samples,0,"lum");
  const cheekLum=avg([leftLum,rightLum]);
  const fixedPositionScore=Math.max(0,100-Math.abs(foreheadLum-cheekLum)*1.2-Math.min(50,avgMotion*3));
  const positionScore=tracked.length?avgPosition:fixedPositionScore;

  let quality=100;
  if(avgLum<45||avgLum>220)quality-=40;
  if(maxLum-minLum>90)quality-=15;
  if(lightingBias>35)quality-=25;
  else if(lightingBias>22)quality-=12;
  quality-=Math.min(40,avgMotion*3.2);
  if(positionScore<45)quality-=20;
  if(state.landmarkReady&&trackingRate<35)quality-=20;
  if(avgRoll>15||avgYaw>.18)quality-=15;
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
    positionScore,positionLabel,trackingRate,poseLabel,blinkLabel,blinkCount,
    avgRoll,avgYaw,avgHeadMovement};
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
    siteName:$("siteName").value.trim(),teamName:$("teamName")?.value.trim()||"",timing:$("timing").value,
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
  if($("trackingStatus"))$("trackingStatus").textContent=(r.trackingRate||0)>=70?"追従良好":(r.trackingRate||0)>=35?"追従注意":"固定枠方式";
  if($("poseStatus"))$("poseStatus").textContent=r.poseLabel||"未確認";
  if($("blinkStatus"))$("blinkStatus").textContent=r.blinkLabel||"未確認";
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
  updateSummary();
  populateWorkerSelect();
  renderAdminDashboard();
  renderNotifications();
  renderAnalysis();
  renderValidation();
});
$("remeasure").addEventListener("click",()=>{ $("resultCard").classList.add("hidden"); startMeasure(); });
$("startMeasure").onclick=function(e){
  e.preventDefault();
  startMeasure();
};
$("startCamera").addEventListener("click",startCamera);
$("stopCamera").addEventListener("click",stopCamera);


function levelRank(level){
  return ({green:0,yellow:1,orange:2,red:3})[level] ?? 0;
}

function levelShort(level){
  return ({green:"緑",yellow:"黄",orange:"橙",red:"赤"})[level] || "--";
}

function timingBand(record){
  const t=record.timing||"";
  const hour=new Date(record.timestamp).getHours();
  if(t.includes("朝")||hour<10) return "morning";
  if(t.includes("昼")||(hour>=10&&hour<14)) return "noon";
  return "afternoon";
}

function workerRecords(workerId){
  return records()
    .filter(r=>r.workerId===workerId)
    .sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
}

function populateWorkerSelect(){
  const select=$("workerSelect");
  if(!select)return;
  const current=select.value;
  const map=new Map();
  records().forEach(r=>{
    if(r.workerId)map.set(r.workerId,r.workerName||r.workerId);
  });
  const items=[...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],"ja"));
  select.innerHTML='<option value="">作業員を選択</option>'+
    items.map(([id,name])=>`<option value="${esc(id)}">${esc(name)}（${esc(id)}）</option>`).join("");
  if(items.some(([id])=>id===current))select.value=current;
}

function differenceComment(latest,previous){
  if(!previous)return "初回記録";
  const color=(Number(latest.colorChange)||0)-(Number(previous.colorChange)||0);
  const motion=(Number(latest.avgMotion)||0)-(Number(previous.avgMotion)||0);
  const level=levelRank(latest.level)-levelRank(previous.level);

  if(level>=1)return "判定が悪化";
  if(level<=-1)return "判定が改善";
  if(color>=3||motion>=3)return "顔状態がやや悪化";
  if(color<=-3&&motion<=1)return "顔状態が改善";
  return "大きな変化なし";
}

function consecutiveCaution(list){
  let count=0;
  for(let i=list.length-1;i>=0;i--){
    if(["yellow","orange","red"].includes(list[i].level))count++;
    else break;
  }
  return count;
}

function averageBand(list,band){
  const filtered=list.filter(r=>timingBand(r)===band);
  if(!filtered.length)return "--";
  const recent=filtered.slice(-5);
  const maxLevel=Math.max(...recent.map(r=>levelRank(r.level)));
  const avgColor=avg(recent.map(r=>Number(r.colorChange)||0));
  return `${levelShort(["green","yellow","orange","red"][maxLevel])}・変化${avgColor.toFixed(1)}`;
}

function trendComment(list){
  if(!list.length)return "保存済みデータがありません。";
  const latest=list.at(-1);
  const previous=list.length>1?list.at(-2):null;
  const caution=consecutiveCaution(list);
  const parts=[];

  if(previous)parts.push(`前回比：${differenceComment(latest,previous)}。`);
  if(caution>=2)parts.push(`注意判定が${caution}回連続しています。管理者による対面確認を推奨します。`);
  else if(latest.level==="orange"||latest.level==="red")parts.push("直近判定は管理者確認が必要な水準です。");

  const today=new Date().toISOString().slice(0,10);
  const todayList=list.filter(r=>(r.timestamp||"").slice(0,10)===today);
  if(todayList.length>=2){
    const first=todayList[0],last=todayList.at(-1);
    const d=(Number(last.colorChange)||0)-(Number(first.colorChange)||0);
    if(d>=3)parts.push("本日は朝から顔色変化が増えています。");
    else if(d<=-3)parts.push("本日は朝より顔色変化が小さくなっています。");
    else parts.push("本日の顔色変化は概ね横ばいです。");
  }

  if(latest.context?.wbgt>=28)parts.push(`直近WBGTは${latest.context.wbgt}で、環境負荷が高めです。`);
  return parts.join(" ")||"大きな悪化傾向は確認されていません。";
}

function drawTrendChart(list){
  const canvas=$("workerTrendChart");
  if(!canvas)return;
  const ctx=canvas.getContext("2d");
  const dpr=window.devicePixelRatio||1;
  const cssW=Math.max(320,canvas.clientWidth||900);
  const cssH=260;
  canvas.width=Math.round(cssW*dpr);
  canvas.height=Math.round(cssH*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,cssW,cssH);
  ctx.font="12px sans-serif";

  const data=list.slice(-12);
  const pad={l:42,r:20,t:18,b:42};
  const w=cssW-pad.l-pad.r,h=cssH-pad.t-pad.b;

  ctx.strokeStyle="#cbd5e1";
  ctx.lineWidth=1;
  for(let i=0;i<=4;i++){
    const y=pad.t+h*i/4;
    ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(pad.l+w,y);ctx.stroke();
  }

  if(!data.length){
    ctx.fillStyle="#64748b";
    ctx.textAlign="center";
    ctx.fillText("作業員を選択すると履歴を表示します",cssW/2,cssH/2);
    return;
  }

  const values=data.flatMap(r=>[
    Number(r.colorChange)||0,
    Number(r.avgMotion)||0,
    Number(r.context?.wbgt)||0
  ]);
  const max=Math.max(10,...values);
  const x=i=>data.length===1?pad.l+w/2:pad.l+w*i/(data.length-1);
  const y=v=>pad.t+h-(Math.min(max,v)/max)*h;

  const series=[
    {key:r=>Number(r.colorChange)||0,width:3},
    {key:r=>Number(r.avgMotion)||0,width:2},
    {key:r=>Number(r.context?.wbgt)||0,width:2}
  ];

  const dashPatterns=[[],[6,4],[2,4]];
  series.forEach((s,si)=>{
    ctx.save();
    ctx.strokeStyle=["#0f766e","#475569","#a16207"][si];
    ctx.lineWidth=s.width;
    ctx.setLineDash(dashPatterns[si]);
    ctx.beginPath();
    data.forEach((r,i)=>{
      const px=x(i),py=y(s.key(r));
      if(i===0)ctx.moveTo(px,py);else ctx.lineTo(px,py);
    });
    ctx.stroke();
    ctx.restore();
  });

  ctx.fillStyle="#64748b";
  ctx.textAlign="center";
  data.forEach((r,i)=>{
    if(data.length<=6||i%2===0||i===data.length-1){
      const d=new Date(r.timestamp);
      ctx.fillText(`${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`,x(i),cssH-16);
    }
  });
}

function renderWorkerCard(){
  const select=$("workerSelect");
  if(!select)return;
  const id=select.value;
  const alertBox=$("workerAlert");

  if(!id){
    alertBox.className="worker-alert neutral";
    alertBox.textContent="作業員を選択してください。";
    ["cardLatest","cardDifference","cardTodayCount","cardConsecutive","bandMorning","bandNoon","bandAfternoon"]
      .forEach(x=>$(x).textContent=x==="cardTodayCount"||x==="cardConsecutive"?"0回":"--");
    $("workerComment").textContent="保存済みデータが3件以上になると、傾向コメントの精度が上がります。";
    drawTrendChart([]);
    return;
  }

  const list=workerRecords(id);
  const latest=list.at(-1);
  const previous=list.length>1?list.at(-2):null;
  const today=new Date().toISOString().slice(0,10);
  const todayCount=list.filter(r=>(r.timestamp||"").slice(0,10)===today).length;
  const caution=consecutiveCaution(list);

  $("cardLatest").textContent=latest?latest.label:"--";
  $("cardDifference").textContent=latest?differenceComment(latest,previous):"--";
  $("cardTodayCount").textContent=`${todayCount}回`;
  $("cardConsecutive").textContent=`${caution}回`;
  $("bandMorning").textContent=averageBand(list,"morning");
  $("bandNoon").textContent=averageBand(list,"noon");
  $("bandAfternoon").textContent=averageBand(list,"afternoon");
  $("workerComment").textContent=trendComment(list);

  if(latest){
    alertBox.className=`worker-alert ${latest.level}`;
    alertBox.textContent=caution>=2
      ?`${latest.workerName}：注意判定が${caution}回連続しています。`
      :`${latest.workerName}：直近は「${latest.label}」です。`;
  }
  drawTrendChart(list);
}

function selectedAdminDate(){
  const el=$("adminDate");
  return el&&el.value ? el.value : new Date().toISOString().slice(0,10);
}

function filteredAdminRecords(){
  const date=selectedAdminDate();
  const site=$("adminSite")?.value||"";
  const level=$("adminLevel")?.value||"";
  const team=$("adminTeam")?.value||"";
  return records().filter(r=>{
    const dateOk=(r.timestamp||"").slice(0,10)===date;
    const siteOk=!site||r.siteName===site;
    const levelOk=!level||r.level===level;
    const teamOk=!team||r.teamName===team;
    return dateOk&&siteOk&&teamOk&&levelOk;
  });
}

function populateAdminSites(){
  const select=$("adminSite");
  if(!select)return;
  const current=select.value;
  const sites=uniqueText([...loadMaster().sites,...records().map(r=>r.siteName).filter(Boolean)]).sort((a,b)=>a.localeCompare(b,"ja"));
  select.innerHTML='<option value="">すべての現場</option>'+
    sites.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if(sites.includes(current))select.value=current;
}

function latestByWorker(list){
  const map=new Map();
  list.forEach(r=>{
    const prev=map.get(r.workerId);
    if(!prev||Date.parse(r.timestamp)>Date.parse(prev.timestamp))map.set(r.workerId,r);
  });
  return [...map.values()];
}

function renderAttentionList(){
  const box=$("attentionList");
  if(!box)return;
  const list=latestByWorker(filteredAdminRecords())
    .filter(r=>["yellow","orange","red"].includes(r.level))
    .sort((a,b)=>levelRank(b.level)-levelRank(a.level)||Date.parse(b.timestamp)-Date.parse(a.timestamp));

  if(!list.length){
    box.textContent="該当者なし";
    return;
  }

  box.innerHTML=list.map(r=>`
    <div class="attention-item ${r.level}">
      <strong>${esc(r.workerName||r.workerId)}（${esc(r.workerId)}）</strong>
      <span>${esc(r.siteName)}／${esc(r.label)}／${new Date(r.timestamp).toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"})}</span>
      <div>${esc(r.instruction||"管理者が本人を確認してください。")}</div>
    </div>`).join("");
}

function renderDailySummary(){
  const box=$("dailySummary");
  if(!box)return;
  const list=filteredAdminRecords();
  const uniqueWorkers=new Set(list.map(r=>r.workerId).filter(Boolean));
  const levels={green:0,yellow:0,orange:0,red:0};
  list.forEach(r=>{if(levels[r.level]!==undefined)levels[r.level]++;});
  const avgWbgt=list.filter(r=>Number.isFinite(Number(r.context?.wbgt)))
    .map(r=>Number(r.context.wbgt));
  const avgWbgtText=avgWbgt.length?(avg(avgWbgt)).toFixed(1):"--";
  const expected=expectedWorkersForFilter();
  const measuredIds=new Set(list.map(r=>r.workerId));
  const measuredExpected=expected.filter(w=>measuredIds.has(w.id)).length;
  const rate=expected.length?Math.round(measuredExpected/expected.length*100):null;

  box.innerHTML=`
    <div class="daily-summary-grid">
      <div><span>測定件数</span><strong>${list.length}</strong></div>
      <div><span>測定人数</span><strong>${uniqueWorkers.size}</strong></div>
      <div><span>平均WBGT</span><strong>${avgWbgtText}</strong></div>
      <div><span>要対応件数</span><strong>${levels.yellow+levels.orange+levels.red}</strong></div>
      <div><span>緑</span><strong>${levels.green}</strong></div>
      <div><span>黄</span><strong>${levels.yellow}</strong></div>
      <div><span>橙</span><strong>${levels.orange}</strong></div>
      <div><span>赤</span><strong>${levels.red}</strong></div>
      <div><span>対象作業員</span><strong>${expected.length||"--"}</strong></div>
      <div><span>測定率</span><strong>${rate===null?"--":rate+"%"}</strong></div>
    </div>
    ${rate===null?"":`<div class="measure-rate"><div style="width:${rate}%"></div></div>`}`;
}

function checkMissingWorkers(){
  const box=$("missingList");
  const raw=$("expectedWorkers")?.value||"";
  const expected=[...new Set(raw.split(/\r?\n|,|、/).map(s=>s.trim()).filter(Boolean))];
  if(!expected.length){
    box.textContent="対象作業員IDを入力してください。";
    return;
  }

  const measured=new Set(filteredAdminRecords().map(r=>r.workerId));
  const missing=expected.filter(id=>!measured.has(id));

  if(!missing.length){
    box.textContent="入力された対象者は全員測定済みです。";
    return;
  }
  box.innerHTML=missing.map(id=>`
    <div class="missing-item">
      <strong>${esc(id)}</strong>
      <span>${esc(selectedAdminDate())}の測定記録がありません。</span>
    </div>`).join("");
}

function renderAdminDashboard(){
  populateAdminSites();
  renderAttentionList();
  renderDailySummary();
}

function exportDailyCsv(){
  const list=filteredAdminRecords();
  if(!list.length){
    alert("対象条件の保存済みデータがありません。");
    return;
  }

  const headers=[
    "日時","現場","作業班","作業員ID","作業員名","区分","判定",
    "顔色変化","赤み変化","顔の動き","映像品質","左右差",
    "WBGT","作業強度","水分補給","本人申告","管理指示"
  ];
  const rows=[headers,...list.map(r=>[
    new Date(r.timestamp).toLocaleString("ja-JP"),
    r.siteName,r.teamName||"",r.workerId,r.workerName,r.timing,r.label,
    r.colorChange?.toFixed?.(2)??r.colorChange??"",
    r.rednessChange?.toFixed?.(2)??r.rednessChange??"",
    r.motionLabel||"",
    r.qualityLabel||"",
    r.asymmetry?.toFixed?.(2)??r.asymmetry??"",
    r.context?.wbgt??"",
    r.context?.workload??"",
    r.context?.hydration??"",
    r.context?.selfCondition??"",
    r.instruction||""
  ])];

  const csv=rows.map(row=>row.map(v=>`"${String(v??"").replaceAll('"','""')}"`).join(",")).join("\r\n");
  const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  const site=$("adminSite")?.value||"全現場";
  a.download=`暑熱チェック日報_${selectedAdminDate()}_${site}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
function renderDashboard(){
  updateSummary();
  renderAnalysis();
  renderValidation();
  renderAdminDashboard();
  populateWorkerSelect();
  const rs=records().sort((a,b)=>Date.parse(b.timestamp)-Date.parse(a.timestamp));
  const counts={green:0,yellow:0,orange:0,red:0};rs.forEach(r=>counts[r.level]++);
  $("summary").innerHTML=[
    `緑 ${counts.green}`,`黄 ${counts.yellow}`,`橙 ${counts.orange}`,`赤 ${counts.red}`,`合計 ${rs.length}`
  ].map(x=>`<span>${x}</span>`).join("");
  $("recordsBody").innerHTML=rs.map(r=>`<tr>
    <td>${new Date(r.timestamp).toLocaleString("ja-JP")}</td>
    <td>${esc(r.siteName)}<br><small>${esc(r.teamName||"")}</small></td><td>${esc(r.workerName)}（${esc(r.workerId)}）</td>
    <td>${esc(r.timing)}</td><td class="level-cell">${esc(r.label)}</td>
    <td>${esc(r.colorChangeLabel||"--")}</td><td>${esc(r.qualityLabel)}</td>
    <td>${esc(r.instruction)}</td></tr>`).join("");
  renderWorkerCard();
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));}



if($("copyDailyReport"))$("copyDailyReport").addEventListener("click",()=>copyTextArea("dailyReportText"));
if($("copyMonthlyReport"))$("copyMonthlyReport").addEventListener("click",()=>copyTextArea("monthlyReportText"));
if($("validationWorker"))$("validationWorker").addEventListener("change",populateValidationRecords);
if($("saveValidation"))$("saveValidation").addEventListener("click",saveValidationEntry);
renderAnalysis();
renderValidation();

if($("addSiteMaster"))$("addSiteMaster").addEventListener("click",addSiteMaster);
if($("addTeamMaster"))$("addTeamMaster").addEventListener("click",addTeamMaster);
if($("addWorkerMaster"))$("addWorkerMaster").addEventListener("click",addWorkerMaster);
if($("workerId"))$("workerId").addEventListener("change",fillWorkerFromMaster);
if($("clearNotifications"))$("clearNotifications").addEventListener("click",clearNotifications);
if($("adminTeam"))$("adminTeam").addEventListener("change",()=>{renderAdminDashboard();renderAnalysis();});
if($("exportMasterJson"))$("exportMasterJson").addEventListener("click",()=>{
  downloadJson(`heat-check-master_${new Date().toISOString().slice(0,10)}.json`,loadMaster());
});
if($("importMasterJson"))$("importMasterJson").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=await readJsonFile(file);
    if(!Array.isArray(data.sites)||!Array.isArray(data.teams)||!Array.isArray(data.workers))throw new Error();
    localStorage.setItem(MASTER_KEY,JSON.stringify(data));renderMaster();alert("マスタを読み込みました。");
  }catch{alert("マスタファイルを読み込めませんでした。");}
  e.target.value="";
});
if($("exportAllData"))$("exportAllData").addEventListener("click",()=>{
  downloadJson(`heat-check-backup_${new Date().toISOString().slice(0,10)}.json`,{
    schemaVersion:"9.4",exportedAt:new Date().toISOString(),master:loadMaster(),records:records(),
    settings:JSON.parse(localStorage.getItem("heatSettings")||"{}"),validations:validations()
  });
});
if($("importAllData"))$("importAllData").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=await readJsonFile(file);
    if(!Array.isArray(data.records)||!data.master)throw new Error();
    saveRecords(data.records);localStorage.setItem(MASTER_KEY,JSON.stringify(data.master));
    if(data.settings)localStorage.setItem("heatSettings",JSON.stringify(data.settings));
    if(Array.isArray(data.validations))saveValidations(data.validations);
    renderMaster();renderDashboard();alert("全データを復元しました。");
  }catch{alert("バックアップファイルを復元できませんでした。");}
  e.target.value="";
});
renderMaster();
renderNotifications();

if($("adminDate")){
  $("adminDate").value=new Date().toISOString().slice(0,10);
  $("adminDate").addEventListener("change",()=>{renderAdminDashboard();renderAnalysis();});
}
if($("adminSite"))$("adminSite").addEventListener("change",()=>{renderAdminDashboard();renderAnalysis();});
if($("adminLevel"))$("adminLevel").addEventListener("change",()=>{renderAdminDashboard();renderAnalysis();});
if($("checkMissing"))$("checkMissing").addEventListener("click",checkMissingWorkers);
if($("exportDailyCsv"))$("exportDailyCsv").addEventListener("click",exportDailyCsv);

if($("workerSelect")){
  $("workerSelect").addEventListener("change",renderWorkerCard);
}
window.addEventListener("resize",()=>{
  if($("workerSelect")?.value)renderWorkerCard();
});

$("exportCsv").addEventListener("click",()=>{
  const rs=records();
  const headers=["日時","現場","作業班","作業員ID","作業員名","区分","判定","顔色変化","赤み変化","明るさ変化","顔の動き","映像品質","左右差","WBGT","作業強度","水分補給","本人申告","指示"];
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
$("guide").textContent="v9.5プログラム読込済み。カメラを開始してください。";
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations()
    .then(regs=>Promise.all(regs.map(r=>r.unregister())))
    .catch(()=>{});
}
if("caches" in window){
  caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
}
window.addEventListener("beforeunload",()=>state.stream?.getTracks().forEach(t=>t.stop()));
const MASTER_KEY="heatCheckMasterV94";
const NOTICE_KEY="heatCheckNoticeAckV94";

function defaultMaster(){
  return {version:"9.4",sites:[],teams:[],workers:[],updatedAt:new Date().toISOString()};
}
function loadMaster(){
  try{
    return {...defaultMaster(),...JSON.parse(localStorage.getItem(MASTER_KEY)||"{}")};
  }catch{return defaultMaster();}
}
function saveMaster(master){
  master.updatedAt=new Date().toISOString();
  localStorage.setItem(MASTER_KEY,JSON.stringify(master));
  renderMaster();
}
function uniqueText(list){return [...new Set(list.map(v=>String(v||"").trim()).filter(Boolean))];}
function downloadJson(filename,data){
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json;charset=utf-8"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();
  URL.revokeObjectURL(a.href);
}
function readJsonFile(file){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>{try{resolve(JSON.parse(reader.result));}catch(e){reject(e);}};
    reader.onerror=reject;reader.readAsText(file);
  });
}
function renderMaster(){
  const m=loadMaster();
  const siteList=$("siteMasterList"),teamList=$("teamMasterList"),workerList=$("workerMasterList");
  if(!siteList)return;

  siteList.innerHTML=m.sites.length?m.sites.map((s,i)=>`
    <span class="master-chip">${esc(s)}<button type="button" data-master-remove="site" data-index="${i}">×</button></span>`).join("")
    :"未登録";
  teamList.innerHTML=m.teams.length?m.teams.map((s,i)=>`
    <span class="master-chip">${esc(s)}<button type="button" data-master-remove="team" data-index="${i}">×</button></span>`).join("")
    :"未登録";
  workerList.innerHTML=m.workers.length?m.workers.map((w,i)=>`
    <div class="worker-master-row">
      <strong>${esc(w.id)}</strong><span>${esc(w.name)}</span>
      <span>${esc(w.site||"所属未設定")}</span><span>${esc(w.team||"班未設定")}</span>
      <button type="button" data-master-remove="worker" data-index="${i}">削除</button>
    </div>`).join("")
    :"作業員は未登録です。";

  const siteOptions='<option value="">所属現場</option>'+m.sites.map(s=>`<option>${esc(s)}</option>`).join("");
  const teamOptions='<option value="">作業班</option>'+m.teams.map(s=>`<option>${esc(s)}</option>`).join("");
  if($("masterWorkerSite"))$("masterWorkerSite").innerHTML=siteOptions;
  if($("masterWorkerTeam"))$("masterWorkerTeam").innerHTML=teamOptions;

  if($("workerIdList"))$("workerIdList").innerHTML=m.workers.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join("");
  if($("siteNameList"))$("siteNameList").innerHTML=m.sites.map(s=>`<option value="${esc(s)}"></option>`).join("");
  if($("teamNameList"))$("teamNameList").innerHTML=m.teams.map(s=>`<option value="${esc(s)}"></option>`).join("");

  document.querySelectorAll("[data-master-remove]").forEach(btn=>{
    btn.onclick=()=>{
      const master=loadMaster(),type=btn.dataset.masterRemove,index=Number(btn.dataset.index);
      if(type==="site")master.sites.splice(index,1);
      if(type==="team")master.teams.splice(index,1);
      if(type==="worker")master.workers.splice(index,1);
      saveMaster(master);
    };
  });
  populateAdminSites();
  populateAdminTeams();
  populateWorkerSelect();
  renderAdminDashboard();
  renderNotifications();
}

function fillWorkerFromMaster(){
  const id=$("workerId")?.value.trim();
  if(!id)return;
  const w=loadMaster().workers.find(x=>x.id===id);
  if(!w)return;
  $("workerName").value=w.name||"";
  if(w.site)$("siteName").value=w.site;
  if($("teamName")&&w.team)$("teamName").value=w.team;
}

function addSiteMaster(){
  const value=$("masterSiteName").value.trim();if(!value)return;
  const m=loadMaster();m.sites=uniqueText([...m.sites,value]);saveMaster(m);
  $("masterSiteName").value="";
}
function addTeamMaster(){
  const value=$("masterTeamName").value.trim();if(!value)return;
  const m=loadMaster();m.teams=uniqueText([...m.teams,value]);saveMaster(m);
  $("masterTeamName").value="";
}
function addWorkerMaster(){
  const id=$("masterWorkerId").value.trim(),name=$("masterWorkerName").value.trim();
  if(!id||!name){alert("作業員IDと氏名を入力してください。");return;}
  const m=loadMaster();
  const item={id,name,site:$("masterWorkerSite").value,team:$("masterWorkerTeam").value,active:true};
  const index=m.workers.findIndex(w=>w.id===id);
  if(index>=0)m.workers[index]=item;else m.workers.push(item);
  m.workers.sort((a,b)=>a.id.localeCompare(b.id,"ja"));
  saveMaster(m);
  ["masterWorkerId","masterWorkerName"].forEach(x=>$(x).value="");
}

function populateAdminTeams(){
  const select=$("adminTeam");if(!select)return;
  const current=select.value;
  const masterTeams=loadMaster().teams;
  const recordTeams=records().map(r=>r.teamName).filter(Boolean);
  const teams=uniqueText([...masterTeams,...recordTeams]).sort((a,b)=>a.localeCompare(b,"ja"));
  select.innerHTML='<option value="">すべての班</option>'+teams.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join("");
  if(teams.includes(current))select.value=current;
}

function expectedWorkersForFilter(){
  const m=loadMaster();
  const site=$("adminSite")?.value||"";
  const team=$("adminTeam")?.value||"";
  return m.workers.filter(w=>w.active!==false&&(!site||w.site===site)&&(!team||w.team===team));
}

function generateNotifications(){
  const all=records().sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const grouped=new Map();
  all.forEach(r=>{
    if(!grouped.has(r.workerId))grouped.set(r.workerId,[]);
    grouped.get(r.workerId).push(r);
  });
  const notices=[];
  grouped.forEach((list,id)=>{
    const latest=list.at(-1);if(!latest)return;
    const consecutive=consecutiveCaution(list);
    if(latest.level==="red"||latest.level==="orange"||(latest.level==="yellow"&&consecutive>=2)){
      notices.push({
        id:`${id}_${latest.timestamp}`,
        workerId:id,workerName:latest.workerName,siteName:latest.siteName,
        teamName:latest.teamName||"",level:latest.level,label:latest.label,
        timestamp:latest.timestamp,consecutive,instruction:latest.instruction
      });
    }
  });
  return notices.sort((a,b)=>levelRank(b.level)-levelRank(a.level)||Date.parse(b.timestamp)-Date.parse(a.timestamp));
}
function renderNotifications(){
  const box=$("notificationList");if(!box)return;
  const ack=JSON.parse(localStorage.getItem(NOTICE_KEY)||"[]");
  const notices=generateNotifications().filter(n=>!ack.includes(n.id));
  if(!notices.length){box.textContent="通知はありません。";return;}
  box.innerHTML=notices.map(n=>`
    <div class="notification-item ${n.level}">
      <strong>${esc(n.workerName||n.workerId)}（${esc(n.workerId)}）— ${esc(n.label)}</strong>
      <span>${esc(n.siteName||"現場未設定")}／${esc(n.teamName||"班未設定")}／${new Date(n.timestamp).toLocaleString("ja-JP")}</span>
      <div>${n.consecutive>=2?`注意判定 ${n.consecutive}回連続。`:""}${esc(n.instruction||"管理者が対面確認してください。")}</div>
    </div>`).join("");
}
function clearNotifications(){
  const ack=JSON.parse(localStorage.getItem(NOTICE_KEY)||"[]");
  const ids=generateNotifications().map(n=>n.id);
  localStorage.setItem(NOTICE_KEY,JSON.stringify([...new Set([...ack,...ids])]));
  renderNotifications();
}

const VALIDATION_KEY="heatCheckValidationV95";

function validations(){
  try{return JSON.parse(localStorage.getItem(VALIDATION_KEY)||"[]");}
  catch{return [];}
}
function saveValidations(list){
  localStorage.setItem(VALIDATION_KEY,JSON.stringify(list));
}

function dateRangeRecords(days,site="",team=""){
  const end=new Date();
  const start=new Date();
  start.setHours(0,0,0,0);
  start.setDate(start.getDate()-(days-1));
  return records().filter(r=>{
    const d=new Date(r.timestamp);
    return d>=start&&d<=end&&(!site||r.siteName===site)&&(!team||r.teamName===team);
  });
}

function countLevels(list){
  const c={green:0,yellow:0,orange:0,red:0};
  list.forEach(r=>{if(c[r.level]!==undefined)c[r.level]++;});
  return c;
}

function percent(n,d){
  return d?Math.round(n/d*100):0;
}

function trendDirection(list,key){
  if(list.length<4)return "データ不足";
  const sorted=[...list].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const half=Math.floor(sorted.length/2);
  const first=sorted.slice(0,half),last=sorted.slice(half);
  const a=avg(first.map(key)),b=avg(last.map(key));
  const d=b-a;
  if(d>=3)return "上昇";
  if(d<=-3)return "低下";
  return "横ばい";
}

function highRiskWorkers(list){
  const map=new Map();
  list.forEach(r=>{
    if(!map.has(r.workerId))map.set(r.workerId,[]);
    map.get(r.workerId).push(r);
  });
  return [...map.entries()].map(([id,rows])=>{
    rows.sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
    const latest=rows.at(-1);
    const cautions=rows.filter(r=>["yellow","orange","red"].includes(r.level)).length;
    const consecutive=consecutiveCaution(rows);
    const score=levelRank(latest.level)*3+Math.min(4,consecutive)+Math.min(3,cautions);
    return {id,name:latest.workerName||id,latest,consecutive,cautions,score};
  }).filter(x=>x.score>=3).sort((a,b)=>b.score-a.score);
}

function buildRecommendations(list){
  const c=countLevels(list);
  const latestWorkers=latestByWorker(list);
  const wbgt=list.map(r=>Number(r.context?.wbgt)).filter(Number.isFinite);
  const maxWbgt=wbgt.length?Math.max(...wbgt):null;
  const rec=[];

  if(c.red>0){
    rec.push({type:"danger",title:"赤判定者の即時確認",
      text:"作業を継続させず、管理者が本人の意識・会話・歩行状態を確認してください。異常があれば救急要請を含めて対応してください。"});
  }
  if(c.orange>0){
    rec.push({type:"danger",title:"橙判定者の作業離脱",
      text:"涼しい場所で休憩させ、水分・塩分補給後に管理者が再確認してください。"});
  }
  const repeated=highRiskWorkers(list).filter(x=>x.consecutive>=2);
  if(repeated.length){
    rec.push({type:"warn",title:"注意判定の連続",
      text:`${repeated.map(x=>x.name).slice(0,5).join("、")}は注意判定が連続しています。作業内容、休憩間隔、体調申告を確認してください。`});
  }
  if(maxWbgt!==null&&maxWbgt>=28){
    rec.push({type:"warn",title:"暑熱環境への対応",
      text:`対象データの最高WBGTは${maxWbgt.toFixed(1)}です。休憩頻度、水分・塩分補給、作業強度の見直しを行ってください。`});
  }
  const noHydration=latestWorkers.filter(r=>String(r.context?.hydration||"").includes("なし"));
  if(noHydration.length){
    rec.push({type:"warn",title:"水分補給未実施者",
      text:`${noHydration.map(r=>r.workerName||r.workerId).slice(0,5).join("、")}は直近記録で水分補給なしとなっています。本人へ確認してください。`});
  }
  if(!rec.length){
    rec.push({type:"",title:"通常監視を継続",
      text:"現在の保存データでは、特別な対応を要する傾向は確認されていません。本人申告と現場巡視を継続してください。"});
  }
  return rec;
}

function analysisScope(){
  return {
    date:selectedAdminDate(),
    site:$("adminSite")?.value||"",
    team:$("adminTeam")?.value||""
  };
}

function buildDailyReport(list,scope){
  const c=countLevels(list);
  const workers=new Set(list.map(r=>r.workerId));
  const wbgt=list.map(r=>Number(r.context?.wbgt)).filter(Number.isFinite);
  const avgWbgt=wbgt.length?avg(wbgt).toFixed(1):"未入力";
  const high=highRiskWorkers(list);
  const names=high.slice(0,5).map(x=>`${x.name}（${x.latest.label}）`).join("、");

  return [
    `【暑熱コンディションチェック日報】`,
    `対象日：${scope.date}`,
    `対象現場：${scope.site||"全現場"}`,
    `対象作業班：${scope.team||"全作業班"}`,
    `測定件数：${list.length}件、測定人数：${workers.size}人`,
    `判定内訳：緑${c.green}件、黄${c.yellow}件、橙${c.orange}件、赤${c.red}件`,
    `平均WBGT：${avgWbgt}`,
    high.length?`要確認者：${names}`:"要確認者：保存データ上は該当なし",
    `対応状況：本人申告を優先し、黄以上の判定者について管理者が対面確認を行う。`,
    `備考：本システムは医療診断ではなく、非接触スクリーニング補助として使用する。`
  ].join("\n");
}

function buildMonthlyReport(list,scope){
  const c=countLevels(list);
  const workers=new Set(list.map(r=>r.workerId));
  const caution=c.yellow+c.orange+c.red;
  const colorTrend=trendDirection(list,r=>Number(r.colorChange)||0);
  const motionTrend=trendDirection(list,r=>Number(r.avgMotion)||0);
  const high=highRiskWorkers(list).slice(0,5);

  return [
    `【暑熱コンディションチェック月次傾向】`,
    `集計期間：直近30日`,
    `対象現場：${scope.site||"全現場"}`,
    `対象作業班：${scope.team||"全作業班"}`,
    `測定件数：${list.length}件、対象人数：${workers.size}人`,
    `注意判定率：${percent(caution,list.length)}％`,
    `顔色変化傾向：${colorTrend}`,
    `顔の動き傾向：${motionTrend}`,
    high.length?`継続確認対象：${high.map(x=>x.name).join("、")}`:"継続確認対象：該当なし",
    `総括：測定値のみで健康状態を断定せず、現場巡視・本人申告・WBGT・作業強度を組み合わせて運用する。`
  ].join("\n");
}

function renderAnalysis(){
  const scope=analysisScope();
  const today=filteredAdminRecords();
  const month=dateRangeRecords(30,scope.site,scope.team);
  const c=countLevels(today);
  const workers=new Set(today.map(r=>r.workerId));
  const caution=c.yellow+c.orange+c.red;
  const high=highRiskWorkers(today);
  const wbgt=today.map(r=>Number(r.context?.wbgt)).filter(Number.isFinite);

  if($("siteTrendSummary")){
    $("siteTrendSummary").textContent=today.length
      ?`本日は${workers.size}人、${today.length}件を測定しています。注意判定は${caution}件で、全測定の${percent(caution,today.length)}％です。${wbgt.length?`平均WBGTは${avg(wbgt).toFixed(1)}です。`:"WBGT入力はありません。"}`
      :"選択条件に該当する本日の測定データはありません。";
  }

  if($("managerSummary")){
    let text=today.length
      ?`緑${c.green}件、黄${c.yellow}件、橙${c.orange}件、赤${c.red}件です。`
      :"本日の保存データはありません。";
    if(high.length)text+=` 優先確認対象は${high.slice(0,5).map(x=>x.name).join("、")}です。`;
    else if(today.length)text+=" 保存データ上、優先確認対象はありません。";
    text+=" 判定結果だけで作業可否を決めず、管理者による対面確認を行ってください。";
    $("managerSummary").textContent=text;
  }

  const rec=buildRecommendations(today);
  if($("recommendedActions")){
    $("recommendedActions").innerHTML=rec.map(x=>`
      <div class="recommendation-item ${x.type}">
        <strong>${esc(x.title)}</strong><span>${esc(x.text)}</span>
      </div>`).join("");
  }

  if($("monthlyTrendSummary")){
    const mc=countLevels(month);
    const caution30=mc.yellow+mc.orange+mc.red;
    $("monthlyTrendSummary").textContent=month.length
      ?`直近30日は${month.length}件を測定し、注意判定率は${percent(caution30,month.length)}％です。顔色変化は${trendDirection(month,r=>Number(r.colorChange)||0)}、顔の動きは${trendDirection(month,r=>Number(r.avgMotion)||0)}傾向です。`
      :"直近30日のデータはありません。";
  }

  if($("dailyReportText"))$("dailyReportText").value=buildDailyReport(today,scope);
  if($("monthlyReportText"))$("monthlyReportText").value=buildMonthlyReport(month,scope);
}

function copyTextArea(id){
  const el=$(id);if(!el)return;
  navigator.clipboard?.writeText(el.value).then(()=>alert("コメントをコピーしました。"))
    .catch(()=>{el.select();document.execCommand("copy");alert("コメントをコピーしました。");});
}

function populateValidationWorkers(){
  const select=$("validationWorker");if(!select)return;
  const current=select.value;
  const map=new Map();
  records().forEach(r=>{if(r.workerId)map.set(r.workerId,r.workerName||r.workerId);});
  select.innerHTML='<option value="">作業員を選択</option>'+
    [...map.entries()].sort((a,b)=>a[1].localeCompare(b[1],"ja"))
    .map(([id,name])=>`<option value="${esc(id)}">${esc(name)}（${esc(id)}）</option>`).join("");
  if([...map.keys()].includes(current))select.value=current;
}

function populateValidationRecords(){
  const workerId=$("validationWorker")?.value||"";
  const select=$("validationRecord");if(!select)return;
  const rows=workerRecords(workerId).slice(-30).reverse();
  select.innerHTML='<option value="">測定記録を選択</option>'+
    rows.map(r=>`<option value="${esc(r.timestamp)}">${new Date(r.timestamp).toLocaleString("ja-JP")}／${esc(r.label)}</option>`).join("");
}

function saveValidationEntry(){
  const workerId=$("validationWorker").value;
  const timestamp=$("validationRecord").value;
  const result=$("validationResult").value;
  if(!workerId||!timestamp||!result){
    alert("作業員、測定記録、管理者確認を選択してください。");return;
  }
  const record=records().find(r=>r.workerId===workerId&&r.timestamp===timestamp);
  if(!record){alert("対象記録が見つかりません。");return;}
  const list=validations();
  list.unshift({
    id:`${workerId}_${timestamp}`,
    workerId,workerName:record.workerName||workerId,timestamp,
    appLevel:record.level,appLabel:record.label,result,
    memo:$("validationMemo").value.trim(),
    createdAt:new Date().toISOString()
  });
  saveValidations(list.slice(0,500));
  $("validationResult").value="";
  $("validationMemo").value="";
  renderValidation();
}

function renderValidation(){
  populateValidationWorkers();
  const list=validations();
  const count=list.length;
  const mismatch=list.filter(v=>v.result==="判定不一致").length;
  const action=list.filter(v=>["休憩実施","水分補給実施","作業中止","医療確認"].includes(v.result)).length;
  const matched=count-mismatch;

  if($("validationCount"))$("validationCount").textContent=count;
  if($("validationMatchRate"))$("validationMatchRate").textContent=count?`${percent(matched,count)}%`:"--";
  if($("validationActionRate"))$("validationActionRate").textContent=count?`${percent(action,count)}%`:"--";
  if($("validationMismatch"))$("validationMismatch").textContent=mismatch;

  const box=$("validationList");if(!box)return;
  if(!list.length){box.textContent="評価記録はありません。";return;}
  box.innerHTML=list.slice(0,30).map(v=>`
    <div class="validation-row">
      <strong>${esc(v.workerName)}<br><small>${new Date(v.timestamp).toLocaleString("ja-JP")}</small></strong>
      <span>アプリ：${esc(v.appLabel)}</span>
      <span>確認：${esc(v.result)}</span>
      <span>${esc(v.memo||"メモなし")}</span>
      <button type="button" data-validation-delete="${esc(v.id)}">削除</button>
    </div>`).join("");

  document.querySelectorAll("[data-validation-delete]").forEach(btn=>{
    btn.onclick=()=>{
      saveValidations(validations().filter(v=>v.id!==btn.dataset.validationDelete));
      renderValidation();
    };
  });
}

