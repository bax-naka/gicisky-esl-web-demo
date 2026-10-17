import { encodeForProfile, rgbToPaletteCode, rgbToBwrColor, transferImage, getProfile, WIDTH, HEIGHT } from './protocol.js?v=0.2.1';
import { DirectBle } from './ble.js?v=0.2.1';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const imageChooser = $('upload');
const modelChooser = $('model');
const bleAvailable = window.isSecureContext && !!navigator.bluetooth;
let profileId = modelChooser.value;
let loadedFile = null;
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
  $('connect').disabled = busy || value || !bleAvailable;
  modelChooser.disabled = busy || value;
  $('disconnect').disabled = busy || !value;
  $('send').disabled = busy || !value;
  $('connectionIndicator').textContent = value ? 'BLE 接続中' : 'BLE 未接続';
  $('connectionIndicator').dataset.connected = String(value);
}
function setBusy(value) {
  busy = value;
  $('connect').disabled = value || connected || !bleAvailable;
  modelChooser.disabled = value || connected;
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
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const is42 = profileId === 'g42';
  const colors = is42
    ? [[0, 0, 0], [255, 255, 255], [255, 0, 0]]
    : [[0, 0, 0], [255, 255, 255], [255, 255, 0], [255, 0, 0]];
  for (let i = 0; i < pixels.data.length; i += 4) {
    const code = is42
      ? rgbToBwrColor(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2])
      : rgbToPaletteCode(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    const rgb = colors[code];
    pixels.data[i] = rgb[0];
    pixels.data[i + 1] = rgb[1];
    pixels.data[i + 2] = rgb[2];
    pixels.data[i + 3] = 255;
  }
  ctx.putImageData(pixels, 0, 0);
}

function drawTemplate(name) {
  if (profileId === 'g42') return drawTemplate42(name);
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

function drawTemplate42(name) {
  const w = 400, h = 300;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, 48);
  const headers = {
    welcome: ['GICISKY ESL DEMO', 'BLE DIRECT'],
    normal: ['設備状態', '設備 A-01'],
    running: ['製造工程', 'LINE 01'],
    attention: ['設備状態', '設備 A-01'],
    alarm: ['設備状態', '設備 A-01'],
    success: ['BLE通信結果', 'DEMO']
  };
  if (!headers[name]) throw new Error('Unknown template');
  text(headers[name][0], 16, 24, 'bold 23px sans-serif', '#fff');
  text(headers[name][1], 384, 24, 'bold 16px sans-serif', '#fff', 'right');
  switch (name) {
    case 'welcome':
      text('電子ペーパー', 200, 141, 'bold 49px sans-serif', '#000', 'center');
      roundedRect(17, 230, 366, 49, 5, '#e50000');
      text('400 × 300  /  3 COLOR', 200, 254, 'bold 23px sans-serif', '#fff', 'center');
      break;
    case 'normal':
      roundedRect(18, 82, 364, 172, 7, '#000');
      roundedRect(24, 88, 352, 160, 4, '#fff');
      text('正常稼働', 200, 165, 'bold 68px sans-serif', '#000', 'center');
      break;
    case 'running':
      roundedRect(18, 79, 364, 174, 7, '#e50000');
      text('検査中', 200, 161, 'bold 75px sans-serif', '#fff', 'center');
      text('PROCESS 03 / 07', 200, 276, 'bold 18px sans-serif', '#000', 'center');
      break;
    case 'attention':
      roundedRect(18, 79, 364, 174, 7, '#e50000');
      text('！注意', 200, 164, 'bold 76px sans-serif', '#fff', 'center');
      break;
    case 'alarm':
      roundedRect(18, 79, 364, 174, 7, '#e50000');
      text('異常停止', 200, 165, 'bold 67px sans-serif', '#fff', 'center');
      ctx.fillStyle = '#000';
      ctx.fillRect(18, 275, 364, 5);
      break;
    case 'success':
      text('更新完了', 200, 150, 'bold 71px sans-serif', '#000', 'center');
      roundedRect(28, 232, 344, 46, 5, '#e50000');
      text('TRANSFER COMPLETE', 200, 254, 'bold 22px sans-serif', '#fff', 'center');
      break;
  }
  quantizePreview();
  log(`プレビュー生成: ${name} (400×300)`);
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
    const width = canvas.width, height = canvas.height;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
    ctx.drawImage(img, (width - w) / 2, (height - h) / 2, w, h);
    quantizePreview();
    log(`画像読込: ${file.name} (${img.naturalWidth}×${img.naturalHeight})`);
  } finally { URL.revokeObjectURL(url); }
}

