import {initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth,GoogleAuthProvider,onAuthStateChanged,signInWithPopup,signOut
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore,collection,doc,setDoc,deleteDoc,onSnapshot,getDocs,
  serverTimestamp,writeBatch
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const $=id=>document.getElementById(id);
const config=window.HEAT_CHECK_FIREBASE_CONFIG||{};
const configured=Boolean(config.apiKey&&!String(config.apiKey).includes("ここへ")&&config.projectId&&!String(config.projectId).includes("ここへ"));
let auth=null,firestore=null,user=null,workspaceId="",unsubs=[],syncing=false;
const provider=new GoogleAuthProvider();
provider.setCustomParameters({prompt:"select_account"});

function status(kind,label,message=""){
  const el=$("cloudStatus");
  if(el){el.className="cloud-status "+kind;el.textContent=label}
  if($("cloudMessage")&&message)$("cloudMessage").textContent=message;
}
function setAuthUI(){
  $("cloudLogin")?.classList.toggle("hidden",Boolean(user));
  $("cloudLogout")?.classList.toggle("hidden",!user);
  if($("cloudUser"))$("cloudUser").textContent=user?`${user.displayName||"ユーザー"}／${user.email||""}`:"Googleアカウント未ログイン";
}
function safeId(value){
  return encodeURIComponent(String(value||"").trim()).replaceAll("%","_");
}
function getWorkspaceId(u){
  const shared=String(window.HEAT_CHECK_SHARED_WORKSPACE_ID||"").trim();
  return shared?safeId(shared):safeId(u.uid);
}
function refs(){
  const root=doc(firestore,"heatCheckWorkspaces",workspaceId);
  return {
    root,
    workers:collection(root,"workers"),
    records:collection(root,"records"),
    settings:doc(root,"config","settings")
  };
}
function mergeById(local,remote){
  const m=new Map();
  [...local,...remote].forEach(x=>{
    if(!x?.id)return;
    const old=m.get(x.id);
    const oldTime=Date.parse(old?.updatedAt||old?.createdAt||0)||0;
    const newTime=Date.parse(x.updatedAt||x.createdAt||0)||0;
    if(!old||newTime>=oldTime)m.set(x.id,x);
  });
  return [...m.values()];
}
function localDB(){return window.HeatCheckApp?.loadDB?.()}
function saveLocal(db){
  window.HeatCheckApp?.saveDB?.(db);
  window.HeatCheckApp?.refresh?.();
}
function stripFirestore(v){
  if(Array.isArray(v))return v.map(stripFirestore);
  if(v&&typeof v==="object"){
    if(typeof v.toDate==="function")return v.toDate().toISOString();
    return Object.fromEntries(Object.entries(v).filter(([k])=>!k.startsWith("_")).map(([k,x])=>[k,stripFirestore(x)]));
  }
  return v;
}

async function ensureWorkspace(){
  await setDoc(refs().root,{
    workspaceId,
    ownerUid:user.uid,
    ownerEmail:user.email||"",
    updatedAt:serverTimestamp()
  },{merge:true});
}
function stopListeners(){unsubs.forEach(x=>x());unsubs=[]}
function startListeners(){
  stopListeners();
  const r=refs();

  unsubs.push(onSnapshot(r.workers,snap=>{
    const remote=snap.docs.filter(d=>!d.data().deleted).map(d=>stripFirestore({...d.data(),id:d.data().id||decodeURIComponent(d.id)}));
    const db=localDB();if(!db)return;
    db.workers=mergeById(db.workers||[],remote).sort((a,b)=>String(a.id).localeCompare(String(b.id),"ja"));
    saveLocal(db);
    status("online","同期中","作業員ID・作業員情報をリアルタイム同期しています。");
  },e=>status("error","同期エラー","作業員同期エラー："+e.message)));

  unsubs.push(onSnapshot(r.records,snap=>{
    const remote=snap.docs.filter(d=>!d.data().deleted).map(d=>stripFirestore({...d.data(),id:d.data().id||d.id}));
    const db=localDB();if(!db)return;
    db.records=mergeById(db.records||[],remote).sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
    saveLocal(db);
  },e=>status("error","同期エラー","履歴同期エラー："+e.message)));

  unsubs.push(onSnapshot(r.settings,snap=>{
    if(!snap.exists())return;
    const remote=stripFirestore(snap.data());
    const db=localDB();if(!db)return;
    db.settings={...db.settings,...remote};
    delete db.settings.updatedAt;
    saveLocal(db);
  },e=>status("error","同期エラー","設定同期エラー："+e.message)));
}
async function uploadAll(){
  if(!user)throw new Error("Googleログインが必要です。");
  if(syncing)return;
  syncing=true;status("syncing","送信中","端末内の作業員・履歴・設定をFirebaseへ登録しています。");
  try{
    await ensureWorkspace();
    const db=localDB(),r=refs();
    const items=[
      ...(db.workers||[]).map(w=>({ref:doc(r.workers,safeId(w.id)),data:{...w,id:w.id,updatedAt:new Date().toISOString(),updatedBy:user.uid}})),
      ...(db.records||[]).map(x=>({ref:doc(r.records,safeId(x.id)),data:{...x,id:x.id,updatedAt:x.updatedAt||x.createdAt||new Date().toISOString(),updatedBy:user.uid}}))
    ];
    for(let i=0;i<items.length;i+=400){
      const batch=writeBatch(firestore);
      items.slice(i,i+400).forEach(x=>batch.set(x.ref,x.data,{merge:true}));
      await batch.commit();
    }
    await setDoc(r.settings,{...(db.settings||{}),updatedAt:serverTimestamp(),updatedBy:user.uid},{merge:true});
    status("online","同期済み","Firebaseへの初回登録が完了しました。PC・モバイルで同じデータを利用できます。");
  }finally{syncing=false}
}
async function upsertWorker(worker){
  if(!user||!worker?.id)return false;
  await setDoc(doc(refs().workers,safeId(worker.id)),{
    ...worker,id:worker.id,deleted:false,updatedAt:new Date().toISOString(),updatedBy:user.uid
  },{merge:true});
  return true;
}
async function deleteWorker(id){
  if(!user||!id)return false;
  // Tombstone prevents another offline terminal from immediately restoring the deleted worker.
  await setDoc(doc(refs().workers,safeId(id)),{
    id,deleted:true,updatedAt:new Date().toISOString(),updatedBy:user.uid
  },{merge:true});
  return true;
}
async function saveRecord(record){
  if(!user||!record?.id)return false;
  await setDoc(doc(refs().records,safeId(record.id)),{
    ...record,id:record.id,deleted:false,updatedAt:new Date().toISOString(),updatedBy:user.uid
  },{merge:true});
  return true;
}
async function saveSettings(settings){
  if(!user)return false;
  await setDoc(refs().settings,{...settings,updatedAt:serverTimestamp(),updatedBy:user.uid},{merge:true});
  return true;
}
async function login(){
  if(!configured)return status("error","設定未完了","firebase-config.jsへFirebase設定値を入力してください。");
  try{await signInWithPopup(auth,provider)}
  catch(e){status("error","ログイン失敗","Googleログインに失敗しました："+e.message)}
}
async function logout(){
  stopListeners();
  if(auth)await signOut(auth);
}
async function manualSync(){
  try{await uploadAll()}catch(e){status("error","同期エラー",e.message)}
}

if(!configured){
  status("waiting","設定未完了","firebase-config.jsへFirebaseプロジェクトの設定値を入力してください。");
}else{
  try{
    const app=initializeApp(config);
    auth=getAuth(app);firestore=getFirestore(app);
    onAuthStateChanged(auth,async u=>{
      user=u;setAuthUI();
      if(!u){workspaceId="";stopListeners();status("offline","未ログイン","PC・モバイルで同じGoogleアカウントにログインしてください。");return}
      workspaceId=getWorkspaceId(u);
      status("syncing","接続中","Firebaseへ接続しています。");
      try{
        await ensureWorkspace();
        startListeners();
        status("online","同期中","作業員ID・履歴・設定をリアルタイム同期しています。");
      }catch(e){status("error","接続エラー",e.message)}
    });
  }catch(e){status("error","初期化エラー","Firebase初期化に失敗しました："+e.message)}
}

$("cloudLogin")?.addEventListener("click",login);
$("cloudLogout")?.addEventListener("click",logout);
$("cloudManualSync")?.addEventListener("click",manualSync);
$("cloudUploadLocal")?.addEventListener("click",manualSync);
window.addEventListener("online",()=>user&&status("online","同期中","ネットワークへ再接続しました。"));
window.addEventListener("offline",()=>status("offline","オフライン","端末内へ保存し、再接続後に同期してください。"));

window.HeatCheckCloud={
  login,logout,manualSync,uploadAll,upsertWorker,deleteWorker,saveRecord,saveSettings,
  get state(){return {configured,user:user?{uid:user.uid,email:user.email}:null,workspaceId}}
};
setAuthUI();
