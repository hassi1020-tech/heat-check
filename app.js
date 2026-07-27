"use strict";
const DB_KEY="heatCheckV11";
const LEVELS={green:{label:"通常",rank:0},yellow:{label:"注意",rank:1},orange:{label:"警戒",rank:2},red:{label:"中止・確認",rank:3}};
const $=id=>document.getElementById(id);
let stream=null, measuring=false;

function defaultDB(){
  return {version:"11.0",sites:[],teams:[],workers:[],records:[],settings:{duration:10,wbgtYellow:28,wbgtOrange:31},updatedAt:new Date().toISOString()};
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
  }catch(e){$("cameraMessage").textContent="カメラ開始エラー："+(e.message||e);}
}
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$("camera").srcObject=null;$("startCamera").disabled=false;$("startMeasure").disabled=true;$("stopCamera").disabled=true;$("cameraMessage").textContent="カメラを開始してください。";}
$("startCamera").onclick=startCamera;$("stopCamera").onclick=stopCamera;

function sampleFrame(){
  const v=$("camera"),c=document.createElement("canvas"),size=240;c.width=size;c.height=size;
  const ctx=c.getContext("2d",{willReadFrequently:true});ctx.drawImage(v,0,0,size,size);
  const d=ctx.getImageData(0,0,size,size).data;let sum=0,r=0,g=0,b=0,left=0,right=0,n=0;
  for(let y=35;y<205;y+=3)for(let x=35;x<205;x+=3){const i=(y*size+x)*4,br=(d[i]+d[i+1]+d[i+2])/3;sum+=br;r+=d[i];g+=d[i+1];b+=d[i+2];if(x<size/2)left+=br;else right+=br;n++;}
  return {brightness:sum/n,red:r/n,green:g/n,blue:b/n,asymmetry:Math.abs(left-right)/(sum||1)*100};
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
  measuring=true;$("startMeasure").disabled=true;
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
  finally{measuring=false;$("startMeasure").disabled=!stream;}
}
$("startMeasure").onclick=startMeasure;
function showResult(r){
  const label = LEVELS[r.level].label;
  const faceCondition =
    r.level === "green" ? "良好" :
    r.level === "yellow" ? "要確認" :
    r.level === "orange" ? "注意" : "異常申告あり";

  const summaries = {
    green: "作業継続可能です。定期的な水分補給を続けてください。",
    yellow: "軽度の注意要因があります。休憩後の再測定を推奨します。",
    orange: "作業を中断し、管理者が本人の状態を確認してください。",
    red: "直ちに作業を中止し、管理者が本人を確認してください。"
  };

  const iconMap = {
    green: "●",
    yellow: "▲",
    orange: "▲",
    red: "×"
  };

  $("measureResult").classList.remove("hidden");
  $("resultHero").className = "simple-result-hero " + r.level;
  $("resultIcon").textContent = iconMap[r.level] || "●";
  $("resultStatus").textContent = label;
  $("resultSummary").textContent = summaries[r.level] || "測定結果を確認してください。";
  $("faceCondition").textContent = faceCondition;
  $("resultQualityText").textContent = r.quality || "中";
  $("resultConfidence").textContent = `${r.confidence ?? 70}%`;

  $("resultReasons").innerHTML = r.reasons
    .slice(0, 5)
    .map(reason => `<li><span class="check-mark">✓</span>${esc(reason)}</li>`)
    .join("");

  $("resultActions").innerHTML = r.actions
    .slice(0, 4)
    .map(action => `<li>${esc(action)}</li>`)
    .join("");

  const indicators = r.indicators || {};
  const detailItems = [
    ["顔色変化", indicators.faceColor ?? "—"],
    ["左右差", indicators.symmetry ?? "—"],
    ["顔の動き", indicators.movement ?? "—"],
    ["撮影環境", indicators.lighting ?? "—"],
    ["明るさ", r.metrics?.brightness ?? "—"],
    ["左右差数値", r.metrics?.asymmetry ?? "—"],
    ["動き数値", r.metrics?.motion ?? "—"],
    ["顔色差数値", r.metrics?.redness ?? "—"],
    ["WBGT", r.wbgt !== null ? `${r.wbgt}℃` : "未入力"],
    ["体調異常", r.abnormal ? "あり" : "なし"],
    ["水分補給", r.hydration === "good" ? "できている" : r.hydration === "partial" ? "少なめ" : "できていない"]
  ];

  $("resultMetrics").innerHTML = detailItems
    .map(([name, value]) => `
      <div class="simple-detail-item">
        <span>${esc(name)}</span>
        <strong>${esc(value)}</strong>
      </div>`)
    .join("");

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
console.info("現場 AIコンディションチェック Ver.11.2 読込完了");