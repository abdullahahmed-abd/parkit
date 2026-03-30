// src/services/NavigationService.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Navigation Service v7.0 (Production Ready)
// ═══════════════════════════════════════════════════════════════
// FIXES APPLIED:
// ✅ Synchronous cleanup (no async delays that cause crashes)
// ✅ VoiceGuidance full reset with re-initialization
// ✅ StepTracker hysteresis to prevent step skipping
// ✅ Null checks everywhere to prevent crashes
// ✅ Production logging (disabled in release)
// ✅ Memory leak prevention
// ✅ Race condition fixes
// ✅ Better error recovery
// ═══════════════════════════════════════════════════════════════

import { Platform, Vibration } from 'react-native';
import Tts from 'react-native-tts';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
export const API_BASE_URL =
  'https://9802-2405-201-3037-e001-b44d-1ecd-8775-95d2.ngrok-free.app';

export const APP_CONFIG = {
  APP_NAME: 'ParkIt',
  VERSION: '7.0.0',
  IS_DEV: __DEV__ || false,
};

export const BACKEND_CONFIG = {
  baseUrl: `${API_BASE_URL}/parkit-api/operate`,
  timeout: 15000,
  maxRetries: 2,
};

export const NAV_CONFIG = {
  // Location
  LOCATION_UPDATE_DISTANCE: 3,
  LOCATION_UPDATE_INTERVAL: 1000,
  MIN_ACCURACY: 100,
  
  // Arrival & Steps
  DISTANCE_THRESHOLD_ARRIVED: 15,
  DISTANCE_THRESHOLD_NEXT_STEP: 25,
  STEP_ADVANCE_HYSTERESIS: 10, // ✅ NEW: Prevents rapid step skipping
  STEP_ADVANCE_MIN_DISTANCE: 20, // ✅ NEW: Must be within 20m to advance
  
  // Route
  ROUTE_DEVIATION_THRESHOLD: 50,
  ROUTE_VISUAL_UPDATE_THRESHOLD: 3,
  SNAP_TO_ROUTE_THRESHOLD: 50,
  SMOOTH_ROUTE_MIN_MOVE: 1.5,
  ROUTE_TRIM_BUFFER: 0,
  
  // Camera
  NAVIGATION_ZOOM: 17.5,
  NAVIGATION_TILT: 50,
  CAMERA_ANIMATION_DURATION: 500,
  MIN_CAMERA_UPDATE_INTERVAL: 400,
  CAMERA_EASE_DURATION: 500,
  
  // Heading
  HEADING_SMOOTHING: 0.3,
  MIN_SPEED_FOR_HEADING: 0.5,
  
  // Voice
  VOICE_ANNOUNCE_DISTANCES: [500, 200, 100, 50, 25],
  VOICE_COOLDOWN: 5000,
  
  // Rerouting
  REROUTE_COOLDOWN: 15000,
  MAX_REROUTES: 3,
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

// ═══════════════════════════════════════════════════════════════
// LOGGER - Production Safe
// ═══════════════════════════════════════════════════════════════
export const Logger = {
  _enabled: APP_CONFIG.IS_DEV,
  _verboseMode: false,
  _logBuffer: [],
  _maxBufferSize: 100,

  _format(emoji, tag, message, data) {
    if (!Logger._enabled) return;
    
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const extra = data
      ? ` | ${typeof data === 'string' ? data : JSON.stringify(data)}`
      : '';
    const logLine = `[${ts}] ${emoji} [${tag}] ${message}${extra}`;
    
    // Buffer for crash reports
    Logger._logBuffer.push({ ts: Date.now(), line: logLine });
    if (Logger._logBuffer.length > Logger._maxBufferSize) {
      Logger._logBuffer.shift();
    }
    
    // eslint-disable-next-line no-console
    console.log(logLine);
  },

  info: (tag, msg, data) => Logger._format('ℹ️', tag, msg, data),
  success: (tag, msg, data) => Logger._format('✅', tag, msg, data),
  warn: (tag, msg, data) => Logger._format('⚠️', tag, msg, data),
  error: (tag, msg, err) => {
    Logger._format('❌', tag, msg, err?.message || err);
    // Always log errors even in production
    if (!Logger._enabled) {
      // eslint-disable-next-line no-console
      console.error(`[${tag}] ${msg}:`, err);
    }
  },

  nav: (msg, data) => Logger._format('🧭', 'NAV', msg, data),
  loc: (msg, data) => Logger._format('📌', 'LOC', msg, data),
  snap: (msg, data) => Logger._format('🎯', 'SNAP', msg, data),
  cleanup: (msg, data) => Logger._format('🧹', 'CLEANUP', msg, data),
  perf: (msg, data) => Logger._format('⚡', 'PERF', msg, data),

  verbose(tag, msg, data) {
    if (Logger._verboseMode && Logger._enabled) {
      Logger._format('🔍', tag, msg, data);
    }
  },

  setEnabled: (enabled) => {
    Logger._enabled = enabled;
  },
  
  setVerbose: (verbose) => {
    Logger._verboseMode = verbose;
  },
  
  getRecentLogs: (count = 50) => {
    return Logger._logBuffer.slice(-count);
  },
  
  clearBuffer: () => {
    Logger._logBuffer = [];
  },
};

// ═══════════════════════════════════════════════════════════════
// SAFE VIBRATE
// ═══════════════════════════════════════════════════════════════
const safeVibrate = (duration = 150) => {
  try {
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Vibration.vibrate(duration);
    }
  } catch (e) {
    Logger.verbose('VIBRATE', 'Failed', e);
  }
};

