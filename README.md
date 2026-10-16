# Gicisky ESL Web Demo (Android / Direct BLE)

GitHub Pages向けの**ビルド不要・外部依存なし**の静的Webアプリです。Android版ChromeでWeb Bluetoothを使い、Gicisky 2.9インチのデモ専用ESLに直接書き込みます。

## 状態

**v0.1.0: 実機未検証の試験版**です。通信順序・2bpp画素エンコードは動作中の既存Python実装に合わせています。Web BluetoothによるGATT接続と244バイトのWrite Without Responseが対象Android/ESLの組み合わせで成立するかは、実機確認が必要です。

## 対象と機能

- 対象: **Gicisky 2.9インチ / 296×128 / 4色（黒・白・赤・黄） / device type 0x002E**
- **画面6種類**の切り替え（日本語フォントは端末のフォントを使用）
- 任意の画像ファイルを読み込み（白余白付きで縦横比を維持、4色へ単純量子化）
- プレビューをPNG形式で保存、転送バイナリの保存
- BLE機器選択 → GATT FEF0 (FEF1制御・FEF2画像) → ACKを待ちながら転送
- ステータス、進捗、ACKログ表示・コピー
- ブラウザから外部サービスへの通信なし（GitHub Pagesが静的ファイルを配布する通信は除く）
- **実運用のMACアドレス/IPアドレス/鍵を含めない**

## GitHub Pagesへの公開

1. GitHub上で `gicisky-esl-web-demo` 等の**新しいPublicリポジトリ**を作成する。既存の private `esl-controller` とは分離する。
2. このフォルダのファイル（`index.html`、`app.js`、`ble.js`、`protocol.js`、`style.css`、`.nojekyll`、`README.md` など）をリポジトリのルートにアップロードする。**zipファイルをそのままアップロードしない**。
3. `Settings` → `Pages` → `Build and deployment` → `Source: Deploy from a branch` → `Branch: main`、`/(root)` → `Save`。
4. 公開後、`https://<GitHubユーザー名>.github.io/<リポジトリ名>/` を**Android版Chrome**で開く。HTTPSが必須です。
5. デモ用タグだけ電源を入れ、画面を選び「ESLに接続」から表示名（例 NEMR...）を選択。接続後「書き込む」。

※ 公開GitHub Pagesを開くための通信は必要ですが、ページが読み込まれた後のESLへの画像転送は端末とESLのBLE直接通信です。サーバー、Wi-Fi、ESPHome Proxyを使いません。

## 開発者向けテスト

```
node --test tests/*.test.js
```

または `python -m http.server 8000` でローカルプレビューできますが、**Androidの別端末から http://LAN-IP:8000 でアクセスすると secure context にならずWeb Bluetoothは使用できません**。必ずGitHub PagesのHTTPSサイトから操作してください。

## BLEプロトコル（対象0x002E）

- Service `0000fef0-0000-1000-8000-00805f9b34fb`
- FEF1: control write / notification
- FEF2: image data write
- 送信画像: 296×128のRGBAを、90度反時計回りに変換して2bpp化。コード `00=黒`, `01=白`, `10=黄`, `11=赤`。全9472バイト
- `01` → ACK `01f400`
- `02 + uint32le(9472) + 000000` → ACK先頭`02`
- `03` → ACK `0500` + 次ブロック番号(LE)
- FEF2: `uint32le(block_number) + image_bytes[block*240:...]` をACKに従って送信
- ACK `0500` + 次ブロック番号 / 完了 `050800000000`

## よくあるエラー

- **Bluetoothが利用不可**: Android版Chrome・HTTPS・Bluetooth有効化を確認。
- **FEF0が見つからない**: 型番違い、デバイス選択違い、またはGATTサービス差異の可能性。nRF Connectなどでサービス構成を確認。
- **BLE write failed (244 bytes)**: 接続時に必要なATT MTUが確保できなかった可能性。20バイト刻みへの単純分割はプロトコルのブロック番号と整合しないため、自動的には行いません。
- **ACK timeout**: Notifications未受信、通信不安定、ESL側の状態不一致など。
- **表示色がおかしい**: 色変換・回転は0x002E用固定。ほかのサイズやモデルにはそのまま使えません。
- **最後に接続が切れる**: 正常書き込み後、ESL側から切断される場合があります。表示の状態と完了ACKも確認してください。

## 注意

本ツールは**デモ専用のESLだけ**に使用してください。ベータ版につき接続失敗時は再接続してください。公開のHTML/JSには個人情報・MACアドレス・秘密鍵を記載しないでください。

## 参考

- https://developer.chrome.com/docs/capabilities/bluetooth
- https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- https://github.com/atc1441/ATC_GICISKY_ESL