// src/services/NavigationService.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Navigation Service v5.3 (PRODUCTION READY)
// ═══════════════════════════════════════════════════════════════

import {Platform, Vibration} from 'react-native';
import Tts from 'react-native-tts';

// ═══════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════
export const API_BASE_URL =
  'https://3fca-2405-201-3037-e001-b079-bd76-8a44-f0e6.ngrok-free.app';

export const APP_CONFIG = {
  APP_NAME: 'ParkIt',
  VERSION: '5.3.0',
};

export const BACKEND_CONFIG = {
  baseUrl: `${API_BASE_URL}/parkit-api/operate`,
  timeout: 15000,
  maxRetries: 2,
};

export const NAV_CONFIG = {
  LOCATION_UPDATE_DISTANCE: 3,
  LOCATION_UPDATE_INTERVAL: 1000,
  MIN_ACCURACY: 100,
  DISTANCE_THRESHOLD_ARRIVED: 15,
  DISTANCE_THRESHOLD_NEXT_STEP: 25,
  ROUTE_DEVIATION_THRESHOLD: 50,
  ROUTE_VISUAL_UPDATE_THRESHOLD: 3,
  NAVIGATION_ZOOM: 17.5,
  NAVIGATION_TILT: 50,
  VOICE_ANNOUNCE_DISTANCES: [500, 200, 100, 50, 25],
  REROUTE_COOLDOWN: 15000,
  MAX_REROUTES: 3,
  CAMERA_ANIMATION_DURATION: 500,
  MIN_CAMERA_UPDATE_INTERVAL: 400,
  SMOOTH_ROUTE_MIN_MOVE: 1.5,
  ROUTE_TRIM_BUFFER: 0,
  CAMERA_EASE_DURATION: 500,
  HEADING_SMOOTHING: 0.3,
  MIN_SPEED_FOR_HEADING: 0.5,
};

export const NEARBY_CONFIG = {
  RADIUS: 500,
  AUTO_REFRESH_INTERVAL: 60000,
  MIN_MOVE_TO_REFRESH: 50,
};

export const DEFAULT_LOC = {latitude: 23.2599, longitude: 77.4126};

// ═══════════════════════════════════════════════════════════════
// ✅ IMPROVED LOCATION TRACKING CONFIG v5.3
// ═══════════════════════════════════════════════════════════════
export const LOCATION_TRACKING_CONFIG = {
  // Watch Position Settings - OPTIMIZED for Android
  WATCH: {
    enableHighAccuracy: true,
    distanceFilter: 0,
    interval: 1000,
    fastestInterval: 500,
    timeout: 8000,
    maximumAge: 2000,
    forceLocationManager: false,
    showLocationDialog: true,
    forceRequestLocation: true,
  },

  // Passive Tracking Settings
  PASSIVE: {
    enableHighAccuracy: true,
    distanceFilter: 5,
    interval: 3000,
    fastestInterval: 2000,
    timeout: 10000,
    maximumAge: 5000,
    forceLocationManager: false,
    showLocationDialog: true,
    forceRequestLocation: true,
  },

  // Fallback Interval Settings
  FALLBACK: {
    checkInterval: 3000,
    watchSilenceThreshold: 6000,
    highAccuracyTimeout: 5000,
    lowAccuracyTimeout: 3000,
    maxAge: 3000,
  },

  // Processing Rules
  PROCESSING: {
    minUpdateInterval: 400,
    maxAccuracy: 150,
    minMovement: 1,
    minMovementLowAccuracy: 3,
    lowAccuracyThreshold: 50,
    maxConsecutiveLowAccuracy: 5,
  },
};