for (const b of templates) {
  b.addEventListener('click', () => {
    active = b.dataset.template;
    loadedFile = null;
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
    loadedFile = file;
    active = 'custom';
    templates.forEach(x => x.classList.remove('active'));
    $('selectedLabel').textContent = '画像ファイル';
    $('progress').value = 0;
    $('progressText').textContent = '0%';
    setStatus('画像を読込みました。BLE接続後に送信できます。');
  } catch (err) { setStatus(err.message, 'error'); }
});

function resetProgress() {
  $('progress').value = 0;
  $('progressText').textContent = '0%';
}

modelChooser.addEventListener('change', async () => {
  if (busy || ble.connected) {
    modelChooser.value = profileId;
    setStatus('モデル変更前にBLEを切断してください。', 'error');
    return;
  }
  profileId = modelChooser.value;
  const profile = getProfile(profileId);
  canvas.width = profile.width;
  canvas.height = profile.height;
  $('profileDetail').textContent = `${profile.width} × ${profile.height} / ${profile.colors}色`;
  resetProgress();
  try {
    if (active === 'custom' && loadedFile) await renderCustomFile(loadedFile);
    else drawTemplate(active);
    log(`モデル選択: ${profile.label} / ${profile.width}×${profile.height} / ${profile.imageBytes} bytes`);
    setStatus(`${profile.label}を選択しました。必ず同じ型式のESLに接続してください。`);
  } catch (err) { setStatus(`プレビュー失敗: ${err.message}`, 'error'); }
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
    const profile = getProfile(profileId);
    const raw = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bytes = encodeForProfile(raw.data, profileId);
    log(`転送開始: ${active} / ${profile.label} ${profile.width}×${profile.height} / ${bytes.length} bytes / 240 bytes per block`);
    const result = await transferImage(ble, bytes, (ratio, writes) => {
      $('progress').value = Math.round(ratio * 100);
      $('progressText').textContent = `${Math.round(ratio * 100)}% (${writes}ブロック)`;
    }, profileId);
    const sec = ((performance.now() - began) / 1000).toFixed(1);
    log(`送信完了: ${result.writes}ブロック ${sec}秒 / ACK ${result.terminal}`);
    setStatus(`画像転送完了：${result.writes}ブロック / ${sec}秒。BLEを自動切断しています…`, 'ok');

    // 4.2-inch tags start refreshing after GATT disconnect; 2.9-inch
    // tags often disconnect themselves after the terminal ACK.
    // Allow the final ACK a brief settling period before disconnecting.
    await new Promise(resolve => setTimeout(resolve, 300));
    if (ble.connected) {
      try {
        await ble.disconnect();
        log('画像転送完了後、BLEを自動切断しました');
      } catch (disconnectError) {
        log(`画像転送完了後のBLE切断エラー: ${disconnectError.message}`);
        setStatus(`画像の転送は完了しましたが、BLE切断に失敗しました：${disconnectError.message}。切断ボタンを押してください。`, 'error');
        return;
      }
    } else {
      log('画像転送完了後、ESL側でBLE切断済み');
    }
    setStatus(`画像転送完了：${result.writes}ブロック / ${sec}秒。BLE切断済みです。ESLの表示を確認してください。`, 'ok');
  } catch (err) {
    log(`転送エラー: ${err.message}`);
    setStatus(`転送失敗: ${err.message}`, 'error');
  } finally { setBusy(false); setConnection(ble.connected); }
});
$('savePng').addEventListener('click', () => canvas.toBlob((blob) => {
  if (!blob) return;
  download(blob, `gicisky-${active}-${canvas.width}x${canvas.height}.png`);
}));
$('saveBin').addEventListener('click', () => {
  const bytes = encodeForProfile(ctx.getImageData(0, 0, canvas.width, canvas.height).data, profileId);
  download(new Blob([bytes], { type: 'application/octet-stream' }), `gicisky-${active}-${profileId}-${bytes.length}.bin`);
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

log(`v0.2.1 / ${getProfile(profileId).width}×${getProfile(profileId).height} / ${getProfile(profileId).imageBytes} bytes`);
if (!window.isSecureContext || !navigator.bluetooth) {
  setStatus('Web Bluetoothが利用できません。Android版ChromeでHTTPSのGitHub Pagesから開いてください。', 'error');
  $('connect').disabled = true;
}
setConnection(false);
drawTemplate(active);
