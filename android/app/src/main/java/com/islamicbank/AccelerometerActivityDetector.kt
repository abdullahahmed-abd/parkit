package com.parkit.newapp

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

        // ✅ INCREASED Timing for stability
        private const val HISTORY_SIZE = 150
        private const val ANALYZE_INTERVAL_MS = 2000L      // Was 1500
        private const val EMIT_INTERVAL_MS = 3000L         // Was 2000
        private const val MIN_HISTORY_FOR_ANALYSIS = 60    // Was 40

        // ✅ STILL Thresholds (more lenient for shake tolerance)
        private const val STILL_AVG_MAX = 0.4f             // Was 0.3
        private const val STILL_VAR_MAX = 0.05f            // Was 0.02

        // ✅ WALKING Thresholds (require sustained movement)
        private const val WALKING_AVG_MIN = 0.6f           // Was 0.5
        private const val WALKING_AVG_MAX = 3.0f           // Was 2.8
        private const val WALKING_PEAKS_MIN = 6            // Was 4
        private const val WALKING_RHYTHM_MIN = 0.3f        // NEW: Require rhythm

        // ✅ RUNNING Thresholds
        private const val RUNNING_AVG_MIN = 3.0f           // Increased from 2.5
        private const val RUNNING_PEAKS_MIN = 10           // Increased from 8
        private const val RUNNING_RHYTHM_MIN = 0.4f        // High rhythm required

        // ✅ Vehicle Thresholds (Better detection)
        private const val VEHICLE_AVG_MIN = 0.15f
        private const val VEHICLE_AVG_MAX = 4.0f           // Increased for motorcycle
        private const val VEHICLE_VAR_MIN = 0.01f
        private const val VEHICLE_VAR_MAX = 3.0f           // Increased for motorcycle
        private const val VEHICLE_RHYTHM_MAX = 0.35f       // LOW rhythm = vehicle
        private const val VEHICLE_CONSISTENCY_MIN = 0.35f

        // ✅ Confirmation counts (prevent quick changes)
        private const val ACTIVITY_CONFIRM_COUNT = 3       // Need 3 consecutive
        private const val VEHICLE_CONFIRM_COUNT = 2
        private const val STILL_CONFIRM_COUNT = 2
    }

    private val magnitudeHistory = CopyOnWriteArrayList<Float>()
    private val timestampHistory = CopyOnWriteArrayList<Long>()

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null

    @Volatile
    private var isListening = false

    private var lastActivity = ACTIVITY_UNKNOWN
    private var pendingActivity = ACTIVITY_UNKNOWN
    private var pendingActivityCount = 0
    private var lastEmitTime = 0L
    private var lastAnalyzeTime = 0L
    private var gravity = floatArrayOf(0f, 0f, 0f)
    
    // Movement tracking
    private var movementStartTime = 0L
    private var lastSignificantMovementTime = 0L

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
                SensorManager.SENSOR_DELAY_GAME  // ✅ Faster sampling for better analysis
            ) ?: false

            if (!registered) {
                Log.e(TAG, "❌ Failed to register listener")
                onError?.invoke("Failed to register sensor")
                return false
            }

            isListening = true
            lastEmitTime = System.currentTimeMillis()
            lastAnalyzeTime = System.currentTimeMillis()
            movementStartTime = 0L
            pendingActivity = ACTIVITY_UNKNOWN
            pendingActivityCount = 0
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
            Log.i(TAG, "✅ Stopped")
        } catch (e: Exception) {
            Log.e(TAG, "Stop error: ${e.message}", e)
        }
    }

    fun isRunning(): Boolean = isListening

    fun getCurrentActivity(): String = lastActivity

    private fun clearHistory() {
        magnitudeHistory.clear()
        timestampHistory.clear()
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
        val currentTime = System.currentTimeMillis()
        
        magnitudeHistory.add(magnitude)
        timestampHistory.add(currentTime)

        // Track significant movement
        if (magnitude > 0.5f) {
            if (movementStartTime == 0L) {
                movementStartTime = currentTime
            }
            lastSignificantMovementTime = currentTime
        } else if (currentTime - lastSignificantMovementTime > 1000) {
            // Reset if no significant movement for 1 second
            movementStartTime = 0L
        }

        while (magnitudeHistory.size > HISTORY_SIZE) {
            magnitudeHistory.removeAt(0)
            timestampHistory.removeAt(0)
        }

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
            
            // ✅ NEW: Calculate movement duration
            val movementDurationMs = if (movementStartTime > 0) {
                System.currentTimeMillis() - movementStartTime
            } else 0L
            
            // ✅ NEW: Detect if it's a shake (short burst)
            val isShake = detectShake(historySnapshot, movementDurationMs)

            Log.d(TAG, "avg=${"%.2f".format(avg)} max=${"%.2f".format(max)} " +
                    "var=${"%.3f".format(variance)} peaks=$stepPeaks " +
                    "rhythm=${"%.2f".format(rhythmRegularity)} " +
                    "duration=${movementDurationMs}ms shake=$isShake")

            val (activity, confidence) = detectActivity(
                avg, max, variance, stepPeaks, consistency, 
                rhythmRegularity, movementDurationMs, isShake
            )

            // ✅ Confirmation system - require consecutive detections
            if (activity == pendingActivity) {
                pendingActivityCount++
            } else {
                pendingActivity = activity
                pendingActivityCount = 1
            }

            val requiredCount = when (activity) {
                ACTIVITY_STILL -> STILL_CONFIRM_COUNT
                ACTIVITY_VEHICLE -> VEHICLE_CONFIRM_COUNT
                else -> ACTIVITY_CONFIRM_COUNT
            }

            if (pendingActivityCount >= requiredCount) {
                emitIfNeeded(activity, confidence)
            } else {
                Log.d(TAG, "⏳ Waiting for confirmation: $activity ($pendingActivityCount/$requiredCount)")
            }

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

    // ✅ NEW: Detect shake pattern
    private fun detectShake(history: List<Float>, movementDurationMs: Long): Boolean {
        if (history.size < 20) return false
        
        val recent = history.takeLast(20)
        val avg = recent.average().toFloat()
        val max = recent.maxOrNull() ?: 0f
        
        // Shake = high movement but short duration (< 2 seconds)
        // and high variance (erratic movement)
        val variance = recent.map { (it - avg) * (it - avg) }.average().toFloat()
        
        return max > 2.0f && 
               movementDurationMs < 2000 && 
               variance > 0.5f &&
               movementDurationMs > 0
    }

    private fun countStepPeaks(history: List<Float>): Int {
        if (history.size < 5) return 0

        var peaks = 0
        for (i in 2 until history.size - 2) {
            val curr = history[i]
            if (curr > history[i - 1] && curr > history[i + 1] &&
                curr > history[i - 2] && curr > history[i + 2] &&
                curr > 0.8f && curr < 12.0f  // ✅ Adjusted range
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
        movementDurationMs: Long,
        isShake: Boolean
    ): Pair<String, Int> {

        // ✅ SHAKE PROTECTION: If it's just a shake, stay still
        if (isShake && lastActivity == ACTIVITY_STILL) {
            Log.d(TAG, "🛡️ Shake detected, staying STILL")
            return ACTIVITY_STILL to 85
        }

        // ✅ Require minimum sustained movement for walking/running
        val sustainedMovement = movementDurationMs > 3000  // 3 seconds

        return when {
            
            // ═══════════════════════════════════════════════════════════
            // 1. STILL: Very low movement
            // ═══════════════════════════════════════════════════════════
            avg < STILL_AVG_MAX && variance < STILL_VAR_MAX -> {
                ACTIVITY_STILL to 95
            }

            // ═══════════════════════════════════════════════════════════
            // 2. VEHICLE: Check BEFORE running!
            //    - Has movement but LOW rhythm (not step pattern)
            //    - Consistent vibration
            // ═══════════════════════════════════════════════════════════
            isVehiclePattern(avg, variance, consistency, rhythmRegularity, stepPeaks) -> {
                Log.d(TAG, "🚗 Vehicle pattern detected")
                ACTIVITY_VEHICLE to 88
            }

            // ═══════════════════════════════════════════════════════════
            // 3. RUNNING: High movement WITH rhythm AND sustained
            // ═══════════════════════════════════════════════════════════
            sustainedMovement &&
            avg > RUNNING_AVG_MIN && 
            stepPeaks > RUNNING_PEAKS_MIN && 
            rhythmRegularity > RUNNING_RHYTHM_MIN -> {
                ACTIVITY_RUNNING to 90
            }

            // Alternative running detection
            sustainedMovement &&
            avg > 3.5f && max > 6.0f && stepPeaks > 8 && rhythmRegularity > 0.3f -> {
                ACTIVITY_RUNNING to 85
            }

            // ═══════════════════════════════════════════════════════════
            // 4. WALKING: Moderate movement with step rhythm
            // ═══════════════════════════════════════════════════════════
            sustainedMovement &&
            avg in WALKING_AVG_MIN..WALKING_AVG_MAX &&
            stepPeaks > WALKING_PEAKS_MIN &&
            rhythmRegularity > WALKING_RHYTHM_MIN -> {
                ACTIVITY_WALKING to 90
            }

            // Light walking (less strict)
            sustainedMovement &&
            avg > 0.5f && avg < 2.5f && 
            stepPeaks > 4 && 
            rhythmRegularity > 0.2f -> {
                ACTIVITY_WALKING to 80
            }

            // ═══════════════════════════════════════════════════════════
            // 5. Movement detected but not sustained - stay current or still
            // ═══════════════════════════════════════════════════════════
            avg > 0.5f && !sustainedMovement -> {
                Log.d(TAG, "⏳ Movement not sustained yet")
                if (lastActivity != ACTIVITY_UNKNOWN) {
                    lastActivity to 70
                } else {
                    ACTIVITY_STILL to 60
                }
            }

            // ═══════════════════════════════════════════════════════════
            // 6. Default to Still
            // ═══════════════════════════════════════════════════════════
            avg < 0.6f -> {
                ACTIVITY_STILL to 80
            }

            // Fallback
            else -> {
                if (lastActivity != ACTIVITY_UNKNOWN) {
                    lastActivity to 65
                } else {
                    ACTIVITY_STILL to 60
                }
            }
        }
    }

    // ✅ NEW: Better vehicle detection
    private fun isVehiclePattern(
        avg: Float,
        variance: Float,
        consistency: Float,
        rhythmRegularity: Float,
        stepPeaks: Int
    ): Boolean {
        
        // Vehicle characteristics:
        // - Has some movement (vibration)
        // - LOW rhythm regularity (not step pattern)
        // - Relatively consistent vibration
        // - Few distinct "step" peaks
        
        val hasMovement = avg > VEHICLE_AVG_MIN
        val notTooMuchMovement = avg < VEHICLE_AVG_MAX
        val lowRhythm = rhythmRegularity < VEHICLE_RHYTHM_MAX  // KEY: Low rhythm
        val isConsistent = consistency > VEHICLE_CONSISTENCY_MIN
        val fewStepPeaks = stepPeaks < 8  // Not step-like
        
        // ✅ Car pattern: Low-moderate vibration, very low rhythm
        val isCarPattern = avg in 0.15f..2.0f &&
                variance in 0.01f..1.0f &&
                rhythmRegularity < 0.25f &&
                consistency > 0.4f &&
                stepPeaks < 6

        // ✅ Motorcycle/Bike pattern: Higher vibration, still low rhythm
        val isBikePattern = avg in 0.5f..4.0f &&
                variance in 0.1f..3.0f &&
                rhythmRegularity < 0.35f &&  // KEY: Not rhythmic like running
                consistency > 0.3f &&
                stepPeaks < 10

        // ✅ General vehicle: Movement + low rhythm + consistency
        val isGeneralVehicle = hasMovement && 
                notTooMuchMovement && 
                lowRhythm && 
                isConsistent && 
                fewStepPeaks

        val result = isCarPattern || isBikePattern || isGeneralVehicle
        
        if (result) {
            Log.d(TAG, "🚗 Vehicle: car=$isCarPattern bike=$isBikePattern " +
                    "general=$isGeneralVehicle rhythm=${"%.2f".format(rhythmRegularity)}")
        }
        
        return result
    }

    private fun calculateMovementConsistency(history: List<Float>): Float {
        if (history.size < 20) return 0f

        val recentReadings = history.takeLast(50)
        val avg = recentReadings.average().toFloat()

        if (avg < 0.1f) return 0f

        val consistentCount = recentReadings.count {
            it in (avg * 0.4f)..(avg * 1.6f)
        }

        return consistentCount.toFloat() / recentReadings.size
    }

    private fun calculateRhythmRegularity(history: List<Float>): Float {
        if (history.size < 30) return 0f

        val peaks = mutableListOf<Int>()
        for (i in 2 until history.size - 2) {
            if (history[i] > history[i - 1] &&
                history[i] > history[i + 1] &&
                history[i] > history[i - 2] &&
                history[i] > history[i + 2] &&
                history[i] > 0.5f
            ) {
                peaks.add(i)
            }
        }

        if (peaks.size < 4) return 0f

        val intervals = mutableListOf<Int>()
        for (i in 1 until peaks.size) {
            intervals.add(peaks[i] - peaks[i - 1])
        }

        if (intervals.isEmpty()) return 0f

        val avgInterval = intervals.average()
        val regularCount = intervals.count {
            abs(it - avgInterval) < avgInterval * 0.4  // 40% tolerance
        }

        return regularCount.toFloat() / intervals.size
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        Log.d(TAG, "Accuracy: $accuracy")
    }
}