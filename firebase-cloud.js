import {initializeApp} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged,
  signInWithRedirect, getRedirectResult, signOut,
  setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, onSnapshot,
  serverTimestamp, writeBatch, enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";

const $ = id => document.getElementById(id);
const config = window.HEAT_CHECK_FIREBASE_CONFIG || {};
const configured = Boolean(
  config.apiKey && config.projectId && config.authDomain &&
  !String(config.apiKey).includes("ここへ")
);

let auth = null;
let firestore = null;
let user = null;
let workspaceId = "";
let listeners = [];
let uploading = false;
let applyingRemote = false;

const provider = new GoogleAuthProvider();
provider.setCustomParameters({prompt: "select_account"});

function setStatus(kind, title, message = "") {
  const badge = $("cloudStatus");
  if (badge) {
    badge.className = `cloud-status ${kind}`;
    badge.textContent = title;
  }
  if ($("cloudMessage") && message) $("cloudMessage").textContent = message;
}

function refreshAuthUI() {
  $("cloudLogin")?.classList.toggle("hidden", Boolean(user));
  $("cloudLogout")?.classList.toggle("hidden", !user);
  if ($("cloudUser")) {
    $("cloudUser").textContent = user
      ? `${user.displayName || "ユーザー"}／${user.email || ""}`
      : "Googleアカウント未ログイン";
  }
}

function safeId(value) {
  return encodeURIComponent(String(value || "").trim()).replaceAll("%", "_");
}

function resolveWorkspaceId(currentUser) {
  const shared = String(window.HEAT_CHECK_SHARED_WORKSPACE_ID || "").trim();
  return shared ? safeId(shared) : currentUser.uid;
}

function cloudRefs() {
  const root = doc(firestore, "heatCheckWorkspaces", workspaceId);
  return {
    root,
    workers: collection(root, "workers"),
    records: collection(root, "records"),
    settings: doc(root, "config", "settings")
  };
}

function dbLocal() {
  return window.HeatCheckApp?.loadDB?.();
}

function saveLocal(db) {
  applyingRemote = true;
  try {
    window.HeatCheckApp?.saveDB?.(db);
    window.HeatCheckApp?.refresh?.();
  } finally {
    queueMicrotask(() => { applyingRemote = false; });
  }
}

function normalizeFirestore(value) {
  if (Array.isArray(value)) return value.map(normalizeFirestore);
  if (value && typeof value === "object") {
    if (typeof value.toDate === "function") return value.toDate().toISOString();
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeFirestore(v)])
    );
  }
  return value;
}

function timestampOf(item) {
  return Date.parse(item?.updatedAt || item?.createdAt || 0) || 0;
}

function mergeActive(localItems, remoteItems, tombstones = new Set()) {
  const map = new Map();
  for (const item of localItems || []) {
    if (item?.id && !tombstones.has(String(item.id))) map.set(String(item.id), item);
  }
  for (const item of remoteItems || []) {
    if (!item?.id || tombstones.has(String(item.id))) continue;
    const key = String(item.id);
    const old = map.get(key);
    if (!old || timestampOf(item) >= timestampOf(old)) map.set(key, item);
  }
  return [...map.values()];
}

async function ensureWorkspace() {
  const r = cloudRefs();
  await setDoc(r.root, {
    workspaceId,
    ownerUid: user.uid,
    ownerEmail: user.email || "",
    appVersion: "13.0",
    updatedAt: serverTimestamp()
  }, {merge: true});
}

function stopListeners() {
  listeners.forEach(unsubscribe => unsubscribe());
  listeners = [];
}