// ═══════════════════════════════════════════════════════════════
// LOGGER (ENHANCED v5.3)
// ═══════════════════════════════════════════════════════════════
export const Logger = {
  _enabled: true,
  _verboseMode: false,

  _format: (emoji, tag, message, data) => {
    if (!Logger._enabled) return;
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const extra = data ? ` | ${JSON.stringify(data)}` : '';
    console.log(`[${ts}] ${emoji} [${tag}] ${message}${extra}`);
  },

  info: (tag, msg, data) => Logger._format('ℹ️', tag, msg, data),
  success: (tag, msg, data) => Logger._format('✅', tag, msg, data),
  error: (tag, msg, err) => Logger._format('❌', tag, msg, err?.message || err),
  warn: (tag, msg, data) => Logger._format('⚠️', tag, msg, data),
  nav: (msg, data) => Logger._format('🧭', 'NAV', msg, data),
  route: (msg, data) => Logger._format('📍', 'ROUTE', msg, data),
  camera: (msg, data) => Logger._format('📷', 'CAMERA', msg, data),
  loc: (msg, data) => Logger._format('📌', 'LOC', msg, data),
  perf: (msg, data) => Logger._format('⚡', 'PERF', msg, data),
  
  // New verbose logging for debugging
  verbose: (tag, msg, data) => {
    if (Logger._verboseMode) {
      Logger._format('🔍', tag, msg, data);
    }
  },

  // Toggle logging
  setEnabled: (enabled) => { Logger._enabled = enabled; },
  setVerbose: (verbose) => { Logger._verboseMode = verbose; },
};

// Suppress MapLibre noise
const originalLog = console.log;
console.log = (...args) => {
  if (args[0] === 'MapLibre [info]' && args[2]?.message?.includes('Canceled')) return;
  originalLog(...args);
};

// ═══════════════════════════════════════════════════════════════
// ✅ SMART LOCATION PROCESSOR v5.3
// ═══════════════════════════════════════════════════════════════
export class LocationProcessor {
  constructor() {
    this.lastProcessedTime = 0;
    this.lastProcessedPosition = null;
    this.consecutiveLowAccuracy = 0;
    this.updateCount = 0;
    this.lastLogTime = 0;
  }

  shouldProcess(position, isNavigating = false) {
    const now = Date.now();
    const {latitude, longitude, accuracy} = position.coords;
    const config = LOCATION_TRACKING_CONFIG.PROCESSING;

    // 1. Validate coordinates
    if (!validLL(latitude, longitude)) {
      Logger.verbose('LOC_PROC', 'Rejected: Invalid coordinates');
      return {process: false, reason: 'invalid_coords'};
    }

    // 2. Check update frequency
    const timeSinceLastUpdate = now - this.lastProcessedTime;
    if (timeSinceLastUpdate < config.minUpdateInterval) {
      Logger.verbose('LOC_PROC', `Rejected: Too frequent (${timeSinceLastUpdate}ms)`);
      return {process: false, reason: 'too_frequent'};
    }

    // 3. Check accuracy
    if (accuracy > config.maxAccuracy) {
      this.consecutiveLowAccuracy++;
      if (this.consecutiveLowAccuracy < config.maxConsecutiveLowAccuracy) {
        Logger.verbose('LOC_PROC', `Rejected: Low accuracy ${accuracy.toFixed(0)}m (${this.consecutiveLowAccuracy}/${config.maxConsecutiveLowAccuracy})`);
        return {process: false, reason: 'low_accuracy'};
      }
      // Allow after max consecutive (better than nothing)
      Logger.warn('LOC', `Accepting low accuracy ${accuracy.toFixed(0)}m after ${this.consecutiveLowAccuracy} consecutive`);
    } else {
      this.consecutiveLowAccuracy = 0;
    }

    // 4. Check movement distance
    if (this.lastProcessedPosition) {
      const moved = calcDistance(
        this.lastProcessedPosition.latitude,
        this.lastProcessedPosition.longitude,
        latitude,
        longitude
      );

      const minMovement = accuracy > config.lowAccuracyThreshold
        ? config.minMovementLowAccuracy
        : config.minMovement;

      if (moved < minMovement && timeSinceLastUpdate < 5000) {
        Logger.verbose('LOC_PROC', `Rejected: No movement (${moved.toFixed(1)}m < ${minMovement}m)`);
        return {process: false, reason: 'no_movement'};
      }
    }

    // All checks passed
    return {
      process: true,
      accuracy,
      timeSinceLastUpdate,
      isFirstUpdate: !this.lastProcessedPosition,
    };
  }

