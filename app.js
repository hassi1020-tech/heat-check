"use strict";
const DB_KEY="heatCheckV11";
const LEVELS={green:{label:"通常",rank:0},yellow:{label:"注意",rank:1},orange:{label:"警戒",rank:2},red:{label:"作業中止",rank:3}};
const $=id=>document.getElementById(id);
let stream=null, measuring=false, guideTimer=null;

function defaultDB(){
  return {version:"12.0-stage1",sites:[],teams:[],workers:[],records:[],settings:{duration:10,wbgtYellow:28,wbgtOrange:31},updatedAt:new Date().toISOString()};
}
function loadDB(){
  try{
    const raw=JSON.parse(localStorage.getItem(DB_KEY)||"{}");
    const db={...defaultDB(),...raw};
    db.sites=Array.isArray(db.sites)?db.sites:[];
    db.teams=Array.isArray(db.teams)?db.teams:[];
    db.workers=Array.isArray(db.workers)?db.workers:[];
    db.records=Array.isArray(db.records)?db.records:[];
    db.settings={...defaultDB().settings,...(db.settings||{})};
    return db;
  }catch(e){console.error(e);return defaultDB();}
}
function saveDB(db,options={}){
  // 顔画像・動画・Base64等は保存しない
  if(Array.isArray(db.records)){
    db.records=db.records.map(record=>{
      const safe={...record};
      [
        "image","imageData","imageUrl","photo","photoData","photoUrl",
        "faceImage","faceImageData","faceImageUrl","video","videoData",
        "thumbnail","snapshot","capture"
      ].forEach(key=>delete safe[key]);
      return safe;
    });
  }
  db.updatedAt=new Date().toISOString();
  localStorage.setItem(DB_KEY,JSON.stringify(db));
  if(!options.fromCloud && window.CloudBridge?.isReady?.()){
    window.CloudBridge.queueSave(db);
  }
  window.dispatchEvent(new CustomEvent("heatcheck:localdbchanged",{detail:{fromCloud:!!options.fromCloud}}));
}
function uid(){return (crypto.randomUUID?.()||Date.now()+"-"+Math.random().toString(16).slice(2));}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function normalizeId(v){return String(v||"").trim().replace(/\u3000/g,"").replace(/\s+/g,"").toUpperCase();}
function fmtDate(iso){return new Date(iso).toLocaleString("ja-JP");}
function setStatus(id,msg,type=""){const e=$(id);e.textContent=msg;e.className="status "+type;}
function download(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function switchView(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+name));
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.view===name));
  if(name==="validation")renderValidation();
  if(name==="dashboard"){renderDashboard();renderAdminDashboard();}
  if(name==="worker")renderWorkerCard();
  if(name==="master")renderMaster();
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>switchView(b.dataset.view)));

function renderAllSelectors(){
  const db=loadDB();
  const workerOptions=db.workers.filter(w=>w.active!==false).sort((a,b)=>a.id.localeCompare(b.id,"ja"))
    .map(w=>`<option value="${esc(w.id)}">${esc(w.name||w.id)}（${esc(w.id)}）</option>`).join("");
  ["measureWorker","workerCardSelect"].forEach(id=>{const el=$(id),v=el.value;el.innerHTML='<option value="">作業員を選択</option>'+workerOptions;if(db.workers.some(w=>w.id===v))el.value=v;});
  const vw=$("validationWorker"),vv=vw.value;vw.innerHTML='<option value="">すべての作業員</option>'+workerOptions;if(db.workers.some(w=>w.id===vv))vw.value=vv;
  const sites=db.sites.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  const teams=db.teams.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
  [["workerSite","未設定",sites],["workerTeam","未設定",teams]].forEach(([id,blank,opts])=>{const e=$(id),v=e.value;e.innerHTML=`<option value="">${blank}</option>`+opts;if([...e.options].some(o=>o.value===v))e.value=v;});
}
function renderMaster(){
  const db=loadDB();renderAllSelectors();
  $("siteList").innerHTML=db.sites.length?db.sites.map((x,i)=>`<div class="master-item"><span>${esc(x)}</span><button data-del-site="${i}">削除</button></div>`).join(""):"現場は未登録です。";
  $("teamList").innerHTML=db.teams.length?db.teams.map((x,i)=>`<div class="master-item"><span>${esc(x)}</span><button data-del-team="${i}">削除</button></div>`).join(""):"作業班は未登録です。";
  $("workerList").innerHTML=db.workers.length?db.workers.map(w=>`<div class="master-item"><span><strong>${esc(w.id)}</strong> ${esc(w.name||w.id)}<br><small>${esc(w.site||"現場未設定")}／${esc(w.team||"班未設定")}</small></span><span><button data-edit-worker="${esc(w.id)}">編集</button> <button data-del-worker="${esc(w.id)}">削除</button></span></div>`).join(""):"作業員は未登録です。";
  document.querySelectorAll("[data-del-site]").forEach(b=>b.onclick=()=>{const d=loadDB();d.sites.splice(Number(b.dataset.delSite),1);saveDB(d);renderMaster();});
  document.querySelectorAll("[data-del-team]").forEach(b=>b.onclick=()=>{const d=loadDB();d.teams.splice(Number(b.dataset.delTeam),1);saveDB(d);renderMaster();});
  document.querySelectorAll("[data-del-worker]").forEach(b=>b.onclick=()=>{if(!confirm("作業員を削除しますか？"))return;const d=loadDB();d.workers=d.workers.filter(w=>w.id!==b.dataset.delWorker);saveDB(d);renderMaster();renderAllSelectors();});
  document.querySelectorAll("[data-edit-worker]").forEach(b=>b.onclick=()=>{const w=loadDB().workers.find(x=>x.id===b.dataset.editWorker);if(!w)return;$("workerId").value=w.id;$("workerName").value=w.name||"";$("workerSite").value=w.site||"";$("workerTeam").value=w.team||"";});
}
$("addSite").onclick=()=>{const v=$("siteName").value.trim();if(!v)return setStatus("siteStatus","現場名を入力してください。","error");const d=loadDB();if(!d.sites.includes(v))d.sites.push(v);saveDB(d);$("siteName").value="";setStatus("siteStatus","追加完了："+v,"success");renderMaster();};
$("addTeam").onclick=()=>{const v=$("teamName").value.trim();if(!v)return setStatus("teamStatus","作業班名を入力してください。","error");const d=loadDB();if(!d.teams.includes(v))d.teams.push(v);saveDB(d);$("teamName").value="";setStatus("teamStatus","追加完了："+v,"success");renderMaster();};
$("saveWorker").onclick=()=>{const id=normalizeId($("workerId").value);if(!id)return setStatus("workerStatus","作業員IDを入力してください。","error");const d=loadDB();const item={id,name:$("workerName").value.trim()||id,site:$("workerSite").value,team:$("workerTeam").value,active:true};const i=d.workers.findIndex(w=>w.id===id);if(i>=0)d.workers[i]={...d.workers[i],...item};else d.workers.push(item);saveDB(d);setStatus("workerStatus","登録完了："+item.name+"（"+id+"）","success");$("workerId").value="";$("workerName").value="";renderMaster();renderAllSelectors();};