function startListeners() {
  stopListeners();
  const r = cloudRefs();

  listeners.push(onSnapshot(r.workers, snapshot => {
    const all = snapshot.docs.map(d => normalizeFirestore({...d.data(), id: d.data().id || d.id}));
    const tombstones = new Set(all.filter(x => x.deleted).map(x => String(x.id)));
    const active = all.filter(x => !x.deleted);
    const local = dbLocal();
    if (!local) return;
    local.workers = mergeActive(local.workers, active, tombstones)
      .sort((a, b) => String(a.id).localeCompare(String(b.id), "ja"));
    saveLocal(local);
    setStatus("online", "同期済み", "作業員ID・作業員情報をリアルタイム同期しています。");
  }, error => setStatus("error", "同期エラー", `作業員同期エラー：${error.message}`)));

  listeners.push(onSnapshot(r.records, snapshot => {
    const all = snapshot.docs.map(d => normalizeFirestore({...d.data(), id: d.data().id || d.id}));
    const tombstones = new Set(all.filter(x => x.deleted).map(x => String(x.id)));
    const active = all.filter(x => !x.deleted);
    const local = dbLocal();
    if (!local) return;
    local.records = mergeActive(local.records, active, tombstones)
      .sort((a, b) => timestampOf(b) - timestampOf(a));
    saveLocal(local);
  }, error => setStatus("error", "同期エラー", `履歴同期エラー：${error.message}`)));

  listeners.push(onSnapshot(r.settings, snapshot => {
    if (!snapshot.exists()) return;
    const remote = normalizeFirestore(snapshot.data());
    const local = dbLocal();
    if (!local) return;
    const {updatedAt, updatedBy, ...settings} = remote;
    local.settings = {...local.settings, ...settings};
    saveLocal(local);
  }, error => setStatus("error", "同期エラー", `設定同期エラー：${error.message}`)));
}

async function uploadAll() {
  if (!user) throw new Error("Googleログインが必要です。");
  if (uploading) return false;

  uploading = true;
  setStatus("syncing", "送信中", "この端末の既存データをFirebaseへ登録しています。");
  try {
    await ensureWorkspace();
    const local = dbLocal();
    const r = cloudRefs();
    const now = new Date().toISOString();

    const writes = [
      ...(local?.workers || []).map(worker => ({
        ref: doc(r.workers, safeId(worker.id)),
        data: {
          ...worker,
          id: worker.id,
          deleted: false,
          updatedAt: worker.updatedAt || now,
          updatedBy: user.uid
        }
      })),
      ...(local?.records || []).map(record => ({
        ref: doc(r.records, safeId(record.id)),
        data: {
          ...record,
          id: record.id,
          deleted: false,
          updatedAt: record.updatedAt || record.createdAt || now,
          updatedBy: user.uid
        }
      }))
    ];

    for (let i = 0; i < writes.length; i += 400) {
      const batch = writeBatch(firestore);
      for (const item of writes.slice(i, i + 400)) {
        batch.set(item.ref, item.data, {merge: true});
      }
      await batch.commit();
    }

    await setDoc(r.settings, {
      ...(local?.settings || {}),
      updatedAt: serverTimestamp(),
      updatedBy: user.uid
    }, {merge: true});

    setStatus("online", "同期済み", "Firebaseへの登録が完了しました。PCとモバイルで同じデータを利用できます。");
    return true;
  } finally {
    uploading = false;
  }
}

async function upsertWorker(worker) {
  if (applyingRemote || !user || !worker?.id) return false;
  await setDoc(doc(cloudRefs().workers, safeId(worker.id)), {
    ...worker,
    id: worker.id,
    deleted: false,
    updatedAt: new Date().toISOString(),
    updatedBy: user.uid
  }, {merge: true});
  return true;
}

async function deleteWorker(id) {
  if (!user || !id) return false;
  await setDoc(doc(cloudRefs().workers, safeId(id)), {
    id,
    deleted: true,
    updatedAt: new Date().toISOString(),
    updatedBy: user.uid
  }, {merge: true});
  return true;
}

async function saveRecord(record) {
  if (applyingRemote || !user || !record?.id) return false;
  await setDoc(doc(cloudRefs().records, safeId(record.id)), {
    ...record,
    id: record.id,
    deleted: false,
    updatedAt: new Date().toISOString(),
    updatedBy: user.uid
  }, {merge: true});
  return true;
}

async function saveSettings(settings) {
  if (applyingRemote || !user) return false;
  await setDoc(cloudRefs().settings, {
    ...settings,
    updatedAt: serverTimestamp(),
    updatedBy: user.uid
  }, {merge: true});
  return true;
}

