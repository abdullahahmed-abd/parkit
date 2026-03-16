// src/screens/ParkingMapScreen.js
// ═══════════════════════════════════════════════════════════════
// PARKIT - Parking Navigation Screen
// MapLibre + OSM (100% Free) + Backend Integration
// PARK / LEAVE events + NEARBY_PARKING_SLOTS
// 🔴 Occupied | 🟢 Available | 🔵 My Spot
// ═══════════════════════════════════════════════════════════════

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  NativeModules,
  Linking,
  Modal,
  ScrollView,
  FlatList,
  TextInput,
  Keyboard,
  Platform,
  AppState,
  Vibration,
  PermissionsAndroid,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Geolocation from '@react-native-community/geolocation';
import Tts from 'react-native-tts';
import ParkingService from '../services/ParkingService';

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════
MapLibreGL.setAccessToken(null);

const {BluetoothModule} = NativeModules;

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const APP_CONFIG = {
  IS_DEV: __DEV__,
  APP_NAME: 'ParkIt',
  VERSION: '2.0.0',
};

const BACKEND_CONFIG = {
  baseUrl: __DEV__
    ? 'https://27da-2405-201-3037-e001-5539-821c-ff1e-6612.ngrok-free.app/parkit-api/operate'
    : 'https://your-production-api.com/parkit-api/operate',
  timeout: 15000,
  maxRetries: 2,
};

const NAV_CONFIG = {
  LOCATION_UPDATE_DISTANCE: 3,
  LOCATION_UPDATE_INTERVAL: 1000,
  MIN_ACCURACY: 50,
  DISTANCE_THRESHOLD_ARRIVED: 20,
  DISTANCE_THRESHOLD_NEXT_STEP: 30,
  ROUTE_DEVIATION_THRESHOLD: 50,
  ROUTE_VISUAL_UPDATE_THRESHOLD: 5,
  NAVIGATION_ZOOM: 18,
  NAVIGATION_TILT: 45,
  VOICE_ANNOUNCE_DISTANCES: [500, 200, 100, 50],
  REROUTE_COOLDOWN: 10000,
  MAX_REROUTES: 5,
};

const NEARBY_CONFIG = {
  RADIUS: 500, // meters
  AUTO_REFRESH_INTERVAL: 60000, // 1 minute
  MIN_MOVE_TO_REFRESH: 50, // meters — refresh if user moved 50m
};

const DEFAULT_LOC = {latitude: 23.2599, longitude: 77.4126};

const EMPTY_STYLE = JSON.stringify({
  version: 8,
  name: 'Empty',
  sources: {},
  layers: [],
});

// ═══════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════
const LOG_ENABLED = __DEV__;
const Logger = {
  _format: (emoji, tag, message, data) => {
    if (!LOG_ENABLED) return;
    const ts = new Date().toISOString().split('T')[1].split('.')[0];
    const extra = data ? ` ${JSON.stringify(data)}` : '';
    console.log(`[${ts}] ${emoji} [${tag}] ${message}${extra}`);
  },
  info: (tag, msg, data) => Logger._format('ℹ️', tag, msg, data),
  success: (tag, msg, data) => Logger._format('✅', tag, msg, data),
  error: (tag, msg, err) =>
    Logger._format('❌', tag, msg, err?.message || err),
  warn: (tag, msg, data) => Logger._format('⚠️', tag, msg, data),
  nav: (msg, data) => Logger._format('🧭', 'NAV', msg, data),
  location: (msg, data) => Logger._format('📍', 'LOC', msg, data),
};

// ═══════════════════════════════════════════════════════════════
// MANEUVER ICONS & INSTRUCTIONS
// ═══════════════════════════════════════════════════════════════
const MANEUVER_ICONS = {
  depart: '🚀', arrive: '🎯', 'turn-right': '➡️', 'turn-left': '⬅️',
  'turn-slight-right': '↗️', 'turn-slight-left': '↖️',
  'turn-sharp-right': '⤴️', 'turn-sharp-left': '⤵️',
  continue: '⬆️', straight: '⬆️', roundabout: '🔄',
  'roundabout-left': '🔄', 'roundabout-right': '🔄',
  'exit roundabout': '↪️', 'ramp-right': '🛣️', 'ramp-left': '🛣️',
  merge: '🔀', 'fork-right': '🔱', 'fork-left': '🔱',
  uturn: '↩️', 'new name': '⬆️', default: '⬆️',
};

const getManeuverIcon = (type, modifier) => {
  if (!type) return MANEUVER_ICONS.default;
  if (type === 'depart') return MANEUVER_ICONS.depart;
  if (type === 'arrive') return MANEUVER_ICONS.arrive;
  const key = modifier ? `${type}-${modifier}` : type;
  return MANEUVER_ICONS[key] || MANEUVER_ICONS[type] || MANEUVER_ICONS.default;
};

const getManeuverInstruction = (type, modifier, name) => {
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
    case 'fork':
      if (modifier === 'right') return 'Keep right at fork';
      if (modifier === 'left') return 'Keep left at fork';
      return 'Continue at fork';
    default: return `Continue on ${street}`;
  }
};

// ═══════════════════════════════════════════════════════════════
// GEO UTILITIES
// ═══════════════════════════════════════════════════════════════
const validLL = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const calcDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const rad = x => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calcBearing = (lat1, lng1, lat2, lng2) => {
  const rad = x => (x * Math.PI) / 180;
  const deg = x => (x * 180) / Math.PI;
  const dLng = rad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(dLng);
  return (deg(Math.atan2(y, x)) + 360) % 360;
};

const closestPointOnSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return {x: ax, y: ay, t: 0};
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return {x: ax + t * dx, y: ay + t * dy, t};
};

const findNearestPointOnRoute = (loc, coords) => {
  if (!coords || coords.length < 2) return null;
  let minDist = Infinity, nearestPt = null, segIdx = 0, nearIdx = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const a = coords[i], b = coords[i + 1];
    const c = closestPointOnSegment(loc.longitude, loc.latitude, a[0], a[1], b[0], b[1]);
    const d = calcDistance(loc.latitude, loc.longitude, c.y, c.x);
    if (d < minDist) { minDist = d; nearestPt = {lng: c.x, lat: c.y}; segIdx = i; nearIdx = c.t >= 0.5 ? i + 1 : i; }
  }
  return {index: nearIdx, segmentIndex: segIdx, distance: minDist, point: nearestPt};
};

