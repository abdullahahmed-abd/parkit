package com.parkit.location

import android.location.Location
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * Singleton repository holding observable state for the location module.
 * Exposes read-only StateFlows for UI and services to observe.
 */
object LocationRepository {

    private val _location = MutableStateFlow<Location?>(null)
    val location: StateFlow<Location?> = _location.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private val _isTracking = MutableStateFlow(false)
    val isTracking: StateFlow<Boolean> = _isTracking.asStateFlow()

    /**
     * Updates the latest received location and clears previous errors.
     */
    fun updateLocation(newLocation: Location) {
        _location.update { newLocation }
        _error.update { null }
    }

    /**
     * Sets or clears the current error message.
     */
    fun setError(message: String?) {
        _error.update { message }
    }

    /**
     * Updates the tracking active state.
     */
    fun setTracking(tracking: Boolean) {
        _isTracking.update { tracking }
    }

    /**
     * Clears error state.
     */
    fun clearError() {
        _error.update { null }
    }
}
