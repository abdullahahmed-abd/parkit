import { NativeModules, NativeEventEmitter, Platform, PermissionsAndroid } from 'react-native';

const { BluetoothModule } = NativeModules;
const bluetoothEmitter = BluetoothModule ? new NativeEventEmitter(BluetoothModule) : null;

class BluetoothService {
    constructor() {
        this.listeners = [];
        this.isListening = false;
    }

    async requestPermissions() {
        if (Platform.OS === 'android') {
            try {
                const apiLevel = Platform.Version;

                if (apiLevel >= 31) {
                    const granted = await PermissionsAndroid.requestMultiple([
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
                        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    ]);

                    return (
                        granted['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED &&
                        granted['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED
                    );
                } else {
                    const granted = await PermissionsAndroid.request(
                        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
                    );
                    return granted === PermissionsAndroid.RESULTS.GRANTED;
                }
            } catch (error) {
                console.error('Permission error:', error);
                return false;
            }
        }
        return true;
    }

    async isBluetoothEnabled() {
        try {
            if (!BluetoothModule) return false;
            return await BluetoothModule.isBluetoothEnabled();
        } catch (error) {
            console.error('Bluetooth check error:', error);
            return false;
        }
    }

    async getPairedDevices() {
        try {
            if (!BluetoothModule) return [];
            return await BluetoothModule.getPairedDevices();
        } catch (error) {
            console.error('Get paired devices error:', error);
            return [];
        }
    }

    // 🔌 Connect to device
    async connectToDevice(address) {
        try {
            if (!BluetoothModule) {
                throw new Error('BluetoothModule not available');
            }
            const result = await BluetoothModule.connectToDevice(address);
            return result;
        } catch (error) {
            console.error('Connect error:', error);
            throw error;
        }
    }

    // 🔌 Disconnect from device
    async disconnectDevice() {
        try {
            if (!BluetoothModule) {
                throw new Error('BluetoothModule not available');
            }
            await BluetoothModule.disconnectDevice();
            return true;
        } catch (error) {
            console.error('Disconnect error:', error);
            throw error;
        }
    }

    // Check if connected
    async isConnected() {
        try {
            if (!BluetoothModule) return false;
            return await BluetoothModule.isConnected();
        } catch (error) {
            return false;
        }
    }

    // Get connected device
    async getConnectedDevice() {
        try {
            if (!BluetoothModule) return null;
            return await BluetoothModule.getConnectedDevice();
        } catch (error) {
            return null;
        }
    }

    async startListening(callbacks = {}) {
        try {
            const hasPermission = await this.requestPermissions();
            if (!hasPermission) {
                console.warn('Bluetooth permissions not granted');
                return false;
            }

            if (!BluetoothModule || !bluetoothEmitter) {
                console.warn('BluetoothModule not available');
                return false;
            }

            await BluetoothModule.startListening();
            this.isListening = true;

            if (callbacks.onConnect) {
                const connectListener = bluetoothEmitter.addListener(
                    'onBluetoothConnect',
                    callbacks.onConnect
                );
                this.listeners.push(connectListener);
            }

            if (callbacks.onDisconnect) {
                const disconnectListener = bluetoothEmitter.addListener(
                    'onBluetoothDisconnect',
                    callbacks.onDisconnect
                );
                this.listeners.push(disconnectListener);
            }

            if (callbacks.onStateChange) {
                const stateListener = bluetoothEmitter.addListener(
                    'onBluetoothStateChange',
                    callbacks.onStateChange
                );
                this.listeners.push(stateListener);
            }

            return true;
        } catch (error) {
            console.error('Start listening error:', error);
            return false;
        }
    }

    async stopListening() {
        try {
            this.listeners.forEach(listener => {
                if (listener && listener.remove) {
                    listener.remove();
                }
            });
            this.listeners = [];

            if (BluetoothModule && this.isListening) {
                await BluetoothModule.stopListening();
            }
            this.isListening = false;
        } catch (error) {
            console.error('Stop listening error:', error);
        }
    }
}

export default new BluetoothService();