// Browser-only BLE transport. No Raspberry Pi, ESPHome proxy, or internet API required.
const IMAGE_SERVICE = '0000fef0-0000-1000-8000-00805f9b34fb';
const CTRL_UUID = '0000fef1-0000-1000-8000-00805f9b34fb';
const DATA_UUID = '0000fef2-0000-1000-8000-00805f9b34fb';
const ACK_TIMEOUT_MS = 12000;

export class DirectBle {
  constructor(onLog = () => {}, onDisconnect = () => {}) {
    this.log = onLog;
    this.onDisconnect = onDisconnect;
    this.device = null;
    this.ctrl = null;
    this.data = null;
    this.acks = [];
    this.pending = null;
    this.boundNotify = (event) => {
      const view = event.target.value;
      const val = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
      this.log(`ACK ${Array.from(val, x => x.toString(16).padStart(2, '0')).join('').toUpperCase()}`);
      if (this.pending) {
        const pending = this.pending;
        this.pending = null;
        clearTimeout(pending.timeout);
        pending.resolve(val);
      } else this.acks.push(val);
    };
    this.boundDisconnect = () => {
      this.ctrl = null;
      this.data = null;
      this.rejectPending(new Error('ESLとのBLE接続が切断されました'));
      this.onDisconnect();
    };
  }

  get connected() { return !!(this.device?.gatt?.connected && this.ctrl && this.data); }

  async connect() {
    if (!navigator.bluetooth) throw new Error('Web Bluetoothに非対応です。Android版ChromeのHTTPSページから開いてください。');
    this.log('BLE機器選択ダイアログを開きます');
    // No MAC address is embedded. Select the dedicated label by its advertised name.
    this.device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [IMAGE_SERVICE]
    });
    this.device.addEventListener('gattserverdisconnected', this.boundDisconnect);
    this.log(`選択: ${this.device.name || '名前なし'} (${this.device.id})`);
    const server = await this.device.gatt.connect();
    try {
      const service = await server.getPrimaryService(IMAGE_SERVICE);
      const [control, data] = await Promise.all([
        service.getCharacteristic(CTRL_UUID), service.getCharacteristic(DATA_UUID)
      ]);
      this.ctrl = control;
      this.data = data;
      this.ctrl.addEventListener('characteristicvaluechanged', this.boundNotify);
      await this.ctrl.startNotifications();
      this.log(`接続完了: ${this.device.name || 'ESL'} / GATT FEF0, FEF1, FEF2`);
      this.log(`FEF1 withoutResponse=${control.properties.writeWithoutResponse}, FEF2 withoutResponse=${data.properties.writeWithoutResponse}`);
      return this.device.name || 'ESL';
    } catch (e) {
      server.disconnect();
      throw new Error(`GATTサービスFEF0/特性FEF1・FEF2にアクセスできません: ${e.message}`);
    }
  }

  rejectPending(error) {
    if (this.pending) {
      const pending = this.pending;
      this.pending = null;
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
  }

  async disconnect() {
    this.rejectPending(new Error('切断されました'));
    if (this.ctrl) {
      try { await this.ctrl.stopNotifications(); } catch {}
      this.ctrl.removeEventListener('characteristicvaluechanged', this.boundNotify);
    }
    this.device?.gatt?.disconnect();
    this.ctrl = this.data = null;
    this.acks = [];
  }

  async writeAck(characteristic, bytes) {
    if (!this.connected) throw new Error('BLE未接続です');
    if (this.pending) throw new Error('ACK待機中の重複送信はできません');
    this.acks = []; // discard late/old ACKs before a new write
    const response = new Promise((resolve, reject) => {
      this.pending = { resolve, reject, timeout: setTimeout(() => {
        this.pending = null;
        reject(new Error(`ACK timeout (${ACK_TIMEOUT_MS}ms)`));
      }, ACK_TIMEOUT_MS) };
    });
    try {
      if (characteristic.properties.writeWithoutResponse) {
        await characteristic.writeValueWithoutResponse(bytes);
      } else if (characteristic.properties.write) {
        await characteristic.writeValueWithResponse(bytes);
      } else throw new Error('特性が書き込みをサポートしていません');
    } catch (err) {
      this.rejectPending(err);
      // Prevent an unhandled rejection from the abandoned response Promise.
      await response.catch(() => {});
      throw new Error(`BLE write failed (${bytes.length} bytes): ${err.message}。MTU不足の可能性もあります。`);
    }
    return response;
  }

  writeControl(bytes) { return this.writeAck(this.ctrl, bytes); }
  writeData(bytes) { return this.writeAck(this.data, bytes); }
}
