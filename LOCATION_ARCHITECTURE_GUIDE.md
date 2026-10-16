# Android Location Architecture, Permissions, and Algorithms Guide (Kotlin)

A complete architectural and mathematical reference for building production-grade location tracking in Android using Kotlin, modern Coroutines/Flow, Google Play Services Fused Location Provider, and geospatial geometry.

---

## 1. System Architecture

A robust location tracking system follows **Clean Architecture** and **Unidirectional Data Flow (UDF)** principles:

```
┌────────────────────────────────────────────────────────┐
│                      UI / App Layer                    │
│   (Jetpack Compose / React Native NativeModule / View) │
└───────────────────────────▲────────────────────────────┘
                            │ Collects StateFlow / Flow<Location>
┌───────────────────────────┴────────────────────────────┐
│                    Location Service                    │
│     (Android Foreground Service + Notification)        │
└───────────────────────────▲────────────────────────────┘
                            │ Subscribes to Flow<Location>
┌───────────────────────────┴────────────────────────────┐
│                     LocationClient                     │
│               (Interface Segregation)                  │
└───────────────────────────▲────────────────────────────┘
                            │ Implemented by
┌───────────────────────────┴────────────────────────────┐
│                  DefaultLocationClient                 │
│         (FusedLocationProviderClient + Flow)           │
└───────────────────────────▲────────────────────────────┘
                            │ Hardware Abstraction
┌───────────────────────────┴────────────────────────────┐
│            Android Hardware & Network Layer            │
│       • GNSS / GPS Satellites                          │
│       • Cellular Towers (Cell-ID / LAC)                │
│       • Wi-Fi Access Points (RTT / BSSID)              │
│       • Inertial Sensors (Accelerometer / Gyroscope)   │
└────────────────────────────────────────────────────────┘
```

### Architectural Components

1. **`LocationClient` (Interface)**: Segregates the location acquisition contract from any Android framework-specific background task or UI element.
2. **`DefaultLocationClient`**: Implements `LocationClient` using Google's `FusedLocationProviderClient`. Converts callbacks into cold Kotlin `Flow<Location>` using `callbackFlow`.
3. **`LocationService` (Foreground Service)**: Keeps location collection active when the app is in the background or device screen is off, displaying an ongoing persistent notification as required by Android 8.0+.
4. **`LocationMathUtils`**: Pure mathematical utility functions for geodesy, great-circle distance (Haversine), bearing, destination point, and geofence boundary checks without depending on Android framework classes.

---

## 2. Permissions & Manifest Configuration

### 2.1 Manifest Declarations (`AndroidManifest.xml`)

Add the following permissions inside your `<manifest>` tag:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">

    <!-- 1. Accuracy Permissions -->
    <!-- Approximate location based on Cell & Wi-Fi (~100m - 2km) -->
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    
    <!-- High-accuracy location based on GPS / GNSS (~3m - 15m) -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />

    <!-- 2. Background Permission (Android 10 / API 29+) -->
    <!-- Required ONLY if accessing location without a Foreground Service -->
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

    <!-- 3. Foreground Service Permissions (Android 9 / API 28+ & Android 14 / API 34+) -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <!-- Android 14+ specific foreground service type -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

    <!-- 4. Notification Permission (Android 13 / API 33+) -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

    <!-- 5. Network Access (For A-GPS ephemeris download & Wi-Fi/Cell DB) -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application>
        <!-- Declare the Foreground Service with foregroundServiceType="location" -->
        <service
            android:name=".location.LocationService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="location" />
    </application>

