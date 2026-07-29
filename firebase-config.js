/*
 現場AIコンディションチェック
 Firebase project: sample1-8011f / Ver.13.2

 この設定値はFirebase Web SDK用の公開設定値です。
 データ保護はFirestore Security Rulesで行います。
*/
window.HEAT_CHECK_FIREBASE_CONFIG = {
  apiKey: "AIzaSyAp9TvNqCuUS9U17Y1vcf6fQ7Ddy0uQMaA",
  authDomain: "sample1-8011f.firebaseapp.com",
  projectId: "sample1-8011f",
  storageBucket: "sample1-8011f.firebasestorage.app",
  messagingSenderId: "298317872953",
  appId: "1:298317872953:web:b0b320048f839b5ca5f2e8",
  measurementId: "G-DMP6TTCC9W"
};

/*
 PCとモバイルで同じGoogleアカウントを使用する運用では空欄にします。
 同じアカウントならFirebase UIDが一致し、同じ作業領域へ接続されます。
*/
window.HEAT_CHECK_SHARED_WORKSPACE_ID = "";
