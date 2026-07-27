# Ver.13.0 Firebase完全同期版 導入手順

Firebaseプロジェクト `sample1-8011f` の設定値は組み込み済みです。

## 1. GitHubへ上書き

ZIPを展開し、`hassi1020-tech/heat-check` リポジトリ直下へ全ファイルを上書きしてください。

重要ファイル:

- `index.html`
- `app.js`
- `styles.css`
- `face-landmarker.js`
- `device-mode.js`
- `firebase-config.js`
- `firebase-cloud.js`
- `firestore.rules`
- `manifest.webmanifest`
- `sw.js`

## 2. Firestoreルールを公開

Firebase Console:

1. Firestore
2. 「ルール」
3. `firestore.rules`の内容を全部貼り付け
4. 「公開」

このアプリは既存の`organizations/company001`を使用しません。
新しく次のコレクションを自動作成します。

```text
heatCheckWorkspaces
└─ FirebaseログインユーザーのUID
   ├─ workers
   ├─ records
   └─ config
      └─ settings
```

## 3. PC側

次のURLを開きます。

```text
https://hassi1020-tech.github.io/heat-check/?mode=admin&v=1300final
```

1. 「Googleログイン」
2. `hassi1020@gmail.com`でログイン
3. 既存作業員が端末内にある場合は「既存データをFirebaseへ初回登録」
4. 作業員を登録・修正

## 4. モバイル側

次のURLを開きます。

```text
https://hassi1020-tech.github.io/heat-check/?mode=kiosk&v=1300final
```

1. PC側と同じGoogleアカウントでログイン
2. 作業員ID一覧が自動表示されることを確認
3. 測定を実施
4. PC側の履歴へ自動反映されることを確認

## 5. 同期対象

- 作業員ID
- 氏名
- 現場
- 班
- 測定履歴
- WBGT
- 自己申告
- 顔色・発汗・表情・目の数値
- 疲労・寝不足・体調変化・集中力の補助指数
- 個人ベースライン算定に使用する正常履歴
- 測定時間とベースライン設定

顔画像・動画は保存しません。

## 6. 削除同期

作業員を削除した場合はFirebaseへ削除フラグを保存します。
別端末で古い作業員情報が復活しないようにしています。

## 7. オフライン

Firestoreのオフライン永続化を有効にしています。
通信が切れた場合は端末内に保存され、通信復旧後に同期されます。

## 8. 更新が表示されない場合

GitHubへアップロード後、古いPWAキャッシュが残る場合があります。

- ブラウザを完全に閉じて再度開く
- URL末尾を`?mode=admin&v=1300final`または`?mode=kiosk&v=1300final`にする
- それでも変わらなければサイトデータ・キャッシュを削除する