</manifest>
```

### 2.2 Permissions Summary Matrix

| Permission | Android Version | Purpose | Prompt Requirement |
| :--- | :--- | :--- | :--- |
| `ACCESS_COARSE_LOCATION` | API 1+ | Approximate network location (Wi-Fi, Cell) | Runtime dialog |
| `ACCESS_FINE_LOCATION` | API 1+ | Precision satellite GNSS tracking | Runtime dialog |
| `ACCESS_BACKGROUND_LOCATION` | API 29+ (Android 10) | Background location when app is closed without Foreground Service | Must be requested separately; redirects to Settings |
| `FOREGROUND_SERVICE` | API 28+ (Android 9) | Run background tasks with persistent user notification | Manifest only |
| `FOREGROUND_SERVICE_LOCATION` | API 34+ (Android 14) | Declares foreground service specifically accesses location | Manifest + Runtime type check |
| `POST_NOTIFICATIONS` | API 33+ (Android 13) | Displays Foreground Service sticky notification | Runtime dialog |

> **Important (Android 12+ / API 31)**: Android 12 allows users to choose "Approximate" instead of "Precise". If you request only `ACCESS_FINE_LOCATION`, the system silently ignores or downgrades the request rather than presenting the user with the option to grant precise location. You **must always request both** `ACCESS_FINE_LOCATION` and `ACCESS_COARSE_LOCATION` simultaneously.

---

## 3. Required Libraries & Dependencies

Add the following to your module-level `build.gradle` (or `build.gradle.kts`):

```groovy
dependencies {
    // Google Play Services Location (FusedLocationProviderClient, SettingsClient, Geofencing)
    implementation "com.google.android.gms:play-services-location:21.3.0"

    // Kotlin Coroutines (Core & Android)
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.1"
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1"
    // Play Services Coroutines Support (Enables .await() on Tasks)
    implementation "org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1"

    // AndroidX Core & Lifecycle (For Foreground Service & Lifecycle-aware scopes)
    implementation "androidx.core:core-ktx:1.13.1"
    implementation "androidx.lifecycle:lifecycle-service:2.8.6"
    implementation "androidx.lifecycle:lifecycle-runtime-ktx:2.8.6"
}
```

---

## 4. Production-Ready Kotlin Implementation

### 4.1 Interface Contract: `LocationClient.kt`

```kotlin
package com.parkit.location

import android.location.Location
import kotlinx.coroutines.flow.Flow

interface LocationClient {
    /**
     * Emits continuous location updates.
     * @param intervalMillis The desired interval for location updates in milliseconds.
     * @throws LocationClient.LocationException when permissions or hardware providers are unavailable.
     */
    fun getLocationUpdates(intervalMillis: Long): Flow<Location>

    class LocationException(message: String) : Exception(message)
}
```

---

### 4.2 Implementation: `DefaultLocationClient.kt`

This class handles hardware availability checks, permission validation, and wraps `FusedLocationProviderClient` callbacks into a cold Kotlin `Flow`.

```kotlin
package com.parkit.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.Priority
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.launch

class DefaultLocationClient(
    private val context: Context,
    private val client: FusedLocationProviderClient
) : LocationClient {

    @SuppressLint("MissingPermission")
    override fun getLocationUpdates(intervalMillis: Long): Flow<Location> = callbackFlow {
        // 1. Verify runtime permissions
        val hasFine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        val hasCoarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            throw LocationClient.LocationException("Missing location permissions")
        }

        // 2. Verify GPS / Network provider status
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
        val isGpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        val isNetworkEnabled = locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)

        if (!isGpsEnabled && !isNetworkEnabled) {
            throw LocationClient.LocationException("Location hardware providers (GPS/Network) are disabled")
        }

        // 3. Configure LocationRequest using modern Builder (Play Services 21+)
        val request = LocationRequest.Builder(
            Priority.PRIORITY_HIGH_ACCURACY,
            intervalMillis
        ).apply {
            setMinUpdateIntervalMillis(intervalMillis / 2) // Fastest interval
            setMinUpdateDistanceMeters(1.0f)              // Displacement threshold (1 meter)
            setWaitForAccurateLocation(false)
        }.build()

        // 4. Create LocationCallback
        val locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                super.onLocationResult(result)
                result.locations.lastOrNull()?.let { location ->
                    launch { send(location) }
                }
            }
        }

        // 5. Register with FusedLocationProviderClient
        client.requestLocationUpdates(
            request,
            locationCallback,
            Looper.getMainLooper()
        )

        // 6. Automatically unregister when Flow collector cancels
        awaitClose {
            client.removeLocationUpdates(locationCallback)
        }
    }
}
```

---

### 4.3 Foreground Service: `LocationService.kt`

Keeps tracking running reliably in the background, compliant with Android 13 (`POST_NOTIFICATIONS`) and Android 14 (`FOREGROUND_SERVICE_LOCATION`).

```kotlin
package com.parkit.location

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.LocationServices
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

class LocationService : Service() {

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private lateinit var locationClient: LocationClient

