package com.parkit.location

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat

/**
 * Utility helper for managing location and notification runtime permissions,
 * handling Android 12+ (coarse/fine split), Android 13+ (notification prompt),
 * and safe Foreground Service lifecycle control.
 */
object LocationPermissionHelper {

    enum class LocationPermissionState {
        GRANTED_PRECISE,     // Both FINE and COARSE (or FINE) granted
        GRANTED_APPROXIMATE, // Only COARSE granted, FINE denied
        DENIED,              // Neither granted, can request
        PERMANENTLY_DENIED   // Denied with "Don't ask again" / rationale false
    }

    /**
     * Required location permissions to request together.
     * Note: On Android 12+ (API 31+), ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION
     * MUST be requested in a single request. Asking only for FINE causes the system dialog
     * to silently ignore or downgrade the request.
     */
    fun getLocationPermissionsToRequest(): Array<String> = arrayOf(
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    )

    /**
     * Returns notification permission required on Android 13+ (API 33+).
     */
    fun getNotificationPermissionToRequest(): Array<String> {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            emptyArray()
        }
    }

    /**
     * Checks the current location permission state.
     */
    fun checkLocationPermissionState(activity: Activity): LocationPermissionState {
        val fineGranted = ContextCompat.checkSelfPermission(
            activity, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val coarseGranted = ContextCompat.checkSelfPermission(
            activity, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        return when {
            fineGranted -> LocationPermissionState.GRANTED_PRECISE
            coarseGranted -> LocationPermissionState.GRANTED_APPROXIMATE
            else -> {
                val shouldShowRationaleFine = ActivityCompat.shouldShowRequestPermissionRationale(
                    activity, Manifest.permission.ACCESS_FINE_LOCATION
                )
                val shouldShowRationaleCoarse = ActivityCompat.shouldShowRequestPermissionRationale(
                    activity, Manifest.permission.ACCESS_COARSE_LOCATION
                )

                // If rationale returns false after denial, the user selected "Don't ask again"
                if (!shouldShowRationaleFine && !shouldShowRationaleCoarse) {
                    LocationPermissionState.PERMANENTLY_DENIED
                } else {
                    LocationPermissionState.DENIED
                }
            }
        }
    }

    /**
     * Checks if notification permission is granted on Android 13+.
     */
    fun hasNotificationPermission(context: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    /**
     * Opens the device Application Details Settings page so the user can manually
     * enable permanently denied permissions.
     */
    fun openAppSettings(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
            data = Uri.fromParts("package", context.packageName, null)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(intent)
    }

    /**
     * Safely starts the LocationService in the foreground.
     */
    fun startLocationService(context: Context) {
        val intent = Intent(context, LocationService::class.java).apply {
            action = LocationService.ACTION_START
        }
        ContextCompat.startForegroundService(context, intent)
    }

    /**
     * Safely stops the LocationService.
     *
     * IMPORTANT: Never use context.startService() to stop the service when the app could
     * be in the background. On Android 8.0+ (API 26+), calling startService() from the
     * background throws an IllegalStateException. Instead, stopService() or
     * startForegroundService() with ACTION_STOP is used.
     */
    fun stopLocationService(context: Context) {
        val intent = Intent(context, LocationService::class.java).apply {
            action = LocationService.ACTION_STOP
        }
        // Either stopService or startForegroundService with ACTION_STOP safely terminates
        context.stopService(intent)
    }
}
