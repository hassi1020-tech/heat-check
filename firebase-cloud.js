// Ver.12.0 第4段階：Firebase任意接続フック
// 既存プロジェクトでFirebase同期済みの場合は、従来のfirebase-cloud.jsを残して使用してください。
// このファイル単体ではクラウド送信を行わず、LocalStorageで全機能が動作します。
window.HeatCheckCloud=window.HeatCheckCloud||{saveRecord:async()=>false};
console.info("Firebase同期は任意設定です。");