    companion object {
        const val ACTION_START = "ACTION_START_LOCATION_SERVICE"
        const val ACTION_STOP = "ACTION_STOP_LOCATION_SERVICE"
        const val NOTIFICATION_CHANNEL_ID = "location_tracking_channel"
        const val NOTIFICATION_ID = 1001

        var currentLocation: Location? = null
            private set
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        locationClient = DefaultLocationClient(
            applicationContext,
            LocationServices.getFusedLocationProviderClient(applicationContext)
        )
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startTracking()
            ACTION_STOP -> stopTracking()
        }
        return START_STICKY
    }

    private fun startTracking() {
        val notification = buildNotification("Initializing location tracking...")

        // Android 14+ requires explicit foregroundServiceType
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification.build(),
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                } else {
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                }
            )
        } else {
            startForeground(NOTIFICATION_ID, notification.build())
        }

        locationClient.getLocationUpdates(5000L) // 5-second interval
            .catch { e -> e.printStackTrace() }
            .onEach { location ->
                currentLocation = location
                val lat = String.format("%.6f", location.latitude)
                val lon = String.format("%.6f", location.longitude)
                val accuracy = location.accuracy

                val updatedNotification = buildNotification(
                    "Lat: $lat, Lon: $lon (±${accuracy.toInt()}m)"
                )
                val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                notificationManager.notify(NOTIFICATION_ID, updatedNotification.build())
            }
            .launchIn(serviceScope)
    }

    private fun stopTracking() {
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun buildNotification(contentText: String): NotificationCompat.Builder {
        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Active Location Tracking")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "Location Tracking Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Shows live location status"
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
}
```

---

## 5. How Latitude and Longitude Are Calculated (Under the Hood)

Latitude ($\phi$) and Longitude ($\lambda$) represent spherical/ellipsoidal coordinates on Earth's reference model (**WGS 84 - World Geodetic System 1984**).

The Android operating system computes these coordinates through multiple physical hardware layers managed by the **Fused Location Provider (FLP)**.

```
                     ┌───────────────────────────┐
                     │   GPS / GNSS Satellites   │
                     │  (Trilateration / Math)   │
                     └─────────────┬─────────────┘
                                   │
┌─────────────────────────┐        │        ┌─────────────────────────┐
│     Cellular Towers     ├────────┼───────►│  Fused Location Engine  │
│  (Timing Advance/CID)   │        │        │     (Sensor Fusion)     │
└─────────────────────────┘        │        └────────────┬────────────┘
┌─────────────────────────┐        │                     │
│    Wi-Fi Access Points  ├────────┘                     │ Output:
│  (BSSID / RSSI Finger)  │                              ▼
└─────────────────────────┘                   Latitude, Longitude,
                                              Altitude, Accuracy, Speed
```

---

### 5.1 Global Navigation Satellite Systems (GNSS / GPS)

GNSS calculates positions using **Trilateration (Multilateration)** with atomic-clock satellite signals.

#### Mathematical Principle:
Each satellite broadcasts:
- Orbital position $(x_i, y_i, z_i)$ (Ephemeris data).
- Transmission timestamp $t_i$.

The receiver receives the signal at local time $t_r$. The distance (called **Pseudorange**, $P_i$) is the speed of light $c$ multiplied by the time delay, plus the receiver clock bias $\Delta t$:

$$P_i = c \cdot (t_r - t_i) = \sqrt{(x - x_i)^2 + (y - y_i)^2 + (z - z_i)^2} + c \cdot \Delta t$$

Because there are **4 unknowns** $(x, y, z, \Delta t)$, the receiver must receive signals from **at least 4 satellites** simultaneously:

$$\begin{cases}
(x - x_1)^2 + (y - y_1)^2 + (z - z_1)^2 = (P_1 - c \Delta t)^2 \\
(x - x_2)^2 + (y - y_2)^2 + (z - z_2)^2 = (P_2 - c \Delta t)^2 \\
(x - x_3)^2 + (y - y_3)^2 + (z - z_3)^2 = (P_3 - c \Delta t)^2 \\
(x - x_4)^2 + (y - y_4)^2 + (z - z_4)^2 = (P_4 - c \Delta t)^2
\end{cases}$$

#### Transformation from Cartesian $(x,y,z)$ to WGS 84 $(\text{Lat}, \text{Lon}, \text{Alt})$:
The resulting Earth-Centered Earth-Fixed (ECEF) coordinates $(x, y, z)$ are converted to Geodetic Latitude ($\phi$), Longitude ($\lambda$), and Ellipsoidal Height ($h$):

$$\lambda = \text{atan2}(y, x)$$

$$\phi = \arctan\left(\frac{z + e'^2 b \sin^3 \theta}{p - e^2 a \cos^3 \theta}\right)$$

Where:
- $a = 6378137.0 \text{ m}$ (semi-major axis).
- $b = 6356752.3142 \text{ m}$ (semi-minor axis).
- $e^2 = \frac{a^2 - b^2}{a^2}$ (first eccentricity squared).
- $p = \sqrt{x^2 + y^2}$.

---

### 5.2 Wi-Fi Positioning System (WPS)

1. The device scans nearby Wi-Fi beacons for **BSSID** (MAC address of router) and **RSSI** (Received Signal Strength Indication in dBm).
2. The device does **not** need to connect to the Wi-Fi.
3. FLP queries Google's cached crowdsourced database of known Wi-Fi AP coordinates.
4. Position is estimated using **Weighted Centroid Localization**:

$$\phi_{\text{device}} = \frac{\sum w_i \cdot \phi_i}{\sum w_i}, \quad \lambda_{\text{device}} = \frac{\sum w_i \cdot \lambda_i}{\sum w_i}$$

Where weight $w_i = 10^{\frac{\text{RSSI}_i}{10 \cdot n}}$ ($n$ is the path-loss exponent).

---

### 5.3 Cellular Tower Multilateration

1. The phone reads Cell ID (CID), Mobile Country Code (MCC), Mobile Network Code (MNC), and Location Area Code (LAC).
2. The network measures **Timing Advance (TA)**, which corresponds to the radio signal round-trip transit time.
   - For **2G/GSM**, 1 TA step $\approx 554$ meters.
   - For **4G/LTE**, 1 TA step ($N_{\text{TA}}$) $\approx 78.12$ meters (and for 5G NR even finer sub-meter granularity).
3. If signals from 3 or more cell towers are received, multilateration produces a position fix accurate within $50\text{m} - 1\text{km}$.

---

### 5.4 Fused Location Provider (Conceptually Sensor Fusion)

Google Play Services `FusedLocationProviderClient` conceptually uses **sensor fusion** (a proprietary Google fusion pipeline combining multiple estimators):
- High accuracy, high power: **GNSS/GPS**.
- Medium accuracy, indoor-capable: **Wi-Fi + Cell**.
- High frequency, micro-movement: **Accelerometer & Gyroscope** (Dead Reckoning).

While sensor fusion is conceptually related to Kalman filtering, Google's exact proprietary implementation in Play Services is not officially confirmed as pure EKF.

When GPS signal is lost (e.g., inside tunnels or underground parking), dead reckoning calculates the updated coordinates from the last known fix using **double integration** of linear acceleration:

$$\vec{p}(t) = \vec{p}_0 + \vec{v}_0 t + \iint \vec{a}_{\text{linear}}(t) \, dt^2$$

Because sensor noise and bias cause the double integration of acceleration to drift quadratically over time ($O(t^2)$), dead reckoning must be periodically recalibrated as soon as an absolute GNSS or Wi-Fi fix is available.

---

## 6. Mathematical Formulas & Kotlin Implementation

Here is a pure Kotlin geodetic library for calculations on latitude and longitude without any external library dependencies.

### 6.1 `LocationMathUtils.kt`

```kotlin
package com.parkit.location

import kotlin.math.*

object LocationMathUtils {

    // Earth's mean radius in meters (WGS84 spherical approximation)
    private const val EARTH_RADIUS_METERS = 6371000.0

    /**
     * 1. HAVERSINE FORMULA (Great-Circle Distance)
     * Calculates the shortest distance over the Earth's surface between two points.
     * Accurate within ~0.3% error for spherical approximation.
     *
     * @return Distance in meters.
     */
    fun calculateDistanceMeters(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val deltaPhi = Math.toRadians(lat2 - lat1)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val a = sin(deltaPhi / 2.0).pow(2) +
                cos(phi1) * cos(phi2) * sin(deltaLambda / 2.0).pow(2)

        val c = 2.0 * atan2(sqrt(a), sqrt(1.0 - a))

        return EARTH_RADIUS_METERS * c
    }

    /**
     * 2. INITIAL BEARING (Forward Azimuth)
     * Calculates the compass direction (0° to 360°) to travel from Point 1 towards Point 2.
     *
     * @return Bearing in degrees (0° = North, 90° = East, 180° = South, 270° = West).
     */
    fun calculateBearing(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Double {
        val phi1 = Math.toRadians(lat1)
        val phi2 = Math.toRadians(lat2)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val y = sin(deltaLambda) * cos(phi2)
        val x = cos(phi1) * sin(phi2) - sin(phi1) * cos(phi2) * cos(deltaLambda)

        val initialBearingRad = atan2(y, x)
        val initialBearingDeg = Math.toDegrees(initialBearingRad)

        // Normalize between 0° and 360°
        return (initialBearingDeg + 360.0) % 360.0
    }

    /**
     * 3. DESTINATION POINT CALCULATION
     * Calculates the new latitude and longitude reached after travelling a given
     * distance along a constant bearing from a starting point.
     *
     * @param distanceMeters Distance in meters.
     * @param bearingDegrees Initial bearing in degrees (0° - 360°).
     * @return Pair of (Latitude, Longitude) in degrees.
     */
    fun calculateDestinationPoint(
        startLat: Double, startLon: Double,
        distanceMeters: Double,
        bearingDegrees: Double
    ): Pair<Double, Double> {
        val angularDistance = distanceMeters / EARTH_RADIUS_METERS
        val bearingRad = Math.toRadians(bearingDegrees)

        val phi1 = Math.toRadians(startLat)
        val lambda1 = Math.toRadians(startLon)

        val phi2 = asin(
            sin(phi1) * cos(angularDistance) +
            cos(phi1) * sin(angularDistance) * cos(bearingRad)
        )

        val lambda2 = lambda1 + atan2(
            sin(bearingRad) * sin(angularDistance) * cos(phi1),
            cos(angularDistance) - sin(phi1) * sin(phi2)
        )

        return Pair(Math.toDegrees(phi2), Math.toDegrees(lambda2))
    }

    /**
     * 4. GEOFENCE PROXIMITY CHECK (Point-in-Circle)
     * Checks if a point is within a circular boundary of radius R.
     *
     * @return true if inside geofence, false otherwise.
     */
    fun isInsideGeofence(
        currentLat: Double, currentLon: Double,
        centerLat: Double, centerLon: Double,
        radiusMeters: Double
    ): Boolean {
        val distance = calculateDistanceMeters(currentLat, currentLon, centerLat, centerLon)
        return distance <= radiusMeters
    }

    /**
     * 5. MIDPOINT FORMULA
     * Calculates the geographic midpoint between two latitude/longitude points.
     *
     * @return Pair of (Midpoint Latitude, Midpoint Longitude).
     */
    fun calculateMidpoint(
        lat1: Double, lon1: Double,
        lat2: Double, lon2: Double
    ): Pair<Double, Double> {
        val phi1 = Math.toRadians(lat1)
        val lambda1 = Math.toRadians(lon1)
        val phi2 = Math.toRadians(lat2)
        val deltaLambda = Math.toRadians(lon2 - lon1)

        val bx = cos(phi2) * cos(deltaLambda)
        val by = cos(phi2) * sin(deltaLambda)

        val phi3 = atan2(
            sin(phi1) + sin(phi2),
            sqrt((cos(phi1) + bx).pow(2) + by.pow(2))
        )
        val lambda3 = lambda1 + atan2(by, cos(phi1) + bx)

        return Pair(Math.toDegrees(phi3), Math.toDegrees(lambda3))
    }
}
```

---

### 6.2 Comparison: Custom Math vs Android Framework `Location`

| Capability | `LocationMathUtils` (Custom Math) | `android.location.Location` (Framework) |
| :--- | :--- | :--- |
| **Formula Used** | Haversine Formula | Andoyer-Lambert / Vincenty Inverse on WGS84 Ellipsoid |
| **Accuracy** | ~0.3% error (assumes perfect sphere) | Millimeter accuracy on reference ellipsoid |
| **Android Dependency** | None (can run in pure Kotlin, JVM, unit tests) | Requires Android SDK runtime (`android.jar`) |
| **Unit Testing** | Instant local JVM unit tests | Requires Robolectric or instrumented device tests |
| **Native Equivalent Method** | `calculateDistanceMeters()` | `Location.distanceBetween(lat1, lon1, lat2, lon2, results)` |
| **Native Bearing Method** | `calculateBearing()` | `locationA.bearingTo(locationB)` |

---

## 7. How to Start and Stop the Location Service from Android / Kotlin

### Start the Service:
```kotlin
val intent = Intent(context, LocationService::class.java).apply {
    action = LocationService.ACTION_START
}
ContextCompat.startForegroundService(context, intent)
```

### Stop the Service:
```kotlin
val intent = Intent(context, LocationService::class.java).apply {
    action = LocationService.ACTION_STOP
}
context.startService(intent)
```
