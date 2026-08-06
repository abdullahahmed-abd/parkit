// src/services/NavigationService.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Navigation Service v9.3 (REROUTING FIXED)
// ═══════════════════════════════════════════════════════════════

import { Platform, Vibration } from 'react-native';
import Tts from 'react-native-tts';

import {
  getValidAccessToken,
  refreshAccessToken,
  clearAuthData,
} from '../utils/GoogleAuthHandler';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
export const API_BASE_URL =
  'https://parkit.sundukpay.com';

export const APP_CONFIG = {
  APP_NAME: 'ParkIt',
  VERSION: '9.3.0',
  IS_DEV: __DEV__ || false,
};

export const BACKEND_CONFIG = {
  baseUrl: `${API_BASE_URL}/parkit-api/operate`,
  timeout: 15000,
  maxRetries: 2,
  retryDelay: 1500,
};

export const NAV_CONFIG = {
  LOCATION_UPDATE_DISTANCE: 3,
  LOCATION_UPDATE_INTERVAL: 1000,
  MIN_ACCURACY: 100,
  DISTANCE_THRESHOLD_ARRIVED: 15,
  DISTANCE_THRESHOLD_NEXT_STEP: 25,
  STEP_ADVANCE_HYSTERESIS: 10,
  STEP_ADVANCE_MIN_DISTANCE: 20,
  ROUTE_DEVIATION_THRESHOLD: 40,
  ROUTE_DEVIATION_MIN_CHECKS: 2,
  REROUTE_COOLDOWN: 10000,
  REROUTE_MIN_DISTANCE_TO_DEST: 30,
  MAX_REROUTES_PER_SESSION: 15,
  REROUTE_BACKOFF_MULTIPLIER: 1.3,
  REROUTE_MAX_COOLDOWN: 45000,
  REROUTE_FAILURE_COOLDOWN: 5000,
  REROUTE_CHECK_INTERVAL: 500,
  ROUTE_VISUAL_UPDATE_THRESHOLD: 3,
  SNAP_TO_ROUTE_THRESHOLD: 50,
  SMOOTH_ROUTE_MIN_MOVE: 1.5,
  ROUTE_TRIM_BUFFER: 0,
  NAVIGATION_ZOOM: 17.5,
  NAVIGATION_TILT: 50,
  CAMERA_ANIMATION_DURATION: 500,
  MIN_CAMERA_UPDATE_INTERVAL: 400,
  CAMERA_EASE_DURATION: 500,
  HEADING_SMOOTHING: 0.3,
  MIN_SPEED_FOR_HEADING: 0.5,
  VOICE_ANNOUNCE_DISTANCES: [500, 200, 100, 50, 25],
  VOICE_COOLDOWN: 5000,
};

export const NEARBY_CONFIG = {
  RADIUS: 500,
  AUTO_REFRESH_INTERVAL: 60000,
  MIN_MOVE_TO_REFRESH: 50,
};

export const DEFAULT_LOC = { latitude: 23.2599, longitude: 77.4126 };

export const LOCATION_TRACKING_CONFIG = {
  NAVIGATION: {
    enableHighAccuracy: true,
    distanceFilter: 3,
    interval: 2000,
    fastestInterval: 1000,
    timeout: 10000,
    maximumAge: 3000,
    forceLocationManager: true,
    showLocationDialog: true,
    forceRequestLocation: true,
  },
  PASSIVE: {
    enableHighAccuracy: true,
    distanceFilter: 8,
    interval: 5000,
    fastestInterval: 3000,
    timeout: 10000,
    maximumAge: 10000,
    forceLocationManager: false,
    showLocationDialog: true,
    forceRequestLocation: false,
  },
  PROCESSING: {
    minUpdateInterval: 800,
    maxAccuracy: 200,
    minMovement: 2,
    minMovementLowAccuracy: 5,
    lowAccuracyThreshold: 50,
    maxConsecutiveLowAccuracy: 3,
    allowStationary: true,
    stationaryUpdateInterval: 5000,
  },
};

export const EMPTY_STYLE = JSON.stringify({
  version: 8,
  name: 'Empty',
  sources: {},
  layers: [],
});
export const MAP_STYLE = JSON.stringify({
  version: 8,
  name: 'ParkIt OSM',
  sources: {
    'osm-tiles': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      maxzoom: 19,
      minzoom: 1,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm-tiles',
      minzoom: 1,
      maxzoom: 19,
      paint: {
        'raster-opacity': 1,
      },
    },
  ],
});
// ═══════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════
const LOG_LEVELS = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
  VERBOSE: 4,
};

