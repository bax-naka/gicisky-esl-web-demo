import { encode296x128RGBA, rgbToPaletteCode, transferImage, WIDTH, HEIGHT, IMAGE_BYTES } from './protocol.js';
import { DirectBle } from './ble.js';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageChooser = $('upload');
const templates = Array.from(document.querySelectorAll('[data-template]'));
let active = 'welcome';
let busy = false;
let connected = false;
let logLines = [];
const ble = new DirectBle(log, () => { log("ESLとのBLE接続が切断されました"); setConnection(false); });

function log(message) {
  const timestamp = new Date().toLocaleTimeString('ja-JP', { hour12: false });
  logLines.push(`[${timestamp}] ${message}`);
  if (logLines.length > 250) logLines.shift();
  $('log').textContent = logLines.join('\n');
  $('log').scrollTop = $('log').scrollHeight;
}
function setStatus(message, kind = 'info') {
  $('status').textContent = message;
  $('status').dataset.kind = kind;
}
function setConnection(value) {
  connected = value;
  $('connect').textContent = value ? '接続済み' : 'ESLに接続';
  $('connect').disabled = busy || value;
  $('disconnect').disabled = busy || !value;
  $('send').disabled = busy || !value;
  $('connectionIndicator').textContent = value ? 'BLE 接続中' : 'BLE 未接続';
  $('connectionIndicator').dataset.connected = String(value);
}
function setBusy(value) {
  busy = value;
  $('connect').disabled = value || connected;
  $('disconnect').disabled = value || !connected;
  $('send').disabled = value || !connected;
  $('upload').disabled = value;
  for (const b of templates) b.disabled = value;
}
function roundedRect(x, y, w, h, radius, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}
function text(t, x, y, font, color = '#000000', align = 'left') {
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(t, x, y);
}
function base(title, sub) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, WIDTH, 26);
  text(title, 9, 13, 'bold 13px sans-serif', '#ffffff');
  text(sub, 288, 13, 'bold 11px sans-serif', '#ffffff', 'right');
}
function quantizePreview() {
  const pixels = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  const colors = [[0, 0, 0], [255, 255, 255], [255, 255, 0], [255, 0, 0]];
  for (let i = 0; i < pixels.data.length; i += 4) {
    const code = rgbToPaletteCode(pixels.data[i], pixels.data[i+1], pixels.data[i+2]);
    const rgb = colors[code];
    pixels.data[i] = rgb[0];
    pixels.data[i + 1] = rgb[1];
    pixels.data[i + 2] = rgb[2];
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
}

function drawTemplate(name) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const p = {
    welcome() {
      base('GICISKY ESL DEMO', 'BLE DIRECT');
      text('電子ペーパー', 148, 61, 'bold 33px sans-serif', '#000', 'center');
      roundedRect(12, 92, 272, 26, 3, '#ffdf00');
      text('296 × 128   /   4 COLOR', 148, 105, 'bold 15px sans-serif', '#000', 'center');
    },
    normal() {
      base('設備状態', '設備 A-01');
      roundedRect(11, 37, 274, 76, 5, '#000000');
      roundedRect(15, 41, 266, 68, 3, '#ffffff');
      text('正常稼働', 148, 75, 'bold 42px sans-serif', '#000', 'center');
    },
    running() {
      base('製造工程', 'LINE 01');
      roundedRect(12, 37, 272, 72, 4, '#ffdf00');
      text('検査中', 148, 72, 'bold 45px sans-serif', '#000', 'center');
      text('PROCESS 03 / 07', 148, 118, 'bold 10px sans-serif', '#000', 'center');
    },
    attention() {
      base('設備状態', '設備 A-01');
      roundedRect(12, 36, 272, 77, 4, '#ffdf00');
      text('! 注意', 148, 76, 'bold 46px sans-serif', '#000', 'center');
    },
    alarm() {
      base('設備状態', '設備 A-01');
      roundedRect(11, 36, 274, 78, 5, '#ef1717');
      text('異常停止', 148, 76, 'bold 40px sans-serif', '#ffffff', 'center');
      ctx.fillStyle = '#000';
      ctx.fillRect(12, 119, 272, 3);
    },
    success() {
      base('BLE通信結果', 'DEMO');
      text('更新完了', 148, 70, 'bold 40px sans-serif', '#000', 'center');
      roundedRect(42, 103, 212, 16, 3, '#ffdf00');
      text('TRANSFER COMPLETE', 148, 111, 'bold 11px sans-serif', '#000', 'center');
    }
  };
  if (!p[name]) throw new Error('Unknown template');
  p[name]();
  quantizePreview();
  log(`プレビュー生成: ${name}`);
}

