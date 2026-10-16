package com.parkit.location

import android.location.Location
import com.google.android.gms.location.Priority
import kotlinx.coroutines.flow.Flow

interface LocationClient {
    /**
     * Emits continuous location updates.
     * @param intervalMillis The desired interval for location updates in milliseconds.
     * @param priority Desired accuracy priority (e.g. Priority.PRIORITY_HIGH_ACCURACY).
     * @throws LocationException when permissions or hardware settings are missing.
     */
    fun getLocationUpdates(
        intervalMillis: Long,
        priority: Int = Priority.PRIORITY_HIGH_ACCURACY
    ): Flow<Location>

    class LocationException(message: String) : Exception(message)
}
