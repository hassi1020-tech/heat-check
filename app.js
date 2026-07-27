"use strict";
const DB_KEY="heatCheckV12";
const LEVELS={green:"通常",yellow:"注意",orange:"警戒",red:"作業中止"};
const $=id=>document.getElementById(id);
const clamp=(v,a=0,b=100)=>Math.max(a,Math.min(b,v));
const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let stream=null,measuring=false;

function defaults(){return {version:"12.0-stage4",workers:[],records:[],settings:{duration:10,baselineCount:10,baselineMin:5,wbgtYellow:28,wbgtOrange:31}}}
function loadDB(){try{const x=JSON.parse(localStorage.getItem(DB_KEY)||"{}");return {...defaults(),...x,workers:Array.isArray(x.workers)?x.workers:[],records:Array.isArray(x.records)?x.records:[],settings:{...defaults().settings,...x.settings}}}catch{return defaults()}}
function saveDB(db){localStorage.setItem(DB_KEY,JSON.stringify({...db,updatedAt:new Date().toISOString()}));window.dispatchEvent(new CustomEvent("heatcheck:updated"))}
const uid=()=>crypto.randomUUID?.()||Date.now()+"-"+Math.random();
const scoreLabel=r=>r>=70?"大きな変化":r>=45?"軽度変化":"通常範囲";
const riskToScore=r=>Math.round(clamp(100-r));

document.querySelectorAll(".tab").forEach(b=>b.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id==="view-"+b.dataset.view));
  render();
});

function workerOptions(){
  const db=loadDB(),opts=db.workers.map(w=>`<option value="${esc(w.id)}">${esc(w.name||w.id)}（${esc(w.id)}）</option>`).join("");
  ["measureWorker","historyWorker"].forEach(id=>{const e=$(id),v=e.value;e.innerHTML=`<option value="">${id==="measureWorker"?"作業員を選択":"全員"}</option>`+opts;e.value=v});
}
$("measureWorker").onchange=()=>{const w=loadDB().workers.find(x=>x.id===$("measureWorker").value);$("workerInfo").textContent=w?`${w.name}／${w.site||"現場未設定"}／${w.team||"班未設定"}`:"作業員を選択してください。"};

$("saveWorker").onclick=()=>{
  const id=$("workerId").value.trim().toUpperCase(),name=$("workerName").value.trim();
  if(!id)return alert("作業員IDを入力してください。");
  const db=loadDB(),item={id,name:name||id,site:$("workerSite").value.trim(),team:$("workerTeam").value.trim()};
  const i=db.workers.findIndex(w=>w.id===id);i>=0?db.workers[i]={...db.workers[i],...item}:db.workers.push(item);
  saveDB(db);window.HeatCheckCloud?.upsertWorker?.(item);["workerId","workerName","workerSite","workerTeam"].forEach(x=>$(x).value="");render();
};

async function startCamera(){
  try{
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"user",width:{ideal:720},height:{ideal:720}},audio:false});
    $("camera").srcObject=stream;await $("camera").play();
    $("startCamera").disabled=true;$("startMeasure").disabled=false;$("stopCamera").disabled=false;
    $("cameraMessage").textContent="顔を正面に向けて枠内に合わせてください。";$("faceGuide").classList.add("ok");
  }catch(e){$("cameraMessage").textContent="カメラ開始エラー："+e.message}
}
function stopCamera(){stream?.getTracks().forEach(t=>t.stop());stream=null;$("camera").srcObject=null;$("startCamera").disabled=false;$("startMeasure").disabled=true;$("stopCamera").disabled=true;$("cameraMessage").textContent="カメラを開始してください。"}
$("startCamera").onclick=startCamera;$("stopCamera").onclick=stopCamera;

