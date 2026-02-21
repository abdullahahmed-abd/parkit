package com.islamicbank.newapp

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.*

class ActivityRecognitionModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "ActivityRecognitionModule"

  private fun hasPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED
  }

  @ReactMethod
  fun start(intervalMs: Int, promise: Promise) {
    if (!hasPermission()) {
      promise.reject("NO_PERMISSION", "ACTIVITY_RECOGNITION permission not granted")
      return
    }

    val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
      action = ActivityRecognitionService.ACTION_START
      putExtra(ActivityRecognitionService.EXTRA_INTERVAL_MS, intervalMs)
    }
    ContextCompat.startForegroundService(ctx, intent)
    promise.resolve(true)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    val intent = Intent(ctx, ActivityRecognitionService::class.java).apply {
      action = ActivityRecognitionService.ACTION_STOP
    }
    ctx.startService(intent)
    promise.resolve(true)
  }

  @ReactMethod
  fun getLast(promise: Promise) {
    val prefs = ctx.getSharedPreferences("activity_recognition", 0)
    val map = Arguments.createMap().apply {
      putString("state", prefs.getString("state", "unknown"))
      putInt("confidence", prefs.getInt("confidence", 0))
      putDouble("timestamp", prefs.getLong("timestamp", 0L).toDouble())
      putBoolean("enabled", prefs.getBoolean("enabled", false))
    }
    promise.resolve(map)
  }

  // RN event emitter compatibility
  @ReactMethod fun addListener(eventName: String) {}
  @ReactMethod fun removeListeners(count: Int) {}
}