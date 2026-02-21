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
    ReactContextBaseJavaModule(ctx) {

    companion object {
        private const val TAG = "ARModule"
    }

    private var accelDetector: AccelerometerActivityDetector? = null

    override fun getName(): String = "ActivityRecognitionModule"

    private fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.ACTIVITY_RECOGNITION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun emitToJS(activity: String, confidence: Int, source: String = "accelerometer") {
        try {
            if (!ctx.hasActiveCatalystInstance()) {
                Log.w(TAG, "No active catalyst instance")
                return
            }

            val ts = System.currentTimeMillis()

            // Save to SharedPrefs
            ctx.getSharedPreferences("activity_recognition", 0)
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
                .emit("ActivityRecognition", payload)

            Log.i(TAG, "📡 Emitted: $activity $confidence% ($source)")

        } catch (e: Exception) {
            Log.e(TAG, "emitToJS error: ${e.message}")
        }
    }

    @ReactMethod
    fun start(intervalMs: Int, promise: Promise) {
        Log.d(TAG, "start() intervalMs=$intervalMs")

        try {
            // 1. Start Google AR Service (background)
            if (hasPermission()) {
                val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
                    action = ActivityRecognitionService.ACTION_START
                    putExtra(ActivityRecognitionService.EXTRA_INTERVAL_MS, intervalMs)
                }
                ContextCompat.startForegroundService(ctx, intent)
                Log.i(TAG, "✅ Google AR Service started")
            }

            // 2. Start Accelerometer (main detection)
            startAccelerometer()

            // 3. Save state
            ctx.getSharedPreferences("activity_recognition", 0)
                .edit()
                .putBoolean("enabled", true)
                .putInt("intervalMs", intervalMs)
                .putLong("startedAt", System.currentTimeMillis())
                .apply()

            Log.i(TAG, "✅ start() complete")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "start() failed", e)
            promise.reject("START_FAILED", e.message)
        }
    }

    private fun startAccelerometer() {
        if (accelDetector != null) {
            Log.d(TAG, "Accelerometer already running")
            return
        }

        Log.i(TAG, "🚀 Starting Accelerometer detector...")

        accelDetector = AccelerometerActivityDetector(ctx) { activity, confidence ->
            emitToJS(activity, confidence, "accelerometer")
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

            // Clear state
            ctx.getSharedPreferences("activity_recognition", 0)
                .edit()
                .putBoolean("enabled", false)
                .apply()

            Log.i(TAG, "✅ stop() complete")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "stop() failed", e)
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
                putInt("intervalMs", prefs.getInt("intervalMs", 5000))
                putDouble("startedAt", prefs.getLong("startedAt", 0L).toDouble())
                putString("source", prefs.getString("source", "unknown"))
            }

            Log.d(TAG, "getLast: state=${prefs.getString("state", "unknown")}")
            promise.resolve(map)

        } catch (e: Exception) {
            Log.e(TAG, "getLast() failed", e)
            promise.reject("GET_FAILED", e.message)
        }
    }

    @ReactMethod
    fun simulateActivity(state: String, confidence: Int, promise: Promise) {
        Log.d(TAG, "simulateActivity: $state $confidence%")

        try {
            emitToJS(state, confidence, "simulated")
            Log.i(TAG, "✅ Simulated: $state $confidence%")
            promise.resolve(true)

        } catch (e: Exception) {
            Log.e(TAG, "simulateActivity error", e)
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun getDebugInfo(promise: Promise) {
        try {
            val prefs = ctx.getSharedPreferences("activity_recognition", 0)

            val map = Arguments.createMap().apply {
                putString("state", prefs.getString("state", "unknown"))
                putInt("confidence", prefs.getInt("confidence", 0))
                putBoolean("enabled", prefs.getBoolean("enabled", false))
                putString("source", prefs.getString("source", "unknown"))
                putBoolean("hasPermission", hasPermission())
                putInt("androidVersion", Build.VERSION.SDK_INT)
                putString("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                putBoolean("accelRunning", accelDetector?.isRunning() == true)
            }

            promise.resolve(map)

        } catch (e: Exception) {
            promise.reject("ERROR", e.message)
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {
        Log.d(TAG, "addListener: $eventName")
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        Log.d(TAG, "removeListeners: $count")
    }
}