function canvasFrame(){
  const video=$("camera"),c=document.createElement("canvas"),s=240;c.width=c.height=s;
  const x=c.getContext("2d",{willReadFrequently:true});x.drawImage(video,0,0,s,s);
  const p=x.getImageData(0,0,s,s).data;
  const regions={forehead:[75,42,90,42],left:[45,94,65,62],right:[130,94,65,62],nose:[95,88,50,70]};
  function stats([rx,ry,rw,rh]){
    let R=0,G=0,B=0,N=0,gloss=0;
    for(let y=ry;y<ry+rh;y+=2)for(let z=rx;z<rx+rw;z+=2){const i=(y*s+z)*4,r=p[i],g=p[i+1],b=p[i+2],br=(r+g+b)/3;R+=r;G+=g;B+=b;gloss+=br>205&&Math.max(r,g,b)-Math.min(r,g,b)<35?1:0;N++}
    return {r:R/N,g:G/N,b:B/N,gloss:gloss/N*100,brightness:(R+G+B)/(3*N)}
  }
  const f=stats(regions.forehead),l=stats(regions.left),r=stats(regions.right),n=stats(regions.nose);
  return {forehead:f,left:l,right:r,nose:n,brightness:mean([f.brightness,l.brightness,r.brightness]),redness:mean([f.r-f.g,l.r-l.g,r.r-r.g]),colorAsymmetry:Math.abs((l.r-l.g)-(r.r-r.g)),sweat:mean([f.gloss,n.gloss])};
}

function baseline(workerId,currentId=null){
  const db=loadDB(),max=db.settings.baselineCount,min=db.settings.baselineMin;
  const rows=db.records.filter(r=>r.workerId===workerId&&r.id!==currentId&&r.level==="green"&&r.condition==="good"&&r.quality>=65).slice(0,max);
  if(rows.length<min)return {ready:false,count:rows.length,min};
  const fields=["colorRisk","sweatRisk","expressionRisk","eyeRisk","openness","blinkRate","maxClosureMs","headMotion"];
  const values={};fields.forEach(k=>values[k]=mean(rows.map(r=>Number(r.ai?.[k])||0)));
  return {ready:true,count:rows.length,values};
}
function deviation(current,base,key,direction="high",scale=1){
  if(!base.ready)return 0;
  const b=base.values[key],c=Number(current[key])||0;
  const d=direction==="low"?b-c:c-b;
  return clamp(d*scale);
}
function calculateConditionAI(ai,self,base){
  const baseColor=deviation(ai,base,"colorRisk","high",2.2);
  const baseExpression=deviation(ai,base,"expressionRisk","high",1.7);
  const baseEye=deviation(ai,base,"eyeRisk","high",1.8);
  const baseOpen=deviation(ai,base,"openness","low",2.5);
  const baseBlink=Math.min(100,Math.abs((ai.blinkRate||0)-(base.ready?base.values.blinkRate:ai.blinkRate||0))*2.2);
  const baseMotion=deviation(ai,base,"headMotion","high",8);

  let fatigue=ai.eyeRisk*.34+ai.expressionRisk*.22+ai.colorRisk*.16+baseOpen*.12+baseMotion*.10+ai.sweatRisk*.06;
  let sleepRisk=ai.eyeRisk*.42+baseOpen*.22+baseBlink*.14+ai.expressionRisk*.12+ai.colorRisk*.10;
  let condition=ai.colorRisk*.30+ai.sweatRisk*.18+ai.expressionRisk*.18+ai.eyeRisk*.16+baseColor*.12+baseExpression*.06;
  let focus=ai.eyeRisk*.36+baseOpen*.22+baseMotion*.22+ai.expressionRisk*.12+baseBlink*.08;

  if(self.sleep==="short"){fatigue+=12;sleepRisk+=25;focus+=10}
  if(self.sleep==="poor"){fatigue+=22;sleepRisk+=45;focus+=18}
  if(self.condition==="slight"){condition+=25;fatigue+=10}
  if(self.condition==="bad"){condition+=60;fatigue+=20}
  if(self.hydration==="partial"){condition+=10;fatigue+=6}
  if(self.hydration==="none"){condition+=25;fatigue+=12;focus+=8}

  return {
    fatigueRisk:Math.round(clamp(fatigue)),sleepRisk:Math.round(clamp(sleepRisk)),
    conditionRisk:Math.round(clamp(condition)),focusRisk:Math.round(clamp(focus)),
    deviations:{baseColor:Math.round(baseColor),baseExpression:Math.round(baseExpression),baseEye:Math.round(baseEye),baseOpen:Math.round(baseOpen),baseBlink:Math.round(baseBlink),baseMotion:Math.round(baseMotion)}
  };
}
function levelFrom(r,self,wbgt){
  let level="green";
  const up=x=>{const a=["green","yellow","orange","red"];if(a.indexOf(x)>a.indexOf(level))level=x};
  if(self.condition==="bad")up("red");
  if(wbgt>=31)up("orange");else if(wbgt>=28)up("yellow");
  if(self.hydration==="none")up("orange");else if(self.hydration==="partial")up("yellow");
  const max=Math.max(r.fatigueRisk,r.sleepRisk,r.conditionRisk,r.focusRisk);
  if(max>=80)up("orange");else if(max>=55)up("yellow");
  if(r.conditionRisk>=90)up("red");
  return level;
}
function comments(ai,cai,base){
  const c=[];
  if(base.ready){
    if(cai.deviations.baseOpen>=20)c.push("本人通常時より開眼状態が低下しています。");
    if(cai.deviations.baseBlink>=20)c.push("本人通常時と比べて瞬き傾向に変化があります。");
    if(cai.deviations.baseColor>=20)c.push("本人通常時より顔色特徴に変化があります。");
    if(cai.deviations.baseExpression>=20)c.push("本人通常時より表情係数に変化があります。");
  }else c.push(`本人通常値は未成立です（正常記録 ${base.count}/${base.min}件）。`);
  if(ai.maxClosureMs>800)c.push("長めの閉眼が検出されました。");
  if(cai.sleepRisk>=55)c.push("寝不足を断定せず、睡眠不足を含む目の状態変化として確認してください。");
  if(cai.fatigueRisk>=55)c.push("疲労傾向が高いため、休憩後の再測定を推奨します。");
  if(cai.conditionRisk>=55)c.push("体調変化の可能性があるため、管理者による対面確認が必要です。");
  if(cai.focusRisk>=55)c.push("集中力低下につながる状態変化が疑われます。危険作業前は特に確認してください。");
  if(!c.length)c.push("大きな変化は検出されませんでした。通常どおり本人の状態を確認してください。");
  return c;
}

