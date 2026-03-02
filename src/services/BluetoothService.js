// src/services/BluetoothService.js

import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';

const { BluetoothModule } = NativeModules;

const DEBUG = __DEV__;
const log = (...args) => DEBUG && console.log('[BT-Service]', new Date().toLocaleTimeString(), ...args);
const logError = (...args) => console.error('[BT-Service]', new Date().toLocaleTimeString(), ...args);

const EVENTS = {
  CONNECTED: 'BluetoothDeviceConnected',
  DISCONNECTED: 'BluetoothDeviceDisconnected',
  STATE_CHANGED: 'BluetoothStateChanged',
};

class BluetoothServiceClass {
  constructor() {
    this._listeners = [];
    this._callbacks = { onConnect: null, onDisconnect: null, onStateChange: null };
    this._isListening = false;
    this._isModuleAvailable = !!BluetoothModule;
    this._lastConnectedDevice = null; // Track last connected device for BT OFF scenario
    log('Service initialized, module:', this._isModuleAvailable);
  }

  async isBluetoothEnabled() {
    try {
      if (!this._isModuleAvailable) return false;
      const enabled = await BluetoothModule.isBluetoothEnabled();
      log('BT enabled:', enabled);
      return Boolean(enabled);
    } catch (e) {
      logError('isBluetoothEnabled:', e?.message);
      return false;
    }
  }

  async getPairedDevices() {
    try {
      if (!this._isModuleAvailable) return [];
      const devices = await BluetoothModule.getPairedDevices();
      const list = devices || [];
      log(`Found ${list.length} paired devices:`);
      list.forEach((d, i) => log(`  ${i + 1}. ${d.name} [${d.address}]`));
      return list;
    } catch (e) {
      logError('getPairedDevices:', e?.message);
      return [];
    }
  }

  async isDeviceConnected(address) {
    try {
      if (!this._isModuleAvailable || !address) return false;
      if (typeof BluetoothModule.isDeviceConnected !== 'function') return false;
      const connected = await BluetoothModule.isDeviceConnected(address);
      log(`Device ${address} connected:`, connected);
      return Boolean(connected);
    } catch (e) {
      logError('isDeviceConnected:', e?.message);
      return false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // START LISTENING
  // ═══════════════════════════════════════════════════════════

  async startListening({ onConnect, onDisconnect, onStateChange }) {
    try {
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log('📱 Starting Bluetooth event listeners...');
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      this._removeAllListeners();
      this._callbacks = { onConnect, onDisconnect, onStateChange };

      // ─── CONNECTED ──────────────────────────────────────
      const connectSub = DeviceEventEmitter.addListener(EVENTS.CONNECTED, (event) => {
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('🟢 BLUETOOTH CONNECTED!');
        log('   Name:', event?.name);
        log('   Address:', event?.address);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // Store for BT OFF scenario
        this._lastConnectedDevice = {
          address: event?.address || '',
          name: event?.name || 'Unknown Device',
          timestamp: event?.timestamp || Date.now(),
        };

        if (this._callbacks.onConnect && event) {
          this._callbacks.onConnect(this._lastConnectedDevice);
        }
      });

      // ─── DISCONNECTED ───────────────────────────────────
      const disconnectSub = DeviceEventEmitter.addListener(EVENTS.DISCONNECTED, (event) => {
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log('🔴 BLUETOOTH DISCONNECTED!');
        log('   Name:', event?.name);
        log('   Address:', event?.address);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        const deviceData = {
          address: event?.address || this._lastConnectedDevice?.address || '',
          name: event?.name || this._lastConnectedDevice?.name || 'Unknown Device',
          timestamp: event?.timestamp || Date.now(),
        };

        this._lastConnectedDevice = null; // Clear after disconnect

        if (this._callbacks.onDisconnect && event) {
          this._callbacks.onDisconnect(deviceData);
        }
      });

      // ─── STATE CHANGE (BT ON/OFF) ──────────────────────
      const stateSub = DeviceEventEmitter.addListener(EVENTS.STATE_CHANGED, (event) => {
        const isOn = Boolean(event?.enabled);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        log(`🔵 BLUETOOTH STATE: ${isOn ? 'ON' : 'OFF'}`);
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        // ═══ IMPORTANT: Jab BT OFF ho, treat as DISCONNECT ═══
        if (!isOn && this._lastConnectedDevice) {
          log('⚠️ BT turned OFF - treating as DISCONNECT');
          log('   Device was:', this._lastConnectedDevice.name);

          if (this._callbacks.onDisconnect) {
            this._callbacks.onDisconnect({
              ...this._lastConnectedDevice,
              timestamp: Date.now(),
              reason: 'bluetooth_off',
            });
          }
          this._lastConnectedDevice = null;
        }

        if (this._callbacks.onStateChange) {
          this._callbacks.onStateChange({
            enabled: isOn,
            state: event?.state || 0,
            timestamp: event?.timestamp || Date.now(),
          });
        }
      });

      this._listeners = [connectSub, disconnectSub, stateSub];

      if (this._isModuleAvailable && typeof BluetoothModule.startListening === 'function') {
        log('Calling native startListening...');
        await BluetoothModule.startListening();
        log('✅ Native BroadcastReceiver registered!');
      }

      this._isListening = true;
      log('✅ ✅ ✅ All 3 event listeners registered:');
      log('   1. BluetoothDeviceConnected');
      log('   2. BluetoothDeviceDisconnected');
      log('   3. BluetoothStateChanged');
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return true;
    } catch (e) {
      logError('startListening FAILED:', e?.message);
      this._isListening = false;
      return false;
    }
  }

  async stopListening() {
    try {
      log('🛑 Stopping Bluetooth listeners...');
      this._removeAllListeners();
      if (this._isModuleAvailable && typeof BluetoothModule.stopListening === 'function') {
        await BluetoothModule.stopListening();
        log('Native BroadcastReceiver unregistered');
      }
      this._callbacks = { onConnect: null, onDisconnect: null, onStateChange: null };
      this._isListening = false;
      log('✅ All Bluetooth listeners stopped');
    } catch (e) {
      logError('stopListening:', e?.message);
      this._isListening = false;
    }
  }

  updateCallbacks({ onConnect, onDisconnect, onStateChange }) {
    if (onConnect !== undefined) this._callbacks.onConnect = onConnect;
    if (onDisconnect !== undefined) this._callbacks.onDisconnect = onDisconnect;
    if (onStateChange !== undefined) this._callbacks.onStateChange = onStateChange;
    log('Callbacks updated');
  }

  // Store last connected device (for manual tracking)
  setLastConnectedDevice(device) {
    this._lastConnectedDevice = device;
    log('Last connected device set:', device?.name, device?.address);
  }

  getLastConnectedDevice() {
    return this._lastConnectedDevice;
  }

  get isListening() { return this._isListening; }
  get isModuleAvailable() { return this._isModuleAvailable; }

  _removeAllListeners() {
    if (this._listeners.length === 0) return;
    log(`Removing ${this._listeners.length} listeners...`);
    this._listeners.forEach((sub, i) => {
      try { sub?.remove(); log(`  Listener ${i + 1} removed ✅`); }
      catch (e) { logError(`  Listener ${i + 1} error:`, e?.message); }
    });
    this._listeners = [];
    log('All JS listeners cleared');
  }
}

const BluetoothService = new BluetoothServiceClass();
export default BluetoothService;