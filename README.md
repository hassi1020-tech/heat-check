# 現場 AIコンディションチェック Ver.11.3 クラウド第1段階

## 構成
Cloud Firestoreを正式な保存先とし、端末内LocalStorageはオフライン時のキャッシュ・一時保存として利用します。

同期対象:
- 現場マスタ
- 作業班マスタ
- 作業員マスタ
- 測定設定
- 測定結果
- 実証評価

顔画像・動画は保存しません。

## GitHub Pagesへの反映
ZIPを展開し、リポジトリ直下へ全ファイルを上書きしてください。

確認URL:
https://hassi1020-tech.github.io/heat-check/?v=1103c1

## Firebaseで必ず行う設定

### 1. 承認済みドメイン
Firebase Console:
Authentication → 設定 → 承認済みドメイン

次を追加:
hassi1020-tech.github.io

### 2. Firestoreルール
Firebase Console:
Firestore → ルール

同梱の `firestore.rules` の内容を貼り付けて「公開」してください。

この第1段階のルールは、Googleログイン済みユーザーに `company001` の読み書きを許可します。
試験運用向けです。本番運用前にユーザー・役割・現場単位のアクセス制限へ変更してください。

### 3. 初回移行
1. 既存データが入っているPCでGoogleログイン
2. 設定・データ画面を開く
3. 「端末データをクラウドへ反映」をクリック
4. スマホで同じGoogleアカウントへログイン
5. 数秒後にマスタと測定履歴が自動表示されることを確認

## データ構造
organizations/company001/
- sites
- teams
- workers
- measurements
- config/app

## 注意
- 初回ログイン時、Firestore側が空の場合は、先に「端末データをクラウドへ反映」を実行してください。
- 同じGoogleアカウントでなくても、現行ルールではGoogleログイン済みであればアクセスできます。
- 本番版では、usersコレクションと権限ルールを追加します。
