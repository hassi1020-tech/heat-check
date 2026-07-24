
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

    if(!validateFields()){
      alert("作業員ID・作業員名・現場名を入力してください。");
      return;
    }
    if(!state.stream){
      guide.textContent="カメラが開始されていません。";
      return;
    }

    const video=$("video");
    if(!video || video.readyState<2){
      guide.textContent="映像準備中です。2秒後にもう一度押してください。";
      return;
    }

    const cfg=settings();
    const warmup=Number(cfg.warmupSec)||5;
    const duration=Number(cfg.durationSec)||25;

    state.measuring=true;
    state.samples=[];
    state.roiFrames=[];
    state.latestResult=null;
    state.lastGray=null;

    $("resultCard").classList.add("hidden");
    $("startMeasure").disabled=true;
    $("stopCamera").disabled=true;
    $("countdown").textContent="準備 "+warmup;
    $("quality").textContent="準備中";
    $("stability").textContent="--";
    guide.textContent="測定を開始しました。顔とスマホを動かさないでください。";

    const started=performance.now();
    const work=document.createElement("canvas");
    work.width=180; work.height=135;
    const ctx=work.getContext("2d",{willReadFrequently:true});
    if(!ctx) throw new Error("画像解析を開始できません");

    let lastSampleAt=0;
    let prevGray=null;

    function roiAverage(x,y,w,h){
      const data=ctx.getImageData(x,y,w,h).data;
      let r=0,g=0,b=0,lum=0;
      const gray=new Uint8Array(data.length/4);
      for(let i=0,j=0;i<data.length;i+=4,j++){
        r+=data[i]; g+=data[i+1]; b+=data[i+2];
        const yy=data[i]*.299+data[i+1]*.587+data[i+2]*.114;
        gray[j]=yy; lum+=yy;
      }
      const n=gray.length;
      return {r:r/n,g:g/n,b:b/n,lum:lum/n,gray};
    }

    function loop(now){
      try{
        if(!state.measuring) return;
        const elapsed=(now-started)/1000;
        const measured=Math.max(0,elapsed-warmup);

        $("countdown").textContent=elapsed<warmup
          ?"準備 "+Math.max(0,Math.ceil(warmup-elapsed))
          :Math.max(0,duration-measured).toFixed(1);

        ctx.drawImage(video,0,0,180,135);

        // 固定3領域：額・左頬・右頬
        const forehead=roiAverage(66,18,48,24);
        const left=roiAverage(43,59,36,28);
        const right=roiAverage(101,59,36,28);

        const mergedGray=new Uint8Array(forehead.gray.length+left.gray.length+right.gray.length);
        mergedGray.set(forehead.gray,0);
        mergedGray.set(left.gray,forehead.gray.length);
        mergedGray.set(right.gray,forehead.gray.length+left.gray.length);

        let motion=0;
        if(prevGray && prevGray.length===mergedGray.length){
          for(let i=0;i<mergedGray.length;i+=5) motion+=Math.abs(mergedGray[i]-prevGray[i]);
          motion/=Math.ceil(mergedGray.length/5);
        }
        prevGray=mergedGray;

        if(elapsed>=warmup && now-lastSampleAt>=55){
          state.samples.push({
            t:now/1000,
            regions:[
              {r:forehead.r,g:forehead.g,b:forehead.b,lum:forehead.lum},
              {r:left.r,g:left.g,b:left.b,lum:left.lum},
              {r:right.r,g:right.g,b:right.b,lum:right.lum}
            ],
            motion
          });
          lastSampleAt=now;
          $("quality").textContent="取得中 "+state.samples.length;
        }

        if(elapsed>=warmup && state.samples.length>160){
          const quick=analyzeSignal(state.samples.slice(-220));
          $("bpmLive").textContent=quick.bpm?Math.round(quick.bpm):"--";
          $("quality").textContent=quick.qualityLabel;
          $("stability").textContent=quick.stabilityLabel;
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
function spectralEstimate(times,signal,minHz=.83,maxHz=2.33){
  const mean=signal.reduce((a,b)=>a+b,0)/signal.length;
  let sig=signal.map(v=>v-mean);
  const duration=times.at(-1)-times[0];
  const fs=(signal.length-1)/Math.max(.001,duration);
  const trend=movingAverage(sig,Math.max(5,Math.round(fs*1.2)));
  sig=sig.map((v,i)=>v-trend[i]);
  const win=sig.map((v,i)=>v*(.5-.5*Math.cos(2*Math.PI*i/(sig.length-1))));

  let bestF=null,best=-1,total=0,second=-1;
  for(let f=minHz;f<=maxHz;f+=.01){
    let re=0,im=0;
    for(let i=0;i<win.length;i++){
      const t=times[i]-times[0];
      re+=win[i]*Math.cos(2*Math.PI*f*t);
      im-=win[i]*Math.sin(2*Math.PI*f*t);
    }
    const p=re*re+im*im;
    total+=p;
    if(p>best){second=best;best=p;bestF=f;}
    else if(p>second){second=p;}
  }
  return {
    bpm:bestF?bestF*60:null,
    peakRatio:best/Math.max(1,total/151),
    dominance:best/Math.max(1,second),
    strength:std(sig)
  };
}

function regionSignal(samples,regionIndex){
  const times=samples.map(x=>x.t);
  const rs=samples.map(x=>x.regions[regionIndex].r);
  const gs=samples.map(x=>x.regions[regionIndex].g);
  const bs=samples.map(x=>x.regions[regionIndex].b);

  // POSに近い正規化色差。通常カメラでの照明変動を抑える簡易実装
  const mr=rs.reduce((a,b)=>a+b,0)/rs.length;
  const mg=gs.reduce((a,b)=>a+b,0)/gs.length;
  const mb=bs.reduce((a,b)=>a+b,0)/bs.length;
  const rn=rs.map(v=>v/Math.max(1,mr));
  const gn=gs.map(v=>v/Math.max(1,mg));
  const bn=bs.map(v=>v/Math.max(1,mb));
  const x=rn.map((v,i)=>gn[i]-bn[i]);
  const y=rn.map((v,i)=>gn[i]+bn[i]-2*v);
  const sx=std(x), sy=std(y);
  const alpha=sx/Math.max(.0001,sy);
  const signal=x.map((v,i)=>v+alpha*y[i]);
  return {times,signal,avgLum:samples.reduce((a,s)=>a+s.regions[regionIndex].lum,0)/samples.length};
}

function analyzeSignal(samples){
  if(samples.length<240){
    return {bpm:null,quality:0,qualityLabel:"不足",avgMotion:99,avgLum:0,
      pulseStrength:0,stability:null,stabilityLabel:"不足",regionAgreement:null};
  }

  const regionResults=[];
  for(let ri=0;ri<3;ri++){
    const sig=regionSignal(samples,ri);
    const est=spectralEstimate(sig.times,sig.signal);
    regionResults.push({...est,avgLum:sig.avgLum,ri});
  }

  // 信号品質の良い2領域を採用
  regionResults.sort((a,b)=>(b.peakRatio*b.dominance)-(a.peakRatio*a.dominance));
  const usable=regionResults.filter(r=>r.bpm && r.peakRatio>=3 && r.dominance>=1.03);
  let bpm=null;
  if(usable.length>=2 && Math.abs(usable[0].bpm-usable[1].bpm)<=12){
    bpm=(usable[0].bpm+usable[1].bpm)/2;
  }else if(usable.length){
    bpm=usable[0].bpm;
  }

  // 前半・後半の一致度
  const mid=Math.floor(samples.length/2);
  const first=regionSignal(samples.slice(0,mid),regionResults[0].ri);
  const second=regionSignal(samples.slice(mid),regionResults[0].ri);
  const e1=spectralEstimate(first.times,first.signal);
  const e2=spectralEstimate(second.times,second.signal);
  const stability=(e1.bpm&&e2.bpm)?Math.abs(e1.bpm-e2.bpm):null;

  const avgMotion=samples.reduce((a,x)=>a+x.motion,0)/samples.length;
  const avgLum=regionResults.reduce((a,x)=>a+x.avgLum,0)/regionResults.length;
  const agreement=usable.length>=2?Math.abs(usable[0].bpm-usable[1].bpm):null;
  const best=regionResults[0];

  let quality=100;
  quality-=Math.min(55,avgMotion*4);
  if(avgLum<55||avgLum>215) quality-=30;
  if(best.peakRatio<4) quality-=25;
  if(best.dominance<1.08) quality-=20;
  if(stability===null) quality-=25;
  else if(stability>18) quality-=40;
  else if(stability>10) quality-=20;
  if(agreement!==null && agreement>12) quality-=25;

  // 周波数範囲の端に張り付く値は無効
  if(bpm && (bpm<=51 || bpm>=139)){
    bpm=null;
    quality=Math.min(quality,45);
  }

  quality=Math.max(0,Math.min(100,quality));
  const stabilityLabel=stability===null?"不足":stability<=8?"安定":stability<=15?"注意":"不安定";
  const qualityLabel=quality>=75&&bpm?"良好":quality>=55&&bpm?"注意":"不良";

  return {
    bpm,quality,qualityLabel,avgMotion,avgLum,
    pulseStrength:best.strength,peakRatio:best.peakRatio,
    stability,stabilityLabel,regionAgreement:agreement
  };
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
  $("startMeasure").disabled=false;
  $("stopCamera").disabled=false;

  const a=analyzeSignal(state.samples);
  const ratios=[];
  state.samples.forEach(s=>s.regions.forEach(r=>ratios.push(r.r/Math.max(1,r.g))));
  const redness=ratios.length?ratios.reduce((x,y)=>x+y,0)/ratios.length:1;
  const baseline=workerBaseline($("workerId").value.trim());
  const delta=(a.bpm&&baseline)?a.bpm-baseline:null;

  const context={
    wbgt:Number($("wbgt").value)||null,
    workload:$("workload").value,
    hydration:$("hydration").value,
    selfCondition:$("selfCondition").value,
    symptoms:{
      dizzy:$("symDizzy").checked,
      nausea:$("symNausea").checked,
      cramp:$("symCramp").checked,
      confusion:$("symConfusion").checked
    }
  };

  const result=judge(a,redness,baseline,delta,context);
  state.latestResult={...result,...a,redness,baseline,delta,context,
    workerId:$("workerId").value.trim(),
    workerName:$("workerName").value.trim(),
    siteName:$("siteName").value.trim(),
    timing:$("timing").value,
    timestamp:new Date().toISOString()
  };
  showResult(state.latestResult);
}

function judge(a,redness,baseline,delta,context){
  const s=settings();
  const symptoms=context.symptoms;
  const serious=symptoms.confusion || symptoms.cramp || context.selfCondition==="bad";
  const symptomCount=Object.values(symptoms).filter(Boolean).length;

  if(serious){
    return {level:"red",label:"赤：作業中止・対面確認",
      instruction:"本人申告または症状に重大な項目があります。測定値に関係なく作業を中止し、管理者が直ちに対面確認してください。意識障害、会話異常、自力飲水困難などがあれば現場の救急手順に従ってください。"};
  }

  if(a.quality<55 || !a.bpm || a.stability===null || a.stability>18){
    return {level:"yellow",label:"判定保留：再測定",
      instruction:"脈拍信号が安定しなかったため、顔動画による判定を保留しました。明るい日陰または室内でスマホを固定し、5分程度安静にして再測定してください。本人に異常があれば測定結果を待たず作業を中止してください。"};
  }

  let contextScore=0;
  if(context.wbgt!==null){
    if(context.wbgt>=31) contextScore+=3;
    else if(context.wbgt>=28) contextScore+=2;
    else if(context.wbgt>=25) contextScore+=1;
  }
  if(context.workload==="high") contextScore+=2;
  else if(context.workload==="medium") contextScore+=1;
  if(context.hydration==="no") contextScore+=2;
  else if(context.hydration==="little") contextScore+=1;
  if(context.selfCondition==="slight") contextScore+=2;
  contextScore+=symptomCount*2;

  const recent=records().filter(r=>r.workerId===$("workerId").value.trim()).slice(-1)[0];
  const repeatedOrange=recent&&recent.level==="orange"&&(Date.now()-Date.parse(recent.timestamp)<30*60*1000);

  const pulseOrange=a.bpm>=s.orangeBpm||(delta!==null&&delta>=s.orangeDelta);
  const pulseYellow=a.bpm>=s.yellowBpm||(delta!==null&&delta>=s.yellowDelta);
  const imageConcern=redness>1.18||a.avgMotion>9;

  if((pulseOrange&&contextScore>=2)||(contextScore>=6)||repeatedOrange){
    return {level:"orange",label:"橙：休憩・管理者確認",
      instruction:`作業を中断し、涼しい場所で休憩してください。水分・塩分補給後、${s.retryMin}分後に再測定し、管理者が本人の状態を直接確認してください。`};
  }
  if(pulseOrange||pulseYellow||imageConcern||contextScore>=3){
    return {level:"yellow",label:"黄：水分補給・再測定",
      instruction:`暑熱負担または体調変化の要因があります。水分・塩分を補給し、${s.retryMin}分以内に再測定してください。違和感がある場合は作業を中止してください。`};
  }
  return {level:"green",label:"緑：明らかな変化なし",
    instruction:"顔動画・現場条件・本人申告の範囲では、明らかな変化は検出されませんでした。安全や就業可能を保証するものではありません。"};
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
  $("resultStability").textContent=r.stability===null?"不足":`${r.stabilityLabel}（差 ${Math.round(r.stability)} bpm）`;
  const wbgtText=r.context?.wbgt!==null&&r.context?.wbgt!==undefined?`WBGT ${r.context.wbgt}`:"WBGT未入力";
  const symptomN=r.context?.symptoms?Object.values(r.context.symptoms).filter(Boolean).length:0;
  $("resultContext").textContent=`${wbgtText}・症状${symptomN}件`;
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
  const headers=["日時","現場","作業員ID","作業員名","区分","判定","推定脈拍","通常値との差","信号品質","脈拍安定性","WBGT","作業強度","水分補給","本人申告","指示"];
  const rows=rs.map(r=>[
    new Date(r.timestamp).toLocaleString("ja-JP"),r.siteName,r.workerId,r.workerName,r.timing,
    r.label,r.bpm?Math.round(r.bpm):"",r.delta===null?"":Math.round(r.delta),r.qualityLabel,r.stabilityLabel,r.context?.wbgt??"",r.context?.workload??"",r.context?.hydration??"",r.context?.selfCondition??"",r.instruction
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
$("guide").textContent="v7プログラム読込済み。カメラを開始してください。";
if("serviceWorker" in navigator){
  navigator.serviceWorker.getRegistrations()
    .then(regs=>Promise.all(regs.map(r=>r.unregister())))
    .catch(()=>{});
}
if("caches" in window){
  caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).catch(()=>{});
}
window.addEventListener("beforeunload",()=>state.stream?.getTracks().forEach(t=>t.stop()));