$("measureWorker").onchange=()=>{const w=loadDB().workers.find(x=>x.id===$("measureWorker").value);$("measureWorkerInfo").textContent=w?`${w.name}／${w.site||"現場未設定"}／${w.team||"班未設定"}`:"作業員を選択してください。";};

async function startCamera(){
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("このブラウザではカメラを利用できません");
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:720}},audio:false});
    $("camera").srcObject=stream;await $("camera").play();
    $("startCamera").disabled=true;$("startMeasure").disabled=false;$("stopCamera").disabled=false;
    $("cameraMessage").textContent="顔を中央に合わせてください。";
    startGuideMonitor();
  }catch(e){$("cameraMessage").textContent="カメラ開始エラー："+(e.message||e);}
}
function stopCamera(){
  if(guideTimer){clearInterval(guideTimer);guideTimer=null;}
  stream?.getTracks().forEach(t=>t.stop());
  stream=null;
  $("camera").srcObject=null;
  $("startCamera").disabled=false;
  $("startMeasure").disabled=true;
  $("stopCamera").disabled=true;
  $("faceGuide").classList.remove("guide-ok","guide-warn");
  $("cameraMessage").textContent="カメラを開始してください。";
}
$("startCamera").onclick=startCamera;$("stopCamera").onclick=stopCamera;

function sampleFrame(){
  const v=$("camera"),c=document.createElement("canvas"),size=240;
  c.width=size;c.height=size;
  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(v,0,0,size,size);
  const image=ctx.getImageData(0,0,size,size);
  const d=image.data;

  const region=(x1,y1,x2,y2)=>{
    let r=0,g=0,b=0,brightness=0,count=0,specular=0,saturation=0;
    const sx=Math.max(0,Math.floor(x1*size)),ex=Math.min(size,Math.ceil(x2*size));
    const sy=Math.max(0,Math.floor(y1*size)),ey=Math.min(size,Math.ceil(y2*size));
    for(let y=sy;y<ey;y+=2){
      for(let x=sx;x<ex;x+=2){
        const i=(y*size+x)*4,rv=d[i],gv=d[i+1],bv=d[i+2];
        const max=Math.max(rv,gv,bv),min=Math.min(rv,gv,bv);
        const br=(rv+gv+bv)/3;
        r+=rv;g+=gv;b+=bv;brightness+=br;
        saturation+=max===0?0:(max-min)/max;
        // 強い白色反射を光沢候補として集計
        if(br>205 && (max-min)<28)specular++;
        count++;
      }
    }
    count=Math.max(1,count);
    const ar=r/count,ag=g/count,ab=b/count;
    return {
      red:ar,green:ag,blue:ab,
      brightness:brightness/count,
      redness:ar-(ag+ab)/2,
      saturation:saturation/count*100,
      specularRatio:specular/count*100
    };
  };

  // 顔ガイド内を想定した固定領域。第2段階でFace Landmarkerの座標へ置換予定。
  const forehead=region(.38,.20,.62,.36);
  const leftCheek=region(.27,.42,.44,.62);
  const rightCheek=region(.56,.42,.73,.62);
  const nose=region(.44,.36,.56,.58);
  const mouth=region(.39,.62,.61,.76);
  const face=region(.25,.18,.75,.82);

  const asymmetry=Math.abs(leftCheek.brightness-rightCheek.brightness)/
    Math.max(1,(leftCheek.brightness+rightCheek.brightness)/2)*100;
  const cheekRedness=(leftCheek.redness+rightCheek.redness)/2;
  const pallor=Math.max(0,100-(leftCheek.saturation+rightCheek.saturation)/2);
  const sweatIndex=Math.min(100,
    forehead.specularRatio*5.2+nose.specularRatio*3.8+
    Math.max(0,forehead.brightness-face.brightness)*0.35
  );

  return {
    brightness:face.brightness,
    red:face.red,green:face.green,blue:face.blue,
    asymmetry,
    foreheadRedness:forehead.redness,
    leftCheekRedness:leftCheek.redness,
    rightCheekRedness:rightCheek.redness,
    cheekRedness,
    mouthRedness:mouth.redness,
    pallor,
    foreheadGloss:forehead.specularRatio,
    noseGloss:nose.specularRatio,
    sweatIndex
  };
}
function startGuideMonitor(){
  if(guideTimer)clearInterval(guideTimer);
  guideTimer=setInterval(()=>{
    if(!stream || measuring || $("camera").readyState<2)return;
    try{
      const s=sampleFrame();
      const guide=$("faceGuide");
      if(s.brightness<55){
        guide.classList.remove("guide-ok");
        guide.classList.add("guide-warn");
        $("cameraMessage").textContent="少し暗いです。明るい場所へ移動してください。";
      }else if(s.brightness>220){
        guide.classList.remove("guide-ok");
        guide.classList.add("guide-warn");
        $("cameraMessage").textContent="光が強すぎます。逆光を避けてください。";
      }else if(s.asymmetry>8){
        guide.classList.remove("guide-ok");
        guide.classList.add("guide-warn");
        $("cameraMessage").textContent="顔を正面に向け、枠の中央に合わせてください。";
      }else{
        guide.classList.remove("guide-warn");
        guide.classList.add("guide-ok");
        $("cameraMessage").textContent="撮影できます。顔を動かさず撮影開始を押してください。";
      }
    }catch(e){
      // 映像準備中は案内を変更しない
    }
  },700);
}

