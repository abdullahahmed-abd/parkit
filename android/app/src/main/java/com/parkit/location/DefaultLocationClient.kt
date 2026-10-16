package com.parkit.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.LocationSettingsResponse
import com.google.android.gms.location.Priority
import com.google.android.gms.location.SettingsClient
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.conflate

class DefaultLocationClient(
    private val context: Context,
    private val client: FusedLocationProviderClient
) : LocationClient {

    @SuppressLint("MissingPermission")
    override fun getLocationUpdates(
        intervalMillis: Long,
        priority: Int
    ): Flow<Location> = callbackFlow {
        // 1. Check permissions (Allow either FINE or COARSE)
        val hasFine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val hasCoarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            close(LocationClient.LocationException("Missing location permissions (requires FINE or COARSE)"))
            return@callbackFlow
        }

        // 2. Build LocationRequest with adaptive priority and 5m displacement threshold
        val request = LocationRequest.Builder(priority, intervalMillis).apply {
            setMinUpdateIntervalMillis(intervalMillis / 2)
            setMinUpdateDistanceMeters(5.0f) // 5 meters displacement threshold
            setWaitForAccurateLocation(false)
        }.build()

        var lastAcceptedLocation: Location? = null

        // 3. Create callback processing ALL points in order with LocationFilter
        val locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                super.onLocationResult(result)
                for (location in result.locations) {
                    if (LocationFilter.isUsable(location, lastAcceptedLocation)) {
                        lastAcceptedLocation = location
                        trySend(location)
                    }
                }
            }
        }

        // 4. Request location updates and attach failure listener
        client.requestLocationUpdates(
            request,
            locationCallback,
            Looper.getMainLooper()
        ).addOnFailureListener { exception ->
            close(exception)
        }

        // 5. Clean up when flow collection terminates
        awaitClose {
            client.removeLocationUpdates(locationCallback)
        }
    }.conflate()

    companion object {
        /**
         * Checks device location settings (GPS / Network location status) using SettingsClient.
         * If settings are satisfied, onSuccess is called.
         * If settings need resolution (e.g. GPS is turned off), onResolvable is called with
         * ResolvableApiException so the Activity can call resolvable.startResolutionForResult(...).
         * If unresolvable or other failure occurs, onFailure is called.
         */
        fun checkLocationSettings(
            context: Context,
            priority: Int = Priority.PRIORITY_HIGH_ACCURACY,
            onSuccess: (LocationSettingsResponse) -> Unit = {},
            onResolvable: (ResolvableApiException) -> Unit,
            onFailure: (Exception) -> Unit = {}
        ) {
            val locationRequest = LocationRequest.Builder(priority, 10000L).build()
            val settingsRequest = LocationSettingsRequest.Builder()
                .addLocationRequest(locationRequest)
                .setAlwaysShow(true)
                .build()

            val settingsClient: SettingsClient = LocationServices.getSettingsClient(context)
            val task: Task<LocationSettingsResponse> = settingsClient.checkLocationSettings(settingsRequest)

            task.addOnSuccessListener { response ->
                onSuccess(response)
            }
            task.addOnFailureListener { exception ->
                if (exception is ResolvableApiException) {
                    onResolvable(exception)
                } else {
                    onFailure(exception)
                }
            }
        }
    }
}