async function login() {
  if (!configured) {
    setStatus("error", "設定未完了", "firebase-config.jsの設定値を確認してください。");
    return;
  }

  try {
    setStatus("syncing", "Googleへ移動中", "Googleログイン画面へ移動します。");
    sessionStorage.setItem("heatCheckLoginStarted", "1");
    await setPersistence(auth, browserLocalPersistence);
    await signInWithRedirect(auth, provider);
  } catch (error) {
    console.error("Firebase Google login error:", error);
    sessionStorage.removeItem("heatCheckLoginStarted");

    const details = [
      `コード：${error.code || "不明"}`,
      `内容：${error.message || "不明"}`
    ].join("／");

    setStatus("error", "ログイン失敗", `Googleログインを開始できませんでした。${details}`);
  }
}

async function logout() {
  stopListeners();
  if (auth) await signOut(auth);
}

async function manualSync() {
  try {
    await uploadAll();
  } catch (error) {
    setStatus("error", "同期エラー", error.message);
  }
}

if (!configured) {
  setStatus("waiting", "設定未完了", "firebase-config.jsの設定値を確認してください。");
} else {
  try {
    const app = initializeApp(config);
    auth = getAuth(app);
    firestore = getFirestore(app);
    await setPersistence(auth, browserLocalPersistence);

    enableIndexedDbPersistence(firestore).catch(error => {
      console.info("Firestoreオフライン永続化:", error.code);
    });

    getRedirectResult(auth)
      .then(result => {
        if (result?.user) {
          sessionStorage.removeItem("heatCheckLoginStarted");
          setStatus("syncing", "認証完了", "Firebaseへ接続しています。");
        } else if (sessionStorage.getItem("heatCheckLoginStarted") === "1") {
          sessionStorage.removeItem("heatCheckLoginStarted");
        }
      })
      .catch(error => {
        console.error("Firebase redirect result error:", error);
        sessionStorage.removeItem("heatCheckLoginStarted");

        const code = error.code || "不明";
        const message = error.message || "不明";
        const guidance = {
          "auth/unauthorized-domain": "Firebase Authenticationの承認済みドメインへ hassi1020-tech.github.io を追加してください。",
          "auth/operation-not-allowed": "Firebase AuthenticationでGoogleプロバイダを有効にしてください。",
          "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Firebase ConsoleのWebアプリ設定からAPIキーをコピーし直してください。",
          "auth/invalid-api-key": "Firebase ConsoleのWebアプリ設定からAPIキーをコピーし直してください。",
          "auth/internal-error": "Google Cloud側のAPIキー制限またはOAuth設定を確認してください。"
        }[code] || "ブラウザのConsoleに表示されるエラーコードを確認してください。";

        setStatus(
          "error",
          "ログイン失敗",
          `Google認証エラー（${code}）：${message} ${guidance}`
        );
      });

    onAuthStateChanged(auth, async currentUser => {
      user = currentUser;
      refreshAuthUI();

      if (!currentUser) {
        workspaceId = "";
        stopListeners();
        setStatus("offline", "未ログイン", "PCとモバイルで同じGoogleアカウントにログインしてください。");
        return;
      }

      workspaceId = resolveWorkspaceId(currentUser);
      setStatus("syncing", "接続中", "Firebaseへ接続しています。");

      try {
        await ensureWorkspace();
        startListeners();
        setStatus("online", "同期済み", "作業員ID・履歴・設定をリアルタイム同期しています。");
      } catch (error) {
        setStatus("error", "接続エラー", error.message);
      }
    });
  } catch (error) {
    setStatus("error", "初期化エラー", `Firebase初期化に失敗しました：${error.message}`);
  }
}

$("cloudLogin")?.addEventListener("click", login);
$("cloudLogout")?.addEventListener("click", logout);
$("cloudManualSync")?.addEventListener("click", manualSync);
$("cloudUploadLocal")?.addEventListener("click", manualSync);

window.addEventListener("online", () => {
  if (user) setStatus("online", "同期済み", "ネットワークへ再接続しました。");
});
window.addEventListener("offline", () => {
  setStatus("offline", "オフライン", "端末内へ保存し、再接続後にFirebaseへ同期します。");
});

window.HeatCheckCloud = {
  login,
  logout,
  manualSync,
  uploadAll,
  upsertWorker,
  deleteWorker,
  saveRecord,
  saveSettings,
  get state() {
    return {
      configured,
      user: user ? {uid: user.uid, email: user.email} : null,
      workspaceId
    };
  }
};

refreshAuthUI();
