// android/app/src/main/java/com/yourapp/bluetooth/BluetoothModule.kt

package com.parkit.newapp

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat

import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource

class BluetoothModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        private const val TAG = "BluetoothModule"
        private const val MODULE_NAME = "BluetoothModule"

        const val EVENT_DEVICE_CONNECTED = "BluetoothDeviceConnected"
        const val EVENT_DEVICE_DISCONNECTED = "BluetoothDeviceDisconnected"
        const val EVENT_STATE_CHANGED = "BluetoothStateChanged"

        private const val LOCATION_TIMEOUT_MS = 12000L
        private const val FRESH_LOCATION_TIMEOUT_MS = 15000L
    }

    private var bluetoothAdapter: BluetoothAdapter? = null
    private var fusedLocationClient: FusedLocationProviderClient? = null
    private var bluetoothReceiver: BroadcastReceiver? = null
    private var isListening = false
    private val mainHandler = Handler(Looper.getMainLooper())
    private val connectedDevices = mutableSetOf<String>()

    init {
        reactContext.addLifecycleEventListener(this)
        try {
            val bm = reactContext.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
            bluetoothAdapter = bm?.adapter ?: BluetoothAdapter.getDefaultAdapter()
            fusedLocationClient = LocationServices.getFusedLocationProviderClient(reactContext)
            Log.d(TAG, "Module initialized, BT: ${bluetoothAdapter != null}")
        } catch (e: Exception) {
            Log.e(TAG, "Init error", e)
        }
    }

    override fun getName(): String = MODULE_NAME

    // ═══════════════════════════════════════════════════════════
    // EVENT EMITTER
    // ═══════════════════════════════════════════════════════════

    private fun sendEvent(eventName: String, params: WritableMap?) {
        try {
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
                Log.d(TAG, "✅ Event: $eventName")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Event error: $eventName", e)
        }
    }

    private fun deviceToMap(device: BluetoothDevice?, event: String): WritableMap {
        return Arguments.createMap().apply {
            putString("address", device?.address ?: "unknown")
            putString("name", getDeviceName(device))
            putString("event", event)
            putDouble("timestamp", System.currentTimeMillis().toDouble())
            putInt("type", device?.type ?: 0)
            putInt("bondState", device?.bondState ?: 0)
        }
    }

    private fun getDeviceName(device: BluetoothDevice?): String {
        return try {
            if (hasBtPermission()) device?.name ?: "Unknown Device"
            else "Unknown Device"
        } catch (e: SecurityException) {
            "Unknown Device"
        }
    }

    // ═══════════════════════════════════════════════════════════
    // PERMISSIONS
    // ═══════════════════════════════════════════════════════════

    private fun hasBtPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(reactContext, Manifest.permission.BLUETOOTH_CONNECT) ==
                    PackageManager.PERMISSION_GRANTED
        } else true
    }

    private fun hasLocPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            reactContext, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
    }

    // ═══════════════════════════════════════════════════════════
    // BLUETOOTH STATUS
    // ═══════════════════════════════════════════════════════════

    @ReactMethod
    fun isBluetoothEnabled(promise: Promise) {
        try {
            promise.resolve(bluetoothAdapter?.isEnabled ?: false)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    @ReactMethod
    fun isBluetoothAvailable(promise: Promise) {
        promise.resolve(bluetoothAdapter != null)
    }

    // ═══════════════════════════════════════════════════════════
    // PAIRED DEVICES
    // ═══════════════════════════════════════════════════════════

    @ReactMethod
    fun getPairedDevices(promise: Promise) {
        try {
            if (bluetoothAdapter == null || !hasBtPermission()) {
                promise.resolve(Arguments.createArray())
                return
            }

            val arr = Arguments.createArray()
            bluetoothAdapter?.bondedDevices?.forEach { device ->
                arr.pushMap(Arguments.createMap().apply {
                    putString("name", getDeviceName(device))
                    putString("address", device.address)
                    putInt("type", device.type)
                    putInt("bondState", device.bondState)
                })
            }
            promise.resolve(arr)
        } catch (e: Exception) {
            Log.e(TAG, "getPairedDevices error", e)
            promise.resolve(Arguments.createArray())
        }
    }

    // ═══════════════════════════════════════════════════════════
    // IS DEVICE CONNECTED
    // ═══════════════════════════════════════════════════════════

    @ReactMethod
    fun isDeviceConnected(address: String, promise: Promise) {
        try {
            if (bluetoothAdapter == null || !hasBtPermission()) {
                promise.resolve(false)
                return
            }

            if (connectedDevices.contains(address)) {
                promise.resolve(true)
                return
            }

            var resolved = false
            val profiles = intArrayOf(BluetoothProfile.A2DP, BluetoothProfile.HEADSET)
            var checked = 0

            for (profile in profiles) {
                bluetoothAdapter?.getProfileProxy(reactContext,
                    object : BluetoothProfile.ServiceListener {
                        override fun onServiceConnected(type: Int, proxy: BluetoothProfile) {
                            try {
                                if (!resolved) {
                                    for (d in proxy.connectedDevices) {
                                        if (d.address == address) {
                                            resolved = true
                                            connectedDevices.add(address)
                                            promise.resolve(true)
                                            break
                                        }
                                    }
                                }
                            } catch (_: SecurityException) {
                            } finally {
                                bluetoothAdapter?.closeProfileProxy(type, proxy)
                                checked++
                                if (!resolved && checked >= profiles.size) {
                                    resolved = true
                                    promise.resolve(false)
                                }
                            }
                        }

                        override fun onServiceDisconnected(type: Int) {
                            checked++
                            if (!resolved && checked >= profiles.size) {
                                resolved = true
                                promise.resolve(false)
                            }
                        }
                    }, profile)
            }

            mainHandler.postDelayed({
                if (!resolved) { resolved = true; promise.resolve(false) }
            }, 3000)

        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    // ═══════════════════════════════════════════════════════════
    // START LISTENING
    // ═══════════════════════════════════════════════════════════

    @ReactMethod
    fun startListening(promise: Promise) {
        try {
            stopListeningInternal()

            bluetoothReceiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context?, intent: Intent?) {
                    val action = intent?.action ?: return

                    when (action) {
                        BluetoothDevice.ACTION_ACL_CONNECTED -> {
                            val device = getDeviceFromIntent(intent)
                            if (device != null) {
                                connectedDevices.add(device.address)
                                Log.d(TAG, "🟢 CONNECTED: ${getDeviceName(device)} [${device.address}]")
                                sendEvent(EVENT_DEVICE_CONNECTED, deviceToMap(device, "connected"))
                            }
                        }

                        BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                            val device = getDeviceFromIntent(intent)
                            if (device != null) {
                                connectedDevices.remove(device.address)
                                Log.d(TAG, "🔴 DISCONNECTED: ${getDeviceName(device)} [${device.address}]")
                                sendEvent(EVENT_DEVICE_DISCONNECTED, deviceToMap(device, "disconnected"))
                            }
                        }

                        BluetoothAdapter.ACTION_STATE_CHANGED -> {
                            val state = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, BluetoothAdapter.ERROR)
                            val enabled = state == BluetoothAdapter.STATE_ON
                            if (!enabled) connectedDevices.clear()

                            sendEvent(EVENT_STATE_CHANGED, Arguments.createMap().apply {
                                putBoolean("enabled", enabled)
                                putInt("state", state)
                                putDouble("timestamp", System.currentTimeMillis().toDouble())
                            })
                        }
                    }
                }
            }

            val filter = IntentFilter().apply {
                addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
                addAction(BluetoothDevice.ACTION_ACL_DISCONNECT_REQUESTED)
                addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                reactContext.registerReceiver(bluetoothReceiver, filter, Context.RECEIVER_EXPORTED)
            } else {
                reactContext.registerReceiver(bluetoothReceiver, filter)
            }

            isListening = true
            Log.d(TAG, "✅ Bluetooth listener STARTED")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "startListening error", e)
            promise.reject("BT_ERROR", e.message, e)
        }
    }

    // ═══════════════════════════════════════════════════════════
    // STOP LISTENING
    // ═══════════════════════════════════════════════════════════

    private fun stopListeningInternal() {
        try {
            bluetoothReceiver?.let {
                try { reactContext.unregisterReceiver(it) } catch (_: Exception) {}
            }
            bluetoothReceiver = null
            isListening = false
        } catch (_: Exception) {}
    }

    @ReactMethod
    fun stopListening(promise: Promise) {
        stopListeningInternal()
        promise.resolve(true)
    }

    // ═══════════════════════════════════════════════════════════
    // LOCATION
    // ═══════════════════════════════════════════════════════════

    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        try {
            if (!hasLocPermission()) {
                promise.reject("PERM", "No location permission")
                return
            }

            var resolved = false

            fusedLocationClient?.lastLocation
                ?.addOnSuccessListener { loc ->
                    if (!resolved) {
                        if (loc != null) {
                            resolved = true
                            promise.resolve(locToMap(loc, "cached"))
                        } else {
                            getFreshLocationInternal(promise)
                        }
                    }
                }
                ?.addOnFailureListener {
                    if (!resolved) { resolved = true; getFreshLocationInternal(promise) }
                }

            mainHandler.postDelayed({
                if (!resolved) { resolved = true; promise.reject("TIMEOUT", "Location timeout") }
            }, LOCATION_TIMEOUT_MS)

        } catch (e: SecurityException) {
            promise.reject("PERM", "Permission denied")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getFreshLocation(promise: Promise) {
        getFreshLocationInternal(promise)
    }

    private fun getFreshLocationInternal(promise: Promise) {
        try {
            if (!hasLocPermission()) {
                promise.reject("PERM", "No permission")
                return
            }

            var resolved = false
            val cts = CancellationTokenSource()

            fusedLocationClient?.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
                ?.addOnSuccessListener { loc ->
                    if (!resolved) {
                        resolved = true
                        if (loc != null) {
                            promise.resolve(locToMap(loc, "fresh_gps"))
                        } else {
                            // Fallback
                            fusedLocationClient?.lastLocation
                                ?.addOnSuccessListener { last ->
                                    if (last != null) promise.resolve(locToMap(last, "last_known"))
                                    else promise.reject("ERROR", "No location")
                                }
                                ?.addOnFailureListener { promise.reject("ERROR", "No location") }
                        }
                    }
                }
                ?.addOnFailureListener { e ->
                    if (!resolved) {
                        resolved = true
                        promise.reject("ERROR", e.message)
                    }
                }

            mainHandler.postDelayed({
                if (!resolved) {
                    resolved = true
                    cts.cancel()
                    promise.reject("TIMEOUT", "GPS timeout")
                }
            }, FRESH_LOCATION_TIMEOUT_MS)

        } catch (e: SecurityException) {
            promise.reject("PERM", "Permission denied")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    private fun locToMap(loc: Location, source: String): WritableMap {
        return Arguments.createMap().apply {
            putDouble("latitude", loc.latitude)
            putDouble("longitude", loc.longitude)
            putDouble("accuracy", loc.accuracy.toDouble())
            putDouble("altitude", loc.altitude)
            putDouble("speed", loc.speed.toDouble())
            putDouble("time", loc.time.toDouble())
            putString("source", source)
            putString("provider", loc.provider ?: "unknown")
        }
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    private fun getDeviceFromIntent(intent: Intent): BluetoothDevice? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }
    }

    @ReactMethod fun isListeningActive(promise: Promise) { promise.resolve(isListening) }
    @ReactMethod fun addListener(eventName: String) {}
    @ReactMethod fun removeListeners(count: Int) {}

    // ═══════════════════════════════════════════════════════════
    // LIFECYCLE
    // ═══════════════════════════════════════════════════════════

    override fun onHostResume() {}
    override fun onHostPause() {}
    override fun onHostDestroy() { stopListeningInternal(); connectedDevices.clear() }
    override fun onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy()
        stopListeningInternal(); connectedDevices.clear()
    }
}