function evaluate(worker,frames){
  const db=loadDB(),avg=k=>frames.reduce((s,x)=>s+x[k],0)/frames.length;
  const brightness=avg("brightness"),asymmetry=avg("asymmetry");
  const variation=Math.sqrt(frames.reduce((s,x)=>s+(x.brightness-brightness)**2,0)/frames.length);
  const redness=avg("red")-(avg("green")+avg("blue"))/2;
  const foreheadRedness=avg("foreheadRedness");
  const leftCheekRedness=avg("leftCheekRedness");
  const rightCheekRedness=avg("rightCheekRedness");
  const mouthRedness=avg("mouthRedness");
  const pallor=avg("pallor");
  const foreheadGloss=avg("foreheadGloss");
  const noseGloss=avg("noseGloss");
  const sweatIndex=avg("sweatIndex");
  const colorVariation=Math.sqrt(frames.reduce((s,x)=>s+(x.cheekRedness-avg("cheekRedness"))**2,0)/frames.length);

  // 第1段階：顔色・発汗の観察スコア（医療診断ではない）
  const rednessRisk=Math.min(100,Math.max(0,(Math.abs((leftCheekRedness+rightCheekRedness)/2)-10)*3.2));
  const pallorRisk=Math.min(100,Math.max(0,(pallor-48)*2.6));
  const colorAsymmetryRisk=Math.min(100,asymmetry*7);
  const faceColorRisk=Math.round(
    rednessRisk*0.45+pallorRisk*0.30+colorAsymmetryRisk*0.15+
    Math.min(100,colorVariation*6)*0.10
  );
  const sweatRisk=Math.round(Math.min(100,Math.max(0,sweatIndex)));
  const faceAiRisk=Math.round(faceColorRisk*0.75+sweatRisk*0.25);
  const wbgt=Number($("measureWbgt").value)||null,abnormal=$("conditionAbnormal").value==="yes",hydration=$("hydration").value;
  let level="green",reasons=[],actions=[];
  const raise=x=>{if(LEVELS[x].rank>LEVELS[level].rank)level=x;};
  if(abnormal){raise("red");reasons.push("本人から体調異常の申告あり");}
  if(wbgt!==null&&wbgt>=db.settings.wbgtOrange){raise("orange");reasons.push(`WBGT ${wbgt}℃で警戒基準以上`);}
  else if(wbgt!==null&&wbgt>=db.settings.wbgtYellow){raise("yellow");reasons.push(`WBGT ${wbgt}℃で注意基準以上`);}
  if(hydration==="none"){raise("orange");reasons.push("水分補給ができていない");}
  else if(hydration==="partial"){raise("yellow");reasons.push("水分補給が少なめ");}
  if(brightness<45||brightness>220){raise("yellow");reasons.push("撮影環境の明るさが不適切");}
  if(asymmetry>7){raise("yellow");reasons.push("顔の左右差が大きく再測定推奨");}
  if(variation>18){raise("yellow");reasons.push("測定中の動きが大きい");}
  if(faceColorRisk>=72){
    raise("yellow");
    reasons.push("顔色の複数指標に大きな変化傾向");
  }else if(faceColorRisk>=48){
    reasons.push("顔色に軽度の変化傾向");
  }
  if(sweatRisk>=75)reasons.push("額・鼻周辺の光沢が増加傾向");
  if(!reasons.length)reasons.push("重大な変化は検出されませんでした");
  actions=level==="red"?["直ちに作業を中止する","涼しい場所で管理者が本人を確認する","必要に応じて救急要請・医療機関へ連絡する"]:
    level==="orange"?["作業を中断して休憩する","水分・塩分を補給する","管理者が本人を確認し再測定する"]:
    level==="yellow"?["短時間休憩し水分補給する","撮影条件を整えて再測定する","違和感があれば作業を中止する"]:
    ["通常どおりでも定期的に休憩する","水分補給を継続する","本人の異常時は結果に関係なく中止する"];
  const faceColor=Math.abs(redness)>25?"大":Math.abs(redness)>14?"中":"小";
  const symmetry=asymmetry>7?"大":asymmetry>4?"中":"小";
  const movement=variation>18?"大":variation>10?"中":"小";
  const lighting=(brightness>=65&&brightness<=200)?"適正":(brightness>=45&&brightness<=220)?"注意":"不適正";
  let qualityScore=100;
  if(lighting==="注意")qualityScore-=20;
  if(lighting==="不適正")qualityScore-=45;
  if(symmetry==="大")qualityScore-=20;
  if(movement==="大")qualityScore-=25;
  const quality=qualityScore>=80?"高":qualityScore>=55?"中":"低";
  const confidence=Math.max(20,Math.min(99,qualityScore));
  return {
    level,reasons,actions,
    metrics:{brightness:+brightness.toFixed(1),asymmetry:+asymmetry.toFixed(2),motion:+variation.toFixed(2),redness:+redness.toFixed(1)},
    indicators:{faceColor,symmetry,movement,lighting},
    quality,confidence,wbgt,abnormal,hydration,
    faceAI:{
      stage:1,
      overallRisk:faceAiRisk,
      colorRisk:faceColorRisk,
      sweatRisk,
      colorLabel:faceColorRisk>=72?"大きな変化":faceColorRisk>=48?"軽度変化":"通常範囲",
      sweatLabel:sweatRisk>=75?"増加傾向":sweatRisk>=45?"やや増加":"判定上大きな変化なし",
      confidence:Math.round(Math.max(20,Math.min(99,qualityScore*0.85+15))),
      regions:{
        foreheadRedness:+foreheadRedness.toFixed(1),
        leftCheekRedness:+leftCheekRedness.toFixed(1),
        rightCheekRedness:+rightCheekRedness.toFixed(1),
        mouthRedness:+mouthRedness.toFixed(1),
        pallor:+pallor.toFixed(1),
        foreheadGloss:+foreheadGloss.toFixed(2),
        noseGloss:+noseGloss.toFixed(2)
      },
      disclaimer:"顔色・皮膚光沢の変化傾向であり、熱中症・脱水・発汗量の医学的診断ではありません。"
    }
  };
}
async function startMeasure(){
  if(measuring)return;
  const db=loadDB(),worker=db.workers.find(w=>w.id===$("measureWorker").value);
  if(!worker)return alert("作業員を選択してください。");
  if(!stream)return alert("カメラを開始してください。");
  measuring=true;$("startMeasure").disabled=true;$("faceGuide").classList.add("guide-measuring");
  const frames=[],sec=Math.max(5,Math.min(30,db.settings.duration||10)),start=Date.now();
  try{
    while(Date.now()-start<sec*1000){
      frames.push(sampleFrame());
      const left=Math.ceil(sec-(Date.now()-start)/1000);
      $("cameraMessage").textContent=`測定中…残り約${Math.max(0,left)}秒`;
      await new Promise(r=>setTimeout(r,400));
    }
    const ev=evaluate(worker,frames);
    const record={id:uid(),createdAt:new Date().toISOString(),workerId:worker.id,workerName:worker.name,site:worker.site||"",team:worker.team||"",...ev,validation:null};
    const d=loadDB();d.records.unshift(record);saveDB(d);showResult(record);renderDashboard();renderValidation();renderWorkerCard();
    $("cameraMessage").textContent="測定完了。";
  }catch(e){$("cameraMessage").textContent="測定エラー："+(e.message||e);}
  finally{measuring=false;$("faceGuide").classList.remove("guide-measuring");$("startMeasure").disabled=!stream;}
}
$("startMeasure").onclick=startMeasure;
function showResult(r){
  const faceCondition =
    r.abnormal ? "本人申告あり" :
    r.indicators?.faceColor === "大" || r.indicators?.symmetry === "大" || r.indicators?.movement === "大" ? "要確認" :
    r.level === "green" ? "良好" : "注意";

  const summaries = {
    green: "現時点で大きな変化は確認されていません。",
    yellow: "軽度の注意要因があります。休憩と再確認を行ってください。",
    orange: "作業を中断し、管理者が本人の状態を確認してください。",
    red: "直ちに作業を中止し、管理者が本人を確認してください。"
  };

  const iconMap = {green:"●", yellow:"▲", orange:"▲", red:"×"};

  $("measureResult").classList.remove("hidden");
  $("resultHero").className = "simple-result-hero " + r.level;
  $("resultIcon").textContent = iconMap[r.level] || "●";
  $("resultStatus").textContent = LEVELS[r.level].label;
  $("resultSummary").textContent = summaries[r.level];
  $("faceCondition").textContent = faceCondition;
  $("resultQualityText").textContent = r.quality || "中";
  $("resultConfidence").textContent = `${r.confidence ?? 70}%`;

  const faceAI=r.faceAI||{};
  if($("faceAiOverall")) $("faceAiOverall").textContent=`${Math.max(0,100-(faceAI.overallRisk??0))}点`;
  if($("faceAiColor")) $("faceAiColor").textContent=`${Math.max(0,100-(faceAI.colorRisk??0))}点`;
  if($("faceAiColorLabel")) $("faceAiColorLabel").textContent=faceAI.colorLabel||"未解析";
  if($("faceAiSweat")) $("faceAiSweat").textContent=`${Math.max(0,100-(faceAI.sweatRisk??0))}点`;
  if($("faceAiSweatLabel")) $("faceAiSweatLabel").textContent=faceAI.sweatLabel||"未解析";
  if($("faceAiStageNote")) $("faceAiStageNote").textContent=
    "第1段階では顔色と皮膚光沢を解析します。表情・目・口元は次段階で追加します。";

  $("resultReasons").innerHTML = r.reasons.slice(0,5)
    .map(reason => `<li><span class="check-mark">✓</span><span>${esc(reason)}</span></li>`)
    .join("");

  $("resultActions").innerHTML = r.actions.slice(0,4)
    .map(action => `<li>${esc(action)}</li>`)
    .join("");

  const indicators = r.indicators || {};
  const detailItems = [
    ["顔色", indicators.faceColor ?? "—"],
    ["左右差", indicators.symmetry ?? "—"],
    ["動き", indicators.movement ?? "—"],
    ["撮影環境", indicators.lighting ?? "—"],
    ["WBGT", r.wbgt !== null ? `${r.wbgt}℃` : "未入力"],
    ["自覚症状", r.abnormal ? "あり" : "なし"],
    ["水分補給", r.hydration === "good" ? "できている" : r.hydration === "partial" ? "少なめ" : "できていない"],
    ["明るさ数値", r.metrics?.brightness ?? "—"],
    ["左右差数値", r.metrics?.asymmetry ?? "—"],
    ["動き数値", r.metrics?.motion ?? "—"],
    ["顔色差数値", r.metrics?.redness ?? "—"],
    ["顔AI総合", r.faceAI ? `${Math.max(0,100-r.faceAI.overallRisk)}点` : "—"],
    ["顔色スコア", r.faceAI ? `${Math.max(0,100-r.faceAI.colorRisk)}点` : "—"],
    ["発汗傾向スコア", r.faceAI ? `${Math.max(0,100-r.faceAI.sweatRisk)}点` : "—"],
    ["額の赤み指数", r.faceAI?.regions?.foreheadRedness ?? "—"],
    ["左頬の赤み指数", r.faceAI?.regions?.leftCheekRedness ?? "—"],
    ["右頬の赤み指数", r.faceAI?.regions?.rightCheekRedness ?? "—"],
    ["額の光沢率", r.faceAI?.regions?.foreheadGloss ?? "—"],
    ["鼻の光沢率", r.faceAI?.regions?.noseGloss ?? "—"]
  ];

  $("resultMetrics").innerHTML = detailItems.map(([name,value]) => `
    <div class="simple-detail-item">
      <span>${esc(name)}</span><strong>${esc(value)}</strong>
    </div>`).join("");

  $("measureResult").scrollIntoView({behavior:"smooth", block:"start"});
}