async function renderCustomFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('画像ファイルを開けません'));
      element.src = url;
    });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    const scale = Math.min(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    quantizePreview();
    log(`画像読込: ${file.name} (${img.naturalWidth}×${img.naturalHeight})`);
  } finally { URL.revokeObjectURL(url); }
}

for (const b of templates) {
  b.addEventListener('click', () => {
    active = b.dataset.template;
    templates.forEach(x => x.classList.toggle('active', x === b));
    drawTemplate(active);
    $('selectedLabel').textContent = b.querySelector('.template-label').textContent;
    $('upload').value = '';
    $('progress').value = 0;
    $('progressText').textContent = '0%';
  });
}
imageChooser.addEventListener('change', async () => {
  const file = imageChooser.files?.[0];
  if (!file) return;
  try {
    await renderCustomFile(file);
    active = 'custom';
    templates.forEach(x => x.classList.remove('active'));
    $('selectedLabel').textContent = '画像ファイル';
    $('progress').value = 0;
    $('progressText').textContent = '0%';
    setStatus('画像を読込みました。BLE接続後に送信できます。');
  } catch (err) { setStatus(err.message, 'error'); }
});

$('connect').addEventListener('click', async () => {
  setBusy(true);
  setStatus('Bluetooth機器を選択して接続します…');
  try {
    const name = await ble.connect();
    connected = true;
    setStatus(`${name} に接続しました。`, 'ok');
  } catch (err) { log(`接続エラー: ${err.message}`); setStatus(err.message, 'error'); }
  finally { setBusy(false); setConnection(ble.connected); }
});
$('disconnect').addEventListener('click', async () => {
  setBusy(true);
  await ble.disconnect();
  connected = false;
  setBusy(false);
  setConnection(false);
  log('手動で切断しました');
  setStatus('BLE接続を切断しました。');
});
$('send').addEventListener('click', async () => {
  setBusy(true);
  $('progress').value = 0;
  $('progressText').textContent = '0%';
  setStatus('ESLに画像を転送しています…');
  const began = performance.now();
  try {
    const raw = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const bytes = encode296x128RGBA(raw.data, raw.width, raw.height);
    log(`転送開始: ${active} / ${bytes.length} bytes / 240 bytes per block`);
    const result = await transferImage(ble, bytes, (ratio, writes) => {
      $('progress').value = Math.round(ratio * 100);
      $('progressText').textContent = `${Math.round(ratio * 100)}% (${writes}ブロック)`;
    });
    const sec = ((performance.now() - began) / 1000).toFixed(1);
    log(`送信完了: ${result.writes}ブロック ${sec}秒 / ACK ${result.terminal}`);
    setStatus(`転送完了：${result.writes}ブロック / ${sec}秒。ESLの表示を確認してください。`, 'ok');
  } catch (err) {
    log(`転送エラー: ${err.message}`);
    setStatus(`転送失敗: ${err.message}`, 'error');
  } finally { setBusy(false); setConnection(ble.connected); }
});
$('savePng').addEventListener('click', () => canvas.toBlob((blob) => {
  if (!blob) return;
  download(blob, `gicisky-${active}-296x128.png`);
}));
$('saveBin').addEventListener('click', () => {
  const bytes = encode296x128RGBA(ctx.getImageData(0, 0, WIDTH, HEIGHT).data);
  download(new Blob([bytes], { type: 'application/octet-stream' }), `gicisky-${active}-${IMAGE_BYTES}.bin`);
});
$('copyLog').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(logLines.join('\n')); setStatus('診断ログをコピーしました。', 'ok'); }
  catch { setStatus('ログコピーに失敗しました。ブラウザの権限を確認してください。', 'error'); }
});
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

log(`v0.1.0 / ${WIDTH}×${HEIGHT} 4-color / ${IMAGE_BYTES} bytes`);
if (!window.isSecureContext || !navigator.bluetooth) {
  setStatus('Web Bluetoothが利用できません。Android版ChromeでHTTPSのGitHub Pagesから開いてください。', 'error');
  $('connect').disabled = true;
}
setConnection(false);
drawTemplate(active);
