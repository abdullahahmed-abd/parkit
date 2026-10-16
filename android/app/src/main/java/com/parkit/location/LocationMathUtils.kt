package com.parkit.location

import kotlin.math.*

/**
 * Pure Kotlin mathematical utilities for geodesy and spherical geometry.
 * Free of Android framework dependencies, making it suitable for JVM unit testing.
 */
object LocationMathUtils {

    // Earth's mean radius in meters (WGS84 spherical approximation)
    const val EARTH_RADIUS_METERS = 6371000.0

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
     * Calculates the compass direction (0° to 360°) to travel from Point 1 towards Point 2
     * along the great-circle path.
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
     * 3. DESTINATION POINT CALCULATION (Great-Circle Geodesic Formula)
     * Calculates the destination point reached after travelling a given distance along a
     * great-circle arc starting with the given initial bearing.
     * Note: This uses the great-circle geodesic formula where bearing varies continuously
     * along the route (not a rhumb line / constant compass bearing).
     *
     * Output longitude is normalized to -180.0..+180.0 degrees.
     *
     * @param startLat Starting latitude in degrees.
     * @param startLon Starting longitude in degrees.
     * @param distanceMeters Distance to travel in meters.
     * @param bearingDegrees Initial bearing in degrees (0° - 360°).
     * @return Pair of (Latitude, Longitude) in degrees, with longitude normalized between -180° and +180°.
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

        val destLat = Math.toDegrees(phi2)
        val destLon = normalizeLongitude(Math.toDegrees(lambda2))

        return Pair(destLat, destLon)
    }

    /**
     * 4. GEOFENCE PROXIMITY CHECK (Point-in-Circle)
     * Checks if a point is within a circular boundary of radius R.
     *
     * @return true if inside or exactly on the geofence boundary, false otherwise.
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
     * Calculates the geographic midpoint along the great-circle path between two points.
     * Output longitude is normalized between -180.0° and +180.0°.
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

        val midLat = Math.toDegrees(phi3)
        val midLon = normalizeLongitude(Math.toDegrees(lambda3))

        return Pair(midLat, midLon)
    }

    /**
     * Normalizes a longitude angle to the range [-180.0, 180.0) degrees.
     */
    fun normalizeLongitude(lon: Double): Double {
        return (lon + 540.0) % 360.0 - 180.0
    }
}
