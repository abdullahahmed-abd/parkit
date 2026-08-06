// src/services/ParkingService.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Parking Service (WITH JWT AUTHENTICATION)
// ═══════════════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';

// ✅ Import Auth Functions
import {
  getValidAccessToken,
  refreshAccessToken,
  clearAuthData,
} from '../utils/GoogleAuthHandler';

// ═══════════════════════════════════════════════════════════════
// ✅ CONFIGURATION - UPDATE YOUR BACKEND URL HERE
// ═══════════════════════════════════════════════════════════════
const API_BASE_URL = 'https://parkit.sundukpay.com';

const API_CONFIG = {
  baseUrl: API_BASE_URL,
  parkingEventEndpoint: '/parkit-api/parking-event',
  operateEndpoint: '/parkit-api/operate',
  timeout: 15000,
  maxRetries: 2,
  defaultRadius: 500,
};

const STORAGE_KEYS = {
  MY_SPOT: 'myParkingSpot',
  PARKING_HISTORY: 'parkingHistory',
  NEARBY_CACHE: 'nearbyParkingCache',
};

const EVENT_TYPES = {
  PARK: 'PARK',
  LEAVE: 'LEAVE',
};

const REQUEST_TYPES = {
  NEARBY_PARKING_SLOTS: 'NEARBY_PARKING_SLOTS',
  ROUTE: 'ROUTE',
};

