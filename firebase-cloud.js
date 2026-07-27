
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  getDoc,
  onSnapshot,
  serverTimestamp,
  writeBatch
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAp9TvNqCuUS9U17Y1vcf6fQ7Ddy0uQMaA",
  authDomain: "sample1-8011f.firebaseapp.com",
  projectId: "sample1-8011f",
  storageBucket: "sample1-8011f.firebasestorage.app",
  messagingSenderId: "298317872953",
  appId: "1:298317872953:web:b0b320048f839b5ca5f2e8",
  measurementId: "G-DMP6TTCC9W"
};

const ORG_ID = "company001";
const ROOT = `organizations/${ORG_ID}`;
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();

let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  console.warn("Firestore永続キャッシュ初期化:", error);
  db = initializeFirestore(app, {});
}

let currentUser = null;
let ready = false;
let applyingCloud = false;
let saveTimer = null;
let unsubscribers = [];
let cloudState = {
  sites: [],
  teams: [],
  workers: [],
  records: [],
  settings: null,
  updatedAt: null
};

const $ = id => document.getElementById(id);

function setCloudMessage(message, type=""){
  const el = $("cloudMessage");
  if(!el) return;
  el.textContent = message;
  el.className = `status ${type}`.trim();
}
function formatDate(value){
  if(!value) return "—";
  const date = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ja-JP");
}
function updateUI(status, detail=""){
  const statusEl = $("cloudStatus");
  const badge = $("cloudModeBadge");
  const sync = $("cloudSyncState");
  if(statusEl){
    statusEl.textContent = status;
    statusEl.className = "cloud-status " + (
      status.includes("同期済") ? "online" :
      status.includes("同期中") ? "syncing" :
      status.includes("オフライン") ? "offline" : "waiting"
    );
  }
  if(badge){
    badge.textContent = status;
    badge.className = "master-status-badge " + (status.includes("同期済") ? "imported" : "");
  }
  if(sync) sync.textContent = detail || status;
}
function setUserUI(user){
  const userEl=$("cloudUser");
  const login=$("cloudLogin");
  const logout=$("cloudLogout");
  const loginState=$("cloudLoginState");
  if(user){
    const name=user.displayName || user.email || "Googleユーザー";
    if(userEl) userEl.textContent=name;
    if(loginState) loginState.textContent=name;
    login?.classList.add("hidden");
    logout?.classList.remove("hidden");
  }else{
    if(userEl) userEl.textContent="未ログイン";
    if(loginState) loginState.textContent="未ログイン";
    login?.classList.remove("hidden");
    logout?.classList.add("hidden");
  }
}
function sanitizeDocId(value){
  return encodeURIComponent(String(value)).replace(/%/g,"_");
}
function sanitizeMeasurement(data){
  const safe={...data};
  [
    "image","imageData","imageUrl","photo","photoData","photoUrl",
    "faceImage","faceImageData","faceImageUrl","video","videoData",
    "thumbnail","snapshot","capture"
  ].forEach(key=>delete safe[key]);
  return safe;
}
function normalizeCloudRecord(data, id){
  const value=sanitizeMeasurement({...data,id:data.id||id});
  delete value._serverUpdatedAt;
  return value;
}
function mergeIntoLocal(){
  if(!window.HeatCheckApp || applyingCloud) return;
  const local = window.HeatCheckApp.loadDB();
  const next = {
    ...local,
    version:"11.3",
    sites:[...cloudState.sites],
    teams:[...cloudState.teams],
    workers:[...cloudState.workers],
    records:[...cloudState.records].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)),
    settings:{...local.settings,...(cloudState.settings||{})},
    updatedAt:cloudState.updatedAt || new Date().toISOString()
  };
  applyingCloud=true;
  window.HeatCheckApp.saveDB(next,{fromCloud:true});
  window.HeatCheckApp.refresh();
  applyingCloud=false;
  $("cloudLastSync").textContent=new Date().toLocaleString("ja-JP");
  updateUI(navigator.onLine ? "同期済" : "オフライン保存","Firestoreと同期済み");
}
function resetListeners(){
  unsubscribers.forEach(fn=>{try{fn();}catch(_){}});
  unsubscribers=[];
}
function subscribeCollection(name, assign){
  const ref=collection(db,`${ROOT}/${name}`);
  const unsub=onSnapshot(ref,{includeMetadataChanges:true},snap=>{
    assign(snap.docs.map(d=>normalizeCloudRecord(d.data(),d.id)));
    cloudState.updatedAt=new Date().toISOString();
    mergeIntoLocal();
    if(snap.metadata.fromCache && !navigator.onLine){
      updateUI("オフライン保存","端末キャッシュを表示中");
    }
  },error=>{
    console.error(`${name}監視エラー`,error);
    updateUI("同期エラー",error.code||error.message);
    setCloudMessage(`同期エラー：${error.message}`,"error");
  });
  unsubscribers.push(unsub);
}
function subscribeSettings(){
  const ref=doc(db,`${ROOT}/config/app`);
  const unsub=onSnapshot(ref,{includeMetadataChanges:true},snap=>{
    if(snap.exists()){
      const data={...snap.data()};
      delete data._serverUpdatedAt;
      cloudState.settings=data;
    }else{
      cloudState.settings=null;
    }
    mergeIntoLocal();
  },error=>{
    console.error("settings監視エラー",error);
    updateUI("同期エラー",error.code||error.message);
  });
  unsubscribers.push(unsub);
}
function startRealtime(){
  resetListeners();
  cloudState={sites:[],teams:[],workers:[],records:[],settings:null,updatedAt:null};
  subscribeCollection("sites",v=>cloudState.sites=v.map(x=>x.name).filter(Boolean));
  subscribeCollection("teams",v=>cloudState.teams=v.map(x=>x.name).filter(Boolean));
  subscribeCollection("workers",v=>cloudState.workers=v);
  subscribeCollection("measurements",v=>cloudState.records=v);
  subscribeSettings();
}
async function syncCollection(name, localItems, idGetter, payloadGetter){
  const ref=collection(db,`${ROOT}/${name}`);
  const cloudSnap=await getDocs(ref);
  const cloudIds=new Set(cloudSnap.docs.map(d=>d.id));
  const localMap=new Map(localItems.map(item=>[sanitizeDocId(idGetter(item)),item]));
  const batch=writeBatch(db);
  for(const [id,item] of localMap){
    batch.set(doc(db,`${ROOT}/${name}/${id}`),{
      ...payloadGetter(item),
      _serverUpdatedAt:serverTimestamp(),
      _updatedBy:currentUser?.uid||null
    },{merge:true});
  }
  for(const id of cloudIds){
    if(!localMap.has(id)) batch.delete(doc(db,`${ROOT}/${name}/${id}`));
  }
  await batch.commit();
}
async function uploadDatabase(localDB, force=false){
  if(!currentUser) throw new Error("Googleログインが必要です。");
  if(!ready && !force) return;
  updateUI("同期中","クラウドへ保存中");
  await syncCollection("sites",localDB.sites||[],x=>x,x=>({name:x}));
  await syncCollection("teams",localDB.teams||[],x=>x,x=>({name:x}));
  await syncCollection("workers",localDB.workers||[],x=>x.id,x=>({...x}));
  await syncCollection("measurements",localDB.records||[],x=>x.id,x=>sanitizeMeasurement(x));
  await setDoc(doc(db,`${ROOT}/config/app`),{
    ...(localDB.settings||{}),
    appVersion:"11.3-kiosk-admin",
    _serverUpdatedAt:serverTimestamp(),
    _updatedBy:currentUser.uid
  },{merge:true});
  $("cloudLastSync").textContent=new Date().toLocaleString("ja-JP");
  updateUI("同期済","クラウド保存完了");
}
function queueSave(localDB){
  if(!currentUser || applyingCloud) return;
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    try{
      await uploadDatabase(localDB);
    }catch(error){
      console.error("自動同期エラー",error);
      updateUI(navigator.onLine ? "同期エラー" : "オフライン保存",error.message);
      setCloudMessage(
        navigator.onLine ? `自動同期に失敗しました：${error.message}` : "通信復旧後に自動同期します。",
        navigator.onLine ? "error" : ""
      );
    }
  },700);
}
async function login(){
  try{
    updateUI("ログイン中","Google認証を開始");
    await signInWithPopup(auth,provider);
  }catch(error){
    console.error(error);
    updateUI("未接続","ログイン失敗");
    setCloudMessage(`ログインできませんでした：${error.message}`,"error");
  }
}
async function logout(){
  await signOut(auth);
}
async function manualSync(){
  try{
    if(!currentUser) return setCloudMessage("Googleログインしてください。","error");
    await uploadDatabase(window.HeatCheckApp.loadDB(),true);
    setCloudMessage("クラウド同期が完了しました。","success");
  }catch(error){
    setCloudMessage(`同期に失敗しました：${error.message}`,"error");
  }
}
async function uploadLocalWithConfirm(){
  if(!currentUser) return setCloudMessage("Googleログインしてください。","error");
  if(!confirm("現在の端末データをクラウドへ反映します。クラウド側の同一IDデータは上書きされます。実行しますか？")) return;
  try{
    await uploadDatabase(window.HeatCheckApp.loadDB(),true);
    setCloudMessage("端末データをクラウドへ反映しました。","success");
  }catch(error){
    setCloudMessage(`反映に失敗しました：${error.message}`,"error");
  }
}

$("cloudLogin")?.addEventListener("click",login);
$("cloudLogout")?.addEventListener("click",logout);
$("cloudManualSync")?.addEventListener("click",manualSync);
$("cloudUploadLocal")?.addEventListener("click",uploadLocalWithConfirm);

window.addEventListener("online",()=>{
  if(currentUser){
    updateUI("同期中","通信復旧・再同期中");
    queueSave(window.HeatCheckApp.loadDB());
  }
});
window.addEventListener("offline",()=>updateUI("オフライン保存","端末キャッシュへ保存"));

window.CloudBridge={
  isReady:()=>ready && !!currentUser,
  queueSave,
  uploadDatabase,
  getUser:()=>currentUser
};

onAuthStateChanged(auth,async user=>{
  currentUser=user;
  setUserUI(user);
  if(user){
    ready=true;
    updateUI("同期中","クラウドデータを読込中");
    setCloudMessage("Googleログイン済み。Firestoreを監視しています。","success");
    startRealtime();
  }else{
    ready=false;
    resetListeners();
    updateUI("未接続","端末内保存モード");
    setCloudMessage("Googleログイン後、PC・スマホ間の自動同期が開始されます。","");
  }
});
