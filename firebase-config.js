/*
 Firebaseコンソール → プロジェクトの設定 → マイアプリ → SDKの設定と構成
 に表示される firebaseConfig の値へ置き換えてください。
*/
window.HEAT_CHECK_FIREBASE_CONFIG = {
  apiKey: "ここへAPI_KEY",
  authDomain: "ここへPROJECT_ID.firebaseapp.com",
  projectId: "ここへPROJECT_ID",
  storageBucket: "ここへPROJECT_ID.firebasestorage.app",
  messagingSenderId: "ここへMESSAGING_SENDER_ID",
  appId: "ここへAPP_ID"
};

/*
 同じGoogleアカウントでPCとモバイルにログインする場合は空欄のままで構いません。
 複数の管理者アカウントで同一現場を共有する場合は、両端末で同じ共有IDを設定します。
 例: "narumi-site-01"
*/
window.HEAT_CHECK_SHARED_WORKSPACE_ID = "";