export const Logger = {
  _enabled: APP_CONFIG.IS_DEV,
  _verboseMode: false,
  _logLevel: APP_CONFIG.IS_DEV ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN,
  _logBuffer: [],
  _maxBufferSize: 200,

  _shouldLog(level) {
    return Logger._enabled && level <= Logger._logLevel;
  },

  _format(emoji, tag, message, data, level = LOG_LEVELS.INFO) {
    if (!Logger._shouldLog(level)) return;

    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const extra = data
      ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}`
      : '';
    const logLine = `[${ts}] ${emoji} [${tag}] ${message}${extra}`;

    Logger._logBuffer.push({ ts: Date.now(), line: logLine, level, tag });
    if (Logger._logBuffer.length > Logger._maxBufferSize) {
      Logger._logBuffer.shift();
    }

    switch (level) {
      case LOG_LEVELS.ERROR:
        console.error(logLine);
        break;
      case LOG_LEVELS.WARN:
        console.warn(logLine);
        break;
      default:
        console.log(logLine);
    }
  },

  info: (tag, msg, data) =>
    Logger._format('ℹ️', tag, msg, data, LOG_LEVELS.INFO),
  success: (tag, msg, data) =>
    Logger._format('✅', tag, msg, data, LOG_LEVELS.INFO),
  warn: (tag, msg, data) =>
    Logger._format('⚠️', tag, msg, data, LOG_LEVELS.WARN),
  debug: (tag, msg, data) =>
    Logger._format('🔧', tag, msg, data, LOG_LEVELS.DEBUG),
  error: (tag, msg, err) => {
    const errorMsg = err?.message || err?.toString() || 'Unknown error';
    const errorStack = err?.stack || '';
    Logger._format('❌', tag, msg, errorMsg, LOG_LEVELS.ERROR);
    if (!Logger._enabled) console.error(`[${tag}] ${msg}:`, err);
    if (Logger._verboseMode && errorStack)
      console.error('Stack trace:', errorStack);
  },
  nav: (msg, data) =>
    Logger._format('🧭', 'NAV', msg, data, LOG_LEVELS.INFO),
  loc: (msg, data) =>
    Logger._format('📌', 'LOC', msg, data, LOG_LEVELS.DEBUG),
  snap: (msg, data) =>
    Logger._format('🎯', 'SNAP', msg, data, LOG_LEVELS.DEBUG),
  cleanup: (msg, data) =>
    Logger._format('🧹', 'CLEANUP', msg, data, LOG_LEVELS.INFO),
  perf: (msg, data) =>
    Logger._format('⚡', 'PERF', msg, data, LOG_LEVELS.DEBUG),
  reroute: (msg, data) =>
    Logger._format('🔄', 'REROUTE', msg, data, LOG_LEVELS.INFO),
  api: (msg, data) =>
    Logger._format('🌐', 'API', msg, data, LOG_LEVELS.DEBUG),
  voice: (msg, data) =>
    Logger._format('🔊', 'VOICE', msg, data, LOG_LEVELS.DEBUG),

  verbose(tag, msg, data) {
    if (Logger._verboseMode)
      Logger._format('🔍', tag, msg, data, LOG_LEVELS.VERBOSE);
  },

  setEnabled: (enabled) => {
    Logger._enabled = enabled;
  },
  setVerbose: (verbose) => {
    Logger._verboseMode = verbose;
  },
  setLogLevel: (level) => {
    if (LOG_LEVELS[level] !== undefined) Logger._logLevel = LOG_LEVELS[level];
  },
  getRecentLogs: (count = 50, tag = null) => {
    let logs = Logger._logBuffer;
    if (tag) logs = logs.filter((l) => l.tag === tag);
    return logs.slice(-count);
  },
  getErrorLogs: (count = 20) =>
    Logger._logBuffer
      .filter((l) => l.level === LOG_LEVELS.ERROR)
      .slice(-count),
  clearBuffer: () => {
    Logger._logBuffer = [];
  },
  exportLogs: () => JSON.stringify(Logger._logBuffer, null, 2),
};

// ═══════════════════════════════════════════════════════════════
// SAFE VIBRATE
// ═══════════════════════════════════════════════════════════════
export const safeVibrate = (duration = 150) => {
  try {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate(duration);
    }
  } catch (e) {
    Logger.verbose('VIBRATE', 'Failed', e?.message);
  }
};

// ═══════════════════════════════════════════════════════════════
// AUTH HEADERS
// ═══════════════════════════════════════════════════════════════
const getAuthHeaders = async () => {
  try {
    const accessToken = await getValidAccessToken();
    if (!accessToken) {
      Logger.warn('AUTH', 'No access token available');
      return { 'Content-Type': 'application/json', Accept: 'application/json' };
    }
    return {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    };
  } catch (error) {
    Logger.error('AUTH', 'Failed to get auth headers', error);
    return { 'Content-Type': 'application/json', Accept: 'application/json' };
  }
};

// ═══════════════════════════════════════════════════════════════
// AUTHENTICATED FETCH
// ═══════════════════════════════════════════════════════════════
const authenticatedFetch = async (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const authHeaders = await getAuthHeaders();
    const finalOptions = {
      ...options,
      headers: { ...authHeaders, ...options.headers },
      signal: controller.signal,
    };

    Logger.api('Making authenticated request', {
      url,
      hasToken: !!authHeaders.Authorization,
    });

    let response = await fetch(url, finalOptions);

    if (response.status === 401) {
      Logger.warn('API', '401 - Attempting token refresh...');
      try {
        const newAccessToken = await refreshAccessToken();
        if (newAccessToken) {
          finalOptions.headers['Authorization'] = `Bearer ${newAccessToken}`;
          response = await fetch(url, finalOptions);
          Logger.info('API', `Retry response: ${response.status}`);
        } else {
          throw new Error('Token refresh returned no token');
        }
      } catch (refreshError) {
        Logger.error('API', 'Token refresh failed', refreshError);
        await clearAuthData();
        const error = new Error('Session expired. Please login again.');
        error.code = 'AUTH_EXPIRED';
        throw error;
      }
    }

    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError')
      throw new Error(`Request timeout after ${timeout}ms`);
    if (error.code === 'AUTH_EXPIRED') throw error;
    Logger.error('API', 'Authenticated fetch failed', error);
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════
// FETCH WITH TIMEOUT
// ═══════════════════════════════════════════════════════════════
export const fetchWithTimeout = async (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response;
  } catch (error) {
    clearTimeout(timer);
    if (error.name === 'AbortError')
      throw new Error(`Request timeout after ${timeout}ms`);
    throw error;
  }
};

// ═══════════════════════════════════════════════════════════════
// GEO UTILITIES
// ═══════════════════════════════════════════════════════════════
export const validLL = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 &&
  !(lat === 0 && lng === 0);

export const calcDistance = (lat1, lng1, lat2, lng2) => {
  if (!validLL(lat1, lng1) || !validLL(lat2, lng2)) return 0;
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calcBearing = (lat1, lng1, lat2, lng2) => {
  if (!validLL(lat1, lng1) || !validLL(lat2, lng2)) return 0;
  const rad = (x) => (x * Math.PI) / 180;
  const deg = (x) => (x * 180) / Math.PI;
  const dLng = rad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

export const smoothHeading = (currentHeading, targetHeading, factor = 0.3) => {
  if (currentHeading === null || currentHeading === undefined)
    return targetHeading;
  if (targetHeading === null || targetHeading === undefined)
    return currentHeading;
  let diff = targetHeading - currentHeading;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return (currentHeading + diff * factor + 360) % 360;
};

export const interpolateCoord = (a, b, t) => {
  if (!a || !b || a.length < 2 || b.length < 2) return a || b || [0, 0];
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

// ═══════════════════════════════════════════════════════════════
// FORMAT UTILITIES
// ═══════════════════════════════════════════════════════════════
export const formatDistanceNav = (m) => {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 50) return `${Math.round(m)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

export const formatDistance = (m) => {
  if (!Number.isFinite(m) || m < 0) return 'N/A';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

export const formatDuration = (s) => {
  if (!s || !Number.isFinite(s) || s < 0) return 'N/A';
  const mins = Math.round(s / 60);
  if (mins < 1) return '< 1 min';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hrs} hr ${remainingMins} min` : `${hrs} hr`;
};

export const formatTime = (ts) => {
  if (!ts) return 'N/A';
  const diff = Date.now() - ts;
  if (diff < 0) return 'Just now';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

// ═══════════════════════════════════════════════════════════════
// POLYLINE DECODER
// ═══════════════════════════════════════════════════════════════
export const decodePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  const coords = [];
  let idx = 0,
    lat = 0,
    lng = 0;
  try {
    while (idx < encoded.length) {
      let shift = 0,
        result = 0,
        byte;
      do {
        byte = encoded.charCodeAt(idx++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;
      do {
        byte = encoded.charCodeAt(idx++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      const dLat = lat / 1e5,
        dLng = lng / 1e5;
      if (validLL(dLat, dLng)) coords.push([dLng, dLat]);
    }
    return coords;
  } catch (error) {
    Logger.error('POLYLINE', 'Decode failed', error);
    return [];
  }
};

// ═══════════════════════════════════════════════════════════════
// SNAP TO ROUTE UTILITIES
// ═══════════════════════════════════════════════════════════════
const closestPointOnSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax,
    dy = by - ay;
  if (dx === 0 && dy === 0) return { x: ax, y: ay, t: 0 };
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
  );
  return { x: ax + t * dx, y: ay + t * dy, t };
};

export const findNearestPointOnRoute = (userLocation, coords) => {
  if (!coords || coords.length < 2 || !userLocation) return null;
  const userLng = userLocation.longitude,
    userLat = userLocation.latitude;
  if (!validLL(userLat, userLng)) return null;

  let minDist = Infinity,
    nearestPt = null,
    segIdx = 0,
    nearestT = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i],
      b = coords[i + 1];
    if (!a || !b || a.length < 2 || b.length < 2) continue;
    const aLng = a[0],
      aLat = a[1],
      bLng = b[0],
      bLat = b[1];
    if (!validLL(aLat, aLng) || !validLL(bLat, bLng)) continue;
    const c = closestPointOnSegment(userLng, userLat, aLng, aLat, bLng, bLat);
    const d = calcDistance(userLat, userLng, c.y, c.x);
    if (d < minDist) {
      minDist = d;
      nearestPt = { lng: c.x, lat: c.y };
      segIdx = i;
      nearestT = c.t;
    }
  }

  if (!nearestPt) return null;
  return { segmentIndex: segIdx, distance: minDist, point: nearestPt, t: nearestT };
};

export const snapToRoute = (userLocation, routeCoordinates, maxDistance = 50) => {
  if (!userLocation || !routeCoordinates || routeCoordinates.length < 2)
    return null;
  try {
    const nearest = findNearestPointOnRoute(userLocation, routeCoordinates);
    if (!nearest || !nearest.point) return null;
    if (nearest.distance > maxDistance) return null;
    return {
      coordinate: [nearest.point.lng, nearest.point.lat],
      latitude: nearest.point.lat,
      longitude: nearest.point.lng,
      distance: nearest.distance,
      segmentIndex: nearest.segmentIndex,
      t: nearest.t,
    };
  } catch (e) {
    Logger.error('SNAP', 'snapToRoute failed', e);
    return null;
  }
};

export const calculateRouteDistance = (coords) => {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i],
      b = coords[i + 1];
    if (!a || !b || a.length < 2 || b.length < 2) continue;
    total += calcDistance(a[1], a[0], b[1], b[0]);
  }
  return total;
};

// ─── NEW: Direct distance from route ───────────────────────────
export const getDistanceFromRouteLine = (userLat, userLng, routeCoords) => {
  if (!routeCoords || routeCoords.length < 2) return 0;
  if (!validLL(userLat, userLng)) return 0;

  let minDistance = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const point = routeCoords[i];
    if (!point || point.length < 2) continue;
    const dist = calcDistance(userLat, userLng, point[1], point[0]);
    if (dist < minDistance) minDistance = dist;
  }
  return minDistance === Infinity ? 0 : minDistance;
};

const distanceAlongRoute = (coords, segIndex, t) => {
  if (!coords || coords.length < 2) return 0;
  let dist = 0;
  for (let i = 0; i < segIndex && i < coords.length - 1; i++) {
    const a = coords[i],
      b = coords[i + 1];
    if (!a || !b) continue;
    dist += calcDistance(a[1], a[0], b[1], b[0]);
  }
  if (
    segIndex < coords.length - 1 &&
    coords[segIndex] &&
    coords[segIndex + 1]
  ) {
    const segDist = calcDistance(
      coords[segIndex][1],
      coords[segIndex][0],
      coords[segIndex + 1][1],
      coords[segIndex + 1][0],
    );
    dist += segDist * t;
  }
  return dist;
};

// ═══════════════════════════════════════════════════════════════
// MANEUVER ICONS & INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
const MANEUVER_ICONS = {
  depart: '🚀',
  arrive: '🎯',
  'turn-right': '➡️',
  'turn-left': '⬅️',
  'turn-slight-right': '↗️',
  'turn-slight-left': '↖️',
  'turn-sharp-right': '⤴️',
  'turn-sharp-left': '⤵️',
  continue: '⬆️',
  straight: '⬆️',
  roundabout: '🔄',
  'exit roundabout': '↪️',
  rotary: '🔄',
  uturn: '↩️',
  'new name': '⬆️',
  merge: '🔀',
  'on ramp': '↗️',
  'off ramp': '↘️',
  fork: '⑂',
  'end of road': '⬆️',
  notification: 'ℹ️',
  default: '⬆️',
};

export const getManeuverIcon = (type, modifier) => {
  if (!type) return MANEUVER_ICONS.default;
  if (type === 'depart') return MANEUVER_ICONS.depart;
  if (type === 'arrive') return MANEUVER_ICONS.arrive;
  const key = modifier ? `${type}-${modifier}` : type;
  return MANEUVER_ICONS[key] || MANEUVER_ICONS[type] || MANEUVER_ICONS.default;
};

export const getManeuverInstruction = (type, modifier, name) => {
  const street = name?.trim() || 'the road';
  switch (type) {
    case 'depart':
      return `Start on ${street}`;
    case 'arrive':
      return 'You have arrived at your destination';
    case 'turn':
      switch (modifier) {
        case 'right':
          return `Turn right onto ${street}`;
        case 'left':
          return `Turn left onto ${street}`;
        case 'slight right':
          return `Keep slight right onto ${street}`;
        case 'slight left':
          return `Keep slight left onto ${street}`;
        case 'sharp right':
          return `Sharp right onto ${street}`;
        case 'sharp left':
          return `Sharp left onto ${street}`;
        case 'uturn':
          return 'Make a U-turn';
        default:
          return `Turn onto ${street}`;
      }
    case 'new name':
    case 'continue':
      return `Continue on ${street}`;
    case 'roundabout':
    case 'rotary':
      return 'Enter roundabout';
    case 'exit roundabout':
      return `Exit roundabout onto ${street}`;
    case 'merge':
      return `Merge onto ${street}`;
    case 'on ramp':
      return `Take the ramp onto ${street}`;
    case 'off ramp':
      return `Take the exit onto ${street}`;
    case 'fork':
      if (modifier === 'left') return `Keep left at the fork onto ${street}`;
      if (modifier === 'right') return `Keep right at the fork onto ${street}`;
      return `Continue at the fork onto ${street}`;
    case 'end of road':
      if (modifier === 'left') return `Turn left onto ${street}`;
      if (modifier === 'right') return `Turn right onto ${street}`;
      return `Continue onto ${street}`;
    case 'uturn':
      return 'Make a U-turn';
    default:
      return `Continue on ${street}`;
  }
};

// ═══════════════════════════════════════════════════════════════
// VOICE GUIDANCE
// ═══════════════════════════════════════════════════════════════
export const VoiceGuidance = {
  initialized: false,
  enabled: true,
  lastAnnouncement: '',
  lastAnnouncementTime: 0,
  COOLDOWN: NAV_CONFIG.VOICE_COOLDOWN,
  _initPromise: null,
  _eventListenersAdded: false,

  async init() {
    if (this._initPromise) return this._initPromise;
    if (this.initialized) return true;

    this._initPromise = (async () => {
      try {
        await Tts.setDefaultLanguage('en-US');
        await Tts.setDefaultRate(Platform.OS === 'ios' ? 0.48 : 0.45);
        await Tts.setDefaultPitch(1.0);
        if (!this._eventListenersAdded) {
          Tts.addEventListener('tts-start', () =>
            Logger.verbose('VOICE', 'TTS started'),
          );
          Tts.addEventListener('tts-finish', () =>
            Logger.verbose('VOICE', 'TTS finished'),
          );
          Tts.addEventListener('tts-cancel', () =>
            Logger.verbose('VOICE', 'TTS cancelled'),
          );
          // ✅ FIXED
Tts.addEventListener('tts-error', (event) =>
  Logger.error(
    'VOICE',
    'TTS error',
    event?.message || event?.error || JSON.stringify(event) || 'TTS error',
  ),
);
          this._eventListenersAdded = true;
        }
        this.initialized = true;
        this.enabled = true;
        Logger.success('VOICE', 'TTS initialized');
        return true;
      } catch (e) {
        this.enabled = false;
        this.initialized = false;
        Logger.error('VOICE', 'Init failed', e);
        return false;
      } finally {
        this._initPromise = null;
      }
    })();

    return this._initPromise;
  },

  speak(text) {
    if (!this.initialized || !this.enabled || !text) return false;
    const now = Date.now();
    if (
      text === this.lastAnnouncement &&
      now - this.lastAnnouncementTime < this.COOLDOWN
    )
      return false;
    try {
      Tts.stop();
      Tts.speak(text);
      this.lastAnnouncement = text;
      this.lastAnnouncementTime = now;
      Logger.voice(`🔊 "${text}"`);
      return true;
    } catch (e) {
      Logger.error('VOICE', 'Speak failed', e);
      return false;
    }
  },

  announceStep(step, distance) {
    if (!step || !step.instruction) return false;
    let distText;
    if (distance > 1000) distText = `In ${(distance / 1000).toFixed(1)} kilometers`;
    else if (distance > 100) distText = `In ${Math.round(distance / 10) * 10} meters`;
    else distText = `In ${Math.round(distance)} meters`;
    return this.speak(`${distText}, ${step.instruction}`);
  },

  announceArrival() {
    safeVibrate(300);
    return this.speak('You have arrived at your destination');
  },
  announceRerouting() {
    safeVibrate(200);
    return this.speak('Recalculating route');
  },
  announceRerouteComplete() {
    return this.speak('Route updated');
  },
  announceRerouteFailed() {
    return this.speak('Unable to recalculate route');
  },
  announceOffRoute(distance) {
    return this.speak(`You are ${Math.round(distance)} meters off route`);
  },

  stop() {
    try {
      Tts.stop();
    } catch (e) {
      Logger.error('VOICE', 'Stop failed', e);
    }
  },

  cleanup() {
    try {
      Tts.stop();
    } catch (e) {
      // swallow
    }
    this.lastAnnouncement = '';
    this.lastAnnouncementTime = 0;
    this.initialized = false;
    this.enabled = true;
    this._initPromise = null;
  },

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    Logger.info('VOICE', `Voice ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  },

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) this.stop();
  },

  getStats() {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      lastAnnouncement: this.lastAnnouncement,
      lastAnnouncementTime: this.lastAnnouncementTime,
      timeSinceLastAnnouncement: Date.now() - this.lastAnnouncementTime,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTE CACHE
// ═══════════════════════════════════════════════════════════════
export const RouteCache = {
  _cache: new Map(),
  TTL: 10 * 60 * 1000,
  MAX_SIZE: 30,
  hits: 0,
  misses: 0,

  key: (lat1, lng1, lat2, lng2) =>
    `${lat1.toFixed(4)},${lng1.toFixed(4)}-${lat2.toFixed(4)},${lng2.toFixed(4)}`,

  get(k) {
    const e = this._cache.get(k);
    if (!e) { this.misses++; return null; }
    if (Date.now() - e.ts > this.TTL) {
      this._cache.delete(k);
      this.misses++;
      return null;
    }
    this._cache.delete(k);
    this._cache.set(k, e);
    this.hits++;
    return e.data;
  },

  set(k, data) {
    if (this._cache.size >= this.MAX_SIZE) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    this._cache.set(k, { data, ts: Date.now() });
  },

  invalidate(lat1, lng1, lat2, lng2) {
    this._cache.delete(this.key(lat1, lng1, lat2, lng2));
  },

  invalidateAll() {
    this._cache.clear();
  },

  clear() {
    this._cache.clear();
    this.hits = 0;
    this.misses = 0;
  },

  getStats() {
    return {
      size: this._cache.size,
      maxSize: this.MAX_SIZE,
      hits: this.hits,
      misses: this.misses,
      hitRate:
        this.hits + this.misses > 0
          ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%'
          : 'N/A',
      ttlMinutes: (this.TTL / 60000).toFixed(0),
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTING SERVICE
// ═══════════════════════════════════════════════════════════════
export const RoutingService = {
  counter: 0,
  successes: 0,
  failures: 0,
  cacheHits: 0,
  lastError: null,
  lastRequestTime: 0,
  isRequesting: false,
  authErrors: 0,

  async fetchRoute(startLat, startLng, destLat, destLng, options = {}) {
    const { retryCount = 0, skipCache = false, isReroute = false } = options;
    const rid = ++this.counter;
    const distance = calcDistance(startLat, startLng, destLat, destLng);

    Logger.api(`Request #${rid} starting`, {
      from: `${startLat.toFixed(5)}, ${startLng.toFixed(5)}`,
      to: `${destLat.toFixed(5)}, ${destLng.toFixed(5)}`,
      distance: formatDistance(distance),
      isReroute,
    });

    if (!skipCache && !isReroute) {
      const ck = RouteCache.key(startLat, startLng, destLat, destLng);
      const cached = RouteCache.get(ck);
      if (cached) {
        this.cacheHits++;
        Logger.info('ROUTE', `Cache hit #${rid}`);
        return cached;
      }
    }

    if (this.isRequesting) {
      Logger.warn('ROUTE', 'Request already in progress');
      return null;
    }

    this.isRequesting = true;
    this.lastRequestTime = Date.now();

    try {
      const body = {
        userLat: startLat,
        userLon: startLng,
        spotLat: destLat,
        spotLon: destLng,
        requestType: 'ROUTE',
      };

      const res = await authenticatedFetch(
        BACKEND_CONFIG.baseUrl,
        { method: 'POST', body: JSON.stringify(body) },
        BACKEND_CONFIG.timeout,
      );

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON response from server');
      }

      let routeData = data;
      if (data.osrmResponse) routeData = data.osrmResponse;

      if (!routeData?.routes?.length)
        throw new Error('No routes returned from server');

      const route = routeData.routes[0];

      let coordinates = [];
      if (typeof route.geometry === 'string') {
        coordinates = decodePolyline(route.geometry);
      } else if (route.geometry?.coordinates) {
        coordinates = route.geometry.coordinates.filter(
          (c) => c && c.length >= 2 && validLL(c[1], c[0]),
        );
      }

      if (!coordinates || coordinates.length < 2)
        throw new Error('Invalid route geometry');

      const steps = [];
      if (route.legs?.length) {
        route.legs.forEach((leg, li) => {
          if (!leg.steps?.length) return;
          leg.steps.forEach((step, si) => {
            const m = step.maneuver || {};
            steps.push({
              id: `step_${li}_${si}_${Date.now()}`,
              stepNumber: steps.length + 1,
              icon: getManeuverIcon(m.type, m.modifier),
              instruction: getManeuverInstruction(m.type, m.modifier, step.name),
              distance: step.distance || 0,
              duration: step.duration || 0,
              name: step.name || '',
              maneuverType: m.type || 'continue',
              modifier: m.modifier || '',
              location: m.location || null,
              coordinates: [],
            });
          });
        });
      }

      const result = {
        routes: [
          {
            geometry: { coordinates, type: 'LineString' },
            distance: route.distance || distance,
            duration: route.duration || distance / 11.11,
            legs: route.legs || [],
            steps,
          },
        ],
        waypoints: routeData.waypoints || [],
        code: routeData.code || 'Ok',
        status: 'success',
        isReroute,
        requestId: rid,
      };

      this.successes++;
      this.lastError = null;

      if (!isReroute) {
        const ck = RouteCache.key(startLat, startLng, destLat, destLng);
        RouteCache.set(ck, result);
      }

      Logger.success('ROUTE', `✅ #${rid}: ${coordinates.length} pts, ${steps.length} steps`);
      return result;
    } catch (e) {
      this.failures++;
      this.lastError = e.message;

      if (e.code === 'AUTH_EXPIRED') {
        this.authErrors++;
        Logger.error('ROUTE', `❌ #${rid} Auth expired`, e);
        throw e;
      }

      Logger.error('ROUTE', `❌ #${rid} failed`, e);

      if (retryCount < BACKEND_CONFIG.maxRetries) {
        Logger.warn('ROUTE', `Retry ${retryCount + 1}/${BACKEND_CONFIG.maxRetries}`);
        await new Promise((r) =>
          setTimeout(r, BACKEND_CONFIG.retryDelay * (retryCount + 1)),
        );
        return this.fetchRoute(startLat, startLng, destLat, destLng, {
          retryCount: retryCount + 1,
          skipCache,
          isReroute,
        });
      }

      throw e;
    } finally {
      this.isRequesting = false;
    }
  },

  stats() {
    return {
      total: this.counter,
      success: this.successes,
      fail: this.failures,
      cache: this.cacheHits,
      authErrors: this.authErrors,
      lastError: this.lastError,
      successRate:
        this.counter > 0
          ? ((this.successes / this.counter) * 100).toFixed(1) + '%'
          : 'N/A',
      isRequesting: this.isRequesting,
      lastRequestTime: this.lastRequestTime,
    };
  },

  reset() {
    this.counter = 0;
    this.successes = 0;
    this.failures = 0;
    this.cacheHits = 0;
    this.authErrors = 0;
    this.lastError = null;
    this.lastRequestTime = 0;
    this.isRequesting = false;
  },
};

// ═══════════════════════════════════════════════════════════════
// REROUTE MANAGER
// ═══════════════════════════════════════════════════════════════
export class RerouteManager {
  constructor() {
    this._callbacks = {
      onRerouteStart: null,
      onRerouteSuccess: null,
      onRerouteFailure: null,
      onOffRoute: null,
      onAuthError: null,
    };
    this.reset();
  }

  reset() {
    this.isRerouting = false;
    this.rerouteCount = 0;
    this.lastRerouteTime = 0;
    this.currentCooldown = NAV_CONFIG.REROUTE_COOLDOWN;
    this.failedAttempts = 0;
    this.lastSuccessfulReroute = null;
  }

  setCallbacks(callbacks) {
    this._callbacks = { ...this._callbacks, ...callbacks };
  }

  clearCallbacks() {
    this._callbacks = {
      onRerouteStart: null,
      onRerouteSuccess: null,
      onRerouteFailure: null,
      onOffRoute: null,
      onAuthError: null,
    };
  }

  canReroute() {
    const now = Date.now();
    return (
      !this.isRerouting &&
      now - this.lastRerouteTime >= this.currentCooldown &&
      this.rerouteCount < NAV_CONFIG.MAX_REROUTES_PER_SESSION
    );
  }

  getCooldownRemaining() {
    return Math.max(0, this.currentCooldown - (Date.now() - this.lastRerouteTime));
  }

  getRemainingReroutes() {
    return NAV_CONFIG.MAX_REROUTES_PER_SESSION - this.rerouteCount;
  }

  startReroute() {
    this.isRerouting = true;
    this.rerouteCount++;
    VoiceGuidance.announceRerouting();
    safeVibrate(200);
    if (this._callbacks.onRerouteStart) {
      this._callbacks.onRerouteStart(this.rerouteCount);
    }
    Logger.reroute(`🔄 STARTING REROUTE #${this.rerouteCount}`);
  }

  completeReroute(success) {
    const now = Date.now();
    if (success) {
      this.failedAttempts = 0;
      this.lastSuccessfulReroute = now;
      this.currentCooldown = Math.min(
        NAV_CONFIG.REROUTE_COOLDOWN *
          Math.pow(NAV_CONFIG.REROUTE_BACKOFF_MULTIPLIER, this.rerouteCount - 1),
        NAV_CONFIG.REROUTE_MAX_COOLDOWN,
      );
      VoiceGuidance.announceRerouteComplete();
      if (this._callbacks.onRerouteSuccess) {
        this._callbacks.onRerouteSuccess(this.rerouteCount);
      }
      Logger.success('REROUTE', `✅ Reroute #${this.rerouteCount} COMPLETE`);
    } else {
      this.failedAttempts++;
      this.currentCooldown = NAV_CONFIG.REROUTE_FAILURE_COOLDOWN;
      VoiceGuidance.announceRerouteFailed();
      if (this._callbacks.onRerouteFailure) {
        this._callbacks.onRerouteFailure(this.rerouteCount, this.failedAttempts);
      }
      Logger.error('REROUTE', `❌ Reroute #${this.rerouteCount} FAILED`);
    }
    this.lastRerouteTime = now;
    this.isRerouting = false;
  }

  getStats() {
    return {
      rerouteCount: this.rerouteCount,
      maxReroutes: NAV_CONFIG.MAX_REROUTES_PER_SESSION,
      remainingReroutes: this.getRemainingReroutes(),
      isRerouting: this.isRerouting,
      currentCooldown: (this.currentCooldown / 1000).toFixed(0) + 's',
      cooldownRemaining: (this.getCooldownRemaining() / 1000).toFixed(0) + 's',
      canReroute: this.canReroute(),
      failedAttempts: this.failedAttempts,
      lastSuccessfulReroute: this.lastSuccessfulReroute
        ? formatTime(this.lastSuccessfulReroute)
        : 'Never',
    };
  }
}

export const rerouteManager = new RerouteManager();

// ═══════════════════════════════════════════════════════════════
// ROUTE LINE MANAGER
// ═══════════════════════════════════════════════════════════════
export class RouteLineManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.fullRoute = null;
    this.totalDistance = 0;
    this.totalDuration = 0;
    this.destination = null;
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = 0;
    this.lastProgress = 0;
    this.arrivalAnnounced = false;
    this.isCleared = false;
    this.routeVersion = 0;
    this.lastUpdateTime = 0;
  }

  setFullRoute(coordinates, destination, duration = 0) {
    if (!coordinates || coordinates.length < 2) {
      Logger.warn('ROUTE', 'Invalid coordinates for setFullRoute');
      return false;
    }

    const isReroute = this.fullRoute !== null && !this.isCleared;
    if (!isReroute) this.reset();

    this.fullRoute = coordinates.map((c) => (Array.isArray(c) ? [...c] : c));
    this.destination = destination ? { ...destination } : null;
    this.totalDistance = calculateRouteDistance(coordinates);
    this.totalDuration = duration || this.totalDistance / 11.11;
    this.lastRemainingDist = this.totalDistance;
    this.isCleared = false;
    this.routeVersion++;
    this.lastUpdateTime = Date.now();
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;

    Logger.success(
      'ROUTE',
      `Route ${isReroute ? 'REROUTE' : 'SET'}: ${coordinates.length} pts, ${formatDistance(this.totalDistance)}, v${this.routeVersion}`,
    );
    return true;
  }

  getFullRoute() {
    return this.isCleared ? null : this.fullRoute;
  }

  getVisibleRoute(userLocation) {
    if (this.isCleared) return this._getLastValidRoute('cleared');
    if (!this.fullRoute || this.fullRoute.length < 2)
      return this._getLastValidRoute('no_route');
    if (!userLocation?.latitude || !userLocation?.longitude)
      return this._getLastValidRoute('no_location');
    if (!validLL(userLocation.latitude, userLocation.longitude))
      return this._getLastValidRoute('invalid_location');

    try {
      const nearest = findNearestPointOnRoute(userLocation, this.fullRoute);
      if (!nearest) return this._getLastValidRoute('no_nearest');

      let snapIndex = nearest.segmentIndex;
      let snapT = nearest.t;

      if (snapIndex < this.lastSnappedIndex) {
        snapIndex = this.lastSnappedIndex;
        snapT = this.lastSnappedT;
      } else if (snapIndex === this.lastSnappedIndex && snapT < this.lastSnappedT) {
        snapT = this.lastSnappedT;
      } else {
        this.lastSnappedIndex = snapIndex;
        this.lastSnappedT = snapT;
      }

      const nextIndex = Math.min(snapIndex + 1, this.fullRoute.length - 1);
      const snappedPoint = interpolateCoord(
        this.fullRoute[snapIndex],
        this.fullRoute[nextIndex],
        snapT,
      );

      const visibleCoords = [snappedPoint, ...this.fullRoute.slice(snapIndex + 1)];
      const traveledDistance = distanceAlongRoute(this.fullRoute, snapIndex, snapT);
      const remainingDistance = Math.max(0, this.totalDistance - traveledDistance);
      const progress =
        this.totalDistance > 0
          ? Math.min(traveledDistance / this.totalDistance, 1)
          : 0;

      const changed =
        !this.lastVisibleCoords ||
        this.lastVisibleCoords.length !== visibleCoords.length ||
        Math.abs(this.lastRemainingDist - remainingDistance) > 1;

      if (changed) {
        this.lastVisibleCoords = visibleCoords;
        this.lastRemainingDist = remainingDistance;
        this.lastProgress = progress;
      }

      return {
        coordinates: this.lastVisibleCoords,
        remainingDistance: this.lastRemainingDist,
        progress: this.lastProgress,
        nearestSegment: snapIndex,
        changed,
        snappedPoint,
        routeVersion: this.routeVersion,
      };
    } catch (e) {
      Logger.error('ROUTE', 'getVisibleRoute failed', e);
      return this._getLastValidRoute('error');
    }
  }

  _getLastValidRoute(reason) {
    if (this.lastVisibleCoords && this.lastVisibleCoords.length >= 2) {
      return {
        coordinates: this.lastVisibleCoords,
        remainingDistance: this.lastRemainingDist,
        progress: this.lastProgress,
        changed: false,
        reason,
        routeVersion: this.routeVersion,
      };
    }
    return null;
  }

  hasArrived(userLocation) {
    if (this.isCleared || this.arrivalAnnounced) return false;
    if (!this.destination || !validLL(this.destination.latitude, this.destination.longitude))
      return false;
    if (!userLocation || !validLL(userLocation.latitude, userLocation.longitude))
      return false;

    const dist = calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      this.destination.latitude,
      this.destination.longitude,
    );

    if (dist < NAV_CONFIG.DISTANCE_THRESHOLD_ARRIVED) {
      this.arrivalAnnounced = true;
      Logger.success('ROUTE', `🎉 ARRIVED! (${dist.toFixed(1)}m from destination)`);
      safeVibrate(300);
      return true;
    }
    return false;
  }

  getNavigationBearing(userLocation) {
    if (this.isCleared || !this.fullRoute || this.fullRoute.length < 2) return 0;
    const snapIdx = this.lastSnappedIndex;
    let lookAheadIdx = Math.min(snapIdx + 2, this.fullRoute.length - 1);
    if (lookAheadIdx <= snapIdx)
      lookAheadIdx = Math.min(snapIdx + 1, this.fullRoute.length - 1);
    const current = this.fullRoute[snapIdx];
    const ahead = this.fullRoute[lookAheadIdx];
    if (!current || !ahead || current.length < 2 || ahead.length < 2) return 0;
    return calcBearing(current[1], current[0], ahead[1], ahead[0]);
  }

  getDistanceToDestination(userLocation) {
    if (!this.destination || !userLocation) return Infinity;
    return calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      this.destination.latitude,
      this.destination.longitude,
    );
  }

  getRemainingTime(userLocation, currentSpeed = null) {
    const remainingDist = this.lastRemainingDist || this.totalDistance;
    if (currentSpeed && currentSpeed > 1) return remainingDist / currentSpeed;
    if (this.totalDistance > 0 && this.totalDuration > 0)
      return this.totalDuration * (remainingDist / this.totalDistance);
    return remainingDist / 1.4;
  }

  clear() {
    Logger.cleanup('🧹 RouteLineManager clearing...');
    this.isCleared = true;
    this.arrivalAnnounced = false;
    this.fullRoute = null;
    this.destination = null;
    this.totalDistance = 0;
    this.totalDuration = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = 0;
    this.lastProgress = 0;
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    Logger.cleanup('✅ RouteLineManager cleared');
  }

  getStats() {
    return {
      hasRoute: !this.isCleared && !!this.fullRoute,
      totalPoints: this.fullRoute?.length || 0,
      totalDistance: this.totalDistance,
      totalDuration: this.totalDuration,
      remainingDistance: this.lastRemainingDist,
      progress: (this.lastProgress * 100).toFixed(1) + '%',
      currentSegment: this.lastSnappedIndex,
      arrivalAnnounced: this.arrivalAnnounced,
      isCleared: this.isCleared,
      routeVersion: this.routeVersion,
      lastUpdateTime: this.lastUpdateTime ? formatTime(this.lastUpdateTime) : 'Never',
    };
  }
}

