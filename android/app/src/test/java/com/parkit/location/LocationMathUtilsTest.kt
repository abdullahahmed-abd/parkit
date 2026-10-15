package com.parkit.location

import org.junit.Assert.*
import org.junit.Test

class LocationMathUtilsTest {

    private val deltaMeters = 5.0 // Tolerance in meters
    private val deltaDegrees = 0.01 // Tolerance in degrees

    @Test
    fun testHaversine_knownCityPair_LondonToParis() {
        // London (51.5074° N, 0.1278° W) to Paris (48.8566° N, 2.3522° E)
        val londonLat = 51.5074
        val londonLon = -0.1278
        val parisLat = 48.8566
        val parisLon = 2.3522

        val distance = LocationMathUtils.calculateDistanceMeters(londonLat, londonLon, parisLat, parisLon)

        // Expected distance is approximately 343.5 km (343,500 m) on a sphere
        assertTrue("Distance should be between 340km and 346km, was $distance", distance in 340_000.0..346_000.0)
    }

    @Test
    fun testBearing_cardinalDirections_NorthEastSouthWest() {
        val centerLat = 0.0
        val centerLon = 0.0

        // North
        val northBearing = LocationMathUtils.calculateBearing(centerLat, centerLon, 5.0, 0.0)
        assertEquals(0.0, northBearing, deltaDegrees)

        // East
        val eastBearing = LocationMathUtils.calculateBearing(centerLat, centerLon, 0.0, 5.0)
        assertEquals(90.0, eastBearing, deltaDegrees)

        // South
        val southBearing = LocationMathUtils.calculateBearing(centerLat, centerLon, -5.0, 0.0)
        assertEquals(180.0, southBearing, deltaDegrees)

        // West
        val westBearing = LocationMathUtils.calculateBearing(centerLat, centerLon, 0.0, -5.0)
        assertEquals(270.0, westBearing, deltaDegrees)
    }

    @Test
    fun testDestinationRoundTrip_withDistanceAndNormalization() {
        val startLat = 40.7128 // NYC
        val startLon = -74.0060
        val travelDistance = 15000.0 // 15 km
        val initialBearing = 45.0 // North-East

        val (destLat, destLon) = LocationMathUtils.calculateDestinationPoint(
            startLat, startLon, travelDistance, initialBearing
        )

        // Verifying distance from start to calculated destination equals travel distance
        val measuredDistance = LocationMathUtils.calculateDistanceMeters(startLat, startLon, destLat, destLon)
        assertEquals(travelDistance, measuredDistance, deltaMeters)

        // Test longitude wrapping across the antimeridian (+179° moving East)
        val nearAntimeridianLat = 0.0
        val nearAntimeridianLon = 179.5
        val (_, wrappedLon) = LocationMathUtils.calculateDestinationPoint(
            nearAntimeridianLat, nearAntimeridianLon, 150_000.0, 90.0
        )
        assertTrue("Normalized longitude must be between -180 and 180, was $wrappedLon", wrappedLon in -180.0..180.0)
        assertTrue("Expected negative longitude after crossing 180° meridian, was $wrappedLon", wrappedLon < 0)
    }

    @Test
    fun testGeofence_insideOutsideAndOnBoundary() {
        val centerLat = 37.7749 // San Francisco
        val centerLon = -122.4194
        val radiusMeters = 500.0

        // Point inside (center)
        assertTrue(LocationMathUtils.isInsideGeofence(centerLat, centerLon, centerLat, centerLon, radiusMeters))

        // Point inside (200m East)
        val (insideLat, insideLon) = LocationMathUtils.calculateDestinationPoint(centerLat, centerLon, 200.0, 90.0)
        assertTrue(LocationMathUtils.isInsideGeofence(insideLat, insideLon, centerLat, centerLon, radiusMeters))

        // Point outside (800m East)
        val (outsideLat, outsideLon) = LocationMathUtils.calculateDestinationPoint(centerLat, centerLon, 800.0, 90.0)
        assertFalse(LocationMathUtils.isInsideGeofence(outsideLat, outsideLon, centerLat, centerLon, radiusMeters))

        // Point exactly on boundary (500m North)
        val (boundaryLat, boundaryLon) = LocationMathUtils.calculateDestinationPoint(centerLat, centerLon, 500.0, 0.0)
        assertTrue(LocationMathUtils.isInsideGeofence(boundaryLat, boundaryLon, centerLat, centerLon, radiusMeters + 0.1))
    }

    @Test
    fun testMidpoint_calculation() {
        val startLat = 10.0
        val startLon = 20.0
        val endLat = 10.0
        val endLon = 30.0

        val (midLat, midLon) = LocationMathUtils.calculateMidpoint(startLat, startLon, endLat, endLon)

        val distStartToMid = LocationMathUtils.calculateDistanceMeters(startLat, startLon, midLat, midLon)
        val distMidToEnd = LocationMathUtils.calculateDistanceMeters(midLat, midLon, endLat, endLon)

        assertEquals(distStartToMid, distMidToEnd, deltaMeters)
    }
}