async function measure(){
  if(measuring)return;
  const db=loadDB(),worker=db.workers.find(w=>w.id===$("measureWorker").value);
  if(!worker)return alert("作業員を選択してください。");
  if(!stream)return alert("カメラを開始してください。");
  measuring=true;$("startMeasure").disabled=true;$("faceGuide").classList.add("measuring");window.FaceAI?.reset?.();
  const frames=[],duration=Math.max(8,Math.min(30,db.settings.duration)),start=Date.now();
  try{
    while(Date.now()-start<duration*1000){
      const cv=canvasFrame(),mp=await window.FaceAI?.analyze?.($("camera"));
      frames.push({...cv,mp});
      $("cameraMessage").textContent=`測定中…残り${Math.max(0,Math.ceil(duration-(Date.now()-start)/1000))}秒`;
      await new Promise(r=>setTimeout(r,250));
    }
    const valid=frames.filter(x=>x.mp?.available);
    const avg=k=>mean(valid.map(x=>Number(x.mp[k])||0));
    const colorRaw=mean(frames.map(x=>Math.abs(x.redness)));
    const asym=mean(frames.map(x=>x.colorAsymmetry));
    const colorRisk=Math.round(clamp(colorRaw*2.0+asym*3.0));
    const sweatRisk=Math.round(clamp(mean(frames.map(x=>x.sweat))*3.2));
    const ai={
      colorRisk,sweatRisk,expressionRisk:Math.round(avg("expressionRisk")),eyeRisk:Math.round(avg("eyeRisk")),
      openness:+avg("openness").toFixed(1),blinkRate:+(valid.at(-1)?.mp.blinkRate||0).toFixed(1),
      blinkCount:valid.at(-1)?.mp.blinkCount||0,maxClosureMs:valid.at(-1)?.mp.maxClosureMs||0,
      prolongedClosureCount:valid.at(-1)?.mp.prolongedClosureCount||0,headMotion:+avg("headMotion").toFixed(2)
    };
    const self={condition:$("condition").value,sleep:$("sleep").value,hydration:$("hydration").value};
    const b=baseline(worker.id),cai=calculateConditionAI(ai,self,b),wbgt=Number($("wbgt").value)||0;
    const level=levelFrom(cai,self,wbgt),quality=Math.round(clamp(valid.length/frames.length*70+(mean(frames.map(x=>x.brightness))>55?30:10)));
    const record={id:uid(),createdAt:new Date().toISOString(),workerId:worker.id,workerName:worker.name,site:worker.site||"",team:worker.team||"",wbgt:wbgt||null,...self,level,quality,ai,conditionAI:cai,baseline:{ready:b.ready,count:b.count},comments:comments(ai,cai,b)};
    const next=loadDB();next.records.unshift(record);saveDB(next);show(record,b);render();
    window.HeatCheckCloud?.saveRecord?.(record);
    $("cameraMessage").textContent="測定完了。";
  }catch(e){console.error(e);$("cameraMessage").textContent="測定エラー："+e.message}
  finally{measuring=false;$("faceGuide").classList.remove("measuring");$("startMeasure").disabled=!stream}
}
$("startMeasure").onclick=measure;