export const routeLineManager = new RouteLineManager();

// ═══════════════════════════════════════════════════════════════
// STEP TRACKER
// ═══════════════════════════════════════════════════════════════
export class StepTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.steps = [];
    this.currentIndex = 0;
    this.announcedDistances = new Set();
    this.lastStepChangeTime = 0;
    this.isCleared = false;
    this.stepVersion = 0;
  }

  setSteps(steps) {
    if (!Array.isArray(steps)) {
      Logger.warn('STEPS', 'Invalid steps array');
      return;
    }
    this.steps = steps;
    this.currentIndex = 0;
    this.announcedDistances = new Set();
    this.lastStepChangeTime = 0;
    this.isCleared = false;
    this.stepVersion++;
    Logger.success('STEPS', `Set ${steps.length} steps (v${this.stepVersion})`);
  }

  getCurrentStep() {
    if (this.isCleared || !this.steps || this.steps.length === 0) return null;
    return this.steps[this.currentIndex] || null;
  }

  getNextStep() {
    if (this.isCleared || !this.steps || this.steps.length === 0) return null;
    return this.steps[this.currentIndex + 1] || null;
  }

  getAllSteps() {
    return this.isCleared ? [] : this.steps;
  }

  getRemainingSteps() {
    if (this.isCleared || !this.steps) return [];
    return this.steps.slice(this.currentIndex);
  }

  update(userLocation) {
    if (this.isCleared || !userLocation?.latitude || !userLocation?.longitude)
      return { changed: false, distanceToStep: 0 };
    if (!this.steps || this.steps.length === 0)
      return { changed: false, distanceToStep: 0 };

    const currentStep = this.steps[this.currentIndex];
    if (!currentStep) return { changed: false, distanceToStep: 0 };
    if (!currentStep.location || currentStep.location.length < 2)
      return { changed: false, distanceToStep: currentStep.distance || 0 };

    let distToCurrentStep = calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      currentStep.location[1],
      currentStep.location[0],
    );

    const nextStep = this.steps[this.currentIndex + 1];
    let shouldAdvance = false;
    const now = Date.now();

    if (now - this.lastStepChangeTime > 2000) {
      if (nextStep?.location && nextStep.location.length >= 2) {
        const distToNextStep = calcDistance(
          userLocation.latitude,
          userLocation.longitude,
          nextStep.location[1],
          nextStep.location[0],
        );

        if (distToCurrentStep < NAV_CONFIG.STEP_ADVANCE_MIN_DISTANCE) {
          if (distToNextStep < distToCurrentStep - NAV_CONFIG.STEP_ADVANCE_HYSTERESIS)
            shouldAdvance = true;
          else if (distToNextStep < 15) shouldAdvance = true;
        } else if (distToCurrentStep < (currentStep.distance || 1) * 0.15) {
          shouldAdvance = true;
        }
      }
    }

    if (shouldAdvance && this.currentIndex < this.steps.length - 1) {
      this.currentIndex++;
      this.announcedDistances.clear();
      this.lastStepChangeTime = now;
      safeVibrate(150);

      const newStep = this.steps[this.currentIndex];
      Logger.info('STEPS', `Advanced to step ${this.currentIndex + 1}/${this.steps.length}: ${newStep?.instruction || 'Unknown'}`);

      if (newStep?.location && newStep.location.length >= 2) {
        const newDist = calcDistance(
          userLocation.latitude,
          userLocation.longitude,
          newStep.location[1],
          newStep.location[0],
        );
        VoiceGuidance.announceStep(newStep, newDist);
        distToCurrentStep = newDist;
      }

      return { changed: true, distanceToStep: distToCurrentStep };
    }

    for (const threshold of NAV_CONFIG.VOICE_ANNOUNCE_DISTANCES) {
      if (
        distToCurrentStep <= threshold &&
        distToCurrentStep > threshold - 30 &&
        !this.announcedDistances.has(threshold)
      ) {
        this.announcedDistances.add(threshold);
        VoiceGuidance.announceStep(currentStep, distToCurrentStep);
        break;
      }
    }

    return { changed: false, distanceToStep: distToCurrentStep };
  }

  clear() {
    this.reset();
  }

  getStats() {
    return {
      totalSteps: this.steps?.length || 0,
      currentIndex: this.currentIndex,
      remainingSteps: (this.steps?.length || 0) - this.currentIndex,
      currentStep: this.getCurrentStep()?.instruction || 'None',
      isCleared: this.isCleared,
      stepVersion: this.stepVersion,
    };
  }
}

