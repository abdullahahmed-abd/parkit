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
    }

    private var accelDetector: AccelerometerActivityDetector? = null
    private var wasRunningBeforeBackground = false

    init {
        ctx.addLifecycleEventListener(this)
    }

    override fun getName(): String = "ActivityRecognitionModule"

    // ✅ Lifecycle - Pause when app goes background
    override fun onHostResume() {
        Log.d(TAG, "onHostResume")
        if (wasRunningBeforeBackground) {
            startAccelerometer()
            wasRunningBeforeBackground = false
        }
    }

    override fun onHostPause() {
        Log.d(TAG, "onHostPause")
        if (accelDetector?.isRunning() == true) {
            wasRunningBeforeBackground = true
            accelDetector?.stop()
            Log.i(TAG, "⏸️ Accelerometer paused (app background)")
        }
    }

    override fun onHostDestroy() {
        Log.d(TAG, "onHostDestroy")
        accelDetector?.stop()
        accelDetector = null
    }

    private fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.ACTIVITY_RECOGNITION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun emitToJS(activity: String, confidence: Int, source: String = "accelerometer") {
        try {
            if (!ctx.hasActiveCatalystInstance()) return

            val ts = System.currentTimeMillis()

            ctx.getSharedPreferences("activity_recognition", 0)
                .edit()
                .putString("state", activity)
                .putInt("confidence", confidence)
                .putLong("timestamp", ts)
                .putBoolean("enabled", true)
                .putString("source", source)
                .apply()

            val payload = Arguments.createMap().apply {
                putString("state", activity)
                putInt("confidence", confidence)
                putDouble("timestamp", ts.toDouble())
                putString("source", source)
            }

            ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit("ActivityRecognition", payload)

            Log.d(TAG, "📡 $activity $confidence%")

        } catch (e: Exception) {
            Log.e(TAG, "emitToJS error: ${e.message}")
        }
    }

    @ReactMethod
    fun start(intervalMs: Int, promise: Promise) {
        Log.d(TAG, "start($intervalMs)")

        try {
            // Google AR Service
            if (hasPermission()) {
                val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
                    action = ActivityRecognitionService.ACTION_START
                    putExtra(ActivityRecognitionService.EXTRA_INTERVAL_MS, intervalMs)
                }
                ContextCompat.startForegroundService(ctx, intent)
            }

            // Accelerometer
            startAccelerometer()

            ctx.getSharedPreferences("activity_recognition", 0)
                .edit()
                .putBoolean("enabled", true)
                .putInt("intervalMs", intervalMs)
                .putLong("startedAt", System.currentTimeMillis())
                .apply()

            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "start failed", e)
            promise.reject("START_FAILED", e.message)
        }
    }

    private fun startAccelerometer() {
        if (accelDetector?.isRunning() == true) return

        accelDetector = AccelerometerActivityDetector(ctx) { activity, confidence ->
            emitToJS(activity, confidence)
        }
        accelDetector?.start()
    }

    @ReactMethod
    fun stop(promise: Promise) {
        Log.d(TAG, "stop()")

        try {
            // Stop Google AR
            val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
                action = ActivityRecognitionService.ACTION_STOP
            }
            ctx.startService(intent)

            // Stop Accelerometer
            accelDetector?.stop()
            accelDetector = null
            wasRunningBeforeBackground = false

            ctx.getSharedPreferences("activity_recognition", 0)
                .edit()
                .putBoolean("enabled", false)
                .apply()

            promise.resolve(true)

        } catch (e: Exception) {
            promise.reject("STOP_FAILED", e.message)
        }
    }

    @ReactMethod
    fun getLast(promise: Promise) {
        try {
            val prefs = ctx.getSharedPreferences("activity_recognition", 0)

            val map = Arguments.createMap().apply {
                putString("state", prefs.getString("state", "unknown"))
                putInt("confidence", prefs.getInt("confidence", 0))
                putDouble("timestamp", prefs.getLong("timestamp", 0L).toDouble())
                putBoolean("enabled", prefs.getBoolean("enabled", false))
                putString("source", prefs.getString("source", "unknown"))
            }

            promise.resolve(map)

        } catch (e: Exception) {
            promise.reject("GET_FAILED", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}
}