function filteredValidation(){
  const d=loadDB(),wid=$("validationWorker").value,mode=$("validationPending").value;
  return d.records.filter(r=>(!wid||r.workerId===wid)&&(mode==="all"||(mode==="pending"?!r.validation:!!r.validation)));
}
function renderValidation(){
  renderAllSelectors();const rows=filteredValidation();
  $("validationList").innerHTML=rows.length?rows.map(r=>`<div class="record">
    <div class="record-head"><strong>${esc(r.workerName)}（${esc(r.workerId)}）</strong><span>${fmtDate(r.createdAt)}／${LEVELS[r.level].label}</span></div>
    <p>${esc(r.site||"現場未設定")}／WBGT ${r.wbgt??"未入力"}／${r.reasons.map(esc).join("、")}</p>
    <label>管理者評価
      <select data-val-result="${r.id}">
        <option value="">未評価</option><option value="match" ${r.validation?.result==="match"?"selected":""}>AI判定と概ね一致</option>
        <option value="over" ${r.validation?.result==="over"?"selected":""}>AI判定が厳しすぎる</option>
        <option value="under" ${r.validation?.result==="under"?"selected":""}>AI判定が軽すぎる</option>
      </select>
    </label>
    <label>所見<textarea data-val-comment="${r.id}">${esc(r.validation?.comment||"")}</textarea></label>
    <button class="primary" data-save-validation="${r.id}">評価を保存</button>
  </div>`).join(""):"対象記録はありません。";
  document.querySelectorAll("[data-save-validation]").forEach(b=>b.onclick=()=>{const id=b.dataset.saveValidation,d=loadDB(),r=d.records.find(x=>x.id===id);if(!r)return;const result=document.querySelector(`[data-val-result="${id}"]`).value,comment=document.querySelector(`[data-val-comment="${id}"]`).value.trim();r.validation=result?{result,comment,updatedAt:new Date().toISOString()}:null;saveDB(d);renderValidation();renderDashboard();});
}
$("validationWorker").onchange=renderValidation;$("validationPending").onchange=renderValidation;

