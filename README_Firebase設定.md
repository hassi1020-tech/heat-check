# 現場 AIコンディションチェック Ver.12.0 第4段階 Firebase同期版

## 同期対象
PC・モバイル間で以下をFirebase Cloud Firestoreによりリアルタイム同期します。

- 作業員ID
- 氏名
- 現場
- 班
- 測定履歴
- WBGT・自己申告・AI結果
- 測定時間と個人ベースライン設定

顔画像・動画はFirebaseへ保存しません。

## Firebase設定手順

1. Firebaseコンソールでプロジェクトを作成します。
2. 「Authentication」→「Sign-in method」でGoogleを有効にします。
3. 「Authentication」→「設定」→「承認済みドメイン」に次を追加します。
   - `hassi1020-tech.github.io`
4. 「Firestore Database」を作成します。
5. 同梱の`firestore.rules`をFirestoreのルール画面へ貼り付けて公開します。
6. Firebaseプロジェクトの「プロジェクトの設定」→「マイアプリ」でWebアプリを追加します。
7. 表示された`firebaseConfig`を`firebase-config.js`へ入力します。
8. ZIP内ファイルをGitHubリポジトリの直下へ上書きします。
9. PCとモバイルで同じGoogleアカウントにログインします。
10. 既存データがある端末で「この端末のデータをFirebaseへ登録」を一度押します。

## データ構造

```text
heatCheckWorkspaces
└─ {Firebase UID}
   ├─ workers
   │  └─ {作業員ID}
   ├─ records
   │  └─ {測定記録ID}
   └─ config
      └─ settings
```

同じGoogleアカウントの場合、Firebase UIDが同じになるため、PCとモバイルが同一の作業員台帳を参照します。

## 複数Googleアカウントで同一現場を共有する場合

`firebase-config.js`の`HEAT_CHECK_SHARED_WORKSPACE_ID`に、PC・モバイルとも同じ文字列を設定します。
その場合はFirestore上の次の場所に利用者UIDのメンバー文書を作成してください。

```text
heatCheckWorkspaces/{共有ID}/members/{利用者UID}
```

まずは、同じGoogleアカウントを使用する運用が簡単で安全です。

## 競合処理

- 作業員IDを一意キーとして統合します。
- 同じIDの情報は更新日時が新しい側を採用します。
- 測定履歴は記録IDで重複を防止します。
- 作業員削除は削除情報をFirestoreへ残し、別端末からの復活を防ぎます。
- オフライン中はLocalStorageへ保存し、オンライン復帰後に同期できます。

## 注意

Firebase設定値の`apiKey`はWebアプリで利用される公開設定値ですが、Firestore Security Rulesは必ず設定してください。
本システムは医療診断を行うものではありません。
