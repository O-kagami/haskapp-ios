# Haskapp iOS

既存のExpo / React Nativeデータ層とSwiftUI画面を維持したiOSプロジェクトです。旧リポジトリのGit履歴は含めていません。

開発途中のスナップショットです。実装、自動検証、実機確認の状態は [進捗](docs/PROGRESS.md) を参照してください。

## 開発

Node.js 22.13以上、Xcode、CocoaPodsを使用します。

```sh
cd mobile
npm ci
npm run verify
npm run test:models
cd ios
pod install --no-repo-update
open Haskapp.xcworkspace
```

既存のbundle ID・署名設定を確認してビルドしてください。認証情報・証明書・プロビジョニングプロファイル・実機データは同梱していません。環境設定例は `mobile/.env.example` です。クライアント側で使用する公開設定のみを指定し、service-roleキーや秘密キーを入れないでください。

新しいキャンパス掲載・講義チャットは既定無効です。実掲載データや有効化を、コードの存在と混同しないでください。DB移行は参考SQLであり、このリポジトリの取得時に自動適用しません。