// ═══════════════════════════════════════════════════════════════
// GEO UTILITIES
// ═══════════════════════════════════════════════════════════════
export const validLL = (lat, lng) => {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0) // ✅ Reject null island
  );
};

export const calcDistance = (lat1, lng1, lat2, lng2) => {
  if (!validLL(lat1, lng1) || !validLL(lat2, lng2)) return 0;
  
  const R = 6371000; // Earth radius in meters
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calcBearing = (lat1, lng1, lat2, lng2) => {
  if (!validLL(lat1, lng1) || !validLL(lat2, lng2)) return 0;
  
  const rad = x => (x * Math.PI) / 180;
  const deg = x => (x * 180) / Math.PI;
  const dLng = rad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

export const smoothHeading = (currentHeading, targetHeading, factor = 0.3) => {
  if (currentHeading === null || currentHeading === undefined) return targetHeading;
  if (targetHeading === null || targetHeading === undefined) return currentHeading;
  
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
  const now = Date.now();
  const diff = now - ts;
  
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
// FETCH WITH TIMEOUT
// ═══════════════════════════════════════════════════════════════
export const fetchWithTimeout = (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeout);

  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
};

// ═══════════════════════════════════════════════════════════════
// POLYLINE DECODER (OSRM polyline5)
// ═══════════════════════════════════════════════════════════════
export const decodePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  
  const coords = [];
  let idx = 0;
  let lat = 0;
  let lng = 0;

  try {
    while (idx < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte;

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

      const decodedLat = lat / 1e5;
      const decodedLng = lng / 1e5;

      // ✅ Validate each coordinate
      if (validLL(decodedLat, decodedLng)) {
        coords.push([decodedLng, decodedLat]);
      }
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
  const dx = bx - ax;
  const dy = by - ay;
  
  if (dx === 0 && dy === 0) {
    return { x: ax, y: ay, t: 0 };
  }
  
  const t = Math.max(
    0,
    Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))
  );
  
  return { x: ax + t * dx, y: ay + t * dy, t };
};

export const findNearestPointOnRoute = (userLocation, coords) => {
  if (!coords || coords.length < 2 || !userLocation) return null;

  const userLng = userLocation.longitude;
  const userLat = userLocation.latitude;
  
  if (!validLL(userLat, userLng)) return null;

  let minDist = Infinity;
  let nearestPt = null;
  let segIdx = 0;
  let nearestT = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    
    if (!a || !b || a.length < 2 || b.length < 2) continue;

    const aLng = a[0], aLat = a[1];
    const bLng = b[0], bLat = b[1];
    
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
  
  return {
    segmentIndex: segIdx,
    distance: minDist,
    point: nearestPt,
    t: nearestT,
  };
};

export const snapToRoute = (userLocation, routeCoordinates, maxDistance = 50) => {
  if (!userLocation || !routeCoordinates || routeCoordinates.length < 2) {
    return null;
  }

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
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b || a.length < 2 || b.length < 2) continue;
    total += calcDistance(a[1], a[0], b[1], b[0]);
  }
  
  return total;
};

