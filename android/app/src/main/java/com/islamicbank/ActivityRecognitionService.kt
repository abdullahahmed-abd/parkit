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
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity

class ActivityRecognitionService : Service() {

    companion object {
        const val ACTION_START = "AR_START"
        const val ACTION_STOP = "AR_STOP"
        const val EXTRA_INTERVAL_MS = "intervalMs"
        private const val CHANNEL_ID = "ar_channel"
        private const val NOTIF_ID = 1001
        private const val TAG = "ARService"
    }

    private lateinit var client: ActivityRecognitionClient

    override fun onCreate() {
        super.onCreate()
        client = ActivityRecognition.getClient(this)
        Log.d(TAG, "onCreate")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "onStartCommand action=${intent?.action}")

        when (intent?.action) {
            ACTION_STOP -> {
                Log.i(TAG, "Stopping...")
                stopAllUpdates()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }

            ACTION_START, null -> {
                val interval = intent?.getIntExtra(EXTRA_INTERVAL_MS, 5000) ?: 5000
                Log.i(TAG, "Starting with interval=$interval ms")
                startForegroundNotification()
                requestUpdates(interval)
                requestTransitions()
                return START_STICKY
            }
        }

        return START_STICKY
    }

    private fun hasPermission(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.ACTIVITY_RECOGNITION
        ) == PackageManager.PERMISSION_GRANTED
    }

    private fun startForegroundNotification() {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, "Activity", NotificationManager.IMPORTANCE_LOW)
                )
            }

            val notif = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("ParkIt Active")
                .setContentText("Detecting activity...")
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .build()

            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else if (Build.VERSION.SDK_INT >= 29) {
                startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
            } else {
                startForeground(NOTIF_ID, notif)
            }

            Log.i(TAG, "✅ Foreground notification started")

        } catch (e: Exception) {
            Log.e(TAG, "startForeground error", e)
        }
    }

    private fun pendingIntent(requestCode: Int): PendingIntent {
        val intent = Intent(this, ActivityRecognitionReceiver::class.java)
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(this, requestCode, intent, flags)
    }

    private fun requestUpdates(intervalMs: Int) {
        if (!hasPermission()) {
            Log.e(TAG, "❌ No AR permission!")
            return
        }

        Log.d(TAG, "Requesting activity updates every $intervalMs ms...")

        client.requestActivityUpdates(intervalMs.toLong(), pendingIntent(100))
            .addOnSuccessListener {
                Log.i(TAG, "✅ requestActivityUpdates SUCCESS")

                getSharedPreferences("activity_recognition", MODE_PRIVATE)
                    .edit()
                    .putBoolean("enabled", true)
                    .apply()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "❌ requestActivityUpdates FAILED: ${e.message}")
            }
    }

    private fun requestTransitions() {
        if (!hasPermission()) return

        try {
            val transitions = mutableListOf<ActivityTransition>()

            listOf(
                DetectedActivity.STILL,
                DetectedActivity.WALKING,
                DetectedActivity.RUNNING,
                DetectedActivity.IN_VEHICLE,
                DetectedActivity.ON_BICYCLE
            ).forEach { activity ->
                transitions.add(
                    ActivityTransition.Builder()
                        .setActivityType(activity)
                        .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
                        .build()
                )
                transitions.add(
                    ActivityTransition.Builder()
                        .setActivityType(activity)
                        .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
                        .build()
                )
            }

            val request = ActivityTransitionRequest(transitions)

            client.requestActivityTransitionUpdates(request, pendingIntent(101))
                .addOnSuccessListener {
                    Log.i(TAG, "✅ requestActivityTransitionUpdates SUCCESS")
                }
                .addOnFailureListener { e ->
                    Log.e(TAG, "❌ requestActivityTransitionUpdates FAILED: ${e.message}")
                }

        } catch (e: Exception) {
            Log.e(TAG, "requestTransitions error", e)
        }
    }

    private fun stopAllUpdates() {
        try {
            client.removeActivityUpdates(pendingIntent(100))
            client.removeActivityTransitionUpdates(pendingIntent(101))

            getSharedPreferences("activity_recognition", MODE_PRIVATE)
                .edit()
                .putBoolean("enabled", false)
                .apply()

            Log.i(TAG, "✅ Updates removed")

        } catch (e: Exception) {
            Log.e(TAG, "stopAllUpdates error", e)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null
}