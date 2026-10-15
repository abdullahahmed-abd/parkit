package com.parkit.location

import android.location.Location
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.test.runTest
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LocationRepositoryTest {

    @Before
    fun setUp() {
        LocationRepository.clearError()
        LocationRepository.setTracking(false)
    }

    @Test
    fun testRepository_initialStateAndUpdates() {
        assertNull(LocationRepository.error.value)
        assertFalse(LocationRepository.isTracking.value)

        // Test set tracking
        LocationRepository.setTracking(true)
        assertTrue(LocationRepository.isTracking.value)

        // Test set error
        val testError = "GPS signal lost"
        LocationRepository.setError(testError)
        assertEquals(testError, LocationRepository.error.value)

        // Test clear error
        LocationRepository.clearError()
        assertNull(LocationRepository.error.value)
    }

    @Test
    fun testRepository_errorPropagationFromFakeClient() = runTest {
        val fakeClient = FakeLocationClient().apply {
            shouldThrowException = true
            exceptionToThrow = LocationClient.LocationException("Hardware error")
        }

        LocationRepository.setTracking(true)

        val job = fakeClient.getLocationUpdates(1000L)
            .catch { exception ->
                LocationRepository.setError(exception.localizedMessage)
                LocationRepository.setTracking(false)
            }
            .onEach { location ->
                LocationRepository.updateLocation(location)
            }
            .launchIn(this)

        job.join()

        // Error should be pushed to repository and tracking stopped
        assertEquals("Hardware error", LocationRepository.error.value)
        assertFalse(LocationRepository.isTracking.value)
    }

    @Test
    fun testRepository_stopCleansTrackingState() = runTest {
        val fakeClient = FakeLocationClient()
        LocationRepository.setTracking(true)
        assertTrue(LocationRepository.isTracking.value)

        val job = fakeClient.getLocationUpdates(1000L)
            .launchIn(this)

        testScheduler.runCurrent()
        assertTrue(fakeClient.isCollecting)

        // Simulate Stop
        job.cancel()
        testScheduler.runCurrent()
        LocationRepository.setTracking(false)

        assertFalse(LocationRepository.isTracking.value)
    }
}