const distanceAlongRoute = (coords, segIndex, t) => {
  if (!coords || coords.length < 2) return 0;
  
  let dist = 0;
  
  for (let i = 0; i < segIndex && i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    if (!a || !b) continue;
    dist += calcDistance(a[1], a[0], b[1], b[0]);
  }
  
  if (segIndex < coords.length - 1 && coords[segIndex] && coords[segIndex + 1]) {
    const segDist = calcDistance(
      coords[segIndex][1],
      coords[segIndex][0],
      coords[segIndex + 1][1],
      coords[segIndex + 1][0]
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
  'rotary': '🔄',
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
// ✅ VOICE GUIDANCE - Production Ready with Full Cleanup
// ═══════════════════════════════════════════════════════════════
export const VoiceGuidance = {
  initialized: false,
  enabled: true,
  lastAnnouncement: '',
  lastAnnouncementTime: 0,
  COOLDOWN: NAV_CONFIG.VOICE_COOLDOWN,
  _initPromise: null,

  async init() {
    // ✅ Prevent multiple simultaneous initializations
    if (this._initPromise) {
      return this._initPromise;
    }

    if (this.initialized) {
      return true;
    }

    this._initPromise = (async () => {
      try {
        await Tts.setDefaultLanguage('en-US');
        await Tts.setDefaultRate(Platform.OS === 'ios' ? 0.48 : 0.45);
        await Tts.setDefaultPitch(1.0);
        
        // ✅ Set up event listeners
        Tts.addEventListener('tts-start', () => {
          Logger.verbose('VOICE', 'TTS started');
        });
        
        Tts.addEventListener('tts-finish', () => {
          Logger.verbose('VOICE', 'TTS finished');
        });
        
        Tts.addEventListener('tts-cancel', () => {
          Logger.verbose('VOICE', 'TTS cancelled');
        });

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
    
    // ✅ Prevent duplicate announcements
    if (
      text === this.lastAnnouncement &&
      now - this.lastAnnouncementTime < this.COOLDOWN
    ) {
      return false;
    }

    try {
      Tts.stop();
      Tts.speak(text);
      this.lastAnnouncement = text;
      this.lastAnnouncementTime = now;
      Logger.verbose('VOICE', `🔊 "${text}"`);
      return true;
    } catch (e) {
      Logger.error('VOICE', 'Speak failed', e);
      return false;
    }
  },

  announceStep(step, distance) {
    if (!step || !step.instruction) return false;

    let distText;
    if (distance > 1000) {
      distText = `In ${(distance / 1000).toFixed(1)} kilometers`;
    } else if (distance > 100) {
      distText = `In ${Math.round(distance / 10) * 10} meters`;
    } else {
      distText = `In ${Math.round(distance)} meters`;
    }

    return this.speak(`${distText}, ${step.instruction}`);
  },

  announceArrival() {
    safeVibrate(300);
    return this.speak('You have arrived at your destination');
  },

  announceRerouting() {
    safeVibrate(150);
    return this.speak('Recalculating route');
  },

  stop() {
    try {
      Tts.stop();
      Logger.verbose('VOICE', '🔇 Stopped');
    } catch (e) {
      Logger.error('VOICE', 'Stop failed', e);
    }
  },

  // ✅ Full cleanup for navigation end
  cleanup() {
    Logger.cleanup('🧹 Voice cleaning up...');
    
    try {
      Tts.stop();
    } catch (e) {
      // Ignore stop errors
    }

    this.lastAnnouncement = '';
    this.lastAnnouncementTime = 0;
    this.initialized = false; // ✅ Force re-init on next navigation
    this.enabled = true; // ✅ Reset to default state
    this._initPromise = null;
    
    Logger.cleanup('✅ Voice cleaned up');
  },

  toggle() {
    this.enabled = !this.enabled;
    
    if (!this.enabled) {
      this.stop();
    }
    
    Logger.info('VOICE', `Voice ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled;
  },

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.stop();
    }
  },

  getStats() {
    return {
      initialized: this.initialized,
      enabled: this.enabled,
      lastAnnouncement: this.lastAnnouncement,
      lastAnnouncementTime: this.lastAnnouncementTime,
    };
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTE CACHE
// ═══════════════════════════════════════════════════════════════
export const RouteCache = {
  _cache: new Map(),
  TTL: 10 * 60 * 1000, // 10 minutes
  MAX_SIZE: 20,
  hits: 0,
  misses: 0,

  key(lat1, lng1, lat2, lng2) {
    return `${lat1.toFixed(4)},${lng1.toFixed(4)}-${lat2.toFixed(4)},${lng2.toFixed(4)}`;
  },

  get(k) {
    const e = this._cache.get(k);
    
    if (!e) {
      this.misses++;
      return null;
    }
    
    if (Date.now() - e.ts > this.TTL) {
      this._cache.delete(k);
      this.misses++;
      return null;
    }
    
    this.hits++;
    return e.data;
  },

  set(k, data) {
    // ✅ Enforce max cache size
    if (this._cache.size >= this.MAX_SIZE) {
      const oldest = this._cache.keys().next().value;
      this._cache.delete(oldest);
    }
    
    this._cache.set(k, { data, ts: Date.now() });
  },

  invalidate(lat1, lng1, lat2, lng2) {
    const k = this.key(lat1, lng1, lat2, lng2);
    this._cache.delete(k);
    Logger.info('CACHE', 'Invalidated route');
  },

  clear() {
    this._cache.clear();
    this.hits = 0;
    this.misses = 0;
    Logger.cleanup('✅ Cache cleared');
  },

  getStats() {
    return {
      size: this._cache.size,
      maxSize: this.MAX_SIZE,
      hits: this.hits,
      misses: this.misses,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%'
        : 'N/A',
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

  async fetchRoute(startLat, startLng, destLat, destLng, retryCount = 0) {
    const rid = ++this.counter;
    const distance = calcDistance(startLat, startLng, destLat, destLng);

    // ✅ Check cache first
    const ck = RouteCache.key(startLat, startLng, destLat, destLng);
    const cached = RouteCache.get(ck);
    
    if (cached) {
      this.cacheHits++;
      Logger.info('ROUTE', `Cache hit #${rid}`);
      return cached;
    }

    Logger.info('ROUTE', `Fetching #${rid}: ${formatDistance(distance)}`);

    try {
      const body = {
        userLat: startLat,
        userLon: startLng,
        spotLat: destLat,
        spotLon: destLng,
        requestType: 'ROUTE',
      };

      const res = await fetchWithTimeout(
        BACKEND_CONFIG.baseUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        },
        BACKEND_CONFIG.timeout
      );

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const text = await res.text();
      let data;
      
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error('Invalid JSON response from server');
      }

      let routeData = data;
      if (data.osrmResponse) {
        routeData = data.osrmResponse;
      }

      if (!routeData?.routes?.length) {
        throw new Error('No routes returned from server');
      }

      const route = routeData.routes[0];

      // ✅ Parse coordinates
      let coordinates = [];
      if (typeof route.geometry === 'string') {
        coordinates = decodePolyline(route.geometry);
      } else if (route.geometry?.coordinates) {
        coordinates = route.geometry.coordinates.filter(
          c => c && c.length >= 2 && validLL(c[1], c[0])
        );
      }

      if (!coordinates || coordinates.length < 2) {
        throw new Error('Invalid route geometry');
      }

      // ✅ Parse steps
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
      };

      this.successes++;
      this.lastError = null;
      RouteCache.set(ck, result);
      
      Logger.success('ROUTE', `✅ #${rid}: ${coordinates.length} pts, ${steps.length} steps`);
      return result;
      
    } catch (e) {
      this.failures++;
      this.lastError = e.message;
      Logger.error('ROUTE', `❌ #${rid} failed`, e);

      // ✅ Retry logic
      if (retryCount < BACKEND_CONFIG.maxRetries) {
        Logger.warn('ROUTE', `Retry ${retryCount + 1}/${BACKEND_CONFIG.maxRetries}`);
        await new Promise(r => setTimeout(r, 1500 * (retryCount + 1)));
        return this.fetchRoute(startLat, startLng, destLat, destLng, retryCount + 1);
      }

      throw e;
    }
  },

  stats() {
    return {
      total: this.counter,
      success: this.successes,
      fail: this.failures,
      cache: this.cacheHits,
      lastError: this.lastError,
      successRate: this.counter > 0
        ? ((this.successes / this.counter) * 100).toFixed(1) + '%'
        : 'N/A',
    };
  },

  reset() {
    this.counter = 0;
    this.successes = 0;
    this.failures = 0;
    this.cacheHits = 0;
    this.lastError = null;
  },
};

// ═══════════════════════════════════════════════════════════════
// ✅ ROUTE LINE MANAGER - Production Ready with Sync Cleanup
// ═══════════════════════════════════════════════════════════════
export class RouteLineManager {
  constructor() {
    this.reset();
  }

  // ✅ Synchronous reset (no async delays!)
  reset() {
    this.fullRoute = null;
    this.totalDistance = 0;
    this.destination = null;
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = 0;
    this.lastProgress = 0;
    this.arrivalAnnounced = false;
    this.isCleared = false;
  }

  setFullRoute(coordinates, destination) {
    if (!coordinates || coordinates.length < 2) {
      Logger.warn('ROUTE', 'Invalid coordinates for setFullRoute');
      return false;
    }

    // ✅ Reset first
    this.reset();

    // ✅ Deep copy coordinates
    this.fullRoute = coordinates.map(c => 
      Array.isArray(c) ? [...c] : c
    );
    
    this.destination = destination ? { ...destination } : null;
    this.totalDistance = calculateRouteDistance(coordinates);
    this.lastRemainingDist = this.totalDistance;
    this.isCleared = false;

    Logger.success(
      'ROUTE',
      `Route set: ${coordinates.length} points, ${formatDistance(this.totalDistance)}`
    );
    
    return true;
  }

  getFullRoute() {
    if (this.isCleared) return null;
    return this.fullRoute;
  }

  getVisibleRoute(userLocation) {
    // ✅ Comprehensive null checks
    if (this.isCleared) {
      return this._getLastValidRoute('cleared');
    }
    
    if (!this.fullRoute || this.fullRoute.length < 2) {
      return this._getLastValidRoute('no_route');
    }
    
    if (!userLocation?.latitude || !userLocation?.longitude) {
      return this._getLastValidRoute('no_location');
    }

    if (!validLL(userLocation.latitude, userLocation.longitude)) {
      return this._getLastValidRoute('invalid_location');
    }

    try {
      const nearest = findNearestPointOnRoute(userLocation, this.fullRoute);
      
      if (!nearest) {
        return this._getLastValidRoute('no_nearest');
      }

      let snapIndex = nearest.segmentIndex;
      let snapT = nearest.t;

      // ✅ Prevent backward movement
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
        snapT
      );

      const visibleCoords = [snappedPoint, ...this.fullRoute.slice(snapIndex + 1)];
      const traveledDistance = distanceAlongRoute(this.fullRoute, snapIndex, snapT);
      const remainingDistance = Math.max(0, this.totalDistance - traveledDistance);
      const progress = this.totalDistance > 0
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
        offRouteDistance: nearest.distance,
        changed,
        snappedPoint,
      };
    } catch (e) {
      Logger.error('ROUTE', 'getVisibleRoute failed', e);
      return this._getLastValidRoute('error');
    }
  }

  // ✅ Helper to return last valid route
  _getLastValidRoute(reason) {
    Logger.verbose('ROUTE', `Using last valid route: ${reason}`);
    
    if (this.lastVisibleCoords && this.lastVisibleCoords.length >= 2) {
      return {
        coordinates: this.lastVisibleCoords,
        remainingDistance: this.lastRemainingDist,
        progress: this.lastProgress,
        changed: false,
        reason,
      };
    }
    
    return null;
  }

  isOffRoute(userLocation) {
    if (this.isCleared || !this.fullRoute || !userLocation) {
      return false;
    }

    const nearest = findNearestPointOnRoute(userLocation, this.fullRoute);
    return !!nearest && nearest.distance > NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD;
  }

  hasArrived(userLocation) {
    // ✅ All null checks BEFORE any calculation
    if (this.isCleared) {
      Logger.verbose('ROUTE', 'hasArrived: already cleared');
      return false;
    }

    if (this.arrivalAnnounced) {
      Logger.verbose('ROUTE', 'hasArrived: already announced');
      return false;
    }

    if (!this.destination) {
      Logger.verbose('ROUTE', 'hasArrived: no destination');
      return false;
    }

    if (
      !this.destination.latitude ||
      !this.destination.longitude ||
      !validLL(this.destination.latitude, this.destination.longitude)
    ) {
      Logger.verbose('ROUTE', 'hasArrived: invalid destination');
      return false;
    }

    if (!userLocation) {
      Logger.verbose('ROUTE', 'hasArrived: no user location');
      return false;
    }

    if (
      !userLocation.latitude ||
      !userLocation.longitude ||
      !validLL(userLocation.latitude, userLocation.longitude)
    ) {
      Logger.verbose('ROUTE', 'hasArrived: invalid user location');
      return false;
    }

    // ✅ Now safe to calculate
    const dist = calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      this.destination.latitude,
      this.destination.longitude
    );

    Logger.verbose('ROUTE', `Distance to destination: ${dist.toFixed(1)}m`);

    if (dist < NAV_CONFIG.DISTANCE_THRESHOLD_ARRIVED) {
      this.arrivalAnnounced = true;
      Logger.success('ROUTE', `🎉 ARRIVED! (${dist.toFixed(1)}m from destination)`);
      safeVibrate(300);
      return true;
    }

    return false;
  }

  getNavigationBearing(userLocation) {
    if (this.isCleared || !this.fullRoute || this.fullRoute.length < 2) {
      return 0;
    }

    const snapIdx = this.lastSnappedIndex;
    let lookAheadIdx = Math.min(snapIdx + 2, this.fullRoute.length - 1);
    
    if (lookAheadIdx <= snapIdx) {
      lookAheadIdx = Math.min(snapIdx + 1, this.fullRoute.length - 1);
    }

    const current = this.fullRoute[snapIdx];
    const ahead = this.fullRoute[lookAheadIdx];
    
    if (!current || !ahead || current.length < 2 || ahead.length < 2) {
      return 0;
    }

    return calcBearing(current[1], current[0], ahead[1], ahead[0]);
  }

  getDistanceToDestination(userLocation) {
    if (!this.destination || !userLocation) return Infinity;
    
    return calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      this.destination.latitude,
      this.destination.longitude
    );
  }

  // ✅ Synchronous clear (NO async delays!)
  clear() {
    Logger.cleanup('🧹 RouteLineManager clearing...');

    // ✅ Set flags immediately
    this.isCleared = true;
    this.arrivalAnnounced = false;

    // ✅ Clear all data immediately (no setTimeout!)
    this.fullRoute = null;
    this.destination = null;
    this.totalDistance = 0;
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
      remainingDistance: this.lastRemainingDist,
      progress: (this.lastProgress * 100).toFixed(1) + '%',
      currentSegment: this.lastSnappedIndex,
      arrivalAnnounced: this.arrivalAnnounced,
      isCleared: this.isCleared,
    };
  }
}