export const stepTracker = new StepTracker();

// ═══════════════════════════════════════════════════════════════
// LOCATION PROCESSOR
// ═══════════════════════════════════════════════════════════════
export class LocationProcessor {
  constructor() {
    this.reset();
  }

  shouldProcess(position, isNavigating = false) {
    const now = Date.now();
    const coords = position?.coords;
    if (!coords) return { process: false, reason: 'no_coords' };

    const { latitude, longitude, accuracy } = coords;
    const cfg = LOCATION_TRACKING_CONFIG.PROCESSING;

    if (!validLL(latitude, longitude))
      return { process: false, reason: 'invalid_coords' };
    if (now - this.lastProcessedTime < cfg.minUpdateInterval)
      return { process: false, reason: 'too_frequent' };

    if (accuracy > cfg.maxAccuracy) {
      this.consecutiveLowAccuracy++;
      if (!isNavigating && this.consecutiveLowAccuracy < cfg.maxConsecutiveLowAccuracy)
        return { process: false, reason: 'low_accuracy' };
    } else {
      this.consecutiveLowAccuracy = 0;
    }

    if (this.lastProcessedPosition) {
      const moved = calcDistance(
        this.lastProcessedPosition.latitude,
        this.lastProcessedPosition.longitude,
        latitude,
        longitude,
      );
      const minMovement =
        accuracy > cfg.lowAccuracyThreshold
          ? cfg.minMovementLowAccuracy
          : cfg.minMovement;

      if (moved < minMovement) {
        if (cfg.allowStationary && now - this.lastProcessedTime > cfg.stationaryUpdateInterval)
          return { process: true, isStationary: true, moved, accuracy };
        return { process: false, reason: 'no_movement' };
      }
    }

    return { process: true, accuracy };
  }

