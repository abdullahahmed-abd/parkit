package com.parkit.newapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

class ActivityRecognitionReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "ARReceiver"
        private const val MIN_CONFIDENCE = 20
    }

    override fun onReceive(context: Context, intent: Intent?) {
        // ✅ Null safety for Android 16
        if (intent == null) {
            Log.w(TAG, "⚠️ onReceive: intent is null!")
            return
        }

        Log.d(TAG, "🔔 onReceive() action=${intent.action}")
        Log.d(TAG, "🔔 Intent extras: ${intent.extras?.keySet()?.joinToString()}")

        try {
            // ✅ Try Activity Recognition Result
            if (ActivityRecognitionResult.hasResult(intent)) {
                Log.i(TAG, "📊 Found ActivityRecognitionResult")
                handleActivityResult(context, intent)
                return
            }

            // ✅ Try Activity Transition Result
            if (ActivityTransitionResult.hasResult(intent)) {
                Log.i(TAG, "🔄 Found ActivityTransitionResult")
                handleTransitionResult(context, intent)
                return
            }

            Log.w(TAG, "⚠️ No AR result in intent")

        } catch (e: Exception) {
            Log.e(TAG, "❌ onReceive error: ${e.message}", e)
        }
    }

    private fun handleActivityResult(context: Context, intent: Intent) {
        try {
            val result = ActivityRecognitionResult.extractResult(intent)
            if (result == null) {
                Log.e(TAG, "extractResult returned null")
                return
            }

            val activities = result.probableActivities ?: emptyList()
            Log.d(TAG, "Activities count: ${activities.size}")

            if (activities.isEmpty()) {
                Log.w(TAG, "No activities detected")
                return
            }

            // Log all activities
            activities.sortedByDescending { it.confidence }.forEach {
                Log.d(TAG, "  → ${mapType(it.type)}: ${it.confidence}%")
            }

            val chosen = chooseBest(activities)
            val state = mapType(chosen?.type ?: DetectedActivity.UNKNOWN)
            val confidence = chosen?.confidence ?: 0

            Log.i(TAG, "✅ Chosen: $state ($confidence%)")

            saveAndEmit(context, state, confidence, activities)

        } catch (e: Exception) {
            Log.e(TAG, "handleActivityResult error", e)
        }
    }

    private fun handleTransitionResult(context: Context, intent: Intent) {
        try {
            val result = ActivityTransitionResult.extractResult(intent)
            if (result == null) {
                Log.e(TAG, "extractTransitionResult null")
                return
            }

            for (event in result.transitionEvents) {
                val type = event.activityType
                val transition = if (event.transitionType == 0) "ENTER" else "EXIT"

                Log.i(TAG, "🔄 Transition: ${mapType(type)} → $transition")

                // Save on ENTER
                if (event.transitionType == 0) {
                    saveAndEmit(context, mapType(type), 100, emptyList())
                }
            }

        } catch (e: Exception) {
            Log.e(TAG, "handleTransitionResult error", e)
        }
    }

    private fun saveAndEmit(
        context: Context,
        state: String,
        confidence: Int,
        activities: List<DetectedActivity>
    ) {
        val ts = System.currentTimeMillis()

        // Save to SharedPreferences
        try {
            context.getSharedPreferences("activity_recognition", Context.MODE_PRIVATE)
                .edit()
                .putString("state", state)
                .putInt("confidence", confidence)
                .putLong("timestamp", ts)
                .putBoolean("enabled", true)
                .apply()

            Log.i(TAG, "💾 Saved: state=$state, conf=$confidence%")

        } catch (e: Exception) {
            Log.e(TAG, "Save error", e)
        }

        // Emit to JS
        try {
            val app = context.applicationContext
            if (app !is MainApplication) {
                Log.w(TAG, "Not MainApplication")
                return
            }

            val reactContext = try {
                app.reactNativeHost.reactInstanceManager.currentReactContext
            } catch (e: Exception) {
                null
            }

            if (reactContext == null) {
                Log.w(TAG, "ReactContext null (app background)")
                return
            }

            val emitter = reactContext.getJSModule(
                DeviceEventManagerModule.RCTDeviceEventEmitter::class.java
            )

            val payload = Arguments.createMap().apply {
                putString("state", state)
                putInt("confidence", confidence)
                putDouble("timestamp", ts.toDouble())
                putArray("top", toTopArray(activities))
            }

            emitter.emit("ActivityRecognition", payload)
            Log.i(TAG, "📡 Emitted to JS: $state")

        } catch (e: Exception) {
            Log.w(TAG, "Emit error: ${e.message}")
        }
    }

    private fun chooseBest(list: List<DetectedActivity>): DetectedActivity? {
        if (list.isEmpty()) return null

        val sorted = list.sortedByDescending { it.confidence }

        val preferred = setOf(
            DetectedActivity.STILL,
            DetectedActivity.WALKING,
            DetectedActivity.RUNNING,
            DetectedActivity.IN_VEHICLE,
            DetectedActivity.ON_BICYCLE,
            DetectedActivity.ON_FOOT
        )

        // Best preferred
        sorted.firstOrNull { preferred.contains(it.type) && it.confidence >= MIN_CONFIDENCE }
            ?.let { return it }

        // Any preferred
        sorted.firstOrNull { preferred.contains(it.type) }
            ?.let { return it }

        return sorted.firstOrNull()
    }

    private fun mapType(type: Int): String = when (type) {
        DetectedActivity.STILL -> "still"
        DetectedActivity.WALKING -> "walking"
        DetectedActivity.RUNNING -> "running"
        DetectedActivity.IN_VEHICLE -> "in_vehicle"
        DetectedActivity.ON_BICYCLE -> "on_bicycle"
        DetectedActivity.ON_FOOT -> "walking"
        DetectedActivity.TILTING -> "tilting"
        else -> "unknown"
    }

    private fun toTopArray(list: List<DetectedActivity>): WritableArray {
        val arr = Arguments.createArray()
        list.sortedByDescending { it.confidence }.take(5).forEach {
            arr.pushMap(Arguments.createMap().apply {
                putString("name", mapType(it.type))
                putInt("confidence", it.confidence)
            })
        }
        return arr
    }
}