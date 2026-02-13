package com.islamicbank.newapp;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.os.Looper;

import androidx.annotation.NonNull;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import java.io.IOException;
import java.util.Set;
import java.util.UUID;

public class BluetoothModule extends ReactContextBaseJavaModule {

    private final ReactApplicationContext reactContext;
    private BluetoothAdapter bluetoothAdapter;
    private BroadcastReceiver bluetoothReceiver;
    private boolean isReceiverRegistered = false;

    private BluetoothSocket bluetoothSocket;
    private BluetoothDevice currentConnectedDevice;

    // ✅ Location Client
    private final FusedLocationProviderClient fusedClient;

    private static final UUID SPP_UUID =
            UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    public BluetoothModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();

        // ✅ init fused location
        this.fusedClient = LocationServices.getFusedLocationProviderClient(reactContext);

        setupBluetoothReceiver();
    }

    @NonNull
    @Override
    public String getName() {
        return "BluetoothModule";
    }

    private void setupBluetoothReceiver() {
        bluetoothReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                String action = intent.getAction();

                if (BluetoothDevice.ACTION_ACL_CONNECTED.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) {
                        currentConnectedDevice = device;
                        sendEvent("onBluetoothConnect", createDeviceMap(device));
                    }
                } else if (BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action)) {
                    BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device != null) {
                        currentConnectedDevice = null;
                        sendEvent("onBluetoothDisconnect", createDeviceMap(device));
                    }
                } else if (BluetoothAdapter.ACTION_STATE_CHANGED.equals(action)) {
                    int state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR);
                    WritableMap params = Arguments.createMap();
                    params.putBoolean("enabled", state == BluetoothAdapter.STATE_ON);
                    sendEvent("onBluetoothStateChange", params);
                }
            }
        };
    }

    private WritableMap createDeviceMap(BluetoothDevice device) {
        WritableMap deviceMap = Arguments.createMap();
        try {
            String deviceName = "Unknown Device";
            String deviceAddress = "Unknown";
            int deviceType = 0;

            try {
                deviceName = device.getName() != null ? device.getName() : "Unknown Device";
                deviceAddress = device.getAddress() != null ? device.getAddress() : "Unknown";
                deviceType = device.getType();
            } catch (SecurityException e) {
                deviceName = "Unknown Device";
                deviceAddress = "Permission Required";
            }

            deviceMap.putString("name", deviceName);
            deviceMap.putString("address", deviceAddress);
            deviceMap.putInt("type", deviceType);
        } catch (Exception e) {
            deviceMap.putString("name", "Unknown Device");
            deviceMap.putString("address", "Unknown");
            deviceMap.putInt("type", 0);
        }
        return deviceMap;
    }

    private void sendEvent(String eventName, WritableMap params) {
        if (reactContext.hasActiveCatalystInstance()) {
            reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                    .emit(eventName, params);
        }
    }

    // ===========================
    // Bluetooth Listener
    // ===========================
    @ReactMethod
    public void startListening(Promise promise) {
        try {
            if (!isReceiverRegistered) {
                IntentFilter filter = new IntentFilter();
                filter.addAction(BluetoothDevice.ACTION_ACL_CONNECTED);
                filter.addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED);
                filter.addAction(BluetoothAdapter.ACTION_STATE_CHANGED);

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    reactContext.registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED);
                } else {
                    reactContext.registerReceiver(bluetoothReceiver, filter);
                }

                isReceiverRegistered = true;
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopListening(Promise promise) {
        try {
            if (isReceiverRegistered) {
                reactContext.unregisterReceiver(bluetoothReceiver);
                isReceiverRegistered = false;
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isBluetoothEnabled(Promise promise) {
        try {
            if (bluetoothAdapter != null) {
                promise.resolve(bluetoothAdapter.isEnabled());
            } else {
                promise.resolve(false);
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void getPairedDevices(Promise promise) {
        try {
            WritableArray devices = Arguments.createArray();

            if (bluetoothAdapter != null) {
                try {
                    Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
                    for (BluetoothDevice device : pairedDevices) {
                        devices.pushMap(createDeviceMap(device));
                    }
                } catch (SecurityException e) {
                    promise.reject("PERMISSION_ERROR", "Bluetooth permission required");
                    return;
                }
            }

            promise.resolve(devices);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    // ===========================
    // (Optional) SPP Connect/Disconnect
    // ===========================
    @ReactMethod
    public void connectToDevice(String address, Promise promise) {
        new Thread(() -> {
            try {
                if (bluetoothAdapter == null) {
                    promise.reject("ERROR", "Bluetooth not available");
                    return;
                }

                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
                if (device == null) {
                    promise.reject("ERROR", "Device not found");
                    return;
                }

                try {
                    bluetoothAdapter.cancelDiscovery();
                } catch (SecurityException ignored) {}

                if (bluetoothSocket != null) {
                    try { bluetoothSocket.close(); } catch (IOException ignored) {}
                }

                try {
                    bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                    bluetoothSocket.connect();
                    currentConnectedDevice = device;

                    WritableMap result = createDeviceMap(device);
                    result.putBoolean("connected", true);
                    promise.resolve(result);

                    sendEvent("onBluetoothConnect", createDeviceMap(device));

                } catch (IOException e) {
                    try {
                        bluetoothSocket = (BluetoothSocket) device.getClass()
                                .getMethod("createRfcommSocket", int.class)
                                .invoke(device, 1);
                        bluetoothSocket.connect();
                        currentConnectedDevice = device;

                        WritableMap result = createDeviceMap(device);
                        result.putBoolean("connected", true);
                        promise.resolve(result);

                        sendEvent("onBluetoothConnect", createDeviceMap(device));

                    } catch (Exception fallbackError) {
                        promise.reject("CONNECTION_FAILED", "Could not connect: " + fallbackError.getMessage());
                    }
                }

            } catch (SecurityException e) {
                promise.reject("PERMISSION_ERROR", "Bluetooth permission required");
            } catch (Exception e) {
                promise.reject("ERROR", e.getMessage());
            }
        }).start();
    }

    @ReactMethod
    public void disconnectDevice(Promise promise) {
        try {
            BluetoothDevice device = currentConnectedDevice;

            if (bluetoothSocket != null) {
                try {
                    bluetoothSocket.close();
                    bluetoothSocket = null;
                } catch (IOException ignored) {}
            }

            if (device != null) {
                currentConnectedDevice = null;
                sendEvent("onBluetoothDisconnect", createDeviceMap(device));
            }

            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isConnected(Promise promise) {
        try {
            boolean connected = bluetoothSocket != null && bluetoothSocket.isConnected();
            promise.resolve(connected);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void getConnectedDevice(Promise promise) {
        try {
            if (currentConnectedDevice != null) {
                promise.resolve(createDeviceMap(currentConnectedDevice));
            } else {
                promise.resolve(null);
            }
        } catch (Exception e) {
            promise.resolve(null);
        }
    }

    // ===========================
    // ✅ GPS Location (Fused)
    // ===========================

    /**
     * getCurrentLocation():
     * - If lastKnown location is recent (<30 sec) => return it
     * - Else => getCurrentLocation() (fresh)
     */
    @SuppressLint("MissingPermission")
    @ReactMethod
    public void getCurrentLocation(Promise promise) {
        try {
            long now = System.currentTimeMillis();

            fusedClient.getLastLocation()
                    .addOnSuccessListener(lastLoc -> {
                        try {
                            if (lastLoc != null && (now - lastLoc.getTime()) < 30_000) {
                                WritableMap map = Arguments.createMap();
                                map.putDouble("latitude", lastLoc.getLatitude());
                                map.putDouble("longitude", lastLoc.getLongitude());
                                map.putDouble("accuracy", lastLoc.getAccuracy());
                                map.putDouble("time", (double) lastLoc.getTime());
                                map.putString("source", "LAST_KNOWN_RECENT");
                                promise.resolve(map);
                                return;
                            }

                            // request fresh current
                            fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
                                    .addOnSuccessListener(curLoc -> {
                                        if (curLoc != null) {
                                            WritableMap map2 = Arguments.createMap();
                                            map2.putDouble("latitude", curLoc.getLatitude());
                                            map2.putDouble("longitude", curLoc.getLongitude());
                                            map2.putDouble("accuracy", curLoc.getAccuracy());
                                            map2.putDouble("time", (double) curLoc.getTime());
                                            map2.putString("source", "CURRENT");
                                            promise.resolve(map2);
                                        } else {
                                            promise.resolve(null);
                                        }
                                    })
                                    .addOnFailureListener(e -> promise.reject("LOCATION_ERROR", e.getMessage()));

                        } catch (Exception ex) {
                            promise.reject("ERROR", ex.getMessage());
                        }
                    })
                    .addOnFailureListener(e -> promise.reject("LOCATION_ERROR", e.getMessage()));

        } catch (SecurityException se) {
            promise.reject("PERMISSION_ERROR", "Location permission required");
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    /**
     * getFreshLocation():
     * - Force 1 fresh update using requestLocationUpdates()
     * - source = FRESH_UPDATE
     */
    @SuppressLint("MissingPermission")
    @ReactMethod
    public void getFreshLocation(Promise promise) {
        try {
            LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 1000)
                    .setWaitForAccurateLocation(true)
                    .setMaxUpdates(1)                 // only 1 update
                    .setMinUpdateIntervalMillis(500)
                    .setDurationMillis(15000)         // 15 sec max
                    .build();

            LocationCallback callback = new LocationCallback() {
                @Override
                public void onLocationResult(@NonNull LocationResult locationResult) {
                    fusedClient.removeLocationUpdates(this);

                    android.location.Location loc = locationResult.getLastLocation();
                    if (loc != null) {
                        WritableMap map = Arguments.createMap();
                        map.putDouble("latitude", loc.getLatitude());
                        map.putDouble("longitude", loc.getLongitude());
                        map.putDouble("accuracy", loc.getAccuracy());
                        map.putDouble("time", (double) loc.getTime());
                        map.putString("source", "FRESH_UPDATE");
                        promise.resolve(map);
                    } else {
                        promise.resolve(null);
                    }
                }
            };

            fusedClient.requestLocationUpdates(request, callback, Looper.getMainLooper())
                    .addOnFailureListener(e -> {
                        // fallback: last known
                        fusedClient.getLastLocation()
                                .addOnSuccessListener(lastLoc -> {
                                    if (lastLoc != null) {
                                        WritableMap map = Arguments.createMap();
                                        map.putDouble("latitude", lastLoc.getLatitude());
                                        map.putDouble("longitude", lastLoc.getLongitude());
                                        map.putDouble("accuracy", lastLoc.getAccuracy());
                                        map.putDouble("time", (double) lastLoc.getTime());
                                        map.putString("source", "LAST_KNOWN_FALLBACK");
                                        promise.resolve(map);
                                    } else {
                                        promise.resolve(null);
                                    }
                                })
                                .addOnFailureListener(err2 -> promise.reject("LOCATION_ERROR", err2.getMessage()));
                    });

        } catch (SecurityException se) {
            promise.reject("PERMISSION_ERROR", "Location permission required");
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }

    // RN event emitter required methods
    @ReactMethod
    public void addListener(String eventName) {}

    @ReactMethod
    public void removeListeners(Integer count) {}
}