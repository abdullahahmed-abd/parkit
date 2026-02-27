package com.islamicbank.newapp

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.math.sqrt
import kotlin.math.abs

class AccelerometerActivityDetector(
    private val context: Context,
    private val onActivityDetected: (String, Int) -> Unit,
    private val onError: ((String) -> Unit)? = null
) : SensorEventListener {

    companion object {
        private const val TAG = "AccelDetector"

        // Activity Constants
        const val ACTIVITY_STILL = "still"
        const val ACTIVITY_WALKING = "walking"
        const val ACTIVITY_RUNNING = "running"
        const val ACTIVITY_VEHICLE = "in_vehicle"
        const val ACTIVITY_UNKNOWN = "unknown"

        // Timing
        private const val HISTORY_SIZE = 100
        private const val ANALYZE_INTERVAL_MS = 1500L
        private const val EMIT_INTERVAL_MS = 2000L
        private const val MIN_HISTORY_FOR_ANALYSIS = 40

        // ✅ STILL Thresholds
        private const val STILL_AVG_MAX = 0.3f
        private const val STILL_VAR_MAX = 0.02f

        // ✅ WALKING Thresholds
        private const val WALKING_AVG_MIN = 0.5f
        private const val WALKING_AVG_MAX = 2.8f      // Reduced (was 4.0)
        private const val WALKING_PEAKS_MIN = 4        // Reduced (was 6)

        // ✅ RUNNING Thresholds (FIXED - Made easier to detect)
        private const val RUNNING_AVG_MIN = 2.5f       // Reduced from 4.0
        private const val RUNNING_PEAKS_MIN = 8        // Reduced from 15
        private const val RUNNING_RHYTHM_MIN = 0.2f    // Reduced from 0.4

        // ✅ Vehicle Thresholds
        private const val VEHICLE_AVG_MIN = 0.1f
        private const val VEHICLE_AVG_MAX = 3.5f
        private const val VEHICLE_VAR_MIN = 0.01f
        private const val VEHICLE_VAR_MAX = 2.0f
        private const val VEHICLE_CONSISTENCY_MIN = 0.4f
        private const val VEHICLE_CONFIRM_COUNT = 3
    }

    private val magnitudeHistory = CopyOnWriteArrayList<Float>()

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null

    @Volatile
    private var isListening = false

    private var lastActivity = ACTIVITY_UNKNOWN
    private var lastEmitTime = 0L
    private var lastAnalyzeTime = 0L
    private var gravity = floatArrayOf(0f, 0f, 0f)

    // Confidence counters
    @Volatile private var vehicleCount = 0
    @Volatile private var walkingCount = 0
    @Volatile private var runningCount = 0
    @Volatile private var stillCount = 0

    private val mainHandler = Handler(Looper.getMainLooper())

    fun start(): Boolean {
        if (isListening) {
            Log.d(TAG, "Already listening")
            return true
        }

        return try {
            sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
            accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

            if (accelerometer == null) {
                Log.e(TAG, "❌ No accelerometer!")
                onError?.invoke("No accelerometer sensor")
                return false
            }

            val registered = sensorManager?.registerListener(
                this,
                accelerometer,
                SensorManager.SENSOR_DELAY_NORMAL
            ) ?: false

            if (!registered) {
                Log.e(TAG, "❌ Failed to register listener")
                onError?.invoke("Failed to register sensor")
                return false
            }

            isListening = true
            lastEmitTime = System.currentTimeMillis()
            lastAnalyzeTime = System.currentTimeMillis()
            resetCounters()
            clearHistory()

            Log.i(TAG, "✅ Started")
            true

        } catch (e: Exception) {
            Log.e(TAG, "❌ Start failed: ${e.message}", e)
            onError?.invoke("Start failed: ${e.message}")
            false
        }
    }

    fun stop() {
        if (!isListening) return

        try {
            sensorManager?.unregisterListener(this)
            isListening = false
            clearHistory()
            resetCounters()
            Log.i(TAG, "✅ Stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Stop error: ${e.message}", e)
        }
    }

    fun isRunning(): Boolean = isListening

    fun getCurrentActivity(): String = lastActivity

    private fun clearHistory() {
        magnitudeHistory.clear()
    }

    private fun resetCounters() {
        vehicleCount = 0
        walkingCount = 0
        runningCount = 0
        stillCount = 0
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (!isListening) return
        if (event?.sensor?.type != Sensor.TYPE_ACCELEROMETER) return

        try {
            processAccelerometerData(event)
        } catch (e: Exception) {
            Log.e(TAG, "Sensor error: ${e.message}")
        }
    }

    private fun processAccelerometerData(event: SensorEvent) {
        val alpha = 0.8f
        gravity[0] = alpha * gravity[0] + (1 - alpha) * event.values[0]
        gravity[1] = alpha * gravity[1] + (1 - alpha) * event.values[1]
        gravity[2] = alpha * gravity[2] + (1 - alpha) * event.values[2]

        val x = event.values[0] - gravity[0]
        val y = event.values[1] - gravity[1]
        val z = event.values[2] - gravity[2]

        val magnitude = sqrt(x * x + y * y + z * z)
        magnitudeHistory.add(magnitude)

        while (magnitudeHistory.size > HISTORY_SIZE) {
            magnitudeHistory.removeAt(0)
        }

        val currentTime = System.currentTimeMillis()
        if (currentTime - lastAnalyzeTime < ANALYZE_INTERVAL_MS) return
        lastAnalyzeTime = currentTime

        if (magnitudeHistory.size < MIN_HISTORY_FOR_ANALYSIS) return

        analyzeAndEmit()
    }

    private fun analyzeAndEmit() {
        try {
            val historySnapshot = magnitudeHistory.toList()
            if (historySnapshot.size < MIN_HISTORY_FOR_ANALYSIS) return

            val avg = historySnapshot.average().toFloat()
            val max = historySnapshot.maxOrNull() ?: 0f
            val variance = historySnapshot.map { (it - avg) * (it - avg) }.average().toFloat()
            val stepPeaks = countStepPeaks(historySnapshot)
            val consistency = calculateMovementConsistency(historySnapshot)
            val rhythmRegularity = calculateRhythmRegularity(historySnapshot)
            val isVehicleVibration = checkVehicleVibration(avg, variance, consistency, stepPeaks)

            Log.d(TAG, "avg=${"%.2f".format(avg)} max=${"%.2f".format(max)} " +
                    "var=${"%.3f".format(variance)} peaks=$stepPeaks " +
                    "rhythm=${"%.2f".format(rhythmRegularity)} vehicle=$isVehicleVibration")

            val (activity, confidence) = detectActivity(
                avg, max, variance, stepPeaks, consistency, rhythmRegularity, isVehicleVibration
            )

            emitIfNeeded(activity, confidence)

        } catch (e: Exception) {
            Log.e(TAG, "Analysis error: ${e.message}", e)
        }
    }

    private fun emitIfNeeded(activity: String, confidence: Int) {
        val currentTime = System.currentTimeMillis()
        val activityChanged = activity != lastActivity
        val intervalPassed = currentTime - lastEmitTime > EMIT_INTERVAL_MS

        if ((activityChanged || intervalPassed) && activity.isNotEmpty()) {
            if (activityChanged) {
                Log.i(TAG, "🏃 $lastActivity → $activity ($confidence%)")
            }
            lastActivity = activity
            lastEmitTime = currentTime

            mainHandler.post {
                try {
                    onActivityDetected(activity, confidence)
                } catch (e: Exception) {
                    Log.e(TAG, "Callback error: ${e.message}")
                }
            }
        }
    }

    private fun countStepPeaks(history: List<Float>): Int {
        if (history.size < 5) return 0

        var peaks = 0
        for (i in 2 until history.size - 2) {
            val curr = history[i]
            if (curr > history[i - 1] && curr > history[i + 1] &&
                curr > history[i - 2] && curr > history[i + 2] &&
                curr > 0.6f && curr < 10.0f  // ✅ Adjusted range
            ) {
                peaks++
            }
        }
        return peaks
    }

    private fun detectActivity(
        avg: Float,
        max: Float,
        variance: Float,
        stepPeaks: Int,
        consistency: Float,
        rhythmRegularity: Float,
        isVehicleVibration: Boolean
    ): Pair<String, Int> {

        return when {
            // ✅ STILL: Very low movement
            avg < STILL_AVG_MAX && variance < STILL_VAR_MAX -> {
                resetCounters()
                stillCount++
                ACTIVITY_STILL to 95
            }

            // ✅ RUNNING: High movement OR high peaks with some rhythm
            // Multiple conditions to catch running
            (avg > RUNNING_AVG_MIN && stepPeaks > RUNNING_PEAKS_MIN) ||
            (avg > 3.0f && max > 5.0f && stepPeaks > 6) ||
            (avg > 2.5f && stepPeaks > 10 && rhythmRegularity > RUNNING_RHYTHM_MIN) -> {
                runningCount++
                walkingCount = 0
                vehicleCount = 0
                stillCount = 0
                
                if (runningCount >= 2) {
                    ACTIVITY_RUNNING to 88
                } else {
                    ACTIVITY_RUNNING to 75
                }
            }

            // ✅ WALKING: Moderate movement with step pattern
            avg in WALKING_AVG_MIN..WALKING_AVG_MAX &&
                    stepPeaks > WALKING_PEAKS_MIN &&
                    rhythmRegularity > 0.15f -> {
                walkingCount++
                runningCount = 0
                vehicleCount = 0
                stillCount = 0
                ACTIVITY_WALKING to 90
            }

            // ✅ IN_VEHICLE: Vibration pattern
            isVehicleVibration -> {
                vehicleCount++
                walkingCount = 0
                runningCount = 0
                stillCount = 0

                if (vehicleCount >= VEHICLE_CONFIRM_COUNT) {
                    ACTIVITY_VEHICLE to 85
                } else {
                    lastActivity to 60
                }
            }

            // ✅ Fast walking (could be light running)
            avg > 2.0f && avg < 3.5f && stepPeaks > 5 -> {
                // Check if it's more like running
                if (max > 4.0f || stepPeaks > 8) {
                    runningCount++
                    if (runningCount >= 2) {
                        ACTIVITY_RUNNING to 75
                    } else {
                        ACTIVITY_WALKING to 70
                    }
                } else {
                    walkingCount++
                    ACTIVITY_WALKING to 80
                }
            }

            // ✅ Light walking
            avg > 0.4f && avg < 2.5f && stepPeaks > 2 -> {
                walkingCount++
                vehicleCount = 0
                runningCount = 0
                ACTIVITY_WALKING to 75
            }

            // ✅ Low movement - could be vehicle
            avg in 0.2f..1.5f && consistency > 0.4f && stepPeaks < 4 -> {
                vehicleCount++
                if (vehicleCount >= 4) {
                    ACTIVITY_VEHICLE to 70
                } else {
                    ACTIVITY_STILL to 65
                }
            }

            // ✅ Default Still
            avg < 0.5f -> {
                stillCount++
                vehicleCount = 0
                runningCount = 0
                ACTIVITY_STILL to 80
            }

            // ✅ Default Walking
            else -> {
                walkingCount++
                vehicleCount = 0
                runningCount = 0
                ACTIVITY_WALKING to 65
            }
        }
    }

    private fun checkVehicleVibration(
        avg: Float,
        variance: Float,
        consistency: Float,
        stepPeaks: Int
    ): Boolean {
        val inAvgRange = avg in VEHICLE_AVG_MIN..VEHICLE_AVG_MAX
        val inVarRange = variance in VEHICLE_VAR_MIN..VEHICLE_VAR_MAX
        val lowStepPeaks = stepPeaks < 6
        val highConsistency = consistency > VEHICLE_CONSISTENCY_MIN

        // Bike/Activa
        val isBikePattern = avg in 0.5f..3.5f &&
                variance in 0.1f..2.0f &&
                consistency > 0.4f &&
                stepPeaks < 8

        // Car
        val isCarPattern = avg in 0.1f..1.5f &&
                variance in 0.01f..0.5f &&
                consistency > 0.5f &&
                stepPeaks < 5

        return (inAvgRange && inVarRange && lowStepPeaks && highConsistency) ||
                isBikePattern ||
                isCarPattern
    }

    private fun calculateMovementConsistency(history: List<Float>): Float {
        if (history.size < 20) return 0f

        val recentReadings = history.takeLast(40)
        val avg = recentReadings.average().toFloat()

        if (avg < 0.1f) return 0f

        val consistentCount = recentReadings.count {
            it in (avg * 0.5f)..(avg * 1.5f)
        }

        return consistentCount.toFloat() / recentReadings.size
    }

    private fun calculateRhythmRegularity(history: List<Float>): Float {
        if (history.size < 30) return 0f

        val peaks = mutableListOf<Int>()
        for (i in 1 until history.size - 1) {
            if (history[i] > history[i - 1] &&
                history[i] > history[i + 1] &&
                history[i] > 0.4f
            ) {
                peaks.add(i)
            }
        }

        if (peaks.size < 3) return 0f

        val intervals = mutableListOf<Int>()
        for (i in 1 until peaks.size) {
            intervals.add(peaks[i] - peaks[i - 1])
        }

        if (intervals.isEmpty()) return 0f

        val avgInterval = intervals.average()
        val regularCount = intervals.count {
            abs(it - avgInterval) < avgInterval * 0.5
        }

        return regularCount.toFloat() / intervals.size
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        Log.d(TAG, "Accuracy: $accuracy")
    }
}