function show(r,b){
  $("result").classList.remove("hidden");$("resultHero").className="hero "+r.level;$("resultLevel").textContent=LEVELS[r.level];
  $("resultSummary").textContent=r.level==="green"?"現時点で大きな異常兆候は確認されていません。":r.level==="yellow"?"軽度の変化があります。休憩・再確認を行ってください。":r.level==="orange"?"作業を中断し、管理者が本人を確認してください。":"直ちに作業を中止し、本人の訴えを確認してください。";
  const map={scoreColor:r.ai.colorRisk,scoreSweat:r.ai.sweatRisk,scoreExpression:r.ai.expressionRisk,scoreEye:r.ai.eyeRisk,scoreFatigue:r.conditionAI.fatigueRisk,scoreSleep:r.conditionAI.sleepRisk,scoreCondition:r.conditionAI.conditionRisk,scoreFocus:r.conditionAI.focusRisk};
  Object.entries(map).forEach(([id,risk])=>$(id).textContent=`${riskToScore(risk)}点`);
  $("baselineStatus").textContent=b.ready?`本人の直近正常記録${b.count}件と比較しています。`:`通常値の成立にはあと${Math.max(0,b.min-b.count)}件の正常記録が必要です。`;
  $("baselineMetrics").innerHTML=Object.entries(r.conditionAI.deviations).map(([k,v])=>`<div><span>${({baseColor:"顔色差",baseExpression:"表情差",baseEye:"目状態差",baseOpen:"開眼低下",baseBlink:"瞬き変化",baseMotion:"頭部動揺"}[k])}</span><strong>${v}</strong></div>`).join("");
  $("aiComment").innerHTML=r.comments.map(x=>`<p>・${esc(x)}</p>`).join("");
  const actions=r.level==="green"?["水分補給と定期休憩を継続する","本人に違和感があれば結果に関係なく申告する"]:r.level==="yellow"?["短時間休憩後に再測定する","管理者が睡眠・体調・水分状況を確認する","高所・重機・電気等の危険作業前は慎重に判断する"]:r.level==="orange"?["作業を中断し涼しい場所で休憩する","管理者が対面で状態を確認する","改善しない場合は作業復帰させない"]:["直ちに作業を中止する","意識・応答・歩行状態を確認する","必要に応じて救急要請または医療機関へ連絡する"];
  $("actions").innerHTML=actions.map(x=>`<li>${esc(x)}</li>`).join("");
  const d={開眼率:r.ai.openness,瞬き回数:r.ai.blinkCount,"瞬き回数/分":r.ai.blinkRate,最大閉眼時間:r.ai.maxClosureMs+"ms",長時間閉眼:r.ai.prolongedClosureCount,頭部動揺:r.ai.headMotion,測定品質:r.quality+"%",WBGT:r.wbgt??"未入力",顔色リスク:r.ai.colorRisk,発汗傾向リスク:r.ai.sweatRisk,表情リスク:r.ai.expressionRisk,目リスク:r.ai.eyeRisk};
  $("details").innerHTML=Object.entries(d).map(([k,v])=>`<div><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`).join("");
  $("result").scrollIntoView({behavior:"smooth"});
}