  markProcessed(latitude, longitude) {
    this.lastProcessedTime = Date.now();
    this.lastProcessedPosition = {latitude, longitude};
    this.updateCount++;
  }

  getStats() {
    return {
      updateCount: this.updateCount,
      consecutiveLowAccuracy: this.consecutiveLowAccuracy,
      lastPosition: this.lastProcessedPosition,
    };
  }

  reset() {
    this.lastProcessedTime = 0;
    this.lastProcessedPosition = null;
    this.consecutiveLowAccuracy = 0;
    this.updateCount = 0;
    Logger.loc('🔄 LocationProcessor reset');
  }
}

export const locationProcessor = new LocationProcessor();

// ═══════════════════════════════════════════════════════════════
// SAFE VIBRATE
// ═══════════════════════════════════════════════════════════════
const safeVibrate = (duration = 150) => {
  try { Vibration.vibrate(duration); } catch (e) {}
};

// ═══════════════════════════════════════════════════════════════
// MANEUVER ICONS & INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
const MANEUVER_ICONS = {
  depart: '🚀', arrive: '🎯', 'turn-right': '➡️', 'turn-left': '⬅️',
  'turn-slight-right': '↗️', 'turn-slight-left': '↖️',
  'turn-sharp-right': '⤴️', 'turn-sharp-left': '⤵️',
  continue: '⬆️', straight: '⬆️', roundabout: '🔄',
  'exit roundabout': '↪️', uturn: '↩️', 'new name': '⬆️',
  merge: '🔀', default: '⬆️',
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
    case 'depart': return `Start on ${street}`;
    case 'arrive': return 'You have arrived at your destination';
    case 'turn':
      if (modifier === 'right') return `Turn right onto ${street}`;
      if (modifier === 'left') return `Turn left onto ${street}`;
      if (modifier === 'slight right') return `Keep slight right onto ${street}`;
      if (modifier === 'slight left') return `Keep slight left onto ${street}`;
      if (modifier === 'sharp right') return `Sharp right onto ${street}`;
      if (modifier === 'sharp left') return `Sharp left onto ${street}`;
      return `Turn onto ${street}`;
    case 'new name':
    case 'continue': return `Continue on ${street}`;
    case 'roundabout': return 'Enter roundabout';
    case 'exit roundabout': return `Exit roundabout onto ${street}`;
    case 'merge': return `Merge onto ${street}`;
    case 'uturn': return 'Make a U-turn';
    default: return `Continue on ${street}`;
  }
};

// ═══════════════════════════════════════════════════════════════
// GEO UTILITIES
// ═══════════════════════════════════════════════════════════════
export const validLL = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export const calcDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const calcBearing = (lat1, lng1, lat2, lng2) => {
  const rad = x => (x * Math.PI) / 180;
  const deg = x => (x * 180) / Math.PI;
  const dLng = rad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

export const interpolateCoord = (a, b, t) => {
  t = Math.max(0, Math.min(1, t));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
};

export const smoothHeading = (currentHeading, targetHeading, factor = 0.3) => {
  if (currentHeading === null || currentHeading === undefined) return targetHeading;
  if (targetHeading === null || targetHeading === undefined) return currentHeading;
  let diff = targetHeading - currentHeading;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return (currentHeading + diff * factor + 360) % 360;
};

const closestPointOnSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return {x: ax, y: ay, t: 0};
  const t = Math.max(0, Math.min(1,
    ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return {x: ax + t * dx, y: ay + t * dy, t};
};

export const findNearestPointOnRoute = (userLocation, coords) => {
  if (!coords || coords.length < 2 || !userLocation) return null;
  
  let minDist = Infinity;
  let nearestPt = null;
  let segIdx = 0;
  let nearestT = 0;

  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i];
    const b = coords[i + 1];
    
    const c = closestPointOnSegment(
      userLocation.longitude, 
      userLocation.latitude, 
      a[0], a[1], 
      b[0], b[1]
    );
    
    const d = calcDistance(
      userLocation.latitude, 
      userLocation.longitude, 
      c.y, 
      c.x
    );
    
    if (d < minDist) {
      minDist = d;
      nearestPt = {lng: c.x, lat: c.y};
      segIdx = i;
      nearestT = c.t;
    }
  }
  
  return {
    segmentIndex: segIdx, 
    distance: minDist, 
    point: nearestPt, 
    t: nearestT
  };
};