  markProcessed(latitude, longitude) {
    this.lastProcessedTime = Date.now();
    this.lastProcessedPosition = { latitude, longitude };
    this.processCount++;
  }

  reset() {
    this.lastProcessedTime = 0;
    this.lastProcessedPosition = null;
    this.consecutiveLowAccuracy = 0;
    this.processCount = 0;
  }

  getStats() {
    return {
      lastProcessedTime: this.lastProcessedTime,
      lastProcessedPosition: this.lastProcessedPosition,
      consecutiveLowAccuracy: this.consecutiveLowAccuracy,
      timeSinceLastProcess: Date.now() - this.lastProcessedTime,
      processCount: this.processCount,
    };
  }
}

export const locationProcessor = new LocationProcessor();

// ═══════════════════════════════════════════════════════════════
// ESTIMATE REMAINING TIME
// ═══════════════════════════════════════════════════════════════
export const estimateRemainingTime = (remainingDist, totalDist, totalDuration, gpsSpeed) => {
  if (!Number.isFinite(remainingDist) || remainingDist < 0) return 0;
  if (gpsSpeed && gpsSpeed > 1 && gpsSpeed < 50) return remainingDist / gpsSpeed;
  if (totalDist > 0 && totalDuration > 0)
    return totalDuration * (remainingDist / totalDist);
  return remainingDist / 1.4;
};

