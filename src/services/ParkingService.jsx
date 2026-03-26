// src/services/ParkingService.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Parking Service (FINAL WORKING VERSION)
// ═══════════════════════════════════════════════════════════════

import AsyncStorage from '@react-native-async-storage/async-storage';

const API_BASE_URL =
  'https://3fca-2405-201-3037-e001-b079-bd76-8a44-f0e6.ngrok-free.app';

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

const fetchWithTimeout = (url, options = {}, timeout = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...options, signal: controller.signal}).finally(() =>
    clearTimeout(timer),
  );
};

const isValidCoordinate = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const ParkingService = {
  async sendParkingEvent(latitude, longitude, eventType, retryCount = 0) {
    const url = `${API_CONFIG.baseUrl}${API_CONFIG.parkingEventEndpoint}`;

    if (!isValidCoordinate(latitude, longitude)) {
      throw new Error('Invalid coordinates provided');
    }
    if (eventType !== EVENT_TYPES.PARK && eventType !== EVENT_TYPES.LEAVE) {
      throw new Error(
        `Invalid eventType: "${eventType}". Must be "PARK" or "LEAVE"`,
      );
    }

    const body = {latitude, longitude, eventType};

    Logger.info('PARKING_API', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    Logger.info('PARKING_API', `Sending ${eventType} event`);
    Logger.info('PARKING_API', `URL: ${url}`);
    Logger.info('PARKING_API', `Body: ${JSON.stringify(body)}`);
    Logger.info('PARKING_API', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
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
        responseData = {raw: responseText};
      }

      if (!response.ok) {
        throw new Error(
          responseData?.message ||
            responseData?.error ||
            `Server error: ${response.status}`,
        );
      }

      Logger.success('PARKING_API', `✅ ${eventType} event SUCCESS`);

      return {
        success: true,
        data: responseData,
        eventType,
        latitude,
        longitude,
        timestamp: Date.now(),
      };
    } catch (error) {
      Logger.error('PARKING_API', `${eventType} event FAILED`, error);

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
          retryCount + 1,
        );
      }

      throw error;
    }
  },

  async occupySpot(latitude, longitude) {
    Logger.info('PARKING', '🅿️ ===== OCCUPY SPOT (PARK) =====');
    Logger.info('PARKING', `Location: ${latitude}, ${longitude}`);
    Logger.info('PARKING', `EventType: "${EVENT_TYPES.PARK}"`);

    const result = await this.sendParkingEvent(
      latitude,
      longitude,
      EVENT_TYPES.PARK,
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
      serverResponse: result.data,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.MY_SPOT,
      JSON.stringify(spotData),
    );
    await this._addToHistory(spotData);

    Logger.success('PARKING', '🅿️ Spot OCCUPIED (PARK sent)');
    return spotData;
  },

  async vacateSpot(latitude, longitude) {
    Logger.info('PARKING', '🚗 ===== VACATE SPOT (LEAVE) =====');
    Logger.info('PARKING', `Location: ${latitude}, ${longitude}`);
    Logger.info('PARKING', `EventType: "${EVENT_TYPES.LEAVE}"`);

    const result = await this.sendParkingEvent(
      latitude,
      longitude,
      EVENT_TYPES.LEAVE,
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
      serverResponse: result.data,
    };

    await AsyncStorage.setItem(
      STORAGE_KEYS.MY_SPOT,
      JSON.stringify(vacatedSpot),
    );
    await this._addToHistory(vacatedSpot);

    Logger.success('PARKING', '🚗 Spot VACATED (LEAVE sent)');
    return vacatedSpot;
  },

  async fetchNearbySpots(
    latitude,
    longitude,
    radius = API_CONFIG.defaultRadius,
    retryCount = 0,
  ) {
    const url = `${API_CONFIG.baseUrl}${API_CONFIG.operateEndpoint}`;

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
      const response = await fetchWithTimeout(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
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

      try {
        await AsyncStorage.setItem(
          STORAGE_KEYS.NEARBY_CACHE,
          JSON.stringify({
            spots,
            timestamp: Date.now(),
            location: {latitude, longitude},
            radius,
          }),
        );
      } catch (_) {}

      return spots;
    } catch (error) {
      Logger.error('NEARBY', 'Fetch nearby FAILED', error);

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
      } catch (_) {}

      throw error;
    }
  },

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

  async clearMySpot() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.MY_SPOT);
      Logger.info('PARKING', 'Saved spot cleared');
    } catch (error) {
      Logger.error('PARKING', 'Failed to clear spot', error);
    }
  },

  async clearNearbyCache() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.NEARBY_CACHE);
    } catch (_) {}
  },

  async _addToHistory(event) {
    try {
      const historyStr = await AsyncStorage.getItem(
        STORAGE_KEYS.PARKING_HISTORY,
      );
      let history = [];
      if (historyStr) {
        try {
          history = JSON.parse(historyStr);
        } catch (_) {}
      }
      history.unshift({...event, historyId: `hist_${Date.now()}`});
      if (history.length > 50) history = history.slice(0, 50);
      await AsyncStorage.setItem(
        STORAGE_KEYS.PARKING_HISTORY,
        JSON.stringify(history),
      );
    } catch (error) {
      Logger.warn('PARKING', 'Failed to save history', error);
    }
  },

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

  async clearHistory() {
    try {
      await AsyncStorage.removeItem(STORAGE_KEYS.PARKING_HISTORY);
    } catch (_) {}
  },
};

export default ParkingService;
export {EVENT_TYPES, REQUEST_TYPES, API_CONFIG};