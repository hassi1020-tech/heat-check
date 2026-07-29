# 現場 AIコンディションチェック Ver.13.2

Ver.13.1の構成を維持し、Googleログイン後の状態取得処理を修正した版です。

主な変更:

- 正しいFirebase APIキー
- ポップアップGoogle認証
- Firebase Userの即時取得
- `onAuthStateChanged`の再処理
- ログイン成功後のFirestore同期開始
- キャッシュ更新

導入方法は`導入手順_Ver13_2.md`を確認してください。