function renderBars(id,obj,total){
  const rows=Object.entries(obj).sort((a,b)=>b[1]-a[1]);
  $(id).innerHTML=rows.length?rows.map(([k,v])=>`<div class="bar-row"><span>${esc(k)}</span><div class="bar-track"><div class="bar-fill" style="width:${total?Math.round(v/total*100):0}%"></div></div><strong>${v}</strong></div>`).join(""):"データなし";
}
function renderDashboard(){
  const r=loadDB().records,total=r.length,alert=r.filter(x=>LEVELS[x.level].rank>=1).length;
  $("dashTotal").textContent=total;$("dashAlert").textContent=alert;$("dashSymptoms").textContent=r.filter(x=>x.abnormal).length;$("dashPending").textContent=r.filter(x=>!x.validation).length;
  const levels={通常:0,注意:0,警戒:0,"中止・確認":0},sites={};
  r.forEach(x=>{levels[LEVELS[x.level].label]++;sites[x.site||"現場未設定"]=(sites[x.site||"現場未設定"]||0)+1;});
  renderBars("levelBreakdown",levels,total);renderBars("siteBreakdown",sites,total);
  $("dashboardRecords").innerHTML=table(r.slice(0,50));
}
function table(rows){
  if(!rows.length)return "記録はありません。";
  return `<table><thead><tr><th>日時</th><th>作業員</th><th>現場</th><th>判定</th><th>WBGT</th><th>評価</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.createdAt)}</td><td>${esc(r.workerName)}（${esc(r.workerId)}）</td><td>${esc(r.site||"—")}</td><td>${LEVELS[r.level].label}</td><td>${r.wbgt??"—"}</td><td>${r.validation?"済":"未"}</td></tr>`).join("")}</tbody></table>`;
}

function renderWorkerCard(){
  renderAllSelectors();const id=$("workerCardSelect").value,db=loadDB(),w=db.workers.find(x=>x.id===id);
  if(!w){$("workerProfile").textContent="作業員を選択してください。";$("workerSummary").innerHTML="";$("workerRecords").innerHTML="";drawChart([]);return;}
  $("workerProfile").textContent=`${w.name}（${w.id}）／${w.site||"現場未設定"}／${w.team||"班未設定"}`;
  const period=$("workerCardPeriod").value,cut=period==="all"?0:Date.now()-Number(period)*86400000;
  const rows=db.records.filter(r=>r.workerId===id&&(!cut||new Date(r.createdAt).getTime()>=cut)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  const alerts=rows.filter(r=>LEVELS[r.level].rank>=1).length,avgW=rows.filter(r=>r.wbgt!==null).reduce((s,r)=>s+r.wbgt,0)/(rows.filter(r=>r.wbgt!==null).length||1);
  $("workerSummary").innerHTML=`<div class="summary-card"><span>測定件数</span><strong>${rows.length}</strong></div><div class="summary-card"><span>注意以上</span><strong>${alerts}</strong></div><div class="summary-card"><span>平均WBGT</span><strong>${avgW?avgW.toFixed(1):"—"}</strong></div><div class="summary-card"><span>評価済み</span><strong>${rows.filter(r=>r.validation).length}</strong></div>`;
  drawChart(rows);$("workerRecords").innerHTML=table([...rows].reverse());
}
$("workerCardSelect").onchange=renderWorkerCard;$("workerCardPeriod").onchange=renderWorkerCard;
function drawChart(rows){
  const c=$("workerChart"),ctx=c.getContext("2d"),w=c.width=c.clientWidth*devicePixelRatio,h=c.height=280*devicePixelRatio;ctx.scale(devicePixelRatio,devicePixelRatio);const W=c.clientWidth,H=280;ctx.clearRect(0,0,W,H);ctx.fillStyle="#fff";ctx.fillRect(0,0,W,H);ctx.strokeStyle="#d8e4e4";for(let y=30;y<=230;y+=50){ctx.beginPath();ctx.moveTo(45,y);ctx.lineTo(W-15,y);ctx.stroke();}
  if(!rows.length){ctx.fillStyle="#60777b";ctx.fillText("測定記録なし",55,60);return;}
  const pts=rows.slice(-30),step=(W-70)/Math.max(1,pts.length-1);ctx.strokeStyle="#0f766e";ctx.lineWidth=3;ctx.beginPath();pts.forEach((r,i)=>{const x=45+i*step,y=230-LEVELS[r.level].rank*60;i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();ctx.fillStyle="#17343a";["通常","注意","警戒","中止"].forEach((t,i)=>ctx.fillText(t,4,234-i*60));
}

$("saveSettings").onclick=()=>{const d=loadDB();d.settings.duration=Math.max(5,Math.min(30,Number($("settingDuration").value)||10));d.settings.wbgtYellow=Number($("settingWbgtYellow").value)||28;d.settings.wbgtOrange=Number($("settingWbgtOrange").value)||31;saveDB(d);setStatus("settingsStatus","設定を保存しました。","success");};
$("exportJson").onclick=()=>download("heat-check-v11-backup.json",JSON.stringify(loadDB(),null,2),"application/json");
$("exportCsv").onclick=()=>{const rows=loadDB().records,head=["日時","作業員ID","氏名","現場","作業班","判定","WBGT","体調異常","水分補給","明るさ","左右差","動き","顔色差","顔AI総合点","顔色点","発汗傾向点","実証評価","所見"];const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv="\ufeff"+[head,...rows.map(r=>[r.createdAt,r.workerId,r.workerName,r.site,r.team,LEVELS[r.level].label,r.wbgt,r.abnormal?"あり":"なし",r.hydration,r.metrics.brightness,r.metrics.asymmetry,r.metrics.motion,r.metrics.redness,Math.max(0,100-(r.faceAI?.overallRisk??0)),Math.max(0,100-(r.faceAI?.colorRisk??0)),Math.max(0,100-(r.faceAI?.sweatRisk??0)),r.validation?.result||"",r.validation?.comment||""])].map(a=>a.map(q).join(",")).join("\n");download("heat-check-v11-records.csv",csv,"text/csv");};
$("importJson").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);if(!Array.isArray(d.records)||!Array.isArray(d.workers))throw new Error();saveDB({...defaultDB(),...d});init();alert("復元しました。");}catch{alert("正しいバックアップファイルではありません。");}};rd.readAsText(f);e.target.value="";};
$("clearRecords").onclick=()=>{if(!confirm("測定記録と実証評価をすべて削除しますか？"))return;const d=loadDB();d.records=[];saveDB(d);renderDashboard();renderValidation();renderWorkerCard();};

function init(){
  const d=loadDB();$("settingDuration").value=d.settings.duration;$("settingWbgtYellow").value=d.settings.wbgtYellow;$("settingWbgtOrange").value=d.settings.wbgtOrange;
  renderAllSelectors();renderMaster();renderValidation();renderDashboard();renderWorkerCard();
}
window.addEventListener("beforeunload",()=>stream?.getTracks().forEach(t=>t.stop()));
window.HeatCheckApp={
  switchView,
  loadDB,
  saveDB,
  defaultDB,
  refresh(){
    init();
    renderAdminDashboard?.();
    renderMasterTransferStatus?.();
  }
};
init();
console.info("現場 AIコンディションチェック Ver.12.0 第1段階 顔色・発汗解析 読込完了");


/* =========================================================
   Ver.11.2 第4.1 完全修正版
   管理者ダッシュボードと現場運用マスタ共有を
   単一DB（heatCheckV11）へ統合
   ========================================================= */

const MASTER_META_KEY = "heatCheckMasterMeta";

function recordDate(record){
  const date = new Date(record?.createdAt || 0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}
function sameLocalDate(a,b){
  return a.getFullYear()===b.getFullYear()
    && a.getMonth()===b.getMonth()
    && a.getDate()===b.getDate();
}
function formatAdminDate(date){
  if(!(date instanceof Date) || Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP",{
    month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
  }).format(date);
}
function levelLabel(level){
  return LEVELS[level]?.label || "—";
}
function levelRank(level){
  return LEVELS[level]?.rank ?? 0;
}

function renderAdminDashboard(){
  const db = loadDB();
  const records = [...db.records].sort((a,b)=>recordDate(b)-recordDate(a));
  const today = new Date();
  const todayRecords = records.filter(r=>sameLocalDate(recordDate(r),today));
  const alertRecords = todayRecords.filter(r=>levelRank(r.level)>=1);
  const confidences = todayRecords
    .map(r=>Number(r.confidence))
    .filter(Number.isFinite);
  const average = confidences.length
    ? Math.round(confidences.reduce((a,b)=>a+b,0)/confidences.length)
    : null;

  if(!$("adminTodayCount")) return;

  $("adminTodayCount").textContent = todayRecords.length;
  $("adminAlertCount").textContent = alertRecords.length;
  $("adminWorkerCount").textContent = db.workers.length;
  $("adminAverageConfidence").textContent = average ?? "—";

  const counts = {green:0,yellow:0,orange:0,red:0};
  todayRecords.forEach(r=>{
    if(r.level in counts) counts[r.level]++;
  });

  $("adminLevelSummary").innerHTML = Object.entries(counts).map(([level,count])=>`
    <div class="level-summary-row ${level}">
      <span>${esc(levelLabel(level))}</span>
      <strong>${count}件</strong>
    </div>
  `).join("");

  const recentAlerts = records.filter(r=>levelRank(r.level)>=1).slice(0,8);
  $("adminRecentAlerts").innerHTML = recentAlerts.length
    ? recentAlerts.map(r=>`
      <div class="recent-alert-item ${esc(r.level)}">
        <div>
          <strong>${esc(r.workerName || r.workerId || "未登録")}</strong>
          <span>${esc(formatAdminDate(recordDate(r)))}</span>
        </div>
        <b>${esc(levelLabel(r.level))}</b>
      </div>
    `).join("")
    : '<p class="empty-message">要確認結果はありません。</p>';

  const select = $("adminWorkerSelect");
  if(select){
    const current = select.value;
    select.innerHTML = '<option value="">作業員を選択</option>' +
      db.workers.map(w=>`<option value="${esc(w.id)}">${esc(w.name||w.id)}（${esc(w.id)}）</option>`).join("");
    if(db.workers.some(w=>w.id===current)) select.value=current;
  }
  renderAdminWorkerCard();
  renderMasterTransferStatus();
}

function renderAdminWorkerCard(){
  const card = $("adminWorkerCard");
  const select = $("adminWorkerSelect");
  if(!card || !select) return;

  const id = select.value;
  if(!id){
    card.innerHTML='<p class="empty-message">作業員を選択してください。</p>';
    return;
  }

  const db=loadDB();
  const worker=db.workers.find(w=>w.id===id);
  const records=db.records
    .filter(r=>r.workerId===id)
    .sort((a,b)=>recordDate(b)-recordDate(a));

  const latest=records[0];
  const alerts=records.filter(r=>levelRank(r.level)>=1).length;
  const trend=records.slice(0,10).reverse();

  card.innerHTML=`
    <div class="worker-card-head">
      <div>
        <strong>${esc(worker?.name||id)}</strong>
        <span>現場：${esc(worker?.site||"未設定")}／班：${esc(worker?.team||"未設定")}</span>
      </div>
      <b>${records.length}回測定</b>
    </div>
    <div class="worker-card-stats">
      <div><span>最新判定</span><strong>${latest?esc(levelLabel(latest.level)):"—"}</strong></div>
      <div><span>注意以上</span><strong>${alerts}回</strong></div>
      <div><span>最新測定</span><strong>${latest?esc(formatAdminDate(recordDate(latest))):"—"}</strong></div>
    </div>
    <div class="worker-trend">
      <span>直近10回</span>
      <div>${trend.length
        ? trend.map(r=>`<span class="worker-trend-dot ${esc(r.level)}" title="${esc(formatAdminDate(recordDate(r)))}：${esc(levelLabel(r.level))}"></span>`).join("")
        : '<span class="empty-message">履歴なし</span>'}
      </div>
    </div>
  `;
}

function getMasterMeta(){
  try{
    const value=JSON.parse(localStorage.getItem(MASTER_META_KEY)||"null");
    if(value && typeof value==="object") return value;
  }catch(_){}
  return {masterVersion:"未設定",updatedAt:null,source:"端末保存"};
}
function saveMasterMeta(meta){
  localStorage.setItem(MASTER_META_KEY,JSON.stringify(meta));
}
function createMasterVersion(){
  const d=new Date(), p=v=>String(v).padStart(2,"0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function formatMasterDate(value){
  if(!value) return "未設定";
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? "未設定" :
    new Intl.DateTimeFormat("ja-JP",{
      year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
    }).format(d);
}
function renderMasterTransferStatus(){
  if(!$("masterVersionDisplay")) return;
  const db=loadDB(), meta=getMasterMeta();
  $("masterVersionDisplay").textContent=meta.masterVersion||"未設定";
  $("masterUpdatedDisplay").textContent=formatMasterDate(meta.updatedAt);
  $("masterSiteCount").textContent=db.sites.length;
  $("masterWorkerCount").textContent=db.workers.length;

  const badge=$("masterSyncStatus");
  badge.textContent=meta.source||"端末保存";
  badge.className="master-status-badge";
  if(meta.source==="ファイル取込") badge.classList.add("imported");
  if(meta.source==="PC作成") badge.classList.add("pc-created");
}
function showMasterMessage(type,message){
  const box=$("masterImportPreview");
  if(!box) return;
  box.classList.remove("hidden","success","warning","error");
  box.classList.add(type);
  box.textContent=message;
}
function selectedMasterImportMode(){
  return document.querySelector('input[name="masterImportMode"]:checked')?.value || "merge";
}
function cloneData(value){
  return typeof structuredClone==="function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}
function mergeSimpleValues(current,incoming){
  return [...new Set([...current,...incoming].map(v=>String(v).trim()).filter(Boolean))];
}
function mergeWorkers(current,incoming){
  const map=new Map(current.map(w=>[normalizeId(w.id),cloneData(w)]));
  incoming.forEach(w=>{
    const id=normalizeId(w.id);
    if(!id) return;
    map.set(id,{...(map.get(id)||{}),...cloneData(w),id});
  });
  return [...map.values()];
}

function exportOperationMaster(){
  const db=loadDB();
  const now=new Date().toISOString();
  const version=createMasterVersion();

  const payload={
    schema:"heat-check-operation-master",
    schemaVersion:2,
    app:"現場 AIコンディションチェック",
    appVersion:"11.2-stage4.1",
    masterVersion:version,
    updatedAt:now,
    containsMeasurements:false,
    containsImages:false,
    master:{
      sites:cloneData(db.sites),
      teams:cloneData(db.teams),
      workers:cloneData(db.workers),
      settings:cloneData(db.settings)
    }
  };

  saveMasterMeta({masterVersion:version,updatedAt:now,source:"PC作成"});
  download(
    `heat-check-master-${version}.json`,
    JSON.stringify(payload,null,2),
    "application/json"
  );
  renderMasterTransferStatus();
  showMasterMessage(
    "success",
    `マスタを出力しました。現場${db.sites.length}件、班${db.teams.length}件、作業員${db.workers.length}件です。`
  );
}

function validateMasterPayload(payload){
  if(!payload || typeof payload!=="object") throw new Error("JSON形式が正しくありません。");
  if(payload.schema!=="heat-check-operation-master") throw new Error("現場運用マスタ用ファイルではありません。");
  if(!payload.master || typeof payload.master!=="object") throw new Error("マスタデータがありません。");

  return {
    sites:Array.isArray(payload.master.sites)?payload.master.sites:[],
    teams:Array.isArray(payload.master.teams)?payload.master.teams:[],
    workers:Array.isArray(payload.master.workers)?payload.master.workers:[],
    settings:payload.master.settings && typeof payload.master.settings==="object"
      ? payload.master.settings
      : {}
  };
}

async function importOperationMaster(event){
  const file=event.target.files?.[0];
  if(!file) return;

  try{
    const payload=JSON.parse(await file.text());
    const master=validateMasterPayload(payload);
    const mode=selectedMasterImportMode();

    const message=[
      mode==="replace"
        ? "端末内の運用マスタをすべて置き換えます。"
        : "既存マスタへ追加し、同一作業員IDは上書きします。",
      "",
      `現場：${master.sites.length}件`,
      `班：${master.teams.length}件`,
      `作業員：${master.workers.length}件`,
      "",
      "測定履歴は変更されません。",
      "取り込みを実行しますか？"
    ].join("\n");
    if(!confirm(message)) return;

    const db=loadDB();
    if(mode==="replace"){
      db.sites=cloneData(master.sites);
      db.teams=cloneData(master.teams);
      db.workers=cloneData(master.workers)
        .map(w=>({...w,id:normalizeId(w.id)}))
        .filter(w=>w.id);
      db.settings={...defaultDB().settings,...cloneData(master.settings)};
    }else{
      db.sites=mergeSimpleValues(db.sites,master.sites);
      db.teams=mergeSimpleValues(db.teams,master.teams);
      db.workers=mergeWorkers(db.workers,master.workers);
      db.settings={...db.settings,...cloneData(master.settings)};
    }

    saveDB(db);
    const now=new Date().toISOString();
    saveMasterMeta({
      masterVersion:payload.masterVersion||createMasterVersion(),
      updatedAt:payload.updatedAt||now,
      importedAt:now,
      source:"ファイル取込",
      importMode:mode,
      importedFilename:file.name
    });

    init();
    renderAdminDashboard();
    renderMasterTransferStatus();
    showMasterMessage(
      "success",
      `マスタを取り込みました。${mode==="replace"?"全置換":"追加・同一ID上書き"}で反映し、測定履歴は保持しています。`
    );
    alert("現場運用マスタを反映しました。測定履歴は変更していません。");
  }catch(error){
    showMasterMessage("error",`取込エラー：${error.message}`);
    alert(`マスタを取り込めませんでした：${error.message}`);
  }finally{
    event.target.value="";
  }
}

function exportMeasurementsCsv41(){
  $("exportCsv").click();
}
function exportBackupJson41(){
  $("exportJson").click();
}
async function importBackupJson41(event){
  const file=event.target.files?.[0];
  if(!file) return;
  const dataTransfer=new DataTransfer();
  dataTransfer.items.add(file);
  $("importJson").files=dataTransfer.files;
  $("importJson").dispatchEvent(new Event("change"));
  event.target.value="";
}

function bindStage41(){
  $("refreshAdminSummary")?.addEventListener("click",renderAdminDashboard);
  $("adminWorkerSelect")?.addEventListener("change",renderAdminWorkerCard);
  $("exportMasterJson")?.addEventListener("click",exportOperationMaster);
  $("importMasterJson")?.addEventListener("change",importOperationMaster);
  $("exportMeasurementsCsv")?.addEventListener("click",exportMeasurementsCsv41);
  $("exportBackupJson")?.addEventListener("click",exportBackupJson41);
  $("importBackupJson")?.addEventListener("change",importBackupJson41);

  renderAdminDashboard();
  renderMasterTransferStatus();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",bindStage41);
}else{
  bindStage41();
}
window.addEventListener("storage",()=>{
  renderAdminDashboard();
  renderMasterTransferStatus();
});
