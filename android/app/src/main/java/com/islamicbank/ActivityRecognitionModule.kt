package com.islamicbank.newapp

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule

class ActivityRecognitionModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx), LifecycleEventListener {

    companion object {
        private const val TAG = "ARModule"
        private const val PREFS_NAME = "activity_recognition"
        private const val EVENT_NAME = "ActivityRecognition"
    }

    private var accelDetector: AccelerometerActivityDetector? = null

    @Volatile
    private var wasRunningBeforeBackground = false

    init {
        ctx.addLifecycleEventListener(this)
    }

    override fun getName(): String = "ActivityRecognitionModule"

    // ✅ Lifecycle Management
    override fun onHostResume() {
        Log.d(TAG, "onHostResume")
        if (wasRunningBeforeBackground && accelDetector == null) {
            startAccelerometer()
            wasRunningBeforeBackground = false
        }
    }

    override fun onHostPause() {
        Log.d(TAG, "onHostPause")
        if (accelDetector?.isRunning() == true) {
            wasRunningBeforeBackground = true
            accelDetector?.stop()
            accelDetector = null
            Log.i(TAG, "⏸️ Paused (background)")
        }
    }

    override fun onHostDestroy() {
        Log.d(TAG, "onHostDestroy")
        cleanup()
    }

    private fun cleanup() {
        try {
            accelDetector?.stop()
            accelDetector = null
            wasRunningBeforeBackground = false
        } catch (e: Exception) {
            Log.e(TAG, "Cleanup error: ${e.message}")
        }
    }

    // ✅ Permission Check
    private fun hasPermission(): Boolean {
        return if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            true
        } else {
            ContextCompat.checkSelfPermission(
                ctx, Manifest.permission.ACTIVITY_RECOGNITION
            ) == PackageManager.PERMISSION_GRANTED
        }
    }

    // ✅ Emit to JS (Thread-safe)
    private fun emitToJS(activity: String, confidence: Int, source: String = "accelerometer") {
        try {
            if (!ctx.hasActiveCatalystInstance()) {
                Log.w(TAG, "No active catalyst instance")
                return
            }

            val ts = System.currentTimeMillis()

            // Save to SharedPrefs
            ctx.getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .putString("state", activity)
                .putInt("confidence", confidence)
                .putLong("timestamp", ts)
                .putBoolean("enabled", true)
                .putString("source", source)
                .apply()

            // Emit event
            val payload = Arguments.createMap().apply {
                putString("state", activity)
                putInt("confidence", confidence)
                putDouble("timestamp", ts.toDouble())
                putString("source", source)
            }

            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                ?.emit(EVENT_NAME, payload)

            Log.d(TAG, "📡 $activity $confidence%")

        } catch (e: Exception) {
            Log.e(TAG, "emitToJS error: ${e.message}")
        }
    }

    // ✅ Start Detection
    @ReactMethod
    fun start(intervalMs: Int, promise: Promise) {
        Log.d(TAG, "start($intervalMs)")

        try {
            // Start Google AR Service (if permission granted)
            if (hasPermission()) {
                try {
                    val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
                        action = ActivityRecognitionService.ACTION_START
                        putExtra(ActivityRecognitionService.EXTRA_INTERVAL_MS, intervalMs)
                    }
                    ContextCompat.startForegroundService(ctx, intent)
                    Log.i(TAG, "✅ Google AR Service started")
                } catch (e: Exception) {
                    Log.w(TAG, "Google AR Service failed: ${e.message}")
                    // Continue with accelerometer
                }
            }

            // Start Accelerometer
            val started = startAccelerometer()

            if (!started) {
                promise.reject("START_FAILED", "Failed to start accelerometer")
                return
            }

            // Save state
            ctx.getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .putBoolean("enabled", true)
                .putInt("intervalMs", intervalMs)
                .putLong("startedAt", System.currentTimeMillis())
                .apply()

            Log.i(TAG, "✅ Started successfully")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "start failed: ${e.message}", e)
            promise.reject("START_FAILED", e.message)
        }
    }

    private fun startAccelerometer(): Boolean {
        if (accelDetector?.isRunning() == true) {
            Log.d(TAG, "Accelerometer already running")
            return true
        }

        accelDetector = AccelerometerActivityDetector(
            context = ctx,
            onActivityDetected = { activity, confidence ->
                emitToJS(activity, confidence)
            },
            onError = { error ->
                Log.e(TAG, "Accelerometer error: $error")
            }
        )

        return accelDetector?.start() ?: false
    }

    // ✅ Stop Detection
    @ReactMethod
    fun stop(promise: Promise) {
        Log.d(TAG, "stop()")

        try {
            // Stop Google AR Service
            try {
                val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
                    action = ActivityRecognitionService.ACTION_STOP
                }
                ctx.startService(intent)
            } catch (e: Exception) {
                Log.w(TAG, "Stop service error: ${e.message}")
            }

            // Stop Accelerometer
            accelDetector?.stop()
            accelDetector = null
            wasRunningBeforeBackground = false

            // Update state
            ctx.getSharedPreferences(PREFS_NAME, 0)
                .edit()
                .putBoolean("enabled", false)
                .apply()

            Log.i(TAG, "✅ Stopped")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "stop failed: ${e.message}", e)
            promise.reject("STOP_FAILED", e.message)
        }
    }

    // ✅ Get Last Activity
    @ReactMethod
    fun getLast(promise: Promise) {
        try {
            val prefs = ctx.getSharedPreferences(PREFS_NAME, 0)

            val map = Arguments.createMap().apply {
                putString("state", prefs.getString("state", "unknown") ?: "unknown")
                putInt("confidence", prefs.getInt("confidence", 0))
                putDouble("timestamp", prefs.getLong("timestamp", 0L).toDouble())
                putBoolean("enabled", prefs.getBoolean("enabled", false))
                putString("source", prefs.getString("source", "unknown") ?: "unknown")
            }

            promise.resolve(map)

        } catch (e: Exception) {
            Log.e(TAG, "getLast failed: ${e.message}", e)
            promise.reject("GET_FAILED", e.message)
        }
    }

    // ✅ Required for RN Event Emitter
    @ReactMethod
    fun addListener(eventName: String) {
        Log.d(TAG, "addListener: $eventName")
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        Log.d(TAG, "removeListeners: $count")
    }
}