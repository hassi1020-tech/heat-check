"use strict";
const DB_KEY="heatCheckV11";
const LEVELS={green:{label:"通常",rank:0},yellow:{label:"注意",rank:1},orange:{label:"警戒",rank:2},red:{label:"作業中止",rank:3}};
const $=id=>document.getElementById(id);
let stream=null, measuring=false, guideTimer=null;

function defaultDB(){
  return {version:"11.2",sites:[],teams:[],workers:[],records:[],settings:{duration:10,wbgtYellow:28,wbgtOrange:31},updatedAt:new Date().toISOString()};
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
function saveDB(db){db.updatedAt=new Date().toISOString();localStorage.setItem(DB_KEY,JSON.stringify(db));}
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
  if(name==="dashboard")renderDashboard();
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
  const v=$("camera"),c=document.createElement("canvas"),size=240;c.width=size;c.height=size;
  const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(v,0,0,size,size);
  const d=ctx.getImageData(0,0,size,size).data;let sum=0,r=0,g=0,b=0,left=0,right=0,n=0;
  for(let y=35;y<205;y+=3)for(let x=35;x<205;x+=3){const i=(y*size+x)*4,br=(d[i]+d[i+1]+d[i+2])/3;sum+=br;r+=d[i];g+=d[i+1];b+=d[i+2];if(x<size/2)left+=br;else right+=br;n++;}
  return {brightness:sum/n,red:r/n,green:g/n,blue:b/n,asymmetry:Math.abs(left-right)/(sum||1)*100};
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
  if(Math.abs(redness)>25){raise("yellow");reasons.push("基準から顔色差が大きい");}
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
    quality,confidence,wbgt,abnormal,hydration
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
    ["顔色差数値", r.metrics?.redness ?? "—"]
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
$("exportCsv").onclick=()=>{const rows=loadDB().records,head=["日時","作業員ID","氏名","現場","作業班","判定","WBGT","体調異常","水分補給","明るさ","左右差","動き","顔色差","実証評価","所見"];const q=v=>`"${String(v??"").replace(/"/g,'""')}"`;const csv="\ufeff"+[head,...rows.map(r=>[r.createdAt,r.workerId,r.workerName,r.site,r.team,LEVELS[r.level].label,r.wbgt,r.abnormal?"あり":"なし",r.hydration,r.metrics.brightness,r.metrics.asymmetry,r.metrics.motion,r.metrics.redness,r.validation?.result||"",r.validation?.comment||""])].map(a=>a.map(q).join(",")).join("\n");download("heat-check-v11-records.csv",csv,"text/csv");};
$("importJson").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);if(!Array.isArray(d.records)||!Array.isArray(d.workers))throw new Error();saveDB({...defaultDB(),...d});init();alert("復元しました。");}catch{alert("正しいバックアップファイルではありません。");}};rd.readAsText(f);e.target.value="";};
$("clearRecords").onclick=()=>{if(!confirm("測定記録と実証評価をすべて削除しますか？"))return;const d=loadDB();d.records=[];saveDB(d);renderDashboard();renderValidation();renderWorkerCard();};

function init(){
  const d=loadDB();$("settingDuration").value=d.settings.duration;$("settingWbgtYellow").value=d.settings.wbgtYellow;$("settingWbgtOrange").value=d.settings.wbgtOrange;
  renderAllSelectors();renderMaster();renderValidation();renderDashboard();renderWorkerCard();
}
window.addEventListener("beforeunload",()=>stream?.getTracks().forEach(t=>t.stop()));
init();
console.info("現場 AIコンディションチェック Ver.11.2 第4段階 読込完了");

/* =========================================================
   Ver.11.2 第3段階：管理者ダッシュボード・データ管理
   ========================================================= */

