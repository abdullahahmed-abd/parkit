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
    }

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var isListening = false

    private val magnitudeHistory = mutableListOf<Float>()
    private var lastActivity = "unknown"
    private var lastEmitTime = 0L
    private var lastAnalyzeTime = 0L
    private var gravity = floatArrayOf(0f, 0f, 0f)

    fun start() {
        if (isListening) {
            Log.d(TAG, "Already listening")
            return
        }

        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        if (accelerometer == null) {
            Log.e(TAG, "❌ No accelerometer sensor found!")
            return
        }

        sensorManager?.registerListener(
            this,
            accelerometer,
            SensorManager.SENSOR_DELAY_GAME
        )

        isListening = true
        lastEmitTime = System.currentTimeMillis()
        lastAnalyzeTime = System.currentTimeMillis()
        Log.i(TAG, "✅ Accelerometer started")
    }

    fun stop() {
        if (!isListening) return

        sensorManager?.unregisterListener(this)
        isListening = false
        magnitudeHistory.clear()
        Log.i(TAG, "Accelerometer stopped")
    }

    fun isRunning(): Boolean = isListening

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return

        // Low-pass filter to remove gravity
        val alpha = 0.8f
        gravity[0] = alpha * gravity[0] + (1 - alpha) * event.values[0]
        gravity[1] = alpha * gravity[1] + (1 - alpha) * event.values[1]
        gravity[2] = alpha * gravity[2] + (1 - alpha) * event.values[2]

        // Linear acceleration (without gravity)
        val x = event.values[0] - gravity[0]
        val y = event.values[1] - gravity[1]
        val z = event.values[2] - gravity[2]

        val magnitude = sqrt(x * x + y * y + z * z)
        magnitudeHistory.add(magnitude)

        // Keep last 100 readings (~2 seconds)
        if (magnitudeHistory.size > 100) {
            magnitudeHistory.removeAt(0)
        }

        // Analyze every 1 second
        val currentTime = System.currentTimeMillis()
        if (currentTime - lastAnalyzeTime < 1000) return
        lastAnalyzeTime = currentTime

        if (magnitudeHistory.size < 50) return

        analyzeAndEmit()
    }

    private fun analyzeAndEmit() {
        val avg = magnitudeHistory.average().toFloat()
        val max = magnitudeHistory.maxOrNull() ?: 0f
        val min = magnitudeHistory.minOrNull() ?: 0f
        val range = max - min

        // Count peaks (steps)
        var peaks = 0
        for (i in 1 until magnitudeHistory.size - 1) {
            if (magnitudeHistory[i] > magnitudeHistory[i - 1] &&
                magnitudeHistory[i] > magnitudeHistory[i + 1] &&
                magnitudeHistory[i] > 1.0f
            ) {
                peaks++
            }
        }

        Log.d(TAG, "avg=${"%.2f".format(avg)} max=${"%.2f".format(max)} range=${"%.2f".format(range)} peaks=$peaks")

        val (activity, confidence) = when {
            // Still: very low movement
            avg < 0.3f && range < 0.5f -> "still" to 95

            // Running: high acceleration, many peaks
            avg > 4.0f || (peaks > 15 && avg > 2.0f) -> "running" to 85

            // Walking: moderate acceleration, regular peaks
            avg > 0.8f && peaks > 5 -> "walking" to 90

            // Walking: medium movement
            avg > 0.5f && range > 1.0f -> "walking" to 75

            // In vehicle: low but consistent movement (vibration)
            avg < 0.8f && avg > 0.2f && range < 2.0f -> "in_vehicle" to 70

            // Default to still if very low
            avg < 0.5f -> "still" to 80

            // Default walking for other cases
            else -> "walking" to 65
        }

        // Only emit if activity changed OR every 5 seconds
        val currentTime = System.currentTimeMillis()
        val timeSinceLastEmit = currentTime - lastEmitTime
        val shouldEmit = activity != lastActivity || timeSinceLastEmit > 5000

        if (shouldEmit) {
            Log.i(TAG, "🏃 Activity: $lastActivity → $activity ($confidence%)")
            lastActivity = activity
            lastEmitTime = currentTime
            onActivityDetected(activity, confidence)
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        Log.d(TAG, "Accuracy changed: $accuracy")
    }
}