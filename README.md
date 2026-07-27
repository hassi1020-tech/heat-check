# 現場 AIコンディションチェック Ver.11.3
## 撮影端末・管理PC分離版

熱中症チェック単体の運用に特化しています。

## 運用構成

### 撮影端末
URL:
https://hassi1020-tech.github.io/heat-check/?mode=kiosk&v=1103ka1

表示機能:
- 作業員選択
- カメラ解析
- 体調・水分・WBGT入力
- 判定結果
- クラウド同期状態

非表示機能:
- マスタ管理
- 管理者ダッシュボード
- 設定変更
- CSV・JSON出力
- 全履歴管理

### 管理PC
URL:
https://hassi1020-tech.github.io/heat-check/?mode=admin&v=1103ka1

表示機能:
- 現場・班・作業員マスタ
- 測定結果一覧
- 管理者ダッシュボード
- 設定
- CSV・JSON出力
- クラウド同期管理

## 顔写真について
顔写真・動画・スクリーンショット・Base64画像は保存しません。
カメラ映像は端末内で解析し、Firestoreには以下のみ保存します。

- 作業員ID
- 氏名
- 現場
- 班
- 測定日時
- WBGT
- 体調申告
- 水分補給状況
- AI解析結果
- 信頼度
- 総合判定
- 端末ID

## 初回運用
1. GitHubへ全ファイルを上書き
2. 管理PCで `?mode=admin` を開く
3. Googleログイン
4. 既存端末データがある場合は「端末データをクラウドへ反映」
5. 撮影端末で `?mode=kiosk` を開く
6. Googleログイン
7. 作業員一覧が同期されることを確認
8. テスト測定し、管理PCに即時反映されることを確認

## Firebase
既存設定をそのまま利用します。
- projectId: sample1-8011f
- Authentication: Google
- Firestore: organizations/company001