// ═══════════════════════════════════════════════════════════════
// NAVIGATION DEBUG
// ═══════════════════════════════════════════════════════════════
export const NavigationDebug = {
  getFullStatus() {
    return {
      app: { version: APP_CONFIG.VERSION, isDev: APP_CONFIG.IS_DEV },
      routing: RoutingService.stats(),
      route: routeLineManager.getStats(),
      steps: stepTracker.getStats(),
      voice: VoiceGuidance.getStats(),
      cache: RouteCache.getStats(),
      location: locationProcessor.getStats(),
      reroute: rerouteManager.getStats(),
    };
  },

  logFullStatus() {
    const status = this.getFullStatus();
    Logger.info('DEBUG', '═══ Full Navigation Status ═══');
    Object.entries(status).forEach(([key, value]) => {
      Logger.info('DEBUG', `${key}:`, value);
    });
    return status;
  },

  resetAll() {
    RouteCache.clear();
    RoutingService.reset();
    Logger.clearBuffer();
  },

  testBackendConnection: async () => {
    try {
      const response = await authenticatedFetch(
        BACKEND_CONFIG.baseUrl,
        {
          method: 'POST',
          body: JSON.stringify({
            userLat: DEFAULT_LOC.latitude,
            userLon: DEFAULT_LOC.longitude,
            spotLat: DEFAULT_LOC.latitude + 0.01,
            spotLon: DEFAULT_LOC.longitude + 0.01,
            requestType: 'ROUTE',
          }),
        },
        5000,
      );
      const success = response.ok;
      Logger.info('DEBUG', `Backend connection: ${success ? '✅ OK' : '❌ Failed'}`);
      return success;
    } catch (error) {
      Logger.error('DEBUG', 'Backend connection failed', error);
      return false;
    }
  },
};

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════
export const cleanupNavigation = () => {
  Logger.cleanup('🧹 Full navigation cleanup...');
  VoiceGuidance.stop();
  routeLineManager.clear();
  stepTracker.reset();
  rerouteManager.reset();
  locationProcessor.reset();
  Logger.cleanup('✅ Navigation cleanup complete');
};

// ═══════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════════════════
export default {
  Logger,
  NAV_CONFIG,
  NEARBY_CONFIG,
  DEFAULT_LOC,
  EMPTY_STYLE,
  MAP_STYLE,
  API_BASE_URL,
  BACKEND_CONFIG,
  APP_CONFIG,
  LOCATION_TRACKING_CONFIG,
  validLL,
  calcDistance,
  calcBearing,
  smoothHeading,
  interpolateCoord,
  findNearestPointOnRoute,
  snapToRoute,
  calculateRouteDistance,
  getDistanceFromRouteLine,
  formatDistance,
  formatDuration,
  formatDistanceNav,
  formatTime,
  fetchWithTimeout,
  decodePolyline,
  safeVibrate,
  getManeuverIcon,
  getManeuverInstruction,
  VoiceGuidance,
  RoutingService,
  RouteCache,
  routeLineManager,
  stepTracker,
  locationProcessor,
  rerouteManager,
  RerouteManager,
  RouteLineManager,
  StepTracker,
  LocationProcessor,
  estimateRemainingTime,
  NavigationDebug,
  cleanupNavigation,
};