package com.islamicbank.newapp

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityRecognitionClient

class ActivityRecognitionService : Service() {

  companion object {
    const val ACTION_START = "AR_START"
    const val ACTION_STOP = "AR_STOP"
    const val EXTRA_INTERVAL_MS = "intervalMs"

    private const val CHANNEL_ID = "activity_recognition_channel"
    private const val NOTIF_ID = 1001
    private const val TAG = "ARService"
  }

  private lateinit var client: ActivityRecognitionClient

  override fun onCreate() {
    super.onCreate()
    client = ActivityRecognition.getClient(this)
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      when (intent?.action) {
        ACTION_STOP -> {
          stopUpdatesSafe()
          stopForeground(STOP_FOREGROUND_REMOVE)
          stopSelf()
          return START_NOT_STICKY
        }

        ACTION_START, null -> {
          val interval = intent?.getIntExtra(EXTRA_INTERVAL_MS, 5000) ?: 5000
          startInForegroundSafe()
          startUpdatesSafe(interval)
          return START_STICKY
        }
      }
    } catch (e: Exception) {
      Log.e(TAG, "onStartCommand crashed", e)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return START_NOT_STICKY
    }

    return START_STICKY
  }

  private fun hasActivityPermission(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
    return ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) ==
      PackageManager.PERMISSION_GRANTED
  }

  private fun startInForegroundSafe() {
    try {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Activity Recognition",
          NotificationManager.IMPORTANCE_LOW
        )
        nm.createNotificationChannel(channel)
      }

      val notif = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle("Activity detection running")
        .setContentText("Detecting: still / walk / run / vehicle / bicycle")
        .setSmallIcon(R.mipmap.ic_launcher)
        .setOngoing(true)
        .build()

      if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else {
        startForeground(NOTIF_ID, notif)
      }
    } catch (se: SecurityException) {
      Log.e(TAG, "startForeground SecurityException", se)
      stopSelf()
    } catch (e: Exception) {
      Log.e(TAG, "startForeground failed", e)
      stopSelf()
    }
  }

  // ✅ FIX: PendingIntent must be MUTABLE on Android 12+ so GMS can attach extras
  private fun pendingIntent(): PendingIntent {
    val intent = Intent(this, ActivityRecognitionReceiver::class.java)

    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
    } else {
      PendingIntent.FLAG_UPDATE_CURRENT
    }

    return PendingIntent.getBroadcast(this, 101, intent, flags)
  }

  private fun startUpdatesSafe(intervalMs: Int) {
    val prefs = getSharedPreferences("activity_recognition", MODE_PRIVATE)

    if (!hasActivityPermission()) {
      Log.e(TAG, "ACTIVITY_RECOGNITION permission not granted. Stopping.")
      prefs.edit().putBoolean("enabled", false).apply()
      stopSelf()
      return
    }

    prefs.edit().putBoolean("enabled", true).putInt("intervalMs", intervalMs).apply()

    try {
      client.requestActivityUpdates(intervalMs.toLong(), pendingIntent())
        .addOnSuccessListener {
          Log.i(TAG, "requestActivityUpdates OK interval=$intervalMs")
        }
        .addOnFailureListener { e ->
          Log.e(TAG, "requestActivityUpdates FAILED", e)
          prefs.edit().putBoolean("enabled", false).apply()
          stopSelf()
        }
    } catch (se: SecurityException) {
      Log.e(TAG, "requestActivityUpdates SecurityException", se)
      prefs.edit().putBoolean("enabled", false).apply()
      stopSelf()
    } catch (e: Exception) {
      Log.e(TAG, "requestActivityUpdates crashed", e)
      prefs.edit().putBoolean("enabled", false).apply()
      stopSelf()
    }
  }

  private fun stopUpdatesSafe() {
    val prefs = getSharedPreferences("activity_recognition", MODE_PRIVATE)
    prefs.edit().putBoolean("enabled", false).apply()

    try {
      client.removeActivityUpdates(pendingIntent())
        .addOnSuccessListener { Log.i(TAG, "removeActivityUpdates OK") }
        .addOnFailureListener { e -> Log.e(TAG, "removeActivityUpdates FAILED", e) }
    } catch (e: Exception) {
      Log.e(TAG, "removeActivityUpdates crashed", e)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null
}