package com.parkit.location

import android.location.Location
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow

/**
 * Test double implementation of LocationClient for unit testing.
 * Allows simulating location fixes, runtime exceptions, and observing collection lifecycle.
 */
class FakeLocationClient : LocationClient {

    private val locationFlow = MutableSharedFlow<Location>(replay = 1)
    var shouldThrowException: Boolean = false
    var exceptionToThrow: Exception = LocationClient.LocationException("Simulated location exception")
    var isCollecting: Boolean = false
        private set

    override fun getLocationUpdates(intervalMillis: Long, priority: Int): Flow<Location> {
        return flow {
            isCollecting = true
            if (shouldThrowException) {
                throw exceptionToThrow
            }
            try {
                locationFlow.collect { location ->
                    emit(location)
                }
            } finally {
                isCollecting = false
            }
        }
    }

    suspend fun emitLocation(location: Location) {
        locationFlow.emit(location)
    }
}
