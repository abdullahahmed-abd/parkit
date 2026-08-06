package com.parkit.newapp

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {

  override fun onReceive(context: Context, intent: Intent) {
    try {
      val prefs = context.getSharedPreferences("activity_recognition", Context.MODE_PRIVATE)
      val enabled = prefs.getBoolean("enabled", false)
      val interval = prefs.getInt("intervalMs", 5000)
      if (!enabled) return

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val ok = ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.ACTIVITY_RECOGNITION
        ) == PackageManager.PERMISSION_GRANTED
        if (!ok) return
      }

      val svc = Intent(context, ActivityRecognitionService::class.java).apply {
        action = ActivityRecognitionService.ACTION_START
        putExtra(ActivityRecognitionService.EXTRA_INTERVAL_MS, interval)
      }
      ContextCompat.startForegroundService(context, svc)
    } catch (e: Exception) {
      Log.e("BootReceiver", "BootReceiver crashed", e)
    }
  }
}