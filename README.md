# Gicisky ESL Web Demo — Android / Direct BLE

Android版Chromeから **Gicisky 2.9インチと4.2インチの電子ペーパーへ直接BLEで書き込む** GitHub Pages用の静的Webアプリです。ビルド・サーバー・Wi-Fi・ESPHome Proxyは不要です。

## 対応モデルと検証状況（v0.2.0）

| 選択 | タグの仕様 | 画像形式 | 転送量 | ブロック数 | Android直接BLE |
| --- | --- | --- | ---: | ---: | --- |
| 2.9インチ（0x002E）| 296×128 / 黒・白・赤・黄 | 90°反時計回り回転・2bpp | 9,472 B | 40 | **実機成功**（2026-10-16、約5.3秒・写真とACKログ） |
| 4.2インチ（0x004B）| 400×300 / 黒・白・赤 | 回転なし・BW/REDの1bpp 2面 | 30,000 B | 125 | **未検証**（既存の4.2インチ用Pythonテストコードから移植） |

**機種は自動判定しません。実機に合うサイズを選択してから接続してください。** 2.9インチに4.2インチ用のデータを送らないでください。使用中はモデル選択を無効化します。

## 主な機能

- サイズ選択と6種類のデモ画面（ウェルカム、正常稼働、検査中、注意、異常停止、更新完了）
- 各モデルのネイティブ解像度でのプレビュー、任意の画像読み込みと3色/4色量子化
- PNGおよび書き込み用バイナリの保存
- Chrome Web Bluetoothで直接GATT FEF0 / FEF1 / FEF2へ接続
- 240バイト単位のACK付き転送、進捗・診断ログ表示
- 固定のMACアドレス、IPアドレス、API鍵、外部送信なし

4.2インチの任意画像は実装元Pythonコードと同じ簡易色判定を使います。白はRGBの全成分が128超、赤はRが128超・G/Bが128以下、それ以外は黒になります。色味が想定と異なる場合は、黒・白・純赤の画像を用意してください。

## GitHub Pagesでの使い方

1. [Pages設定](https://github.com/bax-naka/gicisky-esl-web-demo/settings/pages) の **Deploy from a branch / main / (root)** を設定する。
2. Android版Chromeで [公開サイト](https://bax-naka.github.io/gicisky-esl-web-demo/) にHTTPSでアクセスする。
3. 2.9インチまたは4.2インチを選択して、デモ画面か画像ファイルを選ぶ。
4. 「ESLに接続」から **デモ専用のGicisky ESL** を選び、接続後に「選択画面をESLに書き込む」を押す。
5. 最終ACKと画面が正常に更新されたことを確認する。完了後、ESL側から切断されることがあります。

別のモデルに切り替える場合は、BLE接続を切断してからモデルを変更し、正しいESLへ接続し直してください。

## BLEプロトコル概要

両モデルで制御サービスは `FEF0`、制御/ACK通知は `FEF1`、画像データは `FEF2` を使用します。

- START: `01` → ACK `01F400`
- サイズ通知: `02 + uint32le(byte count) + 000000` → ACK先頭 `02`
- 画像開始: `03` → ACK `0500 + uint32le(next part)`
- データ: `uint32le(part) + image[part*240 : (part+1)*240]`
- 通常の完了ACK: `050800000000`
- 4.2インチでは、**最後の画像ブロック送信後に限り** `0500 + uint32le(125)` を完了として受理します。後者は既存Pythonテストコードの `OFFSET_END` 判定に基づきます。

2.9インチの画像エンコーダーは従来の4色2bpp方式のままです。4.2インチはピクセルの最上位bit優先で、最初の15,000 Bが白/非白ビット面、次の15,000 Bが赤/非赤ビット面です。

## 自動テスト

Node.js 18以降で:

```sh
npm test
```

2.9インチの既存テストと、4.2インチの色変換・MSB画素順・125ブロック・2種類の終了ACK・早期終了拒否のテストを実施します。

## 制約・注意

- 対象タグは既存コードで確認している2.9インチ（0x002E）と4.2インチ（0x004B）を想定しています。別型式では画素並びや転送形式が異なる可能性があります。
- **4.2インチのAndroid直接書き込みは未検証です。** 正常終了ACKを受信したら必ず表示を目視で確認してください。
- Android版ChromeでWeb Bluetoothを使用するために、Bluetooth有効化とHTTPSが必要です。
- BLEのGATT最大転送長が不足した場合、244バイト（4バイトpart番号 + 240バイト画像）のWrite Without Responseが失敗する可能性があります。
- 無応答・失敗の際はログをコピーして解析してください。
- デモ専用のESLだけに使用し、運用中の別ESLを書き換えないでください。

## 元実装・参考

- 2.9インチのPython送信コード（非公開リポジトリ）: `bax-naka/esl-controller/app/gicisky_esl.py`
- 4.2インチのPython送信/エンコーダーテスト（非公開リポジトリ）: `bax-naka/esl-controller/tools/gicisky_42_proxy_test.py`
- https://developer.chrome.com/docs/capabilities/bluetooth
- https://docs.github.com/en/pages