const ADMIN_STORAGE_KEYS = {
  workers: ["workers", "heatCheckWorkers", "workerMaster"],
  records: ["records", "measurements", "heatCheckRecords", "measurementHistory"],
  sites: ["sites", "heatCheckSites", "siteMaster"],
  teams: ["teams", "heatCheckTeams", "teamMaster"]
};

function readFirstArray(keys){
  for(const key of keys){
    try{
      const value = JSON.parse(localStorage.getItem(key) || "null");
      if(Array.isArray(value)) return value;
    }catch(_){}
  }
  return [];
}

function adminWorkers(){
  if(typeof loadWorkers === "function"){
    try{
      const value = loadWorkers();
      if(Array.isArray(value)) return value;
    }catch(_){}
  }
  return readFirstArray(ADMIN_STORAGE_KEYS.workers);
}

function adminRecords(){
  if(typeof loadRecords === "function"){
    try{
      const value = loadRecords();
      if(Array.isArray(value)) return value;
    }catch(_){}
  }
  return readFirstArray(ADMIN_STORAGE_KEYS.records);
}

function recordLevel(record){
  return record.level || record.result?.level || record.judgement || record.status || "green";
}

function recordDate(record){
  const raw = record.createdAt || record.date || record.timestamp || record.measuredAt;
  const date = raw ? new Date(raw) : new Date(0);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

function recordWorkerId(record){
  return String(record.workerId || record.worker?.id || record.workerCode || "");
}

function recordWorkerName(record){
  return record.workerName || record.worker?.name || record.name || "未登録";
}

function recordConfidence(record){
  const raw = record.confidence ?? record.result?.confidence;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function sameLocalDate(a,b){
  return a.getFullYear()===b.getFullYear()
    && a.getMonth()===b.getMonth()
    && a.getDate()===b.getDate();
}

function levelLabel(level){
  return LEVELS[level]?.label || level || "—";
}

function levelRank(level){
  return LEVELS[level]?.rank ?? 0;
}

function formatAdminDate(date){
  if(!(date instanceof Date) || Number.isNaN(date.getTime())) return "日時不明";
  return new Intl.DateTimeFormat("ja-JP",{
    month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"
  }).format(date);
}

function renderAdminDashboard(){
  const records = adminRecords().slice().sort((a,b)=>recordDate(b)-recordDate(a));
  const workers = adminWorkers();
  const today = new Date();
  const todayRecords = records.filter(record=>sameLocalDate(recordDate(record),today));
  const alertRecords = todayRecords.filter(record=>levelRank(recordLevel(record))>=1);
  const confidences = todayRecords.map(recordConfidence).filter(v=>v!==null);
  const average = confidences.length
    ? Math.round(confidences.reduce((sum,v)=>sum+v,0)/confidences.length)
    : null;

  const todayEl = $("adminTodayCount");
  if(!todayEl) return;

  todayEl.textContent = todayRecords.length;
  $("adminAlertCount").textContent = alertRecords.length;
  $("adminWorkerCount").textContent = workers.length;
  $("adminAverageConfidence").textContent = average ?? "—";

  const counts = {green:0,yellow:0,orange:0,red:0};
  for(const record of todayRecords){
    const level = recordLevel(record);
    if(level in counts) counts[level]++;
  }

  $("adminLevelSummary").innerHTML = Object.entries(counts).map(([level,count])=>`
    <div class="level-summary-row ${level}">
      <span>${esc(levelLabel(level))}</span>
      <strong>${count}件</strong>
    </div>
  `).join("");

  const recentAlerts = records
    .filter(record=>levelRank(recordLevel(record))>=1)
    .slice(0,8);

  $("adminRecentAlerts").innerHTML = recentAlerts.length
    ? recentAlerts.map(record=>`
      <div class="recent-alert-item ${recordLevel(record)}">
        <div>
          <strong>${esc(recordWorkerName(record))}</strong>
          <span>${esc(formatAdminDate(recordDate(record)))}</span>
        </div>
        <b>${esc(levelLabel(recordLevel(record)))}</b>
      </div>
    `).join("")
    : '<p class="empty-message">要確認結果はありません。</p>';

  updateAdminWorkerSelect(workers);
  renderAdminWorkerCard();
}

function updateAdminWorkerSelect(workers){
  const select = $("adminWorkerSelect");
  if(!select) return;
  const current = select.value;
  const options = ['<option value="">作業員を選択</option>'];

  workers.forEach((worker,index)=>{
    const id = String(worker.id || worker.workerId || worker.code || index);
    const name = worker.name || worker.workerName || `作業員${index+1}`;
    options.push(`<option value="${esc(id)}">${esc(name)}</option>`);
  });

  select.innerHTML = options.join("");
  if([...select.options].some(option=>option.value===current)) select.value=current;
}

function renderAdminWorkerCard(){
  const select = $("adminWorkerSelect");
  const card = $("adminWorkerCard");
  if(!select || !card) return;

  const workerId = select.value;
  if(!workerId){
    card.innerHTML = '<p class="empty-message">作業員を選択してください。</p>';
    return;
  }

  const workers = adminWorkers();
  const worker = workers.find((item,index)=>
    String(item.id || item.workerId || item.code || index)===workerId
  );

  const records = adminRecords()
    .filter(record=>recordWorkerId(record)===workerId)
    .sort((a,b)=>recordDate(b)-recordDate(a));

  const name = worker?.name || worker?.workerName || records[0]?.workerName || "作業員";
  const site = worker?.site || worker?.siteName || "—";
  const team = worker?.team || worker?.teamName || "—";
  const latest = records[0];
  const alertCount = records.filter(record=>levelRank(recordLevel(record))>=1).length;

  const trend = records.slice(0,10).reverse();
  const trendHtml = trend.length
    ? trend.map(record=>{
        const level = recordLevel(record);
        return `<span class="worker-trend-dot ${level}" title="${esc(formatAdminDate(recordDate(record)))}：${esc(levelLabel(level))}"></span>`;
      }).join("")
    : '<span class="empty-message">履歴なし</span>';

  card.innerHTML = `
    <div class="worker-card-head">
      <div>
        <strong>${esc(name)}</strong>
        <span>現場：${esc(site)}／班：${esc(team)}</span>
      </div>
      <b>${records.length}回測定</b>
    </div>
    <div class="worker-card-stats">
      <div><span>最新判定</span><strong>${latest ? esc(levelLabel(recordLevel(latest))) : "—"}</strong></div>
      <div><span>注意以上</span><strong>${alertCount}回</strong></div>
      <div><span>最新測定</span><strong>${latest ? esc(formatAdminDate(recordDate(latest))) : "—"}</strong></div>
    </div>
    <div class="worker-trend">
      <span>直近10回</span>
      <div>${trendHtml}</div>
    </div>
  `;
}

function csvCell(value){
  const text = value==null ? "" : String(value);
  return `"${text.replace(/"/g,'""')}"`;
}

function downloadTextFile(filename,text,type){
  const blob = new Blob([text],{type});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href=url;
  anchor.download=filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
}

function exportAdminCsv(){
  const records = adminRecords().slice().sort((a,b)=>recordDate(a)-recordDate(b));
  const header = [
    "測定日時","作業員ID","作業員名","判定","信頼度",
    "WBGT","自覚症状","水分補給","測定品質","顔色","左右差","動き"
  ];

  const rows = records.map(record=>{
    const indicators = record.indicators || record.result?.indicators || {};
    return [
      recordDate(record).toISOString(),
      recordWorkerId(record),
      recordWorkerName(record),
      levelLabel(recordLevel(record)),
      recordConfidence(record) ?? "",
      record.wbgt ?? record.result?.wbgt ?? "",
      record.abnormal ?? record.result?.abnormal ? "あり" : "なし",
      record.hydration ?? record.result?.hydration ?? "",
      record.quality ?? record.result?.quality ?? "",
      indicators.faceColor ?? "",
      indicators.symmetry ?? "",
      indicators.movement ?? ""
    ].map(csvCell).join(",");
  });

  const csv = "\uFEFF" + [header.map(csvCell).join(","),...rows].join("\r\n");
  downloadTextFile(
    `heat-check-records-${new Date().toISOString().slice(0,10)}.csv`,
    csv,
    "text/csv;charset=utf-8"
  );
}

function exportAdminBackup(){
  const backup = {
    app:"現場 AIコンディションチェック",
    version:"11.2-stage3",
    exportedAt:new Date().toISOString(),
    localStorage:{}
  };

  for(let i=0;i<localStorage.length;i++){
    const key=localStorage.key(i);
    backup.localStorage[key]=localStorage.getItem(key);
  }

  downloadTextFile(
    `heat-check-backup-${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify(backup,null,2),
    "application/json"
  );
}

async function importAdminBackup(event){
  const file=event.target.files?.[0];
  if(!file) return;

  try{
    const backup=JSON.parse(await file.text());
    if(!backup || typeof backup.localStorage!=="object"){
      throw new Error("バックアップ形式が正しくありません。");
    }

    const ok=confirm("現在の保存データをバックアップ内容で置き換えます。実行しますか？");
    if(!ok) return;

    localStorage.clear();
    Object.entries(backup.localStorage).forEach(([key,value])=>{
      localStorage.setItem(key,String(value));
    });

    alert("データを復元しました。画面を再読み込みします。");
    location.reload();
  }catch(error){
    alert(`復元できませんでした：${error.message}`);
  }finally{
    event.target.value="";
  }
}

function bindAdminDashboard(){
  $("refreshAdminSummary")?.addEventListener("click",renderAdminDashboard);
  $("adminWorkerSelect")?.addEventListener("change",renderAdminWorkerCard);
  $("exportMeasurementsCsv")?.addEventListener("click",exportAdminCsv);
  $("exportBackupJson")?.addEventListener("click",exportAdminBackup);
  $("importBackupJson")?.addEventListener("change",importAdminBackup);
  renderAdminDashboard();
}

if(document.readyState==="loading"){
  document.addEventListener("DOMContentLoaded",bindAdminDashboard);
}else{
  bindAdminDashboard();
}

window.addEventListener("storage",renderAdminDashboard);


/* =========================================================
   Ver.11.2 第4段階：現場運用マスタ端末間共有
   ========================================================= */

const MASTER_META_KEY = "heatCheckMasterMeta";

const MASTER_DEFINITIONS = {
  sites: {
    keys: ["sites", "heatCheckSites", "siteMaster"],
    idFields: ["id", "siteId", "code"],
    label: "現場"
  },
  teams: {
    keys: ["teams", "heatCheckTeams", "teamMaster"],
    idFields: ["id", "teamId", "code"],
    label: "班"
  },
  workers: {
    keys: ["workers", "heatCheckWorkers", "workerMaster"],
    idFields: ["id", "workerId", "code"],
    label: "作業員"
  },
  settings: {
    keys: ["operationSettings", "heatCheckSettings", "settingsMaster"],
    idFields: ["id", "key", "code"],
    label: "運用設定"
  }
};

function masterReadArray(definition){
  for(const key of definition.keys){
    try{
      const parsed = JSON.parse(localStorage.getItem(key) || "null");
      if(Array.isArray(parsed)) return {key, data:parsed};
    }catch(_){}
  }
  return {key:definition.keys[0], data:[]};
}

function masterWriteArray(definition, key, data){
  const destinationKey = key || definition.keys[0];
  localStorage.setItem(destinationKey, JSON.stringify(data));
}

function masterItemId(item, definition, index){
  for(const field of definition.idFields){
    const value = item?.[field];
    if(value !== undefined && value !== null && String(value).trim() !== ""){
      return String(value);
    }
  }

  const name = item?.name || item?.workerName || item?.siteName || item?.teamName;
  if(name) return `name:${String(name).trim()}`;

  return `index:${index}`;
}

function getMasterMeta(){
  try{
    const parsed = JSON.parse(localStorage.getItem(MASTER_META_KEY) || "null");
    if(parsed && typeof parsed === "object") return parsed;
  }catch(_){}

  return {
    masterVersion: "未設定",
    updatedAt: null,
    source: "端末保存"
  };
}

function createMasterVersion(){
  const date = new Date();
  const pad = value => String(value).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth()+1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join("");
}

function saveMasterMeta(meta){
  localStorage.setItem(MASTER_META_KEY, JSON.stringify(meta));
}

function collectOperationMaster(){
  const collections = {};

  Object.entries(MASTER_DEFINITIONS).forEach(([name,definition])=>{
    const result = masterReadArray(definition);
    collections[name] = {
      storageKey: result.key,
      items: result.data
    };
  });

  return collections;
}

function countMasterItems(collections, name){
  return Array.isArray(collections?.[name]?.items)
    ? collections[name].items.length
    : 0;
}

function formatMasterDate(value){
  if(!value) return "未設定";
  const date = new Date(value);
  if(Number.isNaN(date.getTime())) return "未設定";

  return new Intl.DateTimeFormat("ja-JP",{
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit"
  }).format(date);
}

function renderMasterTransferStatus(){
  const collections = collectOperationMaster();
  const meta = getMasterMeta();

  const versionEl = $("masterVersionDisplay");
  if(!versionEl) return;

  versionEl.textContent = meta.masterVersion || "未設定";
  $("masterUpdatedDisplay").textContent = formatMasterDate(meta.updatedAt);
  $("masterSiteCount").textContent = countMasterItems(collections, "sites");
  $("masterWorkerCount").textContent = countMasterItems(collections, "workers");

  const badge = $("masterSyncStatus");
  badge.textContent = meta.source || "端末保存";
  badge.className = "master-status-badge";

  if(meta.source === "ファイル取込"){
    badge.classList.add("imported");
  }else if(meta.source === "PC作成"){
    badge.classList.add("pc-created");
  }
}

function exportOperationMaster(){
  const collections = collectOperationMaster();
  const now = new Date().toISOString();
  const version = createMasterVersion();

  const payload = {
    schema: "heat-check-operation-master",
    schemaVersion: 1,
    app: "現場 AIコンディションチェック",
    appVersion: "11.2-stage4",
    masterVersion: version,
    updatedAt: now,
    exportedAt: now,
    containsMeasurements: false,
    containsImages: false,
    master: {}
  };

  Object.entries(collections).forEach(([name,value])=>{
    payload.master[name] = value.items;
  });

  saveMasterMeta({
    masterVersion: version,
    updatedAt: now,
    source: "PC作成"
  });

  downloadTextFile(
    `heat-check-master-${version}.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );

  renderMasterTransferStatus();
  showMasterMessage(
    "success",
    `マスタを出力しました。現場${payload.master.sites.length}件、班${payload.master.teams.length}件、作業員${payload.master.workers.length}件です。`
  );
}

function validateMasterPayload(payload){
  if(!payload || typeof payload !== "object"){
    throw new Error("JSON形式が正しくありません。");
  }

  if(payload.schema !== "heat-check-operation-master"){
    throw new Error("現場運用マスタ用のファイルではありません。");
  }

  if(!payload.master || typeof payload.master !== "object"){
    throw new Error("マスタデータがありません。");
  }

  const validated = {};

  Object.keys(MASTER_DEFINITIONS).forEach(name=>{
    const value = payload.master[name];
    validated[name] = Array.isArray(value) ? value : [];
  });

  return validated;
}

function mergeMasterArrays(current, incoming, definition){
  const result = current.map(item=>structuredCloneSafe(item));
  const indexMap = new Map();

  result.forEach((item,index)=>{
    indexMap.set(masterItemId(item,definition,index),index);
  });

  incoming.forEach((item,index)=>{
    const cloned = structuredCloneSafe(item);
    const id = masterItemId(cloned,definition,index);

    if(indexMap.has(id)){
      result[indexMap.get(id)] = cloned;
    }else{
      indexMap.set(id,result.length);
      result.push(cloned);
    }
  });

  return result;
}

function structuredCloneSafe(value){
  if(typeof structuredClone === "function"){
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function selectedMasterImportMode(){
  return document.querySelector(
    'input[name="masterImportMode"]:checked'
  )?.value || "merge";
}

function showMasterMessage(type,message){
  const box = $("masterImportPreview");
  if(!box) return;

  box.classList.remove("hidden","success","warning","error");
  box.classList.add(type);
  box.textContent = message;
}

async function importOperationMaster(event){
  const file = event.target.files?.[0];
  if(!file) return;

  try{
    const payload = JSON.parse(await file.text());
    const incoming = validateMasterPayload(payload);
    const mode = selectedMasterImportMode();

    const counts = Object.fromEntries(
      Object.entries(incoming).map(([name,items])=>[name,items.length])
    );

    const modeText = mode === "replace"
      ? "端末内の現場運用マスタをすべて置き換えます。"
      : "既存マスタへ追加し、同一IDのデータは上書きします。";

    const confirmation = [
      modeText,
      "",
      `現場：${counts.sites}件`,
      `班：${counts.teams}件`,
      `作業員：${counts.workers}件`,
      `運用設定：${counts.settings}件`,
      "",
      "測定履歴は変更されません。",
      "取込みを実行しますか？"
    ].join("\n");

    if(!confirm(confirmation)) return;

    Object.entries(MASTER_DEFINITIONS).forEach(([name,definition])=>{
      const current = masterReadArray(definition);
      const newData = mode === "replace"
        ? incoming[name].map(item=>structuredCloneSafe(item))
        : mergeMasterArrays(current.data,incoming[name],definition);

      masterWriteArray(definition,current.key,newData);
    });

    const importedAt = new Date().toISOString();

    saveMasterMeta({
      masterVersion: payload.masterVersion || createMasterVersion(),
      updatedAt: payload.updatedAt || importedAt,
      importedAt,
      source: "ファイル取込",
      importedFilename: file.name,
      importMode: mode
    });

    renderMasterTransferStatus();

    if(typeof renderAdminDashboard === "function"){
      renderAdminDashboard();
    }

    showMasterMessage(
      "success",
      `マスタを取り込みました。取込方式：${mode === "replace" ? "全置換" : "追加・同一ID上書き"}。測定履歴は保持されています。`
    );

    alert("現場運用マスタを反映しました。測定履歴は変更していません。");
  }catch(error){
    showMasterMessage("error",`取込エラー：${error.message}`);
    alert(`マスタを取り込めませんでした：${error.message}`);
  }finally{
    event.target.value = "";
  }
}

function touchMasterMeta(source="端末編集"){
  const current = getMasterMeta();
  saveMasterMeta({
    ...current,
    masterVersion: createMasterVersion(),
    updatedAt: new Date().toISOString(),
    source
  });
  renderMasterTransferStatus();
}

function bindMasterTransfer(){
  $("exportMasterJson")?.addEventListener("click",exportOperationMaster);
  $("importMasterJson")?.addEventListener("change",importOperationMaster);
  renderMasterTransferStatus();
}

if(document.readyState === "loading"){
  document.addEventListener("DOMContentLoaded",bindMasterTransfer);
}else{
  bindMasterTransfer();
}

window.addEventListener("storage",event=>{
  if(event.key === MASTER_META_KEY || event.key === null){
    renderMasterTransferStatus();
  }
});
