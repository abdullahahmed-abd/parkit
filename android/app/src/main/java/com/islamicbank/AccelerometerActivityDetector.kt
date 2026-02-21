package com.islamicbank.newapp

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.util.Log
import kotlin.math.sqrt

class AccelerometerActivityDetector(
    private val context: Context,
    private val onActivityDetected: (String, Int) -> Unit
) : SensorEventListener {

    companion object {
        private const val TAG = "AccelDetector"
        
        // ✅ Constants - Easy to modify
        private const val HISTORY_SIZE = 100
        private const val ANALYZE_INTERVAL_MS = 2000L  // 2 seconds (battery save)
        private const val EMIT_INTERVAL_MS = 3000L    // 3 seconds
        
        // Activity thresholds
        private const val STILL_AVG_MAX = 0.3f
        private const val STILL_VAR_MAX = 0.02f
        private const val WALKING_AVG_MIN = 0.5f
        private const val WALKING_PEAKS_MIN = 5
        private const val RUNNING_AVG_MIN = 3.5f
        private const val RUNNING_PEAKS_MIN = 12
        private const val VEHICLE_AVG_MIN = 0.15f
        private const val VEHICLE_AVG_MAX = 1.2f
        private const val VEHICLE_VAR_MIN = 0.02f
        private const val VEHICLE_VAR_MAX = 0.8f
    }

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var isListening = false

    private val magnitudeHistory = mutableListOf<Float>()
    private var lastActivity = "unknown"
    private var lastEmitTime = 0L
    private var lastAnalyzeTime = 0L
    private var gravity = floatArrayOf(0f, 0f, 0f)
    private var vehiclePatternCount = 0

    fun start() {
        if (isListening) {
            Log.d(TAG, "Already listening")
            return
        }

        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer == null) {
            Log.e(TAG, "❌ No accelerometer sensor!")
            return
        }

        // ✅ SENSOR_DELAY_NORMAL for battery efficiency
        sensorManager?.registerListener(
            this,
            accelerometer,
            SensorManager.SENSOR_DELAY_NORMAL
        )

        isListening = true
        lastEmitTime = System.currentTimeMillis()
        lastAnalyzeTime = System.currentTimeMillis()
        vehiclePatternCount = 0
        Log.i(TAG, "✅ Accelerometer started (NORMAL delay)")
    }

    fun stop() {
        if (!isListening) return

        sensorManager?.unregisterListener(this)
        isListening = false
        magnitudeHistory.clear()
        vehiclePatternCount = 0
        Log.i(TAG, "✅ Accelerometer stopped")
    }

    fun isRunning(): Boolean = isListening

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return

        // Low-pass filter for gravity
        val alpha = 0.8f
        gravity[0] = alpha * gravity[0] + (1 - alpha) * event.values[0]
        gravity[1] = alpha * gravity[1] + (1 - alpha) * event.values[1]
        gravity[2] = alpha * gravity[2] + (1 - alpha) * event.values[2]

        // Linear acceleration
        val x = event.values[0] - gravity[0]
        val y = event.values[1] - gravity[1]
        val z = event.values[2] - gravity[2]

        val magnitude = sqrt(x * x + y * y + z * z)
        magnitudeHistory.add(magnitude)

        // Keep limited history
        if (magnitudeHistory.size > HISTORY_SIZE) {
            magnitudeHistory.removeAt(0)
        }

        // Analyze at interval
        val currentTime = System.currentTimeMillis()
        if (currentTime - lastAnalyzeTime < ANALYZE_INTERVAL_MS) return
        lastAnalyzeTime = currentTime

        if (magnitudeHistory.size < 30) return

        analyzeAndEmit()
    }

    private fun analyzeAndEmit() {
        val avg = magnitudeHistory.average().toFloat()
        val variance = magnitudeHistory.map { (it - avg) * (it - avg) }.average().toFloat()

        // Count peaks
        var peaks = 0
        for (i in 1 until magnitudeHistory.size - 1) {
            if (magnitudeHistory[i] > magnitudeHistory[i - 1] &&
                magnitudeHistory[i] > magnitudeHistory[i + 1] &&
                magnitudeHistory[i] > 0.8f
            ) {
                peaks++
            }
        }

        // Vehicle pattern check
        val isVehiclePattern = avg in VEHICLE_AVG_MIN..VEHICLE_AVG_MAX &&
                               variance in VEHICLE_VAR_MIN..VEHICLE_VAR_MAX &&
                               peaks < 8

        // Determine activity
        val (activity, confidence) = when {
            // STILL
            avg < STILL_AVG_MAX && variance < STILL_VAR_MAX -> {
                vehiclePatternCount = 0
                "still" to 95
            }

            // RUNNING
            avg > RUNNING_AVG_MIN || peaks > RUNNING_PEAKS_MIN -> {
                vehiclePatternCount = 0
                "running" to 88
            }

            // WALKING
            peaks > WALKING_PEAKS_MIN && avg > WALKING_AVG_MIN -> {
                vehiclePatternCount = 0
                "walking" to 90
            }

            // IN_VEHICLE
            isVehiclePattern -> {
                vehiclePatternCount++
                if (vehiclePatternCount >= 3) {
                    "in_vehicle" to 85
                } else {
                    lastActivity to 60
                }
            }

            // Default WALKING
            avg > 0.4f -> {
                vehiclePatternCount = 0
                "walking" to 70
            }

            // Default STILL
            else -> {
                "still" to 75
            }
        }

        // Emit if changed or interval passed
        val currentTime = System.currentTimeMillis()
        val shouldEmit = activity != lastActivity || 
                         (currentTime - lastEmitTime > EMIT_INTERVAL_MS)

        if (shouldEmit && activity.isNotEmpty()) {
            if (activity != lastActivity) {
                Log.i(TAG, "🏃 $lastActivity → $activity ($confidence%)")
            }
            lastActivity = activity
            lastEmitTime = currentTime
            onActivityDetected(activity, confidence)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}