export const calculateRouteDistance = coords => {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += calcDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return total;
};

const distanceAlongRoute = (coords, segIndex, t) => {
  let dist = 0;
  for (let i = 0; i < segIndex && i < coords.length - 1; i++) {
    dist += calcDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  if (segIndex < coords.length - 1) {
    const segDist = calcDistance(
      coords[segIndex][1], coords[segIndex][0],
      coords[segIndex + 1][1], coords[segIndex + 1][0]);
    dist += segDist * t;
  }
  return dist;
};

// ═══════════════════════════════════════════════════════════════
// FORMAT UTILITIES
// ═══════════════════════════════════════════════════════════════
export const formatDistanceNav = m => {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 50) return `${Math.round(m)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

export const formatDistance = m => {
  if (!Number.isFinite(m)) return 'N/A';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

export const formatDuration = s => {
  if (!s || !Number.isFinite(s)) return 'N/A';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ${mins % 60} min`;
};

export const formatTime = ts => {
  if (!ts) return 'N/A';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
};

// ═══════════════════════════════════════════════════════════════
// POLYLINE DECODER
// ═══════════════════════════════════════════════════════════════
export const decodePolyline = encoded => {
  if (!encoded || typeof encoded !== 'string') return [];
  const coords = [];
  let idx = 0, lat = 0, lng = 0;
  try {
    while (idx < encoded.length) {
      let shift = 0, result = 0, byte;
      do { byte = encoded.charCodeAt(idx++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      shift = 0; result = 0;
      do { byte = encoded.charCodeAt(idx++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;
      coords.push([lng / 1e5, lat / 1e5]);
    }
    return coords;
  } catch (error) {
    Logger.error('POLYLINE', 'Decode failed', error);
    return [];
  }
};

export const fetchWithTimeout = (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...options, signal: controller.signal}).finally(() => clearTimeout(timer));
};

// ═══════════════════════════════════════════════════════════════
// VOICE GUIDANCE
// ═══════════════════════════════════════════════════════════════
export const VoiceGuidance = {
  initialized: false,
  enabled: true,
  lastAnnouncement: '',
  lastAnnouncementTime: 0,
  COOLDOWN: 5000,

  async init() {
    if (this.initialized) return;
    try {
      await Tts.setDefaultLanguage('en-US');
      await Tts.setDefaultRate(Platform.OS === 'ios' ? 0.48 : 0.45);
      await Tts.setDefaultPitch(1.0);
      this.initialized = true;
      Logger.success('VOICE', '🔊 TTS initialized');
    } catch (e) {
      this.enabled = false;
      Logger.error('VOICE', 'Init failed', e);
    }
  },

  speak(text) {
    if (!this.initialized || !this.enabled) return;
    const now = Date.now();
    if (text === this.lastAnnouncement && now - this.lastAnnouncementTime < this.COOLDOWN) return;
    try { 
      Tts.stop(); 
      Tts.speak(text); 
      this.lastAnnouncement = text; 
      this.lastAnnouncementTime = now;
      Logger.verbose('VOICE', `Speaking: ${text}`);
    } catch (_) {}
  },

  announceStep(step, distance) {
    if (!step) return;
    try {
      const distText = distance > 1000
        ? `In ${(distance / 1000).toFixed(1)} kilometers`
        : `In ${Math.round(distance)} meters`;
      this.speak(`${distText}, ${step.instruction}`);
    } catch (_) {}
  },

  announceArrival() { 
    try { 
      this.speak('You have arrived at your destination'); 
      Logger.success('VOICE', '🎉 Arrival announced');
    } catch (_) {} 
  },
  
  announceRerouting() { 
    try { 
      this.speak('Recalculating route'); 
      Logger.info('VOICE', '🔄 Rerouting announced');
    } catch (_) {} 
  },
  
  stop() { 
    try { Tts.stop(); } catch (_) {} 
  },
  
  toggle() { 
    this.enabled = !this.enabled; 
    if (!this.enabled) this.stop(); 
    Logger.info('VOICE', `🔊 Voice ${this.enabled ? 'enabled' : 'disabled'}`);
    return this.enabled; 
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTE CACHE
// ═══════════════════════════════════════════════════════════════
export const RouteCache = {
  _cache: new Map(),
  TTL: 10 * 60 * 1000,
  
  key(lat1, lng1, lat2, lng2) {
    return `${lat1.toFixed(4)},${lng1.toFixed(4)}-${lat2.toFixed(4)},${lng2.toFixed(4)}`;
  },
  
  get(k) { 
    const e = this._cache.get(k); 
    if (!e) return null; 
    if (Date.now() - e.ts > this.TTL) { 
      this._cache.delete(k); 
      return null; 
    } 
    return e.data; 
  },
  
  set(k, data) { 
    this._cache.set(k, {data, ts: Date.now()}); 
  },
  
  clear() { 
    this._cache.clear(); 
    Logger.info('CACHE', '🧹 Route cache cleared');
  },
  
  size() { return this._cache.size; },
};

// ═══════════════════════════════════════════════════════════════
// ROUTING SERVICE
// ═══════════════════════════════════════════════════════════════
export const RoutingService = {
  counter: 0, 
  successes: 0, 
  failures: 0, 
  cacheHits: 0,

  async fetchRoute(startLat, startLng, destLat, destLng, retryCount = 0) {
    const rid = ++this.counter;
    const distance = calcDistance(startLat, startLng, destLat, destLng);

    Logger.info('ROUTE', `#${rid} Fetching route | dist: ${distance.toFixed(0)}m`);

    if (distance < 20) throw new Error(`Destination too close (${distance.toFixed(0)}m)`);

    const ck = RouteCache.key(startLat, startLng, destLat, destLng);
    const cached = RouteCache.get(ck);
    if (cached) { 
      this.cacheHits++; 
      Logger.success('ROUTE', `#${rid} 📦 Cache hit`); 
      return cached; 
    }

    try {
      const body = { 
        userLat: startLat, 
        userLon: startLng, 
        spotLat: destLat, 
        spotLon: destLng, 
        requestType: 'ROUTE' 
      };
      
      Logger.verbose('ROUTE', `#${rid} Request body`, body);
      
      const res = await fetchWithTimeout(BACKEND_CONFIG.baseUrl, {
        method: 'POST', 
        headers: {
          'Content-Type': 'application/json', 
          Accept: 'application/json'
        },
        body: JSON.stringify(body),
      }, BACKEND_CONFIG.timeout);

      const text = await res.text();
      let data; 
      try { 
        data = JSON.parse(text); 
      } catch { 
        throw new Error('Invalid JSON response'); 
      }
      
      let routeData = data;
      if (data.osrmResponse) routeData = data.osrmResponse;
      if (!routeData?.routes?.length) throw new Error('No routes in response');

      const route = routeData.routes[0];
      let coordinates = [];
      
      if (typeof route.geometry === 'string') {
        coordinates = decodePolyline(route.geometry);
      } else if (route.geometry?.coordinates) {
        coordinates = route.geometry.coordinates;
      }
      
      if (!coordinates.length) throw new Error('No coordinates in route');

      const steps = [];
      if (route.legs?.length) {
        route.legs.forEach((leg, li) => {
          if (!leg.steps?.length) return;
          leg.steps.forEach((step, si) => {
            const m = step.maneuver || {};
            let stepCoords = [];
            if (typeof step.geometry === 'string') stepCoords = decodePolyline(step.geometry);
            steps.push({
              id: `step_${li}_${si}`, 
              stepNumber: si + 1,
              icon: getManeuverIcon(m.type, m.modifier),
              instruction: getManeuverInstruction(m.type, m.modifier, step.name),
              distance: step.distance || 0, 
              duration: step.duration || 0,
              name: step.name || '', 
              maneuverType: m.type || 'continue',
              modifier: m.modifier || '', 
              location: m.location || null,
              coordinates: stepCoords,
            });
          });
        });
      }

      const result = {
        routes: [{ 
          geometry: {coordinates, type: 'LineString'},
          distance: route.distance || distance, 
          duration: route.duration || distance / 11.11,
          legs: route.legs || [], 
          steps 
        }],
        waypoints: routeData.waypoints || [], 
        code: routeData.code, 
        status: 'success',
      };

      this.successes++;
      RouteCache.set(ck, result);
      Logger.success('ROUTE', `#${rid} ✅ OK – ${coordinates.length} pts, ${steps.length} steps`);
      return result;
    } catch (error) {
      this.failures++;
      Logger.error('ROUTE', `#${rid} ❌ FAILED`, error);
      
      if (retryCount < BACKEND_CONFIG.maxRetries) {
        const delay = 2000 * (retryCount + 1);
        Logger.warn('ROUTE', `#${rid} 🔄 Retrying in ${delay}ms (attempt ${retryCount + 2})`);
        await new Promise(r => setTimeout(r, delay));
        return this.fetchRoute(startLat, startLng, destLat, destLng, retryCount + 1);
      }
      throw error;
    }
  },

  stats() { 
    return { 
      total: this.counter, 
      success: this.successes, 
      fail: this.failures, 
      cache: this.cacheHits 
    }; 
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTE LINE MANAGER v5.3
// ═══════════════════════════════════════════════════════════════
export class RouteLineManager {
  constructor() {
    this.fullRoute = null;
    this.totalDistance = 0;
    this.destination = null;
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = 0;
    this.lastProgress = 0;
    this.updateCount = 0;
  }

  setFullRoute(coordinates, destination) {
    if (!coordinates || coordinates.length < 2) {
      Logger.warn('ROUTE_MGR', '⚠️ Invalid coordinates for setFullRoute');
      return;
    }
    this.fullRoute = coordinates.map(c => [...c]);
    this.destination = destination;
    this.totalDistance = calculateRouteDistance(coordinates);
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = this.totalDistance;
    this.lastProgress = 0;
    this.updateCount = 0;
    Logger.route(`✅ Full route set: ${coordinates.length} pts, ${this.totalDistance.toFixed(0)}m`);
  }

  getVisibleRoute(userLocation) {
    if (!this.fullRoute || this.fullRoute.length < 2) return null;
    if (!userLocation) return null;

    try {
      const nearest = findNearestPointOnRoute(userLocation, this.fullRoute);
      if (!nearest) return null;

      let snapIndex = nearest.segmentIndex;
      let snapT = nearest.t;

      // Forward-only snapping to prevent backward jumps
      if (snapIndex < this.lastSnappedIndex) {
        snapIndex = this.lastSnappedIndex;
        snapT = this.lastSnappedT;
        Logger.verbose('ROUTE_MGR', `⏩ Prevented backward snap: ${nearest.segmentIndex} → ${snapIndex}`);
      } else if (snapIndex === this.lastSnappedIndex && snapT < this.lastSnappedT) {
        snapT = this.lastSnappedT;
      } else {
        this.lastSnappedIndex = snapIndex;
        this.lastSnappedT = snapT;
      }

      const snappedPoint = interpolateCoord(
        this.fullRoute[snapIndex],
        this.fullRoute[Math.min(snapIndex + 1, this.fullRoute.length - 1)],
        snapT,
      );

      const visibleCoords = [snappedPoint];
      for (let i = snapIndex + 1; i < this.fullRoute.length; i++) {
        visibleCoords.push(this.fullRoute[i]);
      }

      const traveledDistance = distanceAlongRoute(this.fullRoute, snapIndex, snapT);
      const remainingDistance = Math.max(0, this.totalDistance - traveledDistance);
      const progress = this.totalDistance > 0
        ? Math.min(traveledDistance / this.totalDistance, 1)
        : 0;

      const coordsChanged = !this.lastVisibleCoords ||
        this.lastVisibleCoords.length !== visibleCoords.length ||
        Math.abs(this.lastRemainingDist - remainingDistance) > 1;

      if (coordsChanged) {
        this.lastVisibleCoords = visibleCoords;
        this.lastRemainingDist = remainingDistance;
        this.lastProgress = progress;
        this.updateCount++;

        Logger.route(
          `📏 Route updated: seg=${snapIndex}/${this.fullRoute.length - 1} | ` +
          `remaining=${remainingDistance.toFixed(0)}m | progress=${(progress * 100).toFixed(1)}% | ` +
          `visible_pts=${visibleCoords.length} | offRoute=${nearest.distance.toFixed(1)}m`
        );
      }

      return {
        coordinates: this.lastVisibleCoords,
        remainingDistance: this.lastRemainingDist,
        nearestSegment: snapIndex,
        offRouteDistance: nearest.distance,
        progress: this.lastProgress,
        changed: coordsChanged,
        snappedPoint,
      };
    } catch (e) {
      Logger.error('ROUTE_MGR', 'getVisibleRoute failed', e);
      return null;
    }
  }

  isOffRoute(userLocation) {
    if (!this.fullRoute || !userLocation) return false;
    try {
      const nearest = findNearestPointOnRoute(userLocation, this.fullRoute);
      const offRoute = nearest && nearest.distance > NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD;
      if (offRoute) {
        Logger.warn('ROUTE_MGR', `⚠️ OFF ROUTE! dist=${nearest.distance.toFixed(1)}m (threshold: ${NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD}m)`);
      }
      return offRoute;
    } catch (_) { return false; }
  }

  hasArrived(userLocation) {
    if (!this.destination || !userLocation) return false;
    try {
      const dist = calcDistance(
        userLocation.latitude, userLocation.longitude,
        this.destination.latitude, this.destination.longitude);
      if (dist < NAV_CONFIG.DISTANCE_THRESHOLD_ARRIVED) {
        Logger.success('ROUTE_MGR', `🎉 ARRIVED! dist=${dist.toFixed(1)}m`);
        return true;
      }
      return false;
    } catch (_) { return false; }
  }

  getNavigationBearing(userLocation) {
    if (!this.fullRoute || this.fullRoute.length < 2) return 0;
    const snapIdx = this.lastSnappedIndex;
    let lookAheadIdx = Math.min(snapIdx + 2, this.fullRoute.length - 1);
    if (lookAheadIdx <= snapIdx) lookAheadIdx = Math.min(snapIdx + 1, this.fullRoute.length - 1);

    const current = this.fullRoute[snapIdx];
    const ahead = this.fullRoute[lookAheadIdx];
    if (!current || !ahead) return 0;

    return calcBearing(current[1], current[0], ahead[1], ahead[0]);
  }

  clear() {
    this.fullRoute = null;
    this.destination = null;
    this.totalDistance = 0;
    this.lastSnappedIndex = 0;
    this.lastSnappedT = 0;
    this.lastVisibleCoords = null;
    this.lastRemainingDist = 0;
    this.lastProgress = 0;
    this.updateCount = 0;
    Logger.route('🧹 Route cleared');
  }

  getFullRoute() { return this.fullRoute; }
  
  getStats() {
    return {
      totalDistance: this.totalDistance,
      remainingDistance: this.lastRemainingDist,
      progress: this.lastProgress,
      updateCount: this.updateCount,
      currentSegment: this.lastSnappedIndex,
    };
  }
}

export const routeLineManager = new RouteLineManager();

// ═══════════════════════════════════════════════════════════════
// STEP TRACKER
// ═══════════════════════════════════════════════════════════════
export class StepTracker {
  constructor() {
    this.steps = [];
    this.currentIndex = 0;
    this.announcedDistances = new Set();
  }

  setSteps(steps) {
    this.steps = steps || [];
    this.currentIndex = 0;
    this.announcedDistances.clear();
    Logger.nav(`📋 Steps loaded: ${this.steps.length}`);
  }

  getCurrentStep() { return this.steps[this.currentIndex] || null; }
  getNextStep() { return this.steps[this.currentIndex + 1] || null; }

  update(userLocation) {
    if (!userLocation || !this.steps.length) return {changed: false, distanceToStep: 0};

    const currentStep = this.steps[this.currentIndex];
    const nextStep = this.steps[this.currentIndex + 1];
    if (!currentStep?.location) return {changed: false, distanceToStep: 0};

    let distToCurrentStep = 0;
    try {
      distToCurrentStep = calcDistance(
        userLocation.latitude, userLocation.longitude,
        currentStep.location[1], currentStep.location[0]);
    } catch (_) { return {changed: false, distanceToStep: 0}; }

    let shouldAdvance = false;
    if (nextStep?.location) {
      try {
        const distToNextStep = calcDistance(
          userLocation.latitude, userLocation.longitude,
          nextStep.location[1], nextStep.location[0]);
        if (distToNextStep < distToCurrentStep || distToNextStep < 15 ||
            distToCurrentStep < currentStep.distance * 0.2) {
          shouldAdvance = true;
        }
      } catch (_) {}
    }

    if (shouldAdvance && this.currentIndex < this.steps.length - 1) {
      this.currentIndex++;
      this.announcedDistances.clear();
      safeVibrate(150);
      const newStep = this.steps[this.currentIndex];
      Logger.nav(`✅ Step ${this.currentIndex + 1}/${this.steps.length}: ${newStep?.icon} ${newStep?.instruction}`);
      try {
        if (newStep?.location) {
          VoiceGuidance.announceStep(newStep,
            calcDistance(userLocation.latitude, userLocation.longitude, newStep.location[1], newStep.location[0]));
        }
      } catch (_) {}
      return { changed: true, distanceToStep: this.getDistanceToCurrentStep(userLocation) };
    }

    // Voice announcements at specific distances
    try {
      for (const threshold of NAV_CONFIG.VOICE_ANNOUNCE_DISTANCES) {
        if (distToCurrentStep <= threshold && distToCurrentStep > threshold - 30 &&
            !this.announcedDistances.has(threshold)) {
          this.announcedDistances.add(threshold);
          VoiceGuidance.announceStep(currentStep, distToCurrentStep);
          Logger.verbose('STEP', `🔊 Announced at ${threshold}m`);
          break;
        }
      }
    } catch (_) {}

    return {changed: false, distanceToStep: distToCurrentStep};
  }

  getDistanceToCurrentStep(userLocation) {
    if (!userLocation) return 0;
    const step = this.getCurrentStep();
    if (!step?.location) return 0;
    try { 
      return calcDistance(userLocation.latitude, userLocation.longitude, step.location[1], step.location[0]); 
    }
    catch (_) { return 0; }
  }

  reset() { 
    this.steps = []; 
    this.currentIndex = 0; 
    this.announcedDistances.clear(); 
    Logger.nav('🧹 Steps reset'); 
  }
}

export const stepTracker = new StepTracker();

// ═══════════════════════════════════════════════════════════════
// ESTIMATE REMAINING TIME
// ═══════════════════════════════════════════════════════════════
export const estimateRemainingTime = (remainingDist, totalDist, totalDuration, gpsSpeed) => {
  if (gpsSpeed && gpsSpeed > 1 && gpsSpeed < 50) return remainingDist / gpsSpeed;
  if (totalDist > 0 && totalDuration > 0) return totalDuration * (remainingDist / totalDist);
  return remainingDist / 11.11; // ~40 km/h default
};

// ═══════════════════════════════════════════════════════════════
// EMPTY MAP STYLE
// ═══════════════════════════════════════════════════════════════
export const EMPTY_STYLE = JSON.stringify({
  version: 8, 
  name: 'Empty', 
  sources: {}, 
  layers: [],
});

// ═══════════════════════════════════════════════════════════════
// DEBUG HELPER
// ═══════════════════════════════════════════════════════════════
export const NavigationDebug = {
  getFullStatus() {
    return {
      routing: RoutingService.stats(),
      route: routeLineManager.getStats(),
      location: locationProcessor.getStats(),
      cache: RouteCache.size(),
    };
  },
  
  logFullStatus() {
    const status = this.getFullStatus();
    Logger.info('DEBUG', '═══ NAVIGATION STATUS ═══');
    Logger.info('DEBUG', `Routing: ${JSON.stringify(status.routing)}`);
    Logger.info('DEBUG', `Route: ${JSON.stringify(status.route)}`);
    Logger.info('DEBUG', `Location: ${JSON.stringify(status.location)}`);
    Logger.info('DEBUG', `Cache size: ${status.cache}`);
    return status;
  },
};