const calculateRouteDistance = coords => {
  if (!coords || coords.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    total += calcDistance(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return total;
};

// ═══════════════════════════════════════════════════════════════
// FORMAT UTILITIES
// ═══════════════════════════════════════════════════════════════
const formatDistanceNav = m => {
  if (!Number.isFinite(m) || m < 0) return '';
  if (m < 50) return `${Math.round(m)} m`;
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

const formatDistance = m => {
  if (!Number.isFinite(m)) return 'N/A';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

const formatDuration = s => {
  if (!s || !Number.isFinite(s)) return 'N/A';
  const mins = Math.round(s / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ${mins % 60} min`;
};

const formatTime = ts => {
  if (!ts) return 'N/A';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 60) return `${mins} min ago`;
  return `${Math.floor(mins / 60)} hr ago`;
};

// ═══════════════════════════════════════════════════════════════
// POLYLINE DECODER
// ═══════════════════════════════════════════════════════════════
const decodePolyline = encoded => {
  if (!encoded || typeof encoded !== 'string') return [];
  const coords = [];
  let idx = 0, lat = 0, lng = 0;
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
};

const fetchWithTimeout = (url, options = {}, timeout = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  return fetch(url, {...options, signal: controller.signal}).finally(() => clearTimeout(timer));
};

// ═══════════════════════════════════════════════════════════════
// VOICE GUIDANCE
// ═══════════════════════════════════════════════════════════════
const VoiceGuidance = {
  initialized: false, enabled: true, lastAnnouncement: '', lastAnnouncementTime: 0, COOLDOWN: 5000,
  async init() {
    if (this.initialized) return;
    try {
      await Tts.setDefaultLanguage('en-US');
      await Tts.setDefaultRate(Platform.OS === 'ios' ? 0.48 : 0.45);
      await Tts.setDefaultPitch(1.0);
      this.initialized = true;
    } catch (e) { this.enabled = false; }
  },
  speak(text) {
    if (!this.initialized || !this.enabled) return;
    const now = Date.now();
    if (text === this.lastAnnouncement && now - this.lastAnnouncementTime < this.COOLDOWN) return;
    try { Tts.stop(); Tts.speak(text); this.lastAnnouncement = text; this.lastAnnouncementTime = now; } catch (_) {}
  },
  announceStep(step, distance) {
    if (!step) return;
    const distText = distance > 1000 ? `In ${(distance / 1000).toFixed(1)} kilometers` : `In ${Math.round(distance)} meters`;
    this.speak(`${distText}, ${step.instruction}`);
  },
  announceArrival() { this.speak('You have arrived at your destination'); },
  announceRerouting() { this.speak('Recalculating route'); },
  stop() { try { Tts.stop(); } catch (_) {} },
  toggle() { this.enabled = !this.enabled; if (!this.enabled) this.stop(); return this.enabled; },
};

// ═══════════════════════════════════════════════════════════════
// LOCATION PERMISSION
// ═══════════════════════════════════════════════════════════════
const LocationPermission = {
  async request() {
    if (Platform.OS === 'android') {
      try {
        const fine = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION, {
          title: 'Location Permission', message: 'ParkIt needs location access.', buttonPositive: 'Allow', buttonNegative: 'Deny',
        });
        if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Required', 'Location needed.', [{text: 'Cancel'}, {text: 'Settings', onPress: () => Linking.openSettings()}]);
          return false;
        }
        if (Platform.Version >= 29) { await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION); }
        return true;
      } catch (e) { return false; }
    }
    return true;
  },
};

// ═══════════════════════════════════════════════════════════════
// ROUTE CACHE & ROUTING SERVICE
// ═══════════════════════════════════════════════════════════════
const RouteCache = {
  _cache: new Map(), TTL: 10 * 60 * 1000,
  key(lat1, lng1, lat2, lng2) { return `${lat1.toFixed(4)},${lng1.toFixed(4)}-${lat2.toFixed(4)},${lng2.toFixed(4)}`; },
  get(k) { const e = this._cache.get(k); if (!e) return null; if (Date.now() - e.ts > this.TTL) { this._cache.delete(k); return null; } return e.data; },
  set(k, data) { this._cache.set(k, {data, ts: Date.now()}); },
  clear() { this._cache.clear(); },
};

const RoutingService = {
  counter: 0, successes: 0, failures: 0, cacheHits: 0,
  async fetchRoute(startLat, startLng, destLat, destLng, retryCount = 0) {
    const rid = ++this.counter;
    const ck = RouteCache.key(startLat, startLng, destLat, destLng);
    const cached = RouteCache.get(ck);
    if (cached) { this.cacheHits++; return cached; }
    try {
      const body = {userLat: startLat, userLon: startLng, spotLat: destLat, spotLon: destLng, requestType: 'ROUTE'};
      const res = await fetchWithTimeout(BACKEND_CONFIG.baseUrl, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'}, body: JSON.stringify(body),
      }, BACKEND_CONFIG.timeout);
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch (_) { throw new Error('Invalid JSON'); }
      const routeData = data.geometry || data;
      if (!routeData?.routes?.length) throw new Error('No routes');
      const route = routeData.routes[0];
      let coordinates = [];
      if (typeof route.geometry === 'string') coordinates = decodePolyline(route.geometry);
      else if (route.geometry?.coordinates) coordinates = route.geometry.coordinates;
      if (!coordinates.length) throw new Error('No coordinates');
      const steps = [];
      if (route.legs?.length) {
        route.legs.forEach((leg, li) => {
          if (!leg.steps?.length) return;
          leg.steps.forEach((step, si) => {
            const m = step.maneuver || {};
            let stepCoords = [];
            if (typeof step.geometry === 'string') stepCoords = decodePolyline(step.geometry);
            steps.push({
              id: `step_${li}_${si}`, stepNumber: si + 1, icon: getManeuverIcon(m.type, m.modifier),
              instruction: getManeuverInstruction(m.type, m.modifier, step.name),
              distance: step.distance || 0, duration: step.duration || 0, name: step.name || '',
              maneuverType: m.type || 'continue', modifier: m.modifier || '',
              location: m.location || null, coordinates: stepCoords,
            });
          });
        });
      }
      const result = {
        routes: [{geometry: {coordinates, type: 'LineString'}, distance: route.distance || 0, duration: route.duration || 0, legs: route.legs || [], steps}],
        waypoints: routeData.waypoints || [], code: routeData.code, status: 'success',
      };
      this.successes++; RouteCache.set(ck, result);
      return result;
    } catch (error) {
      this.failures++;
      if (retryCount < BACKEND_CONFIG.maxRetries) { await new Promise(r => setTimeout(r, 2000 * (retryCount + 1))); return this.fetchRoute(startLat, startLng, destLat, destLng, retryCount + 1); }
      throw error;
    }
  },
  stats() { return {total: this.counter, success: this.successes, fail: this.failures, cache: this.cacheHits}; },
};

const estimateRemainingTime = (remainingDist, totalDist, totalDuration, gpsSpeed) => {
  if (gpsSpeed && gpsSpeed > 1 && gpsSpeed < 50) return remainingDist / gpsSpeed;
  if (totalDist > 0 && totalDuration > 0) return totalDuration * (remainingDist / totalDist);
  return remainingDist / 11.11;
};

// ═══════════════════════════════════════════════════════════════
// MARKER COMPONENTS
// ═══════════════════════════════════════════════════════════════
const ParkingMarker = React.memo(({spot, onPress}) => {
  let color = '#4CAF50', icon = '✓';
  if (spot.isMySpot) { color = '#1976D2'; icon = '🚗'; }
  else if (spot.isOccupied) { color = '#E53935'; icon = '🅿️'; }
  else { color = '#4CAF50'; icon = '✓'; }

  return (
    <MapLibreGL.MarkerView id={`marker-${spot.id}`} coordinate={[spot.longitude, spot.latitude]} anchor={{x: 0.5, y: 1}}>
      <TouchableOpacity onPress={() => onPress(spot)} activeOpacity={0.8} style={S.markerTouchable}
        accessible accessibilityLabel={`${spot.deviceName}, ${spot.isOccupied ? 'occupied' : 'available'}, ${formatDistance(spot.distance)} away`}>
        <View style={[S.markerContainer, {backgroundColor: color}]}>
          <Text style={S.markerIcon}>{icon}</Text>
        </View>
        <View style={[S.markerArrow, {borderTopColor: color}]} />
      </TouchableOpacity>
    </MapLibreGL.MarkerView>
  );
});

const UserLocationMarker = React.memo(({coordinate, heading, isNavigating, accuracy}) => (
  <MapLibreGL.MarkerView id="user-location-marker" coordinate={[coordinate.longitude, coordinate.latitude]} anchor={{x: 0.5, y: 0.5}}>
    <View style={S.userMarkerContainer}>
      {isNavigating && accuracy > 0 && (
        <View style={[S.userMarkerAccuracy, {width: Math.min(accuracy * 2, 100), height: Math.min(accuracy * 2, 100), borderRadius: Math.min(accuracy, 50)}]} />
      )}
      <View style={[S.userMarkerOuter, isNavigating && S.userMarkerOuterNav]}>
        <View style={[S.userMarkerInner, isNavigating && S.userMarkerInnerNav]}>
          {isNavigating && heading !== null && (
            <View style={[S.userMarkerArrowWrap, {transform: [{rotate: `${heading}deg`}]}]}>
              <View style={S.userMarkerArrow2} />
            </View>
          )}
        </View>
      </View>
    </View>
  </MapLibreGL.MarkerView>
));

const SearchMarker = React.memo(({coordinate}) => (
  <MapLibreGL.MarkerView id="search-marker" coordinate={[coordinate.longitude, coordinate.latitude]} anchor={{x: 0.5, y: 1}}>
    <View style={S.searchMarkerContainer}><Text style={S.searchMarkerIcon}>📍</Text></View>
  </MapLibreGL.MarkerView>
));

const DestinationMarker = React.memo(({coordinate}) => (
  <MapLibreGL.MarkerView id="destination-marker" coordinate={[coordinate.longitude, coordinate.latitude]} anchor={{x: 0.5, y: 1}}>
    <View style={S.destMarkerContainer}>
      <View style={S.destMarker}><Text style={S.destMarkerIcon}>🎯</Text></View>
      <View style={S.destMarkerArrow} />
    </View>
  </MapLibreGL.MarkerView>
));

// ═══════════════════════════════════════════════════════════════
// NAVIGATION PANEL
// ═══════════════════════════════════════════════════════════════
const NavigationPanel = React.memo(({currentStep, nextStep, distanceToNextStep, totalRemainingDistance, totalRemainingTime, progress, onClose, onRecenter, isRecentering, voiceEnabled, onToggleVoice}) => {
  if (!currentStep) return null;
  return (
    <View style={S.navPanel}>
      <View style={S.navPanelProgressWrap}><View style={[S.navPanelProgressFill, {width: `${Math.min(progress * 100, 100)}%`}]} /></View>
      <View style={S.navPanelHeader}>
        <TouchableOpacity style={S.navPanelCloseBtn} onPress={onClose}><Text style={S.navPanelCloseTxt}>✕</Text></TouchableOpacity>
        <View style={S.navPanelStats}>
          <Text style={S.navPanelETA}>{formatDuration(totalRemainingTime)}</Text>
          <Text style={S.navPanelDot}>•</Text>
          <Text style={S.navPanelDist}>{formatDistance(totalRemainingDistance)}</Text>
        </View>
        <View style={S.navPanelRight}>
          <TouchableOpacity style={[S.navPanelSmBtn, !voiceEnabled && S.navPanelSmBtnOff]} onPress={onToggleVoice}>
            <Text style={S.navPanelSmBtnTxt}>{voiceEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.navPanelSmBtn, isRecentering && S.navPanelSmBtnActive]} onPress={onRecenter}>
            <Text style={S.navPanelSmBtnTxt}>🎯</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={S.navPanelCard}>
        <View style={S.navPanelIconBox}><Text style={S.navPanelMainIcon}>{currentStep.icon}</Text></View>
        <View style={S.navPanelContent}>
          <Text style={S.navPanelTurnDist}>{distanceToNextStep > 0 ? formatDistanceNav(distanceToNextStep) : 'Now'}</Text>
          <Text style={S.navPanelInstruction} numberOfLines={2}>{currentStep.instruction}</Text>
        </View>
      </View>
      {nextStep && nextStep.maneuverType !== 'arrive' && (
        <View style={S.navPanelNext}>
          <Text style={S.navPanelNextLabel}>Then</Text>
          <View style={S.navPanelNextIconBox}><Text style={S.navPanelNextIcon}>{nextStep.icon}</Text></View>
          <Text style={S.navPanelNextInstr} numberOfLines={1}>{nextStep.instruction}</Text>
        </View>
      )}
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════
class MapErrorBoundary extends React.Component {
  state = {hasError: false};
  static getDerivedStateFromError() { return {hasError: true}; }
  componentDidCatch(error) { Logger.error('BOUNDARY', 'Crash', error); }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={S.errorBoundary}>
          <Text style={{fontSize: 64, marginBottom: 16}}>🗺️</Text>
          <Text style={{fontSize: 20, fontWeight: '800', color: '#111'}}>Something went wrong</Text>
          <TouchableOpacity style={S.errorBtn} onPress={() => this.setState({hasError: false})}>
            <Text style={{fontSize: 16, fontWeight: '700', color: '#fff'}}>Retry</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════
// NAV STEP ITEM
// ═══════════════════════════════════════════════════════════════
const NavigationStepItem = React.memo(({step, index, currentStepIndex, distanceToNextStep, totalSteps}) => {
  const isCurrent = index === currentStepIndex;
  const isPast = index < currentStepIndex;
  return (
    <View style={[S.navStep, isCurrent && S.navStepCurrent, isPast && S.navStepPast]}>
      <View style={S.navStepLeft}>
        <View style={[S.navIconBox, step.maneuverType === 'arrive' && {backgroundColor: '#4CAF50'}, isCurrent && S.navIconBoxCurrent, isPast && S.navIconBoxPast]}>
          <Text style={S.navIcon}>{step.icon}</Text>
        </View>
        {index < totalSteps - 1 && <View style={[S.navConnector, isPast && S.navConnectorPast]} />}
      </View>
      <View style={[S.navStepRight, isCurrent && S.navStepRightCurrent]}>
        <View style={S.navStepHeader}>
          <Text style={[S.navStepNum, isPast && S.navStepTxtPast]}>Step {step.stepNumber}</Text>
          <Text style={[S.navStepDist, isPast && S.navStepTxtPast]}>{formatDistance(step.distance)}</Text>
        </View>
        <Text style={[S.navStepInstr, isPast && S.navStepTxtPast]} numberOfLines={2}>{step.instruction}</Text>
        {step.name ? <Text style={[S.navStepStreet, isPast && S.navStepTxtPast]} numberOfLines={1}>📍 {step.name}</Text> : null}
        <Text style={[S.navStepDur, isPast && S.navStepTxtPast]}>⏱️ ~{formatDuration(step.duration)}</Text>
        {isCurrent && distanceToNextStep > 0 && (
          <View style={S.navStepBadge}><Text style={S.navStepBadgeTxt}>📍 In {formatDistanceNav(distanceToNextStep)}</Text></View>
        )}
      </View>
    </View>
  );
});

// ═══════════════════════════════════════════════════════════════
// MAIN SCREEN
// ═══════════════════════════════════════════════════════════════
function ParkingMapScreenInner({navigation}) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Nav refs
  const locationWatchId = useRef(null);
  const isNavigatingRef = useRef(false);
  const followUserRef = useRef(true);
  const fullRouteRef = useRef(null);
  const destinationRef = useRef(null);
  const navigationStepsRef = useRef([]);
  const currentStepIndexRef = useRef(0);
  const totalDistanceRef = useRef(0);
  const totalDurationRef = useRef(0);
  const lastTrimIndexRef = useRef(0);
  const lastLocationRef = useRef(null);
  const lastVisualUpdateRef = useRef(null);
  const routeUpdateTimeRef = useRef(0);
  const gpsSpeedRef = useRef(0);
  const reroutingRef = useRef(false);
  const rerouteCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);
  const abortControllerRef = useRef(null);
  const announcedDistancesRef = useRef(new Set());

  // Nearby spots refs
  const lastNearbyFetchLocRef = useRef(null);
  const nearbyRefreshTimerRef = useRef(null);

  // State
  const [loading, setLoading] = useState(true);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [spotsLoading, setSpotsLoading] = useState(false);

  const [userLoc, setUserLoc] = useState(DEFAULT_LOC);
  const [userHeading, setUserHeading] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(0);

  const [mySpot, setMySpot] = useState(null);
  const [allSpots, setAllSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [routeCoordinates, setRouteCoordinates] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [destination, setDestination] = useState(null);

  const [navigationSteps, setNavigationSteps] = useState([]);
  const [showNavigation, setShowNavigation] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToNextStep, setDistanceToNextStep] = useState(0);
  const [remainingDistance, setRemainingDistance] = useState(0);
  const [remainingDuration, setRemainingDuration] = useState(0);
  const [navigationProgress, setNavigationProgress] = useState(0);
  const [followUser, setFollowUser] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMarker, setSearchMarker] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(14);

  // ═══════════════════════════════════════════════════════════
  // GET LOCATION
  // ═══════════════════════════════════════════════════════════
  const getLoc = useCallback(async () => {
    setGettingLoc(true);
    try {
      const hasPermission = await LocationPermission.request();
      if (!hasPermission) return {...DEFAULT_LOC, source: 'Default'};

      if (BluetoothModule?.getFreshLocation) {
        try {
          const loc = await Promise.race([BluetoothModule.getFreshLocation(), new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000))]);
          if (validLL(loc?.latitude, loc?.longitude)) return {latitude: loc.latitude, longitude: loc.longitude, source: 'GPS'};
        } catch (_) {}
      }

      try {
        const pos = await new Promise((resolve, reject) => {
          Geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy: true, timeout: 10000, maximumAge: 5000});
        });
        if (validLL(pos.coords.latitude, pos.coords.longitude)) {
          return {latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, heading: pos.coords.heading, source: 'GPS'};
        }
      } catch (_) {}

      try {
        const res = await fetchWithTimeout('https://ipapi.co/json/', {}, 5000);
        const d = await res.json();
        if (validLL(d?.latitude, d?.longitude)) return {latitude: d.latitude, longitude: d.longitude, source: 'IP'};
      } catch (_) {}

      return {...DEFAULT_LOC, source: 'Default'};
    } finally { setGettingLoc(false); }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // CAMERA HELPERS
  // ═══════════════════════════════════════════════════════════
  const flyTo = useCallback((lat, lng, zoom = 16) => {
    const z = Math.min(zoom, 19);
    cameraRef.current?.setCamera({centerCoordinate: [lng, lat], zoomLevel: z, animationDuration: 800});
    setZoomLevel(z);
  }, []);

  const fitBounds = useCallback(coords => {
    if (!coords || coords.length < 2) return;
    const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1]);
    cameraRef.current?.fitBounds([Math.max(...lngs), Math.max(...lats)], [Math.min(...lngs), Math.min(...lats)], [80, 80, 80, 80], 800);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // STOP NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const stopNavigation = useCallback(() => {
    isNavigatingRef.current = false; followUserRef.current = false;
    currentStepIndexRef.current = 0; lastTrimIndexRef.current = 0;
    rerouteCountRef.current = 0; announcedDistancesRef.current.clear();
    lastVisualUpdateRef.current = null; gpsSpeedRef.current = 0;
    setIsNavigating(false); setFollowUser(false); setCurrentStepIndex(0);
    setDistanceToNextStep(0); setNavigationProgress(0);
    if (locationWatchId.current !== null) { Geolocation.clearWatch(locationWatchId.current); locationWatchId.current = null; }
    VoiceGuidance.stop();
    cameraRef.current?.setCamera({pitch: 0, animationDuration: 500});
  }, []);

  // ═══════════════════════════════════════════════════════════
  // REROUTE
  // ═══════════════════════════════════════════════════════════
  const reroute = useCallback(async currentLoc => {
    const dest = destinationRef.current;
    if (!dest || reroutingRef.current) return;
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < NAV_CONFIG.REROUTE_COOLDOWN) return;
    if (rerouteCountRef.current >= NAV_CONFIG.MAX_REROUTES) return;
    reroutingRef.current = true; lastRerouteTimeRef.current = now; rerouteCountRef.current++;
    VoiceGuidance.announceRerouting();
    try {
      const ck = RouteCache.key(currentLoc.latitude, currentLoc.longitude, dest.latitude, dest.longitude);
      RouteCache._cache.delete(ck);
      const routeData = await RoutingService.fetchRoute(currentLoc.latitude, currentLoc.longitude, dest.latitude, dest.longitude);
      if (!isNavigatingRef.current) return;
      const route = routeData.routes[0]; const coords = route.geometry.coordinates; const steps = route.steps || [];
      fullRouteRef.current = [...coords]; totalDistanceRef.current = route.distance; totalDurationRef.current = route.duration;
      navigationStepsRef.current = steps; currentStepIndexRef.current = 0; lastTrimIndexRef.current = 0;
      lastVisualUpdateRef.current = null; announcedDistancesRef.current.clear();
      setRouteCoordinates(coords); setNavigationSteps(steps);
      setRouteInfo({totalDistance: route.distance, totalDuration: route.duration, stepsCount: steps.length});
      setRemainingDistance(route.distance); setRemainingDuration(route.duration); setCurrentStepIndex(0); setNavigationProgress(0);
    } catch (e) { Logger.error('NAV', 'Reroute failed', e); } finally { reroutingRef.current = false; }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // CORE NAV UPDATE
  // ═══════════════════════════════════════════════════════════
  const updateNavigation = useCallback(currentLoc => {
    if (!isNavigatingRef.current) return;
    const fullRoute = fullRouteRef.current; const dest = destinationRef.current; const steps = navigationStepsRef.current;
    if (!fullRoute || fullRoute.length < 2 || !dest) return;
    const now = Date.now(); if (now - routeUpdateTimeRef.current < 200) return; routeUpdateTimeRef.current = now;
    const nearest = findNearestPointOnRoute(currentLoc, fullRoute); if (!nearest) return;
    if (nearest.distance > NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD) { reroute(currentLoc); return; }
    const distToDest = calcDistance(currentLoc.latitude, currentLoc.longitude, dest.latitude, dest.longitude);
    if (distToDest < NAV_CONFIG.DISTANCE_THRESHOLD_ARRIVED) {
      Vibration.vibrate([500, 200, 500, 200, 500]); VoiceGuidance.announceArrival();
      Alert.alert('🎉 Arrived!', 'You reached your destination.', [{text: 'OK', onPress: () => stopNavigation()}]); return;
    }
    const shouldUpdateVisual = !lastVisualUpdateRef.current ||
      calcDistance(currentLoc.latitude, currentLoc.longitude, lastVisualUpdateRef.current.latitude, lastVisualUpdateRef.current.longitude) > NAV_CONFIG.ROUTE_VISUAL_UPDATE_THRESHOLD;
    if (shouldUpdateVisual) {
      lastVisualUpdateRef.current = {...currentLoc};
      if (nearest.segmentIndex > lastTrimIndexRef.current) lastTrimIndexRef.current = nearest.segmentIndex;
      const remaining = fullRoute.slice(Math.max(0, lastTrimIndexRef.current));
      setRouteCoordinates([[currentLoc.longitude, currentLoc.latitude], ...remaining]);
    }
    const routeRemaining = fullRoute.slice(nearest.segmentIndex);
    const totalRemaining = calculateRouteDistance(routeRemaining);
    setRemainingDistance(totalRemaining);
    const traveled = totalDistanceRef.current - totalRemaining;
    setNavigationProgress(totalDistanceRef.current > 0 ? Math.max(0, Math.min(1, traveled / totalDistanceRef.current)) : 0);
    setRemainingDuration(estimateRemainingTime(totalRemaining, totalDistanceRef.current, totalDurationRef.current, gpsSpeedRef.current));

    let newIdx = currentStepIndexRef.current; let distToCurrentManeuver = 0;
    for (let i = currentStepIndexRef.current; i < steps.length; i++) {
      const step = steps[i]; if (!step.location) continue;
      const distToStep = calcDistance(currentLoc.latitude, currentLoc.longitude, step.location[1], step.location[0]);
      if (i === currentStepIndexRef.current) distToCurrentManeuver = distToStep;
      if (i < steps.length - 1) {
        const next = steps[i + 1];
        if (next?.location) {
          const distToNext = calcDistance(currentLoc.latitude, currentLoc.longitude, next.location[1], next.location[0]);
          const stepToStep = calcDistance(step.location[1], step.location[0], next.location[1], next.location[0]);
          if (distToNext < distToStep && distToNext < stepToStep * 0.8) newIdx = i + 1;
        }
      }
    }
    if (steps[newIdx]?.location) distToCurrentManeuver = calcDistance(currentLoc.latitude, currentLoc.longitude, steps[newIdx].location[1], steps[newIdx].location[0]);
    setDistanceToNextStep(distToCurrentManeuver);
    if (newIdx !== currentStepIndexRef.current) {
      currentStepIndexRef.current = newIdx; setCurrentStepIndex(newIdx); Vibration.vibrate(150);
      VoiceGuidance.announceStep(steps[newIdx], distToCurrentManeuver); announcedDistancesRef.current.clear();
    } else {
      for (const threshold of NAV_CONFIG.VOICE_ANNOUNCE_DISTANCES) {
        if (distToCurrentManeuver <= threshold && distToCurrentManeuver > threshold - 30 && !announcedDistancesRef.current.has(threshold)) {
          announcedDistancesRef.current.add(threshold); VoiceGuidance.announceStep(steps[newIdx], distToCurrentManeuver); break;
        }
      }
    }
    if (followUserRef.current && cameraRef.current) {
      let heading = 0;
      if (fullRoute.length > nearest.segmentIndex + 1) { const np = fullRoute[nearest.segmentIndex + 1]; heading = calcBearing(currentLoc.latitude, currentLoc.longitude, np[1], np[0]); }
      cameraRef.current.setCamera({centerCoordinate: [currentLoc.longitude, currentLoc.latitude], zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM, heading, pitch: NAV_CONFIG.NAVIGATION_TILT, animationDuration: 500});
    }
  }, [reroute, stopNavigation]);

  // ═══════════════════════════════════════════════════════════
  // LOCATION TRACKING
  // ═══════════════════════════════════════════════════════════
  const startLocationTracking = useCallback(() => {
    if (locationWatchId.current !== null) { Geolocation.clearWatch(locationWatchId.current); locationWatchId.current = null; }
    locationWatchId.current = Geolocation.watchPosition(
      pos => {
        const {latitude, longitude, accuracy, heading, speed} = pos.coords;
        if (isNavigatingRef.current && accuracy > NAV_CONFIG.MIN_ACCURACY) return;
        if (!validLL(latitude, longitude)) return;
        const newLoc = {latitude, longitude};
        setUserLoc(newLoc); setLocationAccuracy(accuracy || 0);
        if (heading !== null && !isNaN(heading) && heading >= 0) setUserHeading(heading);
        if (speed !== null && !isNaN(speed) && speed >= 0) gpsSpeedRef.current = speed;
        lastLocationRef.current = newLoc;
        if (isNavigatingRef.current) updateNavigation(newLoc);
      },
      err => Logger.error('LOC', 'watchPosition error', err),
      {enableHighAccuracy: true, distanceFilter: NAV_CONFIG.LOCATION_UPDATE_DISTANCE, interval: NAV_CONFIG.LOCATION_UPDATE_INTERVAL, fastestInterval: 500, showLocationDialog: true, forceRequestLocation: true},
    );
  }, [updateNavigation]);

  const startNavigation = useCallback(() => {
    isNavigatingRef.current = true; followUserRef.current = true;
    currentStepIndexRef.current = 0; lastTrimIndexRef.current = 0;
    lastVisualUpdateRef.current = null; rerouteCountRef.current = 0; announcedDistancesRef.current.clear();
    setIsNavigating(true); setFollowUser(true); setCurrentStepIndex(0);
    startLocationTracking();
    setTimeout(() => {
      if (cameraRef.current && lastLocationRef.current) {
        cameraRef.current.setCamera({centerCoordinate: [lastLocationRef.current.longitude, lastLocationRef.current.latitude], zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM, pitch: NAV_CONFIG.NAVIGATION_TILT, animationDuration: 800});
      }
    }, 300);
  }, [startLocationTracking]);

  const recenterOnUser = useCallback(() => {
    followUserRef.current = true; setFollowUser(true);
    if (cameraRef.current && lastLocationRef.current) {
      cameraRef.current.setCamera({centerCoordinate: [lastLocationRef.current.longitude, lastLocationRef.current.latitude], zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM, pitch: NAV_CONFIG.NAVIGATION_TILT, animationDuration: 500});
    }
  }, []);

  const toggleVoice = useCallback(() => { setVoiceEnabled(VoiceGuidance.toggle()); }, []);

  // ═══════════════════════════════════════════════════════════
  // 🆕 LOAD SPOTS — fetches from backend + shows my spot
  // ═══════════════════════════════════════════════════════════
  const loadSpots = useCallback(async (location, forceRefresh = false) => {
    Logger.info('SPOTS', '🔍 Loading nearby parking spots...');
    setSpotsLoading(true);

    try {
      // 1. Load my saved spot
      const saved = await ParkingService.getMySpot();
      setMySpot(saved);

      // 2. Check if we need to refetch from backend
      let shouldFetch = forceRefresh;
      if (!shouldFetch && lastNearbyFetchLocRef.current) {
        const movedDistance = calcDistance(
          location.latitude, location.longitude,
          lastNearbyFetchLocRef.current.latitude, lastNearbyFetchLocRef.current.longitude,
        );
        shouldFetch = movedDistance > NEARBY_CONFIG.MIN_MOVE_TO_REFRESH;
      } else {
        shouldFetch = true; // first time
      }

      let nearbySpots = [];

      if (shouldFetch) {
        try {
          // 3. Fetch nearby spots from backend
          nearbySpots = await ParkingService.fetchNearbySpots(
            location.latitude,
            location.longitude,
            NEARBY_CONFIG.RADIUS,
          );
          lastNearbyFetchLocRef.current = {...location};

          Logger.success('SPOTS', `✅ Got ${nearbySpots.length} nearby spots from backend`);
        } catch (error) {
          Logger.error('SPOTS', 'Failed to fetch nearby spots', error);
          // Don't show alert on every failure — just log it
          // Spots will show empty or cached
        }
      } else {
        Logger.info('SPOTS', 'User hasn\'t moved enough — using existing spots');
        // Keep existing allSpots but recalculate distances
        nearbySpots = allSpots.filter(s => !s.isMySpot);
      }

      // 4. Combine: nearby backend spots + my spot
      let combined = [...nearbySpots];

      // Add my spot if occupied (shows as blue marker)
      if (saved && saved.isOccupied) {
        // Remove any duplicate from backend that matches my spot location
        combined = combined.filter(s => {
          const dist = calcDistance(s.latitude, s.longitude, saved.latitude, saved.longitude);
          return dist > 5; // remove if within 5m of my spot
        });
        combined.push({...saved, isMySpot: true});
      }

      // 5. Calculate distance from user to each spot
      combined = combined.map(s => ({
        ...s,
        distance: calcDistance(location.latitude, location.longitude, s.latitude, s.longitude),
      }));

      // 6. Sort by distance
      combined.sort((a, b) => a.distance - b.distance);

      Logger.info('SPOTS', `📊 Total: ${combined.length} | 🔴 Occupied: ${combined.filter(s => s.isOccupied).length} | 🟢 Available: ${combined.filter(s => !s.isOccupied).length} | 🔵 Mine: ${combined.filter(s => s.isMySpot).length}`);

      setAllSpots(combined);
    } catch (error) {
      Logger.error('SPOTS', 'loadSpots error', error);
    } finally {
      setSpotsLoading(false);
    }
  }, [allSpots]);

  // ═══════════════════════════════════════════════════════════
  // 🆕 REFRESH NEARBY SPOTS (manual button)
  // ═══════════════════════════════════════════════════════════
  const refreshNearbySpots = useCallback(async () => {
    const loc = lastLocationRef.current || userLoc;
    Logger.info('SPOTS', '🔄 Manual refresh nearby spots');
    await loadSpots(loc, true); // force refresh
  }, [loadSpots, userLoc]);

  // ═══════════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    Logger.info('INIT', '🚀 Mounting');
    let mounted = true;

    (async () => {
      await VoiceGuidance.init();
      const loc = await getLoc();
      if (!mounted) return;
      setUserLoc(loc); lastLocationRef.current = loc;
      await loadSpots(loc, true); // force fetch on init
      setLoading(false);
      setTimeout(() => {
        cameraRef.current?.setCamera({centerCoordinate: [loc.longitude, loc.latitude], zoomLevel: 15, animationDuration: 1000});
      }, 500);
    })();

    // Auto-refresh nearby spots every 60s
    nearbyRefreshTimerRef.current = setInterval(() => {
      if (!isNavigatingRef.current && lastLocationRef.current) {
        Logger.info('SPOTS', '⏰ Auto-refresh nearby spots');
        loadSpots(lastLocationRef.current, true);
      }
    }, NEARBY_CONFIG.AUTO_REFRESH_INTERVAL);

    const sub = AppState.addEventListener('change', next => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        if (isNavigatingRef.current) startLocationTracking();
        // Refresh spots when app comes to foreground
        if (lastLocationRef.current) loadSpots(lastLocationRef.current, true);
      }
      appStateRef.current = next;
    });

    return () => {
      mounted = false; RouteCache.clear(); isNavigatingRef.current = false;
      if (locationWatchId.current !== null) { Geolocation.clearWatch(locationWatchId.current); locationWatchId.current = null; }
      if (nearbyRefreshTimerRef.current) { clearInterval(nearbyRefreshTimerRef.current); nearbyRefreshTimerRef.current = null; }
      abortControllerRef.current?.abort(); VoiceGuidance.stop(); sub.remove();
      fullRouteRef.current = null; destinationRef.current = null; navigationStepsRef.current = []; lastLocationRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═══════════════════════════════════════════════════════════
  // FETCH ROUTE
  // ═══════════════════════════════════════════════════════════
  const fetchAndShowRoute = useCallback(async (destLat, destLng, startNav = false) => {
    setRouteLoading(true);
    try {
      const routeData = await RoutingService.fetchRoute(userLoc.latitude, userLoc.longitude, destLat, destLng);
      const route = routeData.routes[0]; const coords = route.geometry.coordinates; const steps = route.steps || [];
      fullRouteRef.current = [...coords]; destinationRef.current = {latitude: destLat, longitude: destLng};
      totalDistanceRef.current = route.distance; totalDurationRef.current = route.duration;
      navigationStepsRef.current = steps; lastTrimIndexRef.current = 0; lastVisualUpdateRef.current = null;
      currentStepIndexRef.current = 0; announcedDistancesRef.current.clear();
      setRouteCoordinates(coords); setDestination({latitude: destLat, longitude: destLng}); setNavigationSteps(steps);
      setRouteInfo({totalDistance: route.distance, totalDuration: route.duration, stepsCount: steps.length});
      setRemainingDistance(route.distance); setRemainingDuration(route.duration); setCurrentStepIndex(0); setNavigationProgress(0);
      fitBounds(coords);
      if (startNav) setTimeout(() => startNavigation(), 500);
      else Alert.alert('✅ Route Ready', `📍 ${formatDistance(route.distance)}\n⏱️ ${formatDuration(route.duration)}\n📝 ${steps.length} steps`);
    } catch (error) {
      const fb = [[userLoc.longitude, userLoc.latitude], [destLng, destLat]];
      fullRouteRef.current = fb; destinationRef.current = {latitude: destLat, longitude: destLng};
      setRouteCoordinates(fb); setDestination({latitude: destLat, longitude: destLng}); fitBounds(fb);
      const dist = calcDistance(userLoc.latitude, userLoc.longitude, destLat, destLng);
      totalDistanceRef.current = dist; totalDurationRef.current = dist / 11.11;
      setRouteInfo({totalDistance: dist, totalDuration: dist / 11.11, stepsCount: 2});
      setRemainingDistance(dist); setRemainingDuration(dist / 11.11);
      const fallbackSteps = [
        {id: '1', stepNumber: 1, icon: '🚀', instruction: 'Head towards destination', distance: dist, duration: dist / 11.11, maneuverType: 'depart', location: [userLoc.longitude, userLoc.latitude], name: '', modifier: '', coordinates: []},
        {id: '2', stepNumber: 2, icon: '🎯', instruction: 'Arrive at destination', distance: 0, duration: 0, maneuverType: 'arrive', location: [destLng, destLat], name: '', modifier: '', coordinates: []},
      ];
      navigationStepsRef.current = fallbackSteps; setNavigationSteps(fallbackSteps);
      Alert.alert('⚠️ Route Error', `Straight line.\n${error.message}`);
    } finally { setRouteLoading(false); }
  }, [userLoc, fitBounds, startNavigation]);

  const clearRoute = useCallback(() => {
    stopNavigation(); fullRouteRef.current = null; destinationRef.current = null; navigationStepsRef.current = [];
    totalDistanceRef.current = 0; totalDurationRef.current = 0; lastTrimIndexRef.current = 0; lastVisualUpdateRef.current = null;
    setRouteCoordinates(null); setRouteInfo(null); setNavigationSteps([]); setDestination(null); setSearchMarker(null);
    setRemainingDistance(0); setRemainingDuration(0); setNavigationProgress(0);
  }, [stopNavigation]);

  // ═══════════════════════════════════════════════════════════
  // OCCUPY (PARK)
  // ═══════════════════════════════════════════════════════════
  const handleOccupy = useCallback(async () => {
    const loc = await getLoc();
    if (!loc || !loc.latitude || !loc.longitude) return Alert.alert('❌', 'Location not found');
    Alert.alert('🅿️ Occupy Spot', `Park at:\n📍 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Occupy', onPress: async () => {
        setGettingLoc(true);
        try {
          const spotData = await ParkingService.occupySpot(loc.latitude, loc.longitude);
          setMySpot(spotData); setUserLoc(loc); lastLocationRef.current = loc;
          await loadSpots(loc, true); // refresh to show new marker
          flyTo(loc.latitude, loc.longitude, 17);
          Alert.alert('✅ Occupied!', `📍 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}\n🔵 Blue marker on map`);
        } catch (error) {
          Alert.alert('❌ Failed', `${error.message}`, [{text: 'OK'}, {text: 'Retry', onPress: handleOccupy}]);
        } finally { setGettingLoc(false); }
      }},
    ]);
  }, [getLoc, loadSpots, flyTo]);

  // ═══════════════════════════════════════════════════════════
  // VACATE (LEAVE)
  // ═══════════════════════════════════════════════════════════
  const handleVacate = useCallback(() => {
    if (!mySpot || !mySpot.isOccupied) return Alert.alert('ℹ️', 'No spot to vacate');
    Alert.alert('🚗 Vacate', `📍 ${mySpot.latitude.toFixed(6)}, ${mySpot.longitude.toFixed(6)}`, [
      {text: 'Cancel', style: 'cancel'},
      {text: 'Vacate', style: 'destructive', onPress: async () => {
        setGettingLoc(true);
        try {
          const vacated = await ParkingService.vacateSpot(mySpot.latitude, mySpot.longitude);
          setMySpot(vacated);
          await loadSpots(userLoc, true); // refresh to update marker color
          Alert.alert('✅ Vacated!', '🟢 Spot now available');
        } catch (error) {
          Alert.alert('❌ Failed', `${error.message}`, [{text: 'OK'}, {text: 'Retry', onPress: handleVacate}]);
        } finally { setGettingLoc(false); }
      }},
    ]);
  }, [mySpot, loadSpots, userLoc]);

  // ═══════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════
  const handleSpotPress = useCallback(spot => { setSelectedSpot(spot); setShowModal(true); }, []);

  const onLocate = useCallback(async () => {
    const loc = await getLoc();
    if (!loc) return;
    setUserLoc(loc); lastLocationRef.current = loc;
    await loadSpots(loc, true);
    flyTo(loc.latitude, loc.longitude, 16);
  }, [getLoc, loadSpots, flyTo]);

  const onShowRoute = useCallback(spot => { setShowModal(false); fetchAndShowRoute(spot.latitude, spot.longitude, false); }, [fetchAndShowRoute]);
  const onStartNavigation = useCallback(spot => { setShowModal(false); setShowNavigation(false); fetchAndShowRoute(spot.latitude, spot.longitude, true); }, [fetchAndShowRoute]);
  const onShowSteps = useCallback(spot => { setShowModal(false); setShowNavigation(true); if (!routeCoordinates) fetchAndShowRoute(spot.latitude, spot.longitude, false); }, [fetchAndShowRoute, routeCoordinates]);
  const onNavigateExternal = useCallback(spot => {
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${userLoc.latitude},${userLoc.longitude}&destination=${spot.latitude},${spot.longitude}&travelmode=driving`);
  }, [userLoc]);

  const onFindParking = useCallback(() => {
    const nearest = allSpots.find(s => !s.isOccupied && !s.isMySpot);
    if (!nearest) return Alert.alert('😕', 'No available spots within 500m');
    flyTo(nearest.latitude, nearest.longitude, 17);
    setSelectedSpot(nearest); setShowModal(true);
  }, [allSpots, flyTo]);

  const showRouteStats = useCallback(() => {
    const stats = RoutingService.stats();
    Alert.alert('📊 Stats', `📡 Total: ${stats.total}\n✅ OK: ${stats.success}\n❌ Fail: ${stats.fail}\n🚀 Cache: ${stats.cache}\n🅿️ Spots: ${allSpots.length}`);
  }, [allSpots.length]);

  const zoomIn = useCallback(() => { const z = Math.min(zoomLevel + 1, 19); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }, [zoomLevel]);
  const zoomOut = useCallback(() => { const z = Math.max(zoomLevel - 1, 5); setZoomLevel(z); cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300}); }, [zoomLevel]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim(); if (!q) return;
    Keyboard.dismiss(); setSearching(true);
    try {
      const res = await fetchWithTimeout(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`, {headers: {'User-Agent': `${APP_CONFIG.APP_NAME}/${APP_CONFIG.VERSION}`}}, 8000);
      const results = await res.json();
      if (!results?.length) return Alert.alert('Not found');
      const lat = parseFloat(results[0].lat), lng = parseFloat(results[0].lon);
      setSearchMarker({latitude: lat, longitude: lng}); flyTo(lat, lng, 16);
    } catch (_) { Alert.alert('Error', 'Search failed'); } finally { setSearching(false); }
  }, [searchQuery, flyTo]);

  // MEMOIZED
  const renderStep = useCallback(({item, index}) => (
    <NavigationStepItem step={item} index={index} currentStepIndex={currentStepIndex} distanceToNextStep={distanceToNextStep} totalSteps={navigationSteps.length} />
  ), [currentStepIndex, distanceToNextStep, navigationSteps.length]);
  const stepKeyExtractor = useCallback(item => item.id, []);

  const routeShape = useMemo(() => {
    if (!routeCoordinates || routeCoordinates.length < 2) return null;
    return {type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: routeCoordinates}};
  }, [routeCoordinates]);

  const availableCount = useMemo(() => allSpots.filter(s => !s.isOccupied && !s.isMySpot).length, [allSpots]);
  const occupiedCount = useMemo(() => allSpots.filter(s => s.isOccupied).length, [allSpots]);

  // LOADING
  if (loading) {
    return (
      <SafeAreaView style={S.loading}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={S.loadingTitle}>Loading Map...</Text>
        <Text style={S.loadingSub}>🗺️ MapLibre • 100% FREE</Text>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
      <View style={S.container}>
        <MapLibreGL.MapView ref={mapRef} style={StyleSheet.absoluteFill} styleJSON={EMPTY_STYLE} logoEnabled={false} attributionEnabled={false}
          onDidFinishLoadingMap={() => Logger.success('MAP', 'Loaded')} onDidFinishRenderingMapFully={() => setTilesLoaded(true)}>
          <MapLibreGL.Camera ref={cameraRef} zoomLevel={14} centerCoordinate={[userLoc.longitude, userLoc.latitude]}
            animationMode="flyTo" animationDuration={0} maxZoomLevel={19} minZoomLevel={3} />
          <MapLibreGL.RasterSource id="osm" tileUrlTemplates={['https://tile.openstreetmap.org/{z}/{x}/{y}.png']} tileSize={256} maxZoomLevel={19} minZoomLevel={1}>
            <MapLibreGL.RasterLayer id="osmLayer" sourceID="osm" style={{rasterOpacity: 1}} maxZoomLevel={19} />
          </MapLibreGL.RasterSource>

          {/* 🆕 Nearby Parking Spots from Backend */}
          {!isNavigating && allSpots.map(spot => (
            <ParkingMarker key={spot.id} spot={spot} onPress={handleSpotPress} />
          ))}

          {searchMarker && !isNavigating && <SearchMarker coordinate={searchMarker} />}
          {destination && <DestinationMarker coordinate={destination} />}

          {routeShape && (
            <MapLibreGL.ShapeSource id="routeSource" shape={routeShape}>
              <MapLibreGL.LineLayer id="routeBorder" style={{lineColor: '#FFFFFF', lineWidth: 12, lineOpacity: 0.9, lineCap: 'round', lineJoin: 'round'}} />
              <MapLibreGL.LineLayer id="routeLine" style={{lineColor: isNavigating ? '#1976D2' : '#E53935', lineWidth: 7, lineOpacity: 1, lineCap: 'round', lineJoin: 'round'}} />
            </MapLibreGL.ShapeSource>
          )}

          <UserLocationMarker coordinate={userLoc} heading={userHeading} isNavigating={isNavigating} accuracy={locationAccuracy} />
        </MapLibreGL.MapView>

        {/* Nav Panel */}
        {isNavigating && navigationSteps.length > 0 && (
          <NavigationPanel currentStep={navigationSteps[currentStepIndex]} nextStep={navigationSteps[currentStepIndex + 1]}
            distanceToNextStep={distanceToNextStep} totalRemainingDistance={remainingDistance} totalRemainingTime={remainingDuration}
            progress={navigationProgress} onClose={stopNavigation} onRecenter={recenterOnUser} isRecentering={followUser}
            voiceEnabled={voiceEnabled} onToggleVoice={toggleVoice} />
        )}

        {!tilesLoaded && (
          <View style={S.tilesLoading}><ActivityIndicator size="small" color="#E53935" /><Text style={S.tilesLoadingTxt}>Loading tiles...</Text></View>
        )}

        {routeLoading && (
          <View style={S.routeLoadingOverlay}><View style={S.routeLoadingCard}>
            <ActivityIndicator size="large" color="#E53935" /><Text style={S.routeLoadingTxt}>Fetching route...</Text>
          </View></View>
        )}

        {/* Search */}
        {!isNavigating && (
          <View style={[S.searchWrap, {top: insets.top + 12}]}>
            <View style={S.searchBar}>
              <Text style={S.searchIcon}>🔍</Text>
              <TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search location..." placeholderTextColor="#999"
                style={S.searchInput} returnKeyType="search" onSubmitEditing={runSearch} />
              {searchQuery.length > 0 && <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchMarker(null); }}><Text style={S.searchClear}>✕</Text></TouchableOpacity>}
              <TouchableOpacity onPress={runSearch} style={S.searchBtn}>
                {searching ? <ActivityIndicator size="small" color="#E53935" /> : <Text style={S.searchBtnTxt}>→</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Occupy / Vacate */}
        {!isNavigating && (
          <View style={[S.pillsRow, {top: insets.top + 68}]}>
            <TouchableOpacity style={[S.pill, mySpot?.isOccupied && S.pillOff]} onPress={handleOccupy} disabled={mySpot?.isOccupied || gettingLoc}>
              {gettingLoc ? <ActivityIndicator size="small" color="#E53935" /> : <><Text style={S.pillIcon}>📍</Text><Text style={S.pillTxt}>Occupy</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={[S.pill, !mySpot?.isOccupied && S.pillOff]} onPress={handleVacate} disabled={!mySpot?.isOccupied || gettingLoc}>
              {gettingLoc ? <ActivityIndicator size="small" color="#E53935" /> : <><Text style={S.pillIcon}>🚗</Text><Text style={S.pillTxt}>Vacate</Text></>}
            </TouchableOpacity>
            {/* 🆕 Refresh button */}
            <TouchableOpacity style={S.pill} onPress={refreshNearbySpots} disabled={spotsLoading}>
              {spotsLoading ? <ActivityIndicator size="small" color="#E53935" /> : <><Text style={S.pillIcon}>🔄</Text><Text style={S.pillTxt}>Refresh</Text></>}
            </TouchableOpacity>
          </View>
        )}

        {/* 🆕 Spots count badge */}
        {!isNavigating && allSpots.length > 0 && (
          <View style={[S.spotsBadge, {top: insets.top + 118}]}>
            <Text style={S.spotsBadgeTxt}>
              🅿️ {allSpots.length} spots • 🟢 {availableCount} free • 🔴 {occupiedCount} taken • 📍 {NEARBY_CONFIG.RADIUS}m radius
            </Text>
          </View>
        )}

        {/* Route info */}
        {routeInfo && !isNavigating && (
          <View style={[S.routeInfoCard, {top: insets.top + (allSpots.length > 0 ? 148 : 120)}]}>
            <View style={S.routeInfoContent}>
              <View style={S.routeInfoItem}><Text style={S.routeInfoVal}>{formatDistance(routeInfo.totalDistance)}</Text><Text style={S.routeInfoLbl}>Distance</Text></View>
              <View style={S.routeInfoDiv} />
              <View style={S.routeInfoItem}><Text style={S.routeInfoVal}>{formatDuration(routeInfo.totalDuration)}</Text><Text style={S.routeInfoLbl}>Duration</Text></View>
              <View style={S.routeInfoDiv} />
              <View style={S.routeInfoItem}><Text style={S.routeInfoVal}>{routeInfo.stepsCount}</Text><Text style={S.routeInfoLbl}>Steps</Text></View>
            </View>
            <TouchableOpacity style={S.routeInfoClose} onPress={clearRoute}><Text style={S.routeInfoCloseTxt}>✕</Text></TouchableOpacity>
          </View>
        )}

        {/* Right controls */}
        <View style={[S.rightCtrls, {top: isNavigating ? insets.top + 240 : routeInfo ? insets.top + 215 : insets.top + 160}]}>
          <TouchableOpacity style={S.ctrlBtn} onPress={onLocate} onLongPress={showRouteStats}><Text style={S.ctrlIcon}>📍</Text></TouchableOpacity>
          {routeCoordinates && !isNavigating && <TouchableOpacity style={S.ctrlBtn} onPress={clearRoute}><Text style={S.ctrlIcon}>🧹</Text></TouchableOpacity>}
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomIn}><Text style={S.ctrlIcon}>＋</Text></TouchableOpacity>
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomOut}><Text style={S.ctrlIcon}>－</Text></TouchableOpacity>
        </View>

        {/* Find parking */}
        {!isNavigating && (
          <View style={[S.findWrap, {bottom: 86 + insets.bottom}]}>
            <TouchableOpacity style={S.findBtn} onPress={onFindParking}>
              <Text style={S.findIcon}>🅿️</Text>
              <Text style={S.findTxt}>Find Parking</Text>
              <View style={S.findBadge}><Text style={S.findBadgeTxt}>{availableCount}</Text></View>
            </TouchableOpacity>
          </View>
        )}

        {isNavigating && (
          <View style={[S.endNavWrap, {bottom: 100 + insets.bottom}]}>
            <TouchableOpacity style={S.endNavBtn} onPress={stopNavigation}>
              <Text style={S.endNavIcon}>✕</Text><Text style={S.endNavTxt}>End Navigation</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tab bar */}
        <View style={[S.tabBar, {paddingBottom: Math.max(12, insets.bottom)}]}>
          <TouchableOpacity style={S.tabItem}><Text style={[S.tabIcon, S.tabActive]}>🗺️</Text><Text style={[S.tabLbl, S.tabActive]}>Explore</Text></TouchableOpacity>
          <TouchableOpacity style={S.tabItem}><Text style={S.tabIcon}>🔖</Text><Text style={S.tabLbl}>Saved</Text></TouchableOpacity>
          <TouchableOpacity style={S.tabCenter}><Text style={S.tabPlus}>＋</Text></TouchableOpacity>
          <TouchableOpacity style={S.tabItem}><Text style={S.tabIcon}>👥</Text><Text style={S.tabLbl}>Contribute</Text></TouchableOpacity>
          <TouchableOpacity style={S.tabItem}><Text style={S.tabIcon}>👤</Text><Text style={S.tabLbl}>Profile</Text></TouchableOpacity>
        </View>

        {/* Spot Modal */}
        <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
          <View style={S.modalOverlay}>
            <TouchableOpacity style={S.modalBg} onPress={() => setShowModal(false)} activeOpacity={1} />
            <View style={S.modalContent}>
              <View style={S.modalHandle} />
              <View style={S.modalHeader}>
                <Text style={S.modalTitle}>{selectedSpot?.isMySpot ? '🚗 Your Spot' : '🅿️ Parking'}</Text>
                <TouchableOpacity onPress={() => setShowModal(false)}><Text style={S.modalClose}>✕</Text></TouchableOpacity>
              </View>
              {selectedSpot && (
                <ScrollView style={S.modalBody}>
                  <View style={[S.statusBadge, {backgroundColor: selectedSpot.isOccupied ? '#FFEBEE' : '#E8F5E9'}]}>
                    <Text style={[S.statusTxt, {color: selectedSpot.isOccupied ? '#E53935' : '#4CAF50'}]}>
                      {selectedSpot.isOccupied ? '🔴 Occupied (PARKED)' : '🟢 Available'}
                    </Text>
                  </View>
                  <View style={S.infoCard}>
                    <Text style={S.infoRow}>📏 {formatDistance(selectedSpot.distance)}</Text>
                    <Text style={S.infoRow}>🚗 {selectedSpot.deviceName}</Text>
                    <Text style={S.infoRow}>🕐 {formatTime(selectedSpot.createdAt)}</Text>
                    <Text style={S.infoRow}>📍 {selectedSpot.latitude?.toFixed(6)}, {selectedSpot.longitude?.toFixed(6)}</Text>
                    {selectedSpot.eventType && <Text style={S.infoRow}>📡 Event: {selectedSpot.eventType}</Text>}
                  </View>
                  <View style={S.modalActions}>
                    <TouchableOpacity style={S.routeBtn} onPress={() => onShowRoute(selectedSpot)}><Text style={S.routeBtnTxt}>🗺️ Show Route</Text></TouchableOpacity>
                    <TouchableOpacity style={S.navBtn} onPress={() => onShowSteps(selectedSpot)}><Text style={S.navBtnTxt}>📋 View Steps</Text></TouchableOpacity>
                    <TouchableOpacity style={S.startBtn} onPress={() => onStartNavigation(selectedSpot)}><Text style={S.startBtnTxt}>🧭 Start Navigation</Text></TouchableOpacity>
                    <TouchableOpacity style={S.extBtn} onPress={() => onNavigateExternal(selectedSpot)}><Text style={S.extBtnTxt}>📱 Google Maps</Text></TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Steps Modal */}
        <Modal visible={showNavigation} transparent animationType="slide" onRequestClose={() => setShowNavigation(false)}>
          <SafeAreaView style={S.navModalWrap}>
            <View style={S.navModalContent}>
              <View style={S.navModalHeader}>
                <TouchableOpacity onPress={() => setShowNavigation(false)} style={S.navModalCloseBtn}><Text style={S.navModalCloseTxt}>←</Text></TouchableOpacity>
                <Text style={S.navModalTitle}>Navigation Steps</Text>
                <TouchableOpacity onPress={() => { if (destination) { setShowNavigation(false); onStartNavigation({latitude: destination.latitude, longitude: destination.longitude}); }}} style={S.navModalStartBtn}>
                  <Text style={S.navModalStartTxt}>▶️ Start</Text>
                </TouchableOpacity>
              </View>
              {routeInfo && (
                <View style={S.navSummary}>
                  <View style={S.navSumItem}><Text style={S.navSumVal}>{formatDistance(isNavigating ? remainingDistance : routeInfo.totalDistance)}</Text><Text style={S.navSumLbl}>{isNavigating ? 'Remaining' : 'Total'}</Text></View>
                  <View style={S.navSumDiv} />
                  <View style={S.navSumItem}><Text style={S.navSumVal}>{formatDuration(isNavigating ? remainingDuration : routeInfo.totalDuration)}</Text><Text style={S.navSumLbl}>Duration</Text></View>
                  <View style={S.navSumDiv} />
                  <View style={S.navSumItem}><Text style={S.navSumVal}>{routeInfo.stepsCount}</Text><Text style={S.navSumLbl}>Steps</Text></View>
                </View>
              )}
              {isNavigating && (
                <View style={S.navProgressWrap}>
                  <View style={S.navProgressBar}><View style={[S.navProgressFill, {width: `${navigationProgress * 100}%`}]} /></View>
                  <Text style={S.navProgressTxt}>{formatDistance(totalDistanceRef.current - remainingDistance)} traveled ({(navigationProgress * 100).toFixed(0)}%)</Text>
                </View>
              )}
              <FlatList data={navigationSteps} renderItem={renderStep} keyExtractor={stepKeyExtractor} contentContainerStyle={S.navStepsList}
                ListEmptyComponent={<View style={S.navEmpty}><Text style={{fontSize: 70, marginBottom: 24}}>🗺️</Text><Text style={{fontSize: 16, color: '#666', fontWeight: '600'}}>No steps</Text></View>} />
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

export default function ParkingMapScreen(props) {
  return <MapErrorBoundary><ParkingMapScreenInner {...props} /></MapErrorBoundary>;
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
const S = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F8F9FA'}, container: {flex: 1},
  loading: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff'},
  loadingTitle: {marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111'},
  loadingSub: {marginTop: 8, fontSize: 13, color: '#4CAF50', fontWeight: '600'},

  errorBoundary: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24},
  errorBtn: {marginTop: 24, paddingHorizontal: 28, paddingVertical: 14, backgroundColor: '#E53935', borderRadius: 14},

  // Nav Panel
  navPanel: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#fff', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, elevation: 20, shadowColor: '#000', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.25, shadowRadius: 12, zIndex: 100},
  navPanelProgressWrap: {position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: '#E0E0E0'},
  navPanelProgressFill: {height: '100%', backgroundColor: '#4CAF50'},
  navPanelHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  navPanelCloseBtn: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navPanelCloseTxt: {fontSize: 22, color: '#666', fontWeight: '600'},
  navPanelStats: {flexDirection: 'row', alignItems: 'center'},
  navPanelETA: {fontSize: 20, fontWeight: '800', color: '#4CAF50'},
  navPanelDot: {fontSize: 18, color: '#999', marginHorizontal: 8},
  navPanelDist: {fontSize: 18, fontWeight: '700', color: '#333'},
  navPanelRight: {flexDirection: 'row', gap: 8},
  navPanelSmBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navPanelSmBtnOff: {backgroundColor: '#FFEBEE'}, navPanelSmBtnTxt: {fontSize: 18}, navPanelSmBtnActive: {backgroundColor: '#E3F2FD'},
  navPanelCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1976D2', borderRadius: 20, padding: 18, marginBottom: 12, elevation: 6},
  navPanelIconBox: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 16, elevation: 3},
  navPanelMainIcon: {fontSize: 34}, navPanelContent: {flex: 1},
  navPanelTurnDist: {fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4},
  navPanelInstruction: {fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.95)', lineHeight: 22},
  navPanelNext: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E0E0E0'},
  navPanelNextLabel: {fontSize: 13, color: '#999', marginRight: 12, fontWeight: '600'},
  navPanelNextIconBox: {width: 38, height: 38, borderRadius: 19, backgroundColor: '#E0E0E0', justifyContent: 'center', alignItems: 'center', marginRight: 12},
  navPanelNextIcon: {fontSize: 18}, navPanelNextInstr: {flex: 1, fontSize: 14, color: '#666', fontWeight: '500'},

  endNavWrap: {position: 'absolute', left: 20, right: 20, zIndex: 50},
  endNavBtn: {height: 56, backgroundColor: '#E53935', borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 10},
  endNavIcon: {fontSize: 22, color: '#fff', marginRight: 8, fontWeight: '700'}, endNavTxt: {fontSize: 17, fontWeight: '700', color: '#fff'},

  // User marker
  userMarkerContainer: {alignItems: 'center', justifyContent: 'center'},
  userMarkerAccuracy: {position: 'absolute', backgroundColor: 'rgba(25,118,210,0.1)', borderWidth: 1, borderColor: 'rgba(25,118,210,0.3)'},
  userMarkerOuter: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(25,118,210,0.2)', justifyContent: 'center', alignItems: 'center'},
  userMarkerOuterNav: {width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(25,118,210,0.25)'},
  userMarkerInner: {width: 26, height: 26, borderRadius: 13, backgroundColor: '#1976D2', borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 6},
  userMarkerInnerNav: {width: 34, height: 34, borderRadius: 17, borderWidth: 5},
  userMarkerArrowWrap: {position: 'absolute', width: 60, height: 60, justifyContent: 'flex-start', alignItems: 'center'},
  userMarkerArrow2: {width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 20, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#1976D2', marginTop: -25},

  tilesLoading: {position: 'absolute', top: '45%', alignSelf: 'center', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, elevation: 8, gap: 10, zIndex: 50},
  tilesLoadingTxt: {fontSize: 14, color: '#333', fontWeight: '600'},

  markerTouchable: {alignItems: 'center'},
  markerContainer: {width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},
  markerIcon: {fontSize: 20},
  markerArrow: {width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -3},
  searchMarkerContainer: {alignItems: 'center'}, searchMarkerIcon: {fontSize: 40},
  destMarkerContainer: {alignItems: 'center'},
  destMarker: {width: 54, height: 54, borderRadius: 27, backgroundColor: '#4CAF50', borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 10},
  destMarkerIcon: {fontSize: 26},
  destMarkerArrow: {width: 0, height: 0, borderLeftWidth: 14, borderRightWidth: 14, borderTopWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#4CAF50', marginTop: -4},

  routeLoadingOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 1000},
  routeLoadingCard: {backgroundColor: '#fff', padding: 32, borderRadius: 24, alignItems: 'center', elevation: 15},
  routeLoadingTxt: {marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111'},

  searchWrap: {position: 'absolute', left: 16, right: 16, zIndex: 30},
  searchBar: {height: 54, backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', elevation: 8},
  searchIcon: {fontSize: 18, marginRight: 10}, searchInput: {flex: 1, fontSize: 15, color: '#111', fontWeight: '500'},
  searchClear: {fontSize: 18, color: '#999', marginRight: 10, padding: 4},
  searchBtn: {width: 38, height: 38, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  searchBtnTxt: {fontSize: 20, color: '#E53935', fontWeight: '700'},

  pillsRow: {position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 25},
  pill: {backgroundColor: '#fff', paddingHorizontal: 16, height: 42, borderRadius: 21, flexDirection: 'row', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 4},
  pillOff: {opacity: 0.5}, pillIcon: {fontSize: 14, marginRight: 5}, pillTxt: {fontSize: 13, fontWeight: '700', color: '#111'},

  // 🆕 Spots count badge
  spotsBadge: {position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, elevation: 4, shadowColor: '#000', shadowOffset: {width: 0, height: 1}, shadowOpacity: 0.1, shadowRadius: 3, zIndex: 24},
  spotsBadgeTxt: {fontSize: 12, fontWeight: '600', color: '#555', textAlign: 'center'},

  routeInfoCard: {position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', elevation: 8, zIndex: 24},
  routeInfoContent: {flex: 1, flexDirection: 'row'},
  routeInfoItem: {flex: 1, alignItems: 'center'},
  routeInfoVal: {fontSize: 18, fontWeight: '800', color: '#E53935'}, routeInfoLbl: {fontSize: 11, color: '#666', marginTop: 2, fontWeight: '500'},
  routeInfoDiv: {width: 1, height: 36, backgroundColor: '#E0E0E0', marginHorizontal: 12},
  routeInfoClose: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  routeInfoCloseTxt: {fontSize: 16, color: '#666', fontWeight: '600'},

  rightCtrls: {position: 'absolute', right: 16, zIndex: 20, gap: 10},
  ctrlBtn: {width: 52, height: 52, borderRadius: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 6},
  ctrlIcon: {fontSize: 24},

  findWrap: {position: 'absolute', left: 20, right: 20, zIndex: 20},
  findBtn: {height: 62, backgroundColor: '#E53935', borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 12},
  findIcon: {fontSize: 24, marginRight: 10}, findTxt: {fontSize: 18, fontWeight: '800', color: '#fff'},
  findBadge: {backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, marginLeft: 14},
  findBadgeTxt: {fontSize: 14, fontWeight: '800', color: '#E53935'},

  tabBar: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, flexDirection: 'row', justifyContent: 'space-around', elevation: 20},
  tabItem: {width: 60, alignItems: 'center', paddingVertical: 6},
  tabIcon: {fontSize: 24, color: '#999'}, tabLbl: {fontSize: 10, marginTop: 4, color: '#999', fontWeight: '600'},
  tabActive: {color: '#E53935'},
  tabCenter: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', marginBottom: 14, elevation: 12},
  tabPlus: {fontSize: 36, color: '#fff', marginTop: -2},

  modalOverlay: {flex: 1, justifyContent: 'flex-end'},
  modalBg: {...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)'},
  modalContent: {backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '80%', elevation: 25},
  modalHandle: {width: 48, height: 5, backgroundColor: '#DDD', borderRadius: 3, alignSelf: 'center', marginTop: 14},
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 22, borderBottomWidth: 1, borderBottomColor: '#F0F0F0'},
  modalTitle: {fontSize: 22, fontWeight: '800', color: '#111'}, modalClose: {fontSize: 28, color: '#999'},
  modalBody: {padding: 22},
  statusBadge: {alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, marginBottom: 18},
  statusTxt: {fontSize: 14, fontWeight: '700'},
  infoCard: {backgroundColor: '#F8F9FA', borderRadius: 18, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: '#F0F0F0'},
  infoRow: {fontSize: 15, color: '#111', paddingVertical: 8, fontWeight: '500'},
  modalActions: {gap: 12},
  routeBtn: {backgroundColor: '#F0F0F0', padding: 18, borderRadius: 16, alignItems: 'center'},
  routeBtnTxt: {fontSize: 16, fontWeight: '700', color: '#111'},
  navBtn: {backgroundColor: '#FFF3E0', padding: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FFE0B2'},
  navBtnTxt: {fontSize: 16, fontWeight: '700', color: '#E65100'},
  startBtn: {backgroundColor: '#4CAF50', padding: 18, borderRadius: 16, alignItems: 'center', elevation: 4},
  startBtnTxt: {fontSize: 16, fontWeight: '700', color: '#fff'},
  extBtn: {backgroundColor: '#E53935', padding: 18, borderRadius: 16, alignItems: 'center', elevation: 4},
  extBtnTxt: {fontSize: 16, fontWeight: '700', color: '#fff'},

  navModalWrap: {flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'},
  navModalContent: {flex: 1, backgroundColor: '#fff', marginTop: 60, borderTopLeftRadius: 32, borderTopRightRadius: 32, elevation: 25},
  navModalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F0F0F0'},
  navModalCloseBtn: {width: 46, height: 46, borderRadius: 23, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navModalCloseTxt: {fontSize: 26, color: '#111', fontWeight: '600'},
  navModalTitle: {fontSize: 18, fontWeight: '800', color: '#111'},
  navModalStartBtn: {paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: '#4CAF50', elevation: 3},
  navModalStartTxt: {fontSize: 14, fontWeight: '700', color: '#fff'},

  navSummary: {flexDirection: 'row', padding: 18, backgroundColor: '#F8F9FA', borderBottomWidth: 1, borderBottomColor: '#EEE'},
  navSumItem: {flex: 1, alignItems: 'center'}, navSumVal: {fontSize: 20, fontWeight: '800', color: '#111'},
  navSumLbl: {fontSize: 11, color: '#666', marginTop: 3, fontWeight: '500'},
  navSumDiv: {width: 1, backgroundColor: '#E0E0E0', marginHorizontal: 12},

  navProgressWrap: {padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE'},
  navProgressBar: {height: 10, backgroundColor: '#E0E0E0', borderRadius: 5, overflow: 'hidden'},
  navProgressFill: {height: '100%', backgroundColor: '#4CAF50', borderRadius: 5},
  navProgressTxt: {fontSize: 13, color: '#666', marginTop: 10, textAlign: 'center', fontWeight: '500'},

  navStepsList: {padding: 16},
  navStep: {flexDirection: 'row', marginBottom: 8},
  navStepCurrent: {backgroundColor: '#FFF8E1', borderRadius: 18, marginLeft: -10, marginRight: -10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: '#FFE082'},
  navStepPast: {opacity: 0.5},
  navStepLeft: {alignItems: 'center', marginRight: 14},
  navIconBox: {width: 50, height: 50, borderRadius: 25, backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center', elevation: 5},
  navIconBoxCurrent: {backgroundColor: '#FF9800', width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: '#FFE082'},
  navIconBoxPast: {backgroundColor: '#9E9E9E'},
  navIcon: {fontSize: 24},
  navConnector: {width: 4, flex: 1, backgroundColor: '#E53935', marginVertical: 6, borderRadius: 2},
  navConnectorPast: {backgroundColor: '#BDBDBD'},
  navStepRight: {flex: 1, backgroundColor: '#F8F9FA', padding: 16, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: '#F0F0F0'},
  navStepRightCurrent: {backgroundColor: '#FFECB3', borderWidth: 2, borderColor: '#FF9800'},
  navStepHeader: {flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8},
  navStepNum: {fontSize: 11, color: '#666', fontWeight: '700', textTransform: 'uppercase'},
  navStepDist: {fontSize: 14, color: '#E53935', fontWeight: '800'},
  navStepInstr: {fontSize: 16, color: '#111', fontWeight: '700', marginBottom: 6, lineHeight: 23},
  navStepStreet: {fontSize: 13, color: '#666', marginBottom: 6, fontWeight: '500'},
  navStepDur: {fontSize: 12, color: '#999', fontWeight: '500'},
  navStepTxtPast: {color: '#9E9E9E'},
  navStepBadge: {backgroundColor: '#FF9800', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, alignSelf: 'flex-start', marginTop: 10, elevation: 2},
  navStepBadgeTxt: {fontSize: 13, fontWeight: '700', color: '#fff'},
  navEmpty: {alignItems: 'center', paddingVertical: 80},
});