// ═══════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════
const Logger = {
  _log(emoji, tag, message, data) {
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const extra = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[${ts}] ${emoji} [${tag}] ${message}${extra}`);
  },
  info(tag, msg, data) {
    this._log('ℹ️', tag, msg, data);
  },
  success(tag, msg, data) {
    this._log('✅', tag, msg, data);
  },
  error(tag, msg, err) {
    this._log('❌', tag, msg, err?.message || err);
  },
  warn(tag, msg, data) {
    this._log('⚠️', tag, msg, data);
  },
};

// ═══════════════════════════════════════════════════════════════
// ✅ GET AUTH HEADERS - WITH ACCESS TOKEN
// ═══════════════════════════════════════════════════════════════
const getAuthHeaders = async () => {
  try {
    const accessToken = await getValidAccessToken();
    
    if (!accessToken) {
      Logger.warn('AUTH', 'No access token available');
      return {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    }

    Logger.info('AUTH', `Token obtained: ${accessToken.substring(0, 20)}...`);

    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    };
  } catch (error) {
    Logger.error('AUTH', 'Failed to get auth headers', error);
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
  }
};

// ═══════════════════════════════════════════════════════════════
// ✅ FETCH WITH TIMEOUT AND AUTH
// ═══════════════════════════════════════════════════════════════
const fetchWithTimeout = (url, options = {}, timeout = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, { ...options, signal: controller.signal }).finally(() =>
    clearTimeout(timer),
  );
};

// ═══════════════════════════════════════════════════════════════
// ✅ AUTHENTICATED FETCH - WITH AUTO TOKEN REFRESH
// ═══════════════════════════════════════════════════════════════
const authenticatedFetch = async (url, options = {}, timeout = API_CONFIG.timeout) => {
  try {
    // Get headers with access token
    const authHeaders = await getAuthHeaders();
    
    const finalOptions = {
      ...options,
      headers: {
        ...authHeaders,
        ...options.headers,
      },
    };

    Logger.info('API', `Making authenticated request to: ${url}`);
    Logger.info('API', `Headers: ${JSON.stringify(Object.keys(finalOptions.headers))}`);

    let response = await fetchWithTimeout(url, finalOptions, timeout);

    // ✅ If 401 Unauthorized, try to refresh token
    if (response.status === 401) {
      Logger.warn('API', '401 Unauthorized - Attempting token refresh...');
      
      try {
        const newAccessToken = await refreshAccessToken();
        
        if (newAccessToken) {
          Logger.info('API', 'Token refreshed, retrying request...');
          
          // Update headers with new token
          finalOptions.headers['Authorization'] = `Bearer ${newAccessToken}`;
          
          // Retry the request
          response = await fetchWithTimeout(url, finalOptions, timeout);
        }
      } catch (refreshError) {
        Logger.error('API', 'Token refresh failed', refreshError);
        
        // Clear auth data and throw auth error
        await clearAuthData();
        
        const error = new Error('Session expired. Please login again.');
        error.code = 'AUTH_EXPIRED';
        throw error;
      }
    }

    return response;
  } catch (error) {
    if (error.code === 'AUTH_EXPIRED') {
      throw error;
    }
    
    Logger.error('API', 'Authenticated fetch failed', error);
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════
// VALIDATE COORDINATES
// ═══════════════════════════════════════════════════════════════
const isValidCoordinate = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

// ═══════════════════════════════════════════════════════════════
// PARKING SERVICE
// ═══════════════════════════════════════════════════════════════
const ParkingService = {
  
  // ─────────────────────────────────────────────────────────────
  // ✅ SEND PARKING EVENT (PARK/LEAVE) - WITH JWT AUTH
  // ─────────────────────────────────────────────────────────────
  async sendParkingEvent(latitude, longitude, eventType, userId, retryCount = 0) {
    const url = `${API_CONFIG.baseUrl}${API_CONFIG.parkingEventEndpoint}`;

    // Validate coordinates
    if (!isValidCoordinate(latitude, longitude)) {
      throw new Error('Invalid coordinates provided');
    }
    
    // Validate event type
    if (eventType !== EVENT_TYPES.PARK && eventType !== EVENT_TYPES.LEAVE) {
      throw new Error(
        `Invalid eventType: "${eventType}". Must be "PARK" or "LEAVE"`,
      );
    }

    // ✅ Validate userId
    if (!userId || typeof userId !== 'string') {
      throw new Error('Valid userId is required');
    }

    const body = {
      latitude,
      longitude,
      eventType,
      userId,
    };

    Logger.info('PARKING_API', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.info('PARKING_API', `Sending ${eventType} event`);
    Logger.info('PARKING_API', `User: ${userId}`);
    Logger.info('PARKING_API', `URL: ${url}`);
    Logger.info('PARKING_API', `Body: ${JSON.stringify(body)}`);
    Logger.info('PARKING_API', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // ✅ Use authenticated fetch
      const response = await authenticatedFetch(
        url,
        {
          method: 'POST',
          body: JSON.stringify(body),
        },
        API_CONFIG.timeout,
      );

      const responseText = await response.text();
      Logger.info('PARKING_API', `Response status: ${response.status}`);
      Logger.info('PARKING_API', `Response body: ${responseText}`);

      let responseData = null;
      try {
        responseData = JSON.parse(responseText);
      } catch (_) {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        throw new Error(
          responseData?.message ||
            responseData?.error ||
            `Server error: ${response.status}`,
        );
      }

      Logger.success('PARKING_API', `${eventType} event SUCCESS for ${userId}`);

      return {
        success: true,
        data: responseData,
        eventType,
        latitude,
        longitude,
        userId,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error('PARKING_API', `${eventType} event FAILED for ${userId}`, error);

      // ✅ Don't retry if auth expired
      if (error.code === 'AUTH_EXPIRED') {
        throw error;
      }

      if (retryCount < API_CONFIG.maxRetries) {
        const delay = 2000 * (retryCount + 1);
        Logger.warn(
          'PARKING_API',
          `Retrying in ${delay}ms (attempt ${retryCount + 2})`,
        );
        await new Promise(r => setTimeout(r, delay));
        return this.sendParkingEvent(
          latitude,
          longitude,
          eventType,
          userId,
          retryCount + 1,
        );
      }

      throw error;
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ✅ OCCUPY SPOT - WITH JWT AUTH
  // ─────────────────────────────────────────────────────────────
  async occupySpot(latitude, longitude, userId) {
    Logger.info('PARKING', '🅿️ ===== OCCUPY SPOT (PARK) =====');
    Logger.info('PARKING', `User: ${userId}`);
    Logger.info('PARKING', `Location: ${latitude}, ${longitude}`);
    Logger.info('PARKING', `EventType: "${EVENT_TYPES.PARK}"`);

    // ✅ Validate userId
    if (!userId) {
      throw new Error('userId is required to occupy a spot');
    }

    const result = await this.sendParkingEvent(
      latitude,
      longitude,
      EVENT_TYPES.PARK,
      userId,
    );

    const spotData = {
      id: `my_${Date.now()}`,
      latitude,
      longitude,
      isOccupied: true,
      isMySpot: true,
      deviceName: 'My Car',
      eventType: EVENT_TYPES.PARK,
      createdAt: Date.now(),
      userId,
      serverResponse: result.data,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.MY_SPOT,
      JSON.stringify(spotData),
    );
    await this._addToHistory(spotData);

    Logger.success('PARKING', `🅿️ Spot OCCUPIED by ${userId}`);
    return spotData;
  },

  // ─────────────────────────────────────────────────────────────
  // ✅ VACATE SPOT - WITH JWT AUTH
  // ─────────────────────────────────────────────────────────────
  async vacateSpot(latitude, longitude, userId) {
    Logger.info('PARKING', '🚗 ===== VACATE SPOT (LEAVE) =====');
    Logger.info('PARKING', `User: ${userId}`);
    Logger.info('PARKING', `Location: ${latitude}, ${longitude}`);
    Logger.info('PARKING', `EventType: "${EVENT_TYPES.LEAVE}"`);

    // ✅ Validate userId
    if (!userId) {
      throw new Error('userId is required to vacate a spot');
    }

    const result = await this.sendParkingEvent(
      latitude,
      longitude,
      EVENT_TYPES.LEAVE,
      userId,
    );

    const stored = await this.getMySpot();

    const vacatedSpot = {
      id: stored?.id || `vacate_${Date.now()}`,
      latitude,
      longitude,
      isOccupied: false,
      isMySpot: true,
      deviceName: stored?.deviceName || 'My Car',
      eventType: EVENT_TYPES.LEAVE,
      createdAt: stored?.createdAt || Date.now(),
      vacatedAt: Date.now(),
      userId,
      serverResponse: result.data,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.MY_SPOT,
      JSON.stringify(vacatedSpot),
    );
    await this._addToHistory(vacatedSpot);

    Logger.success('PARKING', `🚗 Spot VACATED by ${userId}`);
    return vacatedSpot;
  },

  // ─────────────────────────────────────────────────────────────
  // ✅ FETCH NEARBY SPOTS - WITH JWT AUTH
  // ─────────────────────────────────────────────────────────────
  async fetchNearbySpots(
    latitude,
    longitude,
    radius = API_CONFIG.defaultRadius,
    retryCount = 0,
  ) {
    const url = API_CONFIG.baseUrl + API_CONFIG.operateEndpoint;

    if (!isValidCoordinate(latitude, longitude)) {
      throw new Error('Invalid coordinates for nearby search');
    }

    const body = {
      userLat: latitude,
      userLon: longitude,
      radius: radius,
      requestType: REQUEST_TYPES.NEARBY_PARKING_SLOTS,
    };

    Logger.info('NEARBY', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.info('NEARBY', '🔍 Fetching nearby parking slots');
    Logger.info('NEARBY', `URL: ${url}`);
    Logger.info('NEARBY', `Body: ${JSON.stringify(body)}`);
    Logger.info('NEARBY', `Radius: ${radius}m`);
    Logger.info('NEARBY', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      // ✅ Use authenticated fetch
      const response = await authenticatedFetch(
        url,
        {
          method: 'POST',
          headers: {
            'ngrok-skip-browser-warning': 'true',
          },
          body: JSON.stringify(body),
        },
        API_CONFIG.timeout,
      );

      const responseText = await response.text();
      Logger.info('NEARBY', `Response status: ${response.status}`);

      let responseData = null;
      try {
        responseData = JSON.parse(responseText);
      } catch (_) {
        Logger.error('NEARBY', `Response was: ${responseText.substring(0, 200)}`);
        throw new Error('Invalid JSON response from server');
      }

      if (!response.ok) {
        throw new Error(
          responseData?.message ||
            responseData?.error ||
            `Server error: ${response.status}`,
        );
      }

      let rawSlots = [];

      // Try different response structures
      if (Array.isArray(responseData)) {
        rawSlots = responseData;
      } else if (Array.isArray(responseData?.slots)) {
        rawSlots = responseData.slots;
      } else if (Array.isArray(responseData?.parkingSlots)) {
        rawSlots = responseData.parkingSlots;
      } else if (Array.isArray(responseData?.parkingSlotsList)) {
        rawSlots = responseData.parkingSlotsList;
      } else if (Array.isArray(responseData?.data)) {
        rawSlots = responseData.data;
      } else if (Array.isArray(responseData?.data?.slots)) {
        rawSlots = responseData.data.slots;
      } else if (responseData && typeof responseData === 'object') {
        const keys = Object.keys(responseData);
        for (const key of keys) {
          if (Array.isArray(responseData[key])) {
            rawSlots = responseData[key];
            Logger.info('NEARBY', `Found slots in key: "${key}"`);
            break;
          }
        }
      }

      Logger.info('NEARBY', `Raw slots count: ${rawSlots.length}`);

      const spots = rawSlots
        .map((slot, index) => {
          const lat =
            slot.latitude ??
            slot.lat ??
            slot.spotLat ??
            slot.location?.latitude ??
            slot.location?.lat ??
            null;

          const lng =
            slot.longitude ??
            slot.lng ??
            slot.lon ??
            slot.spotLon ??
            slot.location?.longitude ??
            slot.location?.lng ??
            slot.location?.lon ??
            null;

          if (lat === null || lng === null || !isValidCoordinate(lat, lng)) {
            Logger.warn(
              'NEARBY',
              `Skipping slot ${index} — invalid coords`,
              slot,
            );
            return null;
          }

          let isOccupied = false;
          if (typeof slot.isOccupied === 'boolean') {
            isOccupied = slot.isOccupied;
          } else if (typeof slot.occupied === 'boolean') {
            isOccupied = slot.occupied;
          } else if (typeof slot.available === 'boolean') {
            isOccupied = !slot.available;
          } else if (typeof slot.status === 'string') {
            const s = slot.status.toUpperCase();
            isOccupied =
              s === 'OCCUPIED' ||
              s === 'PARKED' ||
              s === 'PARK' ||
              s === 'TAKEN' ||
              s === 'UNAVAILABLE';
          } else if (typeof slot.eventType === 'string') {
            isOccupied = slot.eventType.toUpperCase() === 'PARK';
          }

          const deviceName =
            slot.deviceName ??
            slot.name ??
            slot.spotName ??
            slot.device ??
            slot.vehicleName ??
            slot.label ??
            `Spot ${index + 1}`;

          const spotId =
            slot.id ??
            slot.slotId ??
            slot.spotId ??
            slot._id ??
            `nearby_${index}_${Date.now()}`;

          const createdAt =
            slot.createdAt ??
            slot.timestamp ??
            slot.updatedAt ??
            slot.lastUpdated ??
            Date.now();

          return {
            id: String(spotId),
            latitude: parseFloat(lat),
            longitude: parseFloat(lng),
            isOccupied,
            isMySpot: false,
            deviceName: String(deviceName),
            createdAt:
              typeof createdAt === 'string'
                ? new Date(createdAt).getTime()
                : createdAt,
            eventType: slot.eventType || (isOccupied ? 'PARK' : 'LEAVE'),
            _raw: __DEV__ ? slot : undefined,
          };
        })
        .filter(Boolean);

      Logger.success(
        'NEARBY',
        `✅ Parsed ${spots.length} spots from ${rawSlots.length} raw`,
      );
      Logger.info(
        'NEARBY',
        `Occupied: ${spots.filter(s => s.isOccupied).length} | Available: ${spots.filter(s => !s.isOccupied).length}`,
      );

      // Cache the results
      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.NEARBY_CACHE,
          JSON.stringify({
            spots,
            timestamp: Date.now(),
            location: { latitude, longitude },
            radius,
          }),
        );
      } catch (_) {
        // Ignore cache errors
      }

      return spots;
    } catch (error) {
      Logger.error('NEARBY', 'Fetch nearby FAILED', error);

      // ✅ Don't retry if auth expired
      if (error.code === 'AUTH_EXPIRED') {
        throw error;
      }

      // Retry logic
      if (retryCount < API_CONFIG.maxRetries) {
        const delay = 2000 * (retryCount + 1);
        Logger.warn(
          'NEARBY',
          `Retrying in ${delay}ms (attempt ${retryCount + 2})`,
        );
        await new Promise(r => setTimeout(r, delay));
        return this.fetchNearbySpots(
          latitude,
          longitude,
          radius,
          retryCount + 1,
        );
      }

      // Try to use cached data as fallback
      try {
        const cached = await AsyncStorage.getItem(STORAGE_KEYS.NEARBY_CACHE);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Date.now() - parsed.timestamp < 5 * 60 * 1000) {
            Logger.warn(
              'NEARBY',
              `Using cached data (${parsed.spots.length} spots)`,
            );
            return parsed.spots;
          }
        }
      } catch (_) {
        // Ignore cache errors
      }

      throw error;
    }
  },

  // ─────────────────────────────────────────────────────────────
  // GET MY SPOT
  // ─────────────────────────────────────────────────────────────
  async getMySpot() {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.MY_SPOT);
      if (!stored) return null;
      return JSON.parse(stored);
    } catch (error) {
      Logger.error('PARKING', 'Failed to read saved spot', error);
      return null;
    }
  },

  // ─────────────────────────────────────────────────────────────
  // CLEAR MY SPOT
  // ─────────────────────────────────────────────────────────────
  async clearMySpot() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.MY_SPOT);
      Logger.info('PARKING', 'Saved spot cleared');
    } catch (error) {
      Logger.error('PARKING', 'Failed to clear spot', error);
    }
  },

  // ─────────────────────────────────────────────────────────────
  // CLEAR NEARBY CACHE
  // ─────────────────────────────────────────────────────────────
  async clearNearbyCache() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.NEARBY_CACHE);
    } catch (_) {
      // Ignore errors
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ADD TO HISTORY (INTERNAL)
  // ─────────────────────────────────────────────────────────────
  async _addToHistory(event) {
    try {
      const historyStr = await AsyncStorage.getItem(
        STORAGE_KEYS.PARKING_HISTORY,
      );
      let history = [];
      if (historyStr) {
        try {
          history = JSON.parse(historyStr);
        } catch (_) {
          // Ignore parse errors
        }
      }
      history.unshift({ ...event, historyId: `hist_${Date.now()}` });
      if (history.length > 50) history = history.slice(0, 50);
      await AsyncStorage.setItem(
        STORAGE_KEYS.PARKING_HISTORY,
        JSON.stringify(history),
      );
    } catch (error) {
      Logger.warn('PARKING', 'Failed to save history', error);
    }
  },

  // ─────────────────────────────────────────────────────────────
  // GET HISTORY
  // ─────────────────────────────────────────────────────────────
  async getHistory() {
    try {
      const historyStr = await AsyncStorage.getItem(
        STORAGE_KEYS.PARKING_HISTORY,
      );
      if (!historyStr) return [];
      return JSON.parse(historyStr);
    } catch (error) {
      Logger.error('PARKING', 'Failed to read history', error);
      return [];
    }
  },

  // ─────────────────────────────────────────────────────────────
  // CLEAR HISTORY
  // ─────────────────────────────────────────────────────────────
  async clearHistory() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.PARKING_HISTORY);
      Logger.info('PARKING', 'History cleared');
    } catch (error) {
      Logger.error('PARKING', 'Failed to clear history', error);
    }
  },

  // ─────────────────────────────────────────────────────────────
  // ✅ CHECK AUTH STATUS
  // ─────────────────────────────────────────────────────────────
  async checkAuthStatus() {
    try {
      const accessToken = await getValidAccessToken();
      return {
        isAuthenticated: !!accessToken,
        hasToken: !!accessToken,
      };
    } catch (error) {
      Logger.error('AUTH', 'Auth check failed', error);
      return {
        isAuthenticated: false,
        hasToken: false,
        error: error.message,
      };
    }
  },

  // ─────────────────────────────────────────────────────────────
  // GET API CONFIG (for debugging)
  // ─────────────────────────────────────────────────────────────
  getConfig() {
    return {
      baseUrl: API_CONFIG.baseUrl,
      parkingEventEndpoint: API_CONFIG.parkingEventEndpoint,
      operateEndpoint: API_CONFIG.operateEndpoint,
      fullParkingEventUrl: `${API_CONFIG.baseUrl}${API_CONFIG.parkingEventEndpoint}`,
      fullOperateUrl: `${API_CONFIG.baseUrl}${API_CONFIG.operateEndpoint}`,
    };
  },
};

export default ParkingService;
export { EVENT_TYPES, REQUEST_TYPES, API_CONFIG };