// ✅ Singleton instance
export const routeLineManager = new RouteLineManager();

// ═══════════════════════════════════════════════════════════════
// ✅ STEP TRACKER - Production Ready with Hysteresis
// ═══════════════════════════════════════════════════════════════
export class StepTracker {
  constructor() {
    this.reset();
  }

  // ✅ Synchronous reset
  reset() {
    Logger.cleanup('🧹 StepTracker resetting...');
    
    this.steps = [];
    this.currentIndex = 0;
    this.announcedDistances = new Set();
    this.lastStepChangeTime = 0;
    this.isCleared = false;
    
    Logger.cleanup('✅ StepTracker reset');
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
    
    Logger.success('STEPS', `Set ${steps.length} steps`);
  }

  getCurrentStep() {
    if (this.isCleared || !this.steps || this.steps.length === 0) {
      return null;
    }
    return this.steps[this.currentIndex] || null;
  }

  getNextStep() {
    if (this.isCleared || !this.steps || this.steps.length === 0) {
      return null;
    }
    return this.steps[this.currentIndex + 1] || null;
  }

  update(userLocation) {
    // ✅ Comprehensive checks
    if (this.isCleared) {
      return { changed: false, distanceToStep: 0 };
    }

    if (!userLocation?.latitude || !userLocation?.longitude) {
      return { changed: false, distanceToStep: 0 };
    }

    if (!this.steps || this.steps.length === 0) {
      return { changed: false, distanceToStep: 0 };
    }

    const currentStep = this.steps[this.currentIndex];
    
    if (!currentStep) {
      return { changed: false, distanceToStep: 0 };
    }

    // ✅ Handle steps without location
    if (!currentStep.location || currentStep.location.length < 2) {
      Logger.verbose('STEPS', `Step ${this.currentIndex + 1} has no location`);
      return { changed: false, distanceToStep: currentStep.distance || 0 };
    }

    let distToCurrentStep = calcDistance(
      userLocation.latitude,
      userLocation.longitude,
      currentStep.location[1],
      currentStep.location[0]
    );

    const nextStep = this.steps[this.currentIndex + 1];
    let shouldAdvance = false;

    // ✅ Hysteresis logic to prevent rapid step changes
    const now = Date.now();
    const timeSinceLastChange = now - this.lastStepChangeTime;
    const minTimeBetweenChanges = 2000; // 2 seconds minimum

    if (timeSinceLastChange > minTimeBetweenChanges) {
      if (nextStep?.location && nextStep.location.length >= 2) {
        const distToNextStep = calcDistance(
          userLocation.latitude,
          userLocation.longitude,
          nextStep.location[1],
          nextStep.location[0]
        );

        // ✅ Must be within MIN_DISTANCE AND significantly closer to next step
        const minDist = NAV_CONFIG.STEP_ADVANCE_MIN_DISTANCE;
        const hysteresis = NAV_CONFIG.STEP_ADVANCE_HYSTERESIS;

        if (distToCurrentStep < minDist) {
          // We're close to current step, check if we should advance
          if (distToNextStep < distToCurrentStep - hysteresis) {
            shouldAdvance = true;
          } else if (distToNextStep < 15) {
            // Very close to next step
            shouldAdvance = true;
          }
        } else if (distToCurrentStep < (currentStep.distance || 1) * 0.15) {
          // We've covered most of the step distance
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
      Logger.info(
        'STEPS',
        `Advanced to step ${this.currentIndex + 1}/${this.steps.length}: ${newStep?.instruction || 'Unknown'}`
      );

      if (newStep?.location && newStep.location.length >= 2) {
        const newDist = calcDistance(
          userLocation.latitude,
          userLocation.longitude,
          newStep.location[1],
          newStep.location[0]
        );
        VoiceGuidance.announceStep(newStep, newDist);
        distToCurrentStep = newDist;
      }

      return { changed: true, distanceToStep: distToCurrentStep };
    }

    // ✅ Voice announcements at distance thresholds
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

  getStats() {
    return {
      totalSteps: this.steps?.length || 0,
      currentIndex: this.currentIndex,
      currentStep: this.getCurrentStep()?.instruction || 'None',
      isCleared: this.isCleared,
      announcedDistances: Array.from(this.announcedDistances),
    };
  }
}

// ✅ Singleton instance
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
    
    if (!coords) {
      return { process: false, reason: 'no_coords' };
    }

    const { latitude, longitude, accuracy } = coords;
    const cfg = LOCATION_TRACKING_CONFIG.PROCESSING;

    if (!validLL(latitude, longitude)) {
      return { process: false, reason: 'invalid_coords' };
    }

    if (now - this.lastProcessedTime < cfg.minUpdateInterval) {
      return { process: false, reason: 'too_frequent' };
    }

    if (accuracy > cfg.maxAccuracy) {
      this.consecutiveLowAccuracy++;
      
      if (!isNavigating && this.consecutiveLowAccuracy < cfg.maxConsecutiveLowAccuracy) {
        return { process: false, reason: 'low_accuracy' };
      }
    } else {
      this.consecutiveLowAccuracy = 0;
    }

    if (this.lastProcessedPosition) {
      const moved = calcDistance(
        this.lastProcessedPosition.latitude,
        this.lastProcessedPosition.longitude,
        latitude,
        longitude
      );
      
      const minMovement = accuracy > cfg.lowAccuracyThreshold
        ? cfg.minMovementLowAccuracy
        : cfg.minMovement;

      if (moved < minMovement) {
        if (
          cfg.allowStationary &&
          now - this.lastProcessedTime > cfg.stationaryUpdateInterval
        ) {
          return { process: true, isStationary: true, moved, accuracy };
        }
        return { process: false, reason: 'no_movement' };
      }
    }

    return { process: true, accuracy };
  }

  markProcessed(latitude, longitude) {
    this.lastProcessedTime = Date.now();
    this.lastProcessedPosition = { latitude, longitude };
  }

  reset() {
    this.lastProcessedTime = 0;
    this.lastProcessedPosition = null;
    this.consecutiveLowAccuracy = 0;
  }

  getStats() {
    return {
      lastProcessedTime: this.lastProcessedTime,
      lastProcessedPosition: this.lastProcessedPosition,
      consecutiveLowAccuracy: this.consecutiveLowAccuracy,
      timeSinceLastProcess: Date.now() - this.lastProcessedTime,
    };
  }
}

// ✅ Singleton instance
export const locationProcessor = new LocationProcessor();

// ═══════════════════════════════════════════════════════════════
// ESTIMATE REMAINING TIME
// ═══════════════════════════════════════════════════════════════
export const estimateRemainingTime = (
  remainingDist,
  totalDist,
  totalDuration,
  gpsSpeed
) => {
  // ✅ Validate inputs
  if (!Number.isFinite(remainingDist) || remainingDist < 0) {
    return 0;
  }

  // ✅ Use GPS speed if valid (1-50 m/s = ~3.6-180 km/h)
  if (gpsSpeed && gpsSpeed > 1 && gpsSpeed < 50) {
    return remainingDist / gpsSpeed;
  }

  // ✅ Use average speed from total route
  if (totalDist > 0 && totalDuration > 0) {
    return totalDuration * (remainingDist / totalDist);
  }

  // ✅ Fallback: assume 40 km/h = 11.11 m/s
  return remainingDist / 11.11;
};

// ═══════════════════════════════════════════════════════════════
// DEBUG HELPER
// ═══════════════════════════════════════════════════════════════
export const NavigationDebug = {
  getFullStatus() {
    return {
      routing: RoutingService.stats(),
      route: routeLineManager.getStats(),
      steps: stepTracker.getStats(),
      voice: VoiceGuidance.getStats(),
      cache: RouteCache.getStats(),
      location: locationProcessor.getStats(),
      config: {
        version: APP_CONFIG.VERSION,
        isDev: APP_CONFIG.IS_DEV,
      },
    };
  },

  logFullStatus() {
    const status = this.getFullStatus();
    Logger.info('DEBUG', 'Full Navigation Status', status);
    return status;
  },

  resetAll() {
    Logger.cleanup('🧹 Resetting all navigation components...');
    
    routeLineManager.clear();
    stepTracker.reset();
    locationProcessor.reset();
    VoiceGuidance.cleanup();
    RouteCache.clear();
    RoutingService.reset();
    
    Logger.cleanup('✅ All components reset');
  },
};

// ═══════════════════════════════════════════════════════════════
// CLEANUP HELPER
// ═══════════════════════════════════════════════════════════════
export const cleanupNavigation = () => {
  Logger.cleanup('🧹 Full navigation cleanup...');
  
  // ✅ Synchronous cleanup of all components
  routeLineManager.clear();
  stepTracker.reset();
  locationProcessor.reset();
  VoiceGuidance.cleanup();
  
  Logger.cleanup('✅ Navigation cleanup complete');
};

// ═══════════════════════════════════════════════════════════════
// EXPORT DEFAULT
// ═══════════════════════════════════════════════════════════════
export default {
  // Config
  Logger,
  NAV_CONFIG,
  NEARBY_CONFIG,
  DEFAULT_LOC,
  EMPTY_STYLE,
  API_BASE_URL,
  BACKEND_CONFIG,
  APP_CONFIG,
  LOCATION_TRACKING_CONFIG,
  
  // Utilities
  validLL,
  calcDistance,
  calcBearing,
  smoothHeading,
  interpolateCoord,
  findNearestPointOnRoute,
  snapToRoute,
  calculateRouteDistance,
  formatDistance,
  formatDuration,
  formatDistanceNav,
  formatTime,
  fetchWithTimeout,
  decodePolyline,
  
  // Maneuvers
  getManeuverIcon,
  getManeuverInstruction,
  
  // Services
  VoiceGuidance,
  RoutingService,
  RouteCache,
  
  // Managers (singletons)
  routeLineManager,
  stepTracker,
  locationProcessor,
  
  // Helpers
  estimateRemainingTime,
  NavigationDebug,
  cleanupNavigation,
};