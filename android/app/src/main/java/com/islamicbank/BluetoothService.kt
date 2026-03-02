// android/app/src/main/java/com/yourapp/bluetooth/BluetoothService.kt

package com.islamicbank.newapp

import android.app.*
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat

class BluetoothService : Service() {

    companion object {
        private const val TAG = "BTService"
        private const val NOTIF_ID = 1001
        private const val CHANNEL_ID = "parkit_bt_channel"

        const val ACTION_START = "com.yourapp.bt.START"
        const val ACTION_STOP = "com.yourapp.bt.STOP"
        const val EXTRA_ADDRESS = "device_address"
        const val EXTRA_NAME = "device_name"

        private var running = false
        fun isRunning(): Boolean = running

        fun start(ctx: Context, address: String? = null, name: String? = null) {
            val i = Intent(ctx, BluetoothService::class.java).apply {
                action = ACTION_START
                address?.let { putExtra(EXTRA_ADDRESS, it) }
                name?.let { putExtra(EXTRA_NAME, it) }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
            else ctx.startService(i)
        }

        fun stop(ctx: Context) {
            ctx.stopService(Intent(ctx, BluetoothService::class.java).apply { action = ACTION_STOP })
        }
    }

    private var btReceiver: BroadcastReceiver? = null
    private var targetAddress: String? = null
    private var targetName: String? = null
    private var btAdapter: BluetoothAdapter? = null
    private val connected = mutableSetOf<String>()

    override fun onCreate() {
        super.onCreate()
        btAdapter = (getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter
            ?: BluetoothAdapter.getDefaultAdapter()
        createChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                targetAddress = intent.getStringExtra(EXTRA_ADDRESS)
                targetName = intent.getStringExtra(EXTRA_NAME)
                startForeground(NOTIF_ID, buildNotif("Monitoring: ${targetName ?: "All devices"}"))
                registerBtReceiver()
                running = true
                Log.d(TAG, "✅ Service STARTED for: $targetName [$targetAddress]")
            }
            ACTION_STOP -> stopSelf()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        unregisterBtReceiver()
        connected.clear()
        running = false
        Log.d(TAG, "🛑 Service DESTROYED")
    }

    // ═══════════════════════════════════════════════════════════
    // NOTIFICATION
    // ═══════════════════════════════════════════════════════════

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, "ParkIt BT Monitor", NotificationManager.IMPORTANCE_LOW).apply {
                description = "Bluetooth monitoring for parking detection"
                setShowBadge(false)
            }
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(ch)
        }
    }

    private fun buildNotif(text: String): Notification {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        else PendingIntent.FLAG_UPDATE_CURRENT

        val tapIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            flags
        )

        val stopIntent = PendingIntent.getService(
            this, 1,
            Intent(this, BluetoothService::class.java).apply { action = ACTION_STOP },
            flags
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🅿️ ParkIt Active")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(tapIntent)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopIntent)
            .build()
    }

    private fun updateNotif(text: String) {
        try {
            (getSystemService(NOTIFICATION_SERVICE) as NotificationManager)
                .notify(NOTIF_ID, buildNotif(text))
        } catch (_: Exception) {}
    }

    // ═══════════════════════════════════════════════════════════
    // BT RECEIVER
    // ═══════════════════════════════════════════════════════════

    private fun registerBtReceiver() {
        unregisterBtReceiver()

        btReceiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                when (intent?.action) {
                    BluetoothDevice.ACTION_ACL_CONNECTED -> {
                        val d = getDevice(intent) ?: return
                        connected.add(d.address)
                        val name = safeName(d)
                        Log.d(TAG, "🟢 $name [${d.address}]")
                        if (shouldTrack(d.address)) updateNotif("🟢 Connected: $name")
                    }
                    BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                        val d = getDevice(intent) ?: return
                        connected.remove(d.address)
                        val name = safeName(d)
                        Log.d(TAG, "🔴 $name [${d.address}]")
                        if (shouldTrack(d.address)) updateNotif("🔴 Disconnected: $name")
                    }
                    BluetoothAdapter.ACTION_STATE_CHANGED -> {
                        val on = intent.getIntExtra(BluetoothAdapter.EXTRA_STATE, -1) == BluetoothAdapter.STATE_ON
                        if (!on) connected.clear()
                        updateNotif(if (on) "Monitoring..." else "⚠️ BT OFF")
                    }
                }
            }
        }

        val filter = IntentFilter().apply {
            addAction(BluetoothDevice.ACTION_ACL_CONNECTED)
            addAction(BluetoothDevice.ACTION_ACL_DISCONNECTED)
            addAction(BluetoothAdapter.ACTION_STATE_CHANGED)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(btReceiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            registerReceiver(btReceiver, filter)
        }
    }

    private fun unregisterBtReceiver() {
        btReceiver?.let {
            try { unregisterReceiver(it) } catch (_: Exception) {}
        }
        btReceiver = null
    }

    // ═══════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════

    private fun getDevice(intent: Intent): BluetoothDevice? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        else @Suppress("DEPRECATION") intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
    }

    private fun safeName(d: BluetoothDevice): String {
        return try { d.name ?: "Unknown" } catch (_: SecurityException) { "Unknown" }
    }

    private fun shouldTrack(address: String): Boolean {
        return targetAddress == null || targetAddress == address
    }
}