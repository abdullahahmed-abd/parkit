package com.parkit.location

import android.location.Location
import android.os.Build
import android.os.SystemClock

object LocationFilter {

    private const val MAX_ACCURACY_METERS = 50.0f
    private const val MAX_AGE_NANOS = 15_000_000_000L // 15 seconds
    private const val MAX_IMPLIED_SPEED_MPS = 70.0    // 70 m/s (~252 km/h)

    /**
     * Determines whether a location fix is valid and usable.
     *
     * Filters out:
     * 1. Mock locations (fraud / fake GPS).
     * 2. Inaccurate fixes (accuracy > 50m or non-positive).
     * 3. Stale locations (older than 15 seconds).
     * 4. Unrealistic teleportation / speed-jump outliers compared to the previous accepted fix.
     *
     * @param location The candidate location fix.
     * @param previousLocation The last accepted location fix, or null if none.
     * @return true if usable, false otherwise.
     */
    fun isUsable(location: Location, previousLocation: Location?): Boolean {
        // 1. Check for mock locations
        val isMock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            location.isMock
        } else {
            @Suppress("DEPRECATION")
            location.isFromMockProvider
        }
        if (isMock) return false

        // 2. Accuracy check (reject > 50m or invalid)
        if (!location.hasAccuracy() || location.accuracy <= 0.0f || location.accuracy > MAX_ACCURACY_METERS) {
            return false
        }

        // 3. Age / staleness check (reject fixes older than 15s)
        val ageNanos = SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos
        if (ageNanos > MAX_AGE_NANOS || ageNanos < -1_000_000_000L) { // Also guard against future timestamps
            return false
        }

        // 4. Speed-jump outlier check against previous accepted location
        if (previousLocation != null) {
            val deltaNanos = location.elapsedRealtimeNanos - previousLocation.elapsedRealtimeNanos
            if (deltaNanos > 0) {
                val deltaSeconds = deltaNanos / 1_000_000_000.0
                val distanceMeters = location.distanceTo(previousLocation).toDouble()
                val impliedSpeed = distanceMeters / deltaSeconds
                if (impliedSpeed > MAX_IMPLIED_SPEED_MPS) {
                    return false
                }
            }
        }

        return true
    }
}