function render(){
  workerOptions();
  const db=loadDB();
  $("duration").value=db.settings.duration;$("baselineCount").value=db.settings.baselineCount;$("baselineMin").value=db.settings.baselineMin;
  $("workerList").innerHTML=db.workers.map(w=>`<div class="worker-row"><span><strong>${esc(w.name)}</strong><br>${esc(w.id)}／${esc(w.site||"—")}／${esc(w.team||"—")}</span><button data-del="${esc(w.id)}">削除</button></div>`).join("")||"登録なし";
  document.querySelectorAll("[data-del]").forEach(b=>b.onclick=async()=>{if(confirm("削除しますか？")){const id=b.dataset.del;const d=loadDB();d.workers=d.workers.filter(w=>w.id!==id);saveDB(d);render();await window.HeatCheckCloud?.deleteWorker?.(id)}});
  const wid=$("historyWorker").value,rows=db.records.filter(r=>!wid||r.workerId===wid);
  $("historyList").innerHTML=rows.length?`<table><thead><tr><th>日時</th><th>作業員</th><th>判定</th><th>疲労</th><th>寝不足</th><th>体調変化</th><th>集中力</th></tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr><td>${new Date(r.createdAt).toLocaleString("ja-JP")}</td><td>${esc(r.workerName)}</td><td>${LEVELS[r.level]}</td><td>${riskToScore(r.conditionAI?.fatigueRisk||0)}</td><td>${riskToScore(r.conditionAI?.sleepRisk||0)}</td><td>${riskToScore(r.conditionAI?.conditionRisk||0)}</td><td>${riskToScore(r.conditionAI?.focusRisk||0)}</td></tr>`).join("")}</tbody></table>`:"履歴なし";
}
$("historyWorker").onchange=render;
$("saveSettings").onclick=()=>{const db=loadDB();db.settings.duration=clamp(Number($("duration").value)||10,8,30);db.settings.baselineCount=clamp(Number($("baselineCount").value)||10,3,30);db.settings.baselineMin=clamp(Number($("baselineMin").value)||5,3,10);saveDB(db);window.HeatCheckCloud?.saveSettings?.(db.settings);alert("保存しました。")};
function download(name,text,type){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$("exportJson").onclick=()=>download("heat-check-v12-stage4-backup.json",JSON.stringify(loadDB(),null,2),"application/json");
$("importJson").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{try{const x=JSON.parse(rd.result);if(!Array.isArray(x.records)||!Array.isArray(x.workers))throw Error();saveDB({...defaults(),...x});render();alert("復元しました。")}catch{alert("復元できません。")}};rd.readAsText(f);e.target.value=""};
$("clearRecords").onclick=()=>{if(confirm("測定履歴を全削除しますか？")){const db=loadDB();db.records=[];saveDB(db);render()}};
$("exportCsv").onclick=()=>{const q=v=>`"${String(v??"").replace(/"/g,'""')}"`,db=loadDB(),head=["日時","作業員ID","氏名","現場","班","判定","WBGT","体調申告","睡眠申告","水分","顔色点","発汗点","表情点","目点","疲労点","寝不足点","体調変化点","集中力点","開眼率","瞬き/分","最大閉眼ms","通常値成立"];const rows=db.records.map(r=>[r.createdAt,r.workerId,r.workerName,r.site,r.team,LEVELS[r.level],r.wbgt,r.condition,r.sleep,r.hydration,riskToScore(r.ai.colorRisk),riskToScore(r.ai.sweatRisk),riskToScore(r.ai.expressionRisk),riskToScore(r.ai.eyeRisk),riskToScore(r.conditionAI.fatigueRisk),riskToScore(r.conditionAI.sleepRisk),riskToScore(r.conditionAI.conditionRisk),riskToScore(r.conditionAI.focusRisk),r.ai.openness,r.ai.blinkRate,r.ai.maxClosureMs,r.baseline?.ready?"済":"未"]);download("heat-check-v12-stage4.csv","\ufeff"+[head,...rows].map(a=>a.map(q).join(",")).join("\n"),"text/csv")};

window.HeatCheckApp={loadDB,saveDB,refresh:render,version:"12.0-stage4"};
window.addEventListener("beforeunload",()=>stream?.getTracks().forEach(t=>t.stop()));
render();