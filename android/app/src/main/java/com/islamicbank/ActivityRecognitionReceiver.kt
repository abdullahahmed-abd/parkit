package com.islamicbank.newapp

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.ActivityRecognitionResult
import com.google.android.gms.location.DetectedActivity

class ActivityRecognitionReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    val has = ActivityRecognitionResult.hasResult(intent)
    Log.d("ARReceiver", "onReceive called. hasResult=$has")
    if (!has) return

    val result = ActivityRecognitionResult.extractResult(intent) ?: return
    val candidates = result.probableActivities ?: emptyList()

    // Debug: print top candidates
    val topStr = candidates
      .sortedByDescending { it.confidence }
      .take(5)
      .joinToString { "${it.type}:${it.confidence}" }
    Log.d("ARReceiver", "candidates(top5)=$topStr")

    val chosen = chooseBest(candidates)

    val prefs = context.getSharedPreferences("activity_recognition", Context.MODE_PRIVATE)
    val lastState = prefs.getString("state", "unknown") ?: "unknown"

    var state = mapActivityType(chosen?.type ?: DetectedActivity.UNKNOWN)
    var confidence = chosen?.confidence ?: 0

    // If still unknown or very low confidence, keep last known state
    val MIN_CONFIDENCE = 40
    if (state == "unknown" || confidence < MIN_CONFIDENCE) {
      state = lastState
    }

    val ts = System.currentTimeMillis()

    Log.d("ARReceiver", "chosenType=${chosen?.type} state=$state conf=$confidence last=$lastState")

    // Save for UI
    prefs.edit()
      .putString("state", state)
      .putInt("confidence", confidence)
      .putLong("timestamp", ts)
      .apply()

    // Emit to JS (only if RN alive)
    val app = context.applicationContext as MainApplication
    val reactContext = app.reactNativeHost.reactInstanceManager.currentReactContext

    reactContext?.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      ?.emit(
        "ActivityRecognition",
        Arguments.createMap().apply {
          putString("state", state)
          putInt("confidence", confidence)
          putDouble("timestamp", ts.toDouble())
          putInt("rawType", chosen?.type ?: -1)
          putArray("top", toTopArray(candidates))
        }
      )
  }

  // Pick best meaningful activity (ignore UNKNOWN/TILTING if possible)
  private fun chooseBest(list: List<DetectedActivity>): DetectedActivity? {
    if (list.isEmpty()) return null

    val sorted = list.sortedByDescending { it.confidence }

    // Prefer these types
    val allowed = setOf(
      DetectedActivity.IN_VEHICLE,
      DetectedActivity.ON_BICYCLE,
      DetectedActivity.RUNNING,
      DetectedActivity.WALKING,
      DetectedActivity.ON_FOOT,
      DetectedActivity.STILL
    )

    // First try: best among allowed
    val bestAllowed = sorted.firstOrNull { allowed.contains(it.type) }
    if (bestAllowed != null) return bestAllowed

    // Fallback: best overall
    return sorted.firstOrNull()
  }

  private fun mapActivityType(type: Int): String = when (type) {
    DetectedActivity.IN_VEHICLE -> "in_vehicle"
    DetectedActivity.ON_BICYCLE -> "on_bicycle"
    DetectedActivity.RUNNING -> "running"
    DetectedActivity.WALKING -> "walking"
    DetectedActivity.ON_FOOT -> "walking"
    DetectedActivity.STILL -> "still"
    DetectedActivity.TILTING -> "still"   // you can also return "unknown" if you prefer
    DetectedActivity.UNKNOWN -> "unknown"
    else -> "unknown"
  }

  private fun toTopArray(list: List<DetectedActivity>): WritableArray {
    val arr = Arguments.createArray()
    list.sortedByDescending { it.confidence }
      .take(5)
      .forEach {
        arr.pushMap(
          Arguments.createMap().apply {
            putInt("type", it.type)
            putInt("confidence", it.confidence)
          }
        )
      }
    return arr
  }
}