// src/screens/ParkingMapScreen.js

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
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
} from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { BluetoothModule } = NativeModules;

/* ─────────────────────────────────────────────────────────────
   BACKEND CONFIGURATION
────────────────────────────────────────────────────────────── */
const BACKEND_CONFIG = {
  baseUrl: 'https://cb38-2405-201-3037-e001-c059-8276-d489-7631.ngrok-free.app/parkit-api/operate',
  timeout: 15000,
  maxRetries: 2,
};

/* ─────────────────────────────────────────────────────────────
   POLYLINE DECODER
────────────────────────────────────────────────────────────── */
const decodePolyline = (encoded) => {
  if (!encoded || typeof encoded !== 'string') return [];
  
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    coordinates.push([lng / 1e5, lat / 1e5]);
  }

  return coordinates;
};

/* ─────────────────────────────────────────────────────────────
   TURN-BY-TURN ICONS + INSTRUCTIONS
────────────────────────────────────────────────────────────── */
const MANEUVER_ICONS = {
  'turn-right': '➡️',
  'turn-left': '⬅️',
  'turn-slight right': '↗️',
  'turn-slight left': '↖️',
  'turn-sharp right': '⤴️',
  'turn-sharp left': '⤵️',
  'continue': '⬆️',
  'straight': '⬆️',
  'roundabout': '🔄',
  'roundabout-straight': '🔄',
  'exit roundabout': '↪️',
  'exit roundabout-straight': '↪️',
  'exit roundabout-slight left': '↪️',
  'exit roundabout-left': '↪️',
  'ramp-right': '🛣️',
  'ramp-left': '🛣️',
  'fork-right': '🔱',
  'fork-left': '🔱',
  'merge': '🔀',
  'depart': '🚀',
  'arrive': '🎯',
  'default': '⬆️',
};

const getManeuverIcon = (type, modifier) => {
  if (!type) return MANEUVER_ICONS.default;
  const key = modifier ? `${type}-${modifier}` : type;
  return MANEUVER_ICONS[key] || MANEUVER_ICONS[type] || MANEUVER_ICONS.default;
};

const getManeuverInstruction = (type, modifier, name, distance) => {
  const streetName = name && name.trim() ? name.trim() : 'the road';

  if (type === 'depart') return `Start on ${streetName}`;
  if (type === 'arrive') return 'You have arrived at your destination';

  if (type === 'turn') {
    if (modifier === 'right') return `Turn right onto ${streetName}`;
    if (modifier === 'left') return `Turn left onto ${streetName}`;
    if (modifier === 'slight right') return `Keep right onto ${streetName}`;
    if (modifier === 'slight left') return `Keep left onto ${streetName}`;
    if (modifier === 'sharp right') return `Sharp right onto ${streetName}`;
    if (modifier === 'sharp left') return `Sharp left onto ${streetName}`;
  }

  if (type === 'roundabout') return `Enter roundabout`;
  if (type === 'exit roundabout') return `Exit roundabout onto ${streetName}`;
  if (type === 'new name' || type === 'continue' || type === 'straight') return `Continue on ${streetName}`;
  if (type === 'fork') {
    if (modifier === 'right') return `Keep right at fork`;
    if (modifier === 'left') return `Keep left at fork`;
  }
  if (type === 'merge') return `Merge onto ${streetName}`;

  return `Continue on ${streetName}`;
};

const getShortInstruction = (type, modifier) => {
  if (type === 'depart') return 'Start';
  if (type === 'arrive') return 'Arrive';
  if (type === 'turn') {
    if (modifier === 'right') return 'Turn Right';
    if (modifier === 'left') return 'Turn Left';
    if (modifier === 'slight right') return 'Slight Right';
    if (modifier === 'slight left') return 'Slight Left';
    if (modifier === 'sharp right') return 'Sharp Right';
    if (modifier === 'sharp left') return 'Sharp Left';
  }
  if (type === 'roundabout') return 'Roundabout';
  if (type === 'exit roundabout') return 'Exit';
  if (type === 'fork') return modifier === 'right' ? 'Keep Right' : 'Keep Left';
  if (type === 'merge') return 'Merge';
  return 'Continue';
};

/* ─────────────────────────────────────────────────────────────
   DISTANCE CALCULATION
────────────────────────────────────────────────────────────── */
const calcDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371000;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const findNearestPointOnRoute = (userLat, userLng, coordinates) => {
  let minDist = Infinity;
  let nearestIndex = 0;
  
  for (let i = 0; i < coordinates.length; i++) {
    const [lng, lat] = coordinates[i];
    const dist = calcDistance(userLat, userLng, lat, lng);
    if (dist < minDist) {
      minDist = dist;
      nearestIndex = i;
    }
  }
  
  return { index: nearestIndex, distance: minDist };
};

/* ─────────────────────────────────────────────────────────────
   BACKEND ROUTING SERVICE
────────────────────────────────────────────────────────────── */
const RoutingService = {
  requestCounter: 0,
  failureCount: 0,
  successCount: 0,
  lastBackendMessage: '',

  fetchRoute: async (startLat, startLng, destLat, destLng, retryCount = 0) => {
    const requestId = ++RoutingService.requestCounter;
    console.log(`[BACKEND] #${requestId} Fetching route...`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), BACKEND_CONFIG.timeout);

      const requestBody = {
        startLat,
        startLon: startLng,
        endLat: destLat,
        endLon: destLng,
        requestType: 'ROUTE',
      };

      const response = await fetch(BACKEND_CONFIG.baseUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      clearTimeout(timeoutId);

      const responseText = await response.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch {
        throw new Error('Invalid JSON response');
      }

      // Handle both response formats
      const routeData = data.geometry || data;
      const backendMessage = data?.message || '';
      RoutingService.lastBackendMessage = backendMessage;

      if (data?.status === 'error' || data?.status === 'ERROR') {
        throw new Error(backendMessage || 'Backend error');
      }

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!routeData?.routes || routeData.routes.length === 0) throw new Error('No routes found');
      if (routeData.code !== 'Ok') throw new Error(`Route error: ${routeData.code}`);

      const route = routeData.routes[0];

      let coordinates = [];
      if (route.geometry && typeof route.geometry === 'string') {
        coordinates = decodePolyline(route.geometry);
      } else if (route.geometry?.coordinates) {
        coordinates = route.geometry.coordinates;
      }

      if (coordinates.length === 0) throw new Error('No coordinates');

      const navigationSteps = [];
      if (route.legs?.length > 0) {
        route.legs.forEach((leg) => {
          if (leg.steps?.length > 0) {
            leg.steps.forEach((step) => {
              const maneuver = step.maneuver || {};
              const stepCoords = step.geometry ? decodePolyline(step.geometry) : [];
              
              navigationSteps.push({
                type: maneuver.type || 'continue',
                modifier: maneuver.modifier || '',
                location: maneuver.location || [0, 0],
                distance: step.distance || 0,
                duration: step.duration || 0,
                name: step.name || step.ref || '',
                ref: step.ref || '',
                geometry: stepCoords,
                instruction: getManeuverInstruction(maneuver.type, maneuver.modifier, step.name || step.ref || '', step.distance),
                shortInstruction: getShortInstruction(maneuver.type, maneuver.modifier),
                icon: getManeuverIcon(maneuver.type, maneuver.modifier),
              });
            });
          }
        });
      }

      console.log(`[BACKEND] #${requestId} ✅ Success! Steps: ${navigationSteps.length}`);
      RoutingService.successCount++;

      return {
        routes: [{
          geometry: { coordinates, type: 'LineString' },
          distance: route.distance || 0,
          duration: route.duration || 0,
          legs: route.legs || [],
        }],
        waypoints: routeData.waypoints || [],
        navigationSteps,
        code: routeData.code,
        status: 'success',
      };

    } catch (error) {
      console.log(`[BACKEND] #${requestId} ❌ Error:`, error.message);
      RoutingService.failureCount++;
      RoutingService.lastBackendMessage = error.message;

      if (retryCount < BACKEND_CONFIG.maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 2000 * (retryCount + 1)));
        return RoutingService.fetchRoute(startLat, startLng, destLat, destLng, retryCount + 1);
      }

      throw new Error(error.message || 'Routing failed');
    }
  },

  getStats: () => ({
    totalRequests: RoutingService.requestCounter,
    successfulRequests: RoutingService.successCount,
    failedRequests: RoutingService.failureCount,
    lastMessage: RoutingService.lastBackendMessage,
  }),
};

/* ─────────────────────────────────────────────────────────────
   CONSTANTS + DEMO DATA
────────────────────────────────────────────────────────────── */
const STORAGE_KEYS = { MY_SPOT: 'myParkingSpot' };
const DEFAULT_LOC = { latitude: 23.2599, longitude: 77.4126 };

const generateDemoSpots = (centerLat, centerLng) => [
  { id: 'demo_1', latitude: centerLat + 0.002, longitude: centerLng + 0.001, isOccupied: true, deviceName: 'Honda City', userId: 'user1', createdAt: Date.now() - 3600000 },
  { id: 'demo_2', latitude: centerLat - 0.001, longitude: centerLng + 0.002, isOccupied: false, deviceName: 'Maruti Swift', userId: 'user2', createdAt: Date.now() - 7200000 },
  { id: 'demo_3', latitude: centerLat + 0.001, longitude: centerLng - 0.002, isOccupied: true, deviceName: 'Hyundai i20', userId: 'user3', createdAt: Date.now() - 1800000 },
  { id: 'demo_4', latitude: centerLat - 0.002, longitude: centerLng - 0.001, isOccupied: false, deviceName: 'Tata Nexon', userId: 'user4', createdAt: Date.now() - 900000 },
  { id: 'demo_5', latitude: centerLat + 0.0015, longitude: centerLng + 0.0018, isOccupied: true, deviceName: 'Mahindra XUV', userId: 'user5', createdAt: Date.now() - 5400000 },
];

/* ─────────────────────────────────────────────────────────────
   MAIN SCREEN
────────────────────────────────────────────────────────────── */
export default function ParkingMapScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const webRef = useRef(null);
  const locationWatchRef = useRef(null);
  const mapReadyRef = useRef(false);
  const initialLocRef = useRef(DEFAULT_LOC);

  const [loading, setLoading] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);

  const [userLoc, setUserLoc] = useState(DEFAULT_LOC);
  const [mySpot, setMySpot] = useState(null);
  const [allSpots, setAllSpots] = useState([]);

  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  const [navigationSteps, setNavigationSteps] = useState([]);
  const [showNavigation, setShowNavigation] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [distanceToNextTurn, setDistanceToNextTurn] = useState(0);
  const [routeCoordinates, setRouteCoordinates] = useState([]);
  const [destination, setDestination] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);

  /* ───────── Utilities ───────── */
  const validLL = (lat, lng) =>
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

  const formatDistance = (meters) => {
    if (!Number.isFinite(meters)) return 'N/A';
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
  };

  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A';
    const mins = Math.floor((Date.now() - timestamp) / 60000);
    if (mins < 60) return `${mins} min ago`;
    return `${Math.floor(mins / 60)} hr ago`;
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'N/A';
    const mins = Math.round(seconds / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} hr ${mins % 60} min`;
  };

  /* ───────── Location ───────── */
  const getLoc = useCallback(async () => {
    setGettingLoc(true);
    try {
      if (BluetoothModule?.getFreshLocation) {
        try {
          const loc = await Promise.race([
            BluetoothModule.getFreshLocation(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
          ]);
          if (validLL(loc?.latitude, loc?.longitude)) {
            return { latitude: loc.latitude, longitude: loc.longitude, source: 'GPS' };
          }
        } catch (e) {
          console.log('[LOC] GPS failed');
        }
      }

      try {
        const controller = new AbortController();
        const t = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
        clearTimeout(t);
        const d = await res.json();
        if (validLL(d?.latitude, d?.longitude)) {
          return { latitude: d.latitude, longitude: d.longitude, source: 'IP' };
        }
      } catch (e) {
        console.log('[LOC] IP failed');
      }

      return { ...DEFAULT_LOC, source: 'Default' };
    } finally {
      setGettingLoc(false);
    }
  }, []);

  const startLocationWatch = useCallback(() => {
    if (locationWatchRef.current) return;
    
    locationWatchRef.current = setInterval(async () => {
      if (!isNavigating) return;
      
      try {
        const loc = await getLoc();
        if (loc && validLL(loc.latitude, loc.longitude)) {
          setUserLoc(loc);
          
          webRef.current?.injectJavaScript(`
            window.updateUserPosition && window.updateUserPosition(${loc.latitude}, ${loc.longitude});
            true;
          `);
          
          if (routeCoordinates.length > 0 && navigationSteps.length > 0) {
            const { index } = findNearestPointOnRoute(loc.latitude, loc.longitude, routeCoordinates);
            
            if (index > 0) {
              const remainingCoords = routeCoordinates.slice(index);
              webRef.current?.injectJavaScript(`
                window.updateRoute && window.updateRoute(${JSON.stringify(remainingCoords)});
                true;
              `);
            }
            
            for (let i = 0; i < navigationSteps.length; i++) {
              const step = navigationSteps[i];
              const distToStep = calcDistance(loc.latitude, loc.longitude, step.location[1], step.location[0]);
              
              if (distToStep < 30 && i > currentStepIndex) {
                setCurrentStepIndex(i);
                break;
              }
            }
            
            if (currentStepIndex < navigationSteps.length) {
              const nextStep = navigationSteps[currentStepIndex];
              const distToNext = calcDistance(loc.latitude, loc.longitude, nextStep.location[1], nextStep.location[0]);
              setDistanceToNextTurn(distToNext);
            }
            
            if (destination) {
              const distToDest = calcDistance(loc.latitude, loc.longitude, destination.latitude, destination.longitude);
              if (distToDest < 20) {
                Alert.alert('🎯 Arrived!', 'You have reached your destination.');
                stopNavigation();
              }
            }
          }
        }
      } catch (e) {
        console.log('[NAV] Location update error');
      }
    }, 3000);
  }, [isNavigating, routeCoordinates, navigationSteps, currentStepIndex, destination, getLoc]);

  const stopLocationWatch = useCallback(() => {
    if (locationWatchRef.current) {
      clearInterval(locationWatchRef.current);
      locationWatchRef.current = null;
    }
  }, []);

  const stopNavigation = useCallback(() => {
    setIsNavigating(false);
    setCurrentStepIndex(0);
    setDistanceToNextTurn(0);
    setRouteCoordinates([]);
    setDestination(null);
    stopLocationWatch();
    webRef.current?.injectJavaScript(`window.clearRoute(); true;`);
  }, [stopLocationWatch]);

  useEffect(() => {
    if (isNavigating) {
      startLocationWatch();
    } else {
      stopLocationWatch();
    }
    return () => stopLocationWatch();
  }, [isNavigating, startLocationWatch, stopLocationWatch]);

  /* ───────── Storage ───────── */
  const saveMySpot = useCallback(async (spot) => {
    await AsyncStorage.setItem(STORAGE_KEYS.MY_SPOT, JSON.stringify(spot));
    setMySpot(spot);
  }, []);

  const loadSpots = useCallback(async (location) => {
    const mySpotStr = await AsyncStorage.getItem(STORAGE_KEYS.MY_SPOT);
    let savedMySpot = null;
    if (mySpotStr) {
      try { savedMySpot = JSON.parse(mySpotStr); } catch {}
    }
    setMySpot(savedMySpot);

    const demoSpots = generateDemoSpots(location.latitude, location.longitude);
    let combined = [...demoSpots];
    if (savedMySpot) combined.push({ ...savedMySpot, isMySpot: true });

    combined = combined.map((spot) => ({
      ...spot,
      distance: calcDistance(location.latitude, location.longitude, spot.latitude, spot.longitude),
    }));

    combined.sort((a, b) => a.distance - b.distance);
    setAllSpots(combined);
    
    return combined;
  }, []);

  /* ───────── Add Markers to Map ───────── */
  const addMarkersToMap = useCallback((spots) => {
    if (!mapReadyRef.current) return;
    
    const markersJS = spots.map((spot) => {
      const color = spot.isMySpot ? '#1976D2' : spot.isOccupied ? '#E53935' : '#4CAF50';
      const icon = spot.isMySpot ? '🚗' : spot.isOccupied ? '🅿️' : '✓';
      const spotDataStr = JSON.stringify({
        id: spot.id,
        latitude: spot.latitude,
        longitude: spot.longitude,
        isOccupied: spot.isOccupied,
        isMySpot: spot.isMySpot || false,
        deviceName: spot.deviceName || 'Unknown',
        userId: spot.userId || '',
        createdAt: spot.createdAt || Date.now(),
        distance: spot.distance || 0
      }).replace(/"/g, '\\"');

      return `
        (function() {
          var markerIcon = L.divIcon({
            className: 'custom-marker',
            html: '<div style="width:40px;height:48px;background:${color};border-radius:50% 50% 50% 50%/60% 60% 40% 40%;border:3px solid #fff;box-shadow:0 4px 15px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;padding-bottom:6px;cursor:pointer;">${icon}</div>',
            iconSize: [40, 48],
            iconAnchor: [20, 48]
          });
          var marker = L.marker([${spot.latitude}, ${spot.longitude}], {icon: markerIcon}).addTo(map);
          marker.on('click', function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'spotClick',
              spot: JSON.parse("${spotDataStr}")
            }));
          });
        })();
      `;
    }).join('\n');

    webRef.current?.injectJavaScript(`
      ${markersJS}
      true;
    `);
  }, []);

  /* ───────── Init ───────── */
  useEffect(() => {
    let mounted = true;
    (async () => {
      const loc = await getLoc();
      if (!mounted) return;
      
      initialLocRef.current = loc;
      setUserLoc(loc);
      const spots = await loadSpots(loc);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [getLoc, loadSpots]);

  /* ───────── Map HTML - STATIC, no dependencies ───────── */
  const mapHtml = useMemo(() => {
    const lat = initialLocRef.current.latitude;
    const lng = initialLocRef.current.longitude;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; width: 100%; overflow: hidden; }
    #map { height: 100%; width: 100%; background: #E8E8E8; }
    .leaflet-control-attribution { background: rgba(255,255,255,0.8) !important; font-size: 10px !important; }
    #loading-overlay { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(255,255,255,0.95); display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 9999; }
    #loading-overlay.hidden { display: none; }
    .loader { width: 50px; height: 50px; border: 4px solid #f3f3f3; border-top: 4px solid #E53935; border-radius: 50%; animation: spin 1s linear infinite; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    @keyframes pulse { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(2); opacity: 0; } }
  </style>
</head>
<body>
  <div id="loading-overlay"><div class="loader"></div></div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    function hideLoading() { document.getElementById('loading-overlay').classList.add('hidden'); }

    var map = L.map('map', { zoomControl: false, attributionControl: true }).setView([${lat}, ${lng}], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);

    var userLat = ${lat}, userLng = ${lng};
    var userMarker = null, mySpotMarker = null;
    var routeLine = null, routeBorder = null, searchMarker = null, destMarker = null;

    var userIcon = L.divIcon({
      className: '',
      html: '<div style="position:relative;"><div style="position:absolute;width:40px;height:40px;border-radius:50%;background:rgba(229,57,53,0.2);top:-9px;left:-9px;animation:pulse 2s ease-out infinite;"></div><div style="width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#E53935,#C62828);border:4px solid #fff;box-shadow:0 2px 10px rgba(229,57,53,0.5);"></div></div>',
      iconSize: [22, 22], iconAnchor: [11, 11]
    });
    userMarker = L.marker([userLat, userLng], {icon: userIcon, zIndexOffset: 1000}).addTo(map);

    window.setUserLocation = function(lat, lng, moveCamera) {
      userLat = lat; userLng = lng;
      if (userMarker) userMarker.setLatLng([lat, lng]);
      if (moveCamera) map.flyTo([lat, lng], 16, { duration: 0.8 });
    };

    window.updateUserPosition = function(lat, lng) {
      userLat = lat; userLng = lng;
      if (userMarker) userMarker.setLatLng([lat, lng]);
    };

    window.zoomIn = function() { map.zoomIn(); };
    window.zoomOut = function() { map.zoomOut(); };
    window.centerOnUser = function() { map.flyTo([userLat, userLng], 17, { duration: 0.5 }); };

    window.panTo = function(lat, lng, zoom) {
      if (searchMarker) { map.removeLayer(searchMarker); searchMarker = null; }
      map.flyTo([lat, lng], zoom || 16, { duration: 0.8 });
      var pin = L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:50%;background:#111;border:3px solid #fff;"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
      searchMarker = L.marker([lat, lng], {icon: pin}).addTo(map);
    };

    window.clearRoute = function() {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      if (routeBorder) { map.removeLayer(routeBorder); routeBorder = null; }
      if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
    };

    window.updateRoute = function(coordinates) {
      if (routeLine) map.removeLayer(routeLine);
      if (routeBorder) map.removeLayer(routeBorder);
      var latlngs = coordinates.map(function(c) { return [c[1], c[0]]; });
      routeBorder = L.polyline(latlngs, { color: '#fff', weight: 10, opacity: 0.6 }).addTo(map);
      routeLine = L.polyline(latlngs, { color: '#E53935', weight: 6, opacity: 0.9 }).addTo(map);
    };

    window.setMySpot = function(lat, lng) {
      if (mySpotMarker) { map.removeLayer(mySpotMarker); mySpotMarker = null; }
      var spotIcon = L.divIcon({ className: '', html: '<div style="width:40px;height:48px;background:#1976D2;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;border:3px solid #fff;box-shadow:0 4px 15px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">🚗</div>', iconSize: [40, 48], iconAnchor: [20, 48] });
      mySpotMarker = L.marker([lat, lng], {icon: spotIcon}).addTo(map);
    };

    window.showRoute = function(destLat, destLng) {
      window.clearRoute();
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'fetchRoute', startLat: userLat, startLng: userLng, destLat: destLat, destLng: destLng }));
    };

    window.handleRouteData = function(data) {
      if (!data || !data.coordinates) return;
      var latlngs = data.coordinates.map(function(c) { return [c[1], c[0]]; });
      routeBorder = L.polyline(latlngs, { color: '#fff', weight: 10, opacity: 0.6 }).addTo(map);
      routeLine = L.polyline(latlngs, { color: '#E53935', weight: 6, opacity: 0.9 }).addTo(map);
      
      if (data.destLat && data.destLng) {
        if (destMarker) map.removeLayer(destMarker);
        var destIcon = L.divIcon({
          className: '',
          html: '<div style="width:40px;height:48px;background:#4CAF50;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;border:3px solid #fff;box-shadow:0 4px 15px rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">🎯</div>',
          iconSize: [40, 48],
          iconAnchor: [20, 48]
        });
        destMarker = L.marker([data.destLat, data.destLng], {icon: destIcon}).addTo(map);
      }
      
      map.fitBounds(routeLine.getBounds(), { padding: [80, 80], maxZoom: 17 });
    };

    map.whenReady(function() { 
      setTimeout(function() { 
        hideLoading(); 
        window.ReactNativeWebView.postMessage(JSON.stringify({type: 'ready'})); 
      }, 500); 
    });
  </script>
</body>
</html>`;
  }, []); // Empty dependency - HTML never changes

  /* ───────── WebView Message Handler ───────── */
  const onWebMessage = useCallback(async (event) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.type === 'ready') {
        mapReadyRef.current = true;
        
        // Set user location
        webRef.current?.injectJavaScript(`
          window.setUserLocation(${userLoc.latitude}, ${userLoc.longitude}, true);
          true;
        `);
        
        // Add markers
        if (allSpots.length > 0) {
          addMarkersToMap(allSpots);
        }
        return;
      }

      if (data.type === 'spotClick') {
        setSelectedSpot(data.spot);
        setShowModal(true);
        return;
      }

      if (data.type === 'fetchRoute') {
        setRouteLoading(true);

        try {
          const routeData = await RoutingService.fetchRoute(
            data.startLat, data.startLng, data.destLat, data.destLng
          );

          const route = routeData.routes[0];
          const steps = routeData.navigationSteps || [];
          
          setRouteCoordinates(route.geometry.coordinates);
          setNavigationSteps(steps);
          setDestination({ latitude: data.destLat, longitude: data.destLng });
          
          setRouteInfo({ 
            totalDistance: route.distance, 
            totalDuration: route.duration, 
            stepsCount: steps.length 
          });

          webRef.current?.injectJavaScript(`
            window.handleRouteData({
              coordinates: ${JSON.stringify(route.geometry.coordinates)},
              destLat: ${data.destLat},
              destLng: ${data.destLng}
            });
            true;
          `);

        } catch (error) {
          Alert.alert('❌ Route Error', error.message);

          webRef.current?.injectJavaScript(`
            window.handleRouteData({
              coordinates: [[${data.startLng}, ${data.startLat}], [${data.destLng}, ${data.destLat}]],
              destLat: ${data.destLat},
              destLng: ${data.destLng}
            });
            true;
          `);

          const distance = calcDistance(data.startLat, data.startLng, data.destLat, data.destLng);
          setRouteInfo({
            totalDistance: distance,
            totalDuration: distance / 13.89,
            stepsCount: 2,
          });
        } finally {
          setRouteLoading(false);
        }
      }
    } catch (e) {
      console.log('[MAP] Parse error');
    }
  }, [userLoc, allSpots, addMarkersToMap]);

  // Update markers when allSpots changes
  useEffect(() => {
    if (mapReadyRef.current && allSpots.length > 0) {
      addMarkersToMap(allSpots);
    }
  }, [allSpots, addMarkersToMap]);

  /* ───────── Actions ───────── */
  const handleOccupy = useCallback(async () => {
    setGettingLoc(true);
    try {
      const loc = await getLoc();
      if (!loc) return Alert.alert('Error', 'Could not get location');

      const newSpot = { 
        id: `my_${Date.now()}`, 
        latitude: loc.latitude, 
        longitude: loc.longitude, 
        isOccupied: true, 
        isMySpot: true, 
        deviceName: 'My Car', 
        userId: 'me', 
        createdAt: Date.now() 
      };
      await saveMySpot(newSpot);
      setUserLoc(loc);
      await loadSpots(loc);

      webRef.current?.injectJavaScript(`
        window.setUserLocation(${loc.latitude}, ${loc.longitude}, true); 
        window.setMySpot(${loc.latitude}, ${loc.longitude}); 
        true;
      `);
      Alert.alert('✅ Done', 'Parking spot occupied!');
    } finally {
      setGettingLoc(false);
    }
  }, [getLoc, loadSpots, saveMySpot]);

  const handleVacate = useCallback(async () => {
    if (!mySpot) return Alert.alert('No Spot', 'Nothing to vacate');
    Alert.alert('Vacate?', 'Mark your spot as available?', [
      { text: 'Cancel', style: 'cancel' },
      { 
        text: 'Vacate', 
        style: 'destructive', 
        onPress: async () => {
          await saveMySpot({ ...mySpot, isOccupied: false });
          await loadSpots(userLoc);
          Alert.alert('✅ Done', 'Spot vacated!');
        }
      },
    ]);
  }, [loadSpots, mySpot, saveMySpot, userLoc]);

  const onLocate = useCallback(async () => {
    const loc = await getLoc();
    if (!loc) return;
    setUserLoc(loc);
    await loadSpots(loc);
    webRef.current?.injectJavaScript(`
      window.setUserLocation(${loc.latitude}, ${loc.longitude}, true); 
      true;
    `);
  }, [getLoc, loadSpots]);

  const onShowRoute = useCallback((spot) => {
    setShowModal(false);
    webRef.current?.injectJavaScript(`window.showRoute(${spot.latitude}, ${spot.longitude}); true;`);
  }, []);

  const startActiveNavigation = useCallback((spot) => {
    setShowModal(false);
    setShowNavigation(false);
    setIsNavigating(true);
    setCurrentStepIndex(0);
    setDestination({ latitude: spot.latitude, longitude: spot.longitude });
    
    webRef.current?.injectJavaScript(`
      window.showRoute(${spot.latitude}, ${spot.longitude}); 
      window.centerOnUser();
      true;
    `);
  }, []);

  const onShowNavigation = useCallback((spot) => {
    setShowModal(false);
    setShowNavigation(true);
    webRef.current?.injectJavaScript(`window.showRoute(${spot.latitude}, ${spot.longitude}); true;`);
  }, []);

  const onNavigate = useCallback((spot) => {
    Linking.openURL(
      `https://www.google.com/maps/dir/?api=1&origin=${userLoc.latitude},${userLoc.longitude}&destination=${spot.latitude},${spot.longitude}&travelmode=driving`
    );
  }, [userLoc]);

  const onFindParking = useCallback(() => {
    const nearest = allSpots.find((s) => !s.isOccupied && !s.isMySpot);
    if (!nearest) return Alert.alert('😕 No Parking', 'No available spots nearby');
    webRef.current?.injectJavaScript(`window.panTo(${nearest.latitude}, ${nearest.longitude}, 17); true;`);
    setSelectedSpot(nearest);
    setShowModal(true);
  }, [allSpots]);

  const zoomIn = useCallback(() => { webRef.current?.injectJavaScript(`window.zoomIn(); true;`); }, []);
  const zoomOut = useCallback(() => { webRef.current?.injectJavaScript(`window.zoomOut(); true;`); }, []);

  const clearRoute = useCallback(() => { 
    stopNavigation();
    setRouteInfo(null); 
    setNavigationSteps([]); 
  }, [stopNavigation]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    Keyboard.dismiss();
    setSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`);
      const results = await res.json();
      if (!results?.length) return Alert.alert('Not found', 'No results');
      webRef.current?.injectJavaScript(`window.panTo(${results[0].lat}, ${results[0].lon}, 16); true;`);
    } catch { 
      Alert.alert('Error', 'Search failed'); 
    } finally { 
      setSearching(false); 
    }
  }, [searchQuery]);

  const showRouteStats = useCallback(() => {
    const stats = RoutingService.getStats();
    Alert.alert('📊 Route Stats', 
      `📡 Total: ${stats.totalRequests}\n✅ Success: ${stats.successfulRequests}\n❌ Failed: ${stats.failedRequests}`
    );
  }, []);

  const renderStep = useCallback(({ item, index }) => (
    <View style={S.navStep}>
      <View style={S.navStepLeft}>
        <View style={[
          S.navIconContainer, 
          item.type === 'arrive' && { backgroundColor: '#4CAF50' },
          index === currentStepIndex && isNavigating && { backgroundColor: '#FF9800' }
        ]}>
          <Text style={S.navIcon}>{item.icon}</Text>
        </View>
        {index < navigationSteps.length - 1 && <View style={S.navConnector} />}
      </View>
      <View style={[
        S.navStepRight,
        index === currentStepIndex && isNavigating && { backgroundColor: '#FFF3E0', borderColor: '#FF9800', borderWidth: 2 }
      ]}>
        <View style={S.navStepHeader}>
          <Text style={S.navStepNumber}>Step {index + 1}</Text>
          <Text style={S.navStepDistance}>{formatDistance(item.distance)}</Text>
        </View>
        <Text style={S.navStepInstruction}>{item.instruction}</Text>
        {item.name ? <Text style={S.navStepStreet}>{item.name}</Text> : null}
      </View>
    </View>
  ), [currentStepIndex, isNavigating, navigationSteps.length]);

  const currentStep = navigationSteps[currentStepIndex];
  const nextStep = navigationSteps[currentStepIndex + 1];

  if (loading) {
    return (
      <SafeAreaView style={S.loading}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={S.loadingTitle}>Loading Map...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
      <View style={S.container}>
        <WebView 
          ref={webRef} 
          source={{ html: mapHtml }} 
          style={StyleSheet.absoluteFill} 
          javaScriptEnabled 
          domStorageEnabled 
          originWhitelist={['*']} 
          onMessage={onWebMessage} 
          scrollEnabled={false}
          cacheEnabled={true}
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
        />

        {routeLoading && (
          <View style={S.routeLoadingOverlay}>
            <View style={S.routeLoadingCard}>
              <ActivityIndicator size="large" color="#E53935" />
              <Text style={S.routeLoadingText}>Fetching route...</Text>
            </View>
          </View>
        )}

        {/* Active Navigation Header */}
        {isNavigating && currentStep && (
          <View style={[S.activeNavHeader, { top: insets.top }]}>
            <View style={S.activeNavContent}>
              <View style={S.activeNavIconWrap}>
                <Text style={S.activeNavIcon}>{currentStep.icon}</Text>
              </View>
              <View style={S.activeNavInfo}>
                <Text style={S.activeNavDistance}>
                  {formatDistance(distanceToNextTurn || currentStep.distance)}
                </Text>
                <Text style={S.activeNavInstruction}>{currentStep.shortInstruction}</Text>
                {currentStep.name ? <Text style={S.activeNavStreet}>{currentStep.name}</Text> : null}
              </View>
              <TouchableOpacity style={S.activeNavClose} onPress={stopNavigation}>
                <Text style={S.activeNavCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            {nextStep && (
              <View style={S.nextStepPreview}>
                <Text style={S.nextStepText}>
                  Then: {nextStep.icon} {nextStep.shortInstruction} in {formatDistance(nextStep.distance)}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* Search Bar */}
        {!isNavigating && (
          <View style={[S.searchBarWrap, { top: insets.top + 12 }]}>
            <View style={S.searchBar}>
              <Text style={S.searchIcon}>🔍</Text>
              <TextInput 
                value={searchQuery} 
                onChangeText={setSearchQuery} 
                placeholder="Search location..." 
                placeholderTextColor="#999" 
                style={S.searchInput} 
                returnKeyType="search" 
                onSubmitEditing={runSearch} 
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Text style={S.searchClear}>✕</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={runSearch} style={S.searchActionBtn}>
                {searching ? <ActivityIndicator size="small" color="#E53935" /> : <Text style={S.searchAction}>→</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Top Pills */}
        {!isNavigating && (
          <View style={[S.topPillsRow, { top: insets.top + 68 }]}>
            <TouchableOpacity 
              style={[S.pillBtn, mySpot?.isOccupied && S.pillDisabled]} 
              onPress={handleOccupy} 
              disabled={mySpot?.isOccupied || gettingLoc}
            >
              {gettingLoc ? <ActivityIndicator size="small" color="#E53935" /> : (
                <>
                  <Text style={S.pillIcon}>📍</Text>
                  <Text style={S.pillText}>Occupy</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity 
              style={[S.pillBtn, !mySpot?.isOccupied && S.pillDisabled]} 
              onPress={handleVacate} 
              disabled={!mySpot?.isOccupied}
            >
              <Text style={S.pillIcon}>🚗</Text>
              <Text style={S.pillText}>Vacate</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Route Info Card */}
        {routeInfo && !isNavigating && (
          <View style={[S.routeInfoCard, { top: insets.top + 120 }]}>
            <View style={S.routeInfoContent}>
              <View style={S.routeInfoItem}>
                <Text style={S.routeInfoValue}>{formatDistance(routeInfo.totalDistance)}</Text>
                <Text style={S.routeInfoLabel}>Distance</Text>
              </View>
              <View style={S.routeInfoDivider} />
              <View style={S.routeInfoItem}>
                <Text style={S.routeInfoValue}>{formatDuration(routeInfo.totalDuration)}</Text>
                <Text style={S.routeInfoLabel}>Duration</Text>
              </View>
              <View style={S.routeInfoDivider} />
              <View style={S.routeInfoItem}>
                <Text style={S.routeInfoValue}>{routeInfo.stepsCount}</Text>
                <Text style={S.routeInfoLabel}>Steps</Text>
              </View>
            </View>
            <TouchableOpacity style={S.routeInfoClose} onPress={clearRoute}>
              <Text style={S.routeInfoCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Right Controls */}
        <View style={[S.rightControls, { top: isNavigating ? insets.top + 140 : routeInfo ? insets.top + 185 : insets.top + 130 }]}>
          <TouchableOpacity style={S.ctrlBtn} onPress={onLocate} onLongPress={showRouteStats}>
            <Text style={S.ctrlIcon}>📍</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.ctrlBtn} onPress={clearRoute}>
            <Text style={S.ctrlIcon}>🧹</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomIn}>
            <Text style={S.ctrlIcon}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomOut}>
            <Text style={S.ctrlIcon}>－</Text>
          </TouchableOpacity>
        </View>

        {/* Find Parking Button */}
        {!isNavigating && (
          <View style={[S.findParkingWrap, { bottom: 86 + insets.bottom }]}>
            <TouchableOpacity style={S.findParkingBtn} onPress={onFindParking}>
              <Text style={S.findParkingIcon}>🅿️</Text>
              <Text style={S.findParkingText}>Find Parking</Text>
              <View style={S.findParkingBadge}>
                <Text style={S.findParkingBadgeText}>
                  {allSpots.filter(s => !s.isOccupied && !s.isMySpot).length}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* Bottom Tab Bar */}
        <View style={[S.tabBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity style={S.tabItem}>
            <Text style={[S.tabIcon, S.tabIconActive]}>🗺️</Text>
            <Text style={[S.tabLabel, S.tabLabelActive]}>Explore</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>🔖</Text>
            <Text style={S.tabLabel}>Saved</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabCenterPlus}>
            <Text style={S.tabPlus}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>👥</Text>
            <Text style={S.tabLabel}>Contribute</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>👤</Text>
            <Text style={S.tabLabel}>Profile</Text>
          </TouchableOpacity>
        </View>

        {/* Spot Details Modal */}
        <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
          <View style={S.modalOverlay}>
            <TouchableOpacity style={S.modalBackdrop} onPress={() => setShowModal(false)} />
            <View style={S.modalContent}>
              <View style={S.modalHandle} />
              <View style={S.modalHeader}>
                <Text style={S.modalTitle}>
                  {selectedSpot?.isMySpot ? '🚗 Your Spot' : '🅿️ Parking'}
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Text style={S.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>
              {selectedSpot && (
                <ScrollView style={S.modalBody}>
                  <View style={[S.statusBadge, { backgroundColor: selectedSpot.isOccupied ? '#FFEBEE' : '#E8F5E9' }]}>
                    <Text style={[S.statusText, { color: selectedSpot.isOccupied ? '#E53935' : '#4CAF50' }]}>
                      {selectedSpot.isOccupied ? '🔴 Occupied' : '🟢 Available'}
                    </Text>
                  </View>
                  <View style={S.infoCard}>
                    <Text style={S.infoRow}>📏 {formatDistance(selectedSpot.distance)}</Text>
                    <Text style={S.infoRow}>🚗 {selectedSpot.deviceName}</Text>
                    <Text style={S.infoRow}>🕐 {formatTime(selectedSpot.createdAt)}</Text>
                  </View>
                  <View style={S.modalActions}>
                    <TouchableOpacity style={S.startNavBtn} onPress={() => startActiveNavigation(selectedSpot)}>
                      <Text style={S.startNavBtnText}>🧭 Start Navigation</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.routeBtn} onPress={() => onShowRoute(selectedSpot)}>
                      <Text style={S.routeBtnText}>🗺️ Show Route</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.navigationBtn} onPress={() => onShowNavigation(selectedSpot)}>
                      <Text style={S.navigationBtnText}>📋 All Steps</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.navigateBtn} onPress={() => onNavigate(selectedSpot)}>
                      <Text style={S.navigateBtnText}>📱 Google Maps</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* Navigation Steps Modal */}
        <Modal visible={showNavigation} transparent animationType="slide" onRequestClose={() => setShowNavigation(false)}>
          <SafeAreaView style={S.navModalContainer}>
            <View style={S.navModalContent}>
              <View style={S.navModalHeader}>
                <TouchableOpacity onPress={() => setShowNavigation(false)} style={S.navModalCloseBtn}>
                  <Text style={S.navModalClose}>←</Text>
                </TouchableOpacity>
                <Text style={S.navModalTitle}>Turn-by-Turn</Text>
                <TouchableOpacity 
                  onPress={() => {
                    setShowNavigation(false);
                    if (destination) {
                      setIsNavigating(true);
                      setCurrentStepIndex(0);
                    }
                  }}
                  style={S.navStartBtn}
                >
                  <Text style={S.navStartBtnText}>Start</Text>
                </TouchableOpacity>
              </View>
              {routeInfo && (
                <View style={S.navSummary}>
                  <View style={S.navSummaryItem}>
                    <Text style={S.navSummaryValue}>{formatDistance(routeInfo.totalDistance)}</Text>
                    <Text style={S.navSummaryLabel}>Distance</Text>
                  </View>
                  <View style={S.navSummaryDivider} />
                  <View style={S.navSummaryItem}>
                    <Text style={S.navSummaryValue}>{formatDuration(routeInfo.totalDuration)}</Text>
                    <Text style={S.navSummaryLabel}>Duration</Text>
                  </View>
                  <View style={S.navSummaryDivider} />
                  <View style={S.navSummaryItem}>
                    <Text style={S.navSummaryValue}>{routeInfo.stepsCount}</Text>
                    <Text style={S.navSummaryLabel}>Turns</Text>
                  </View>
                </View>
              )}
              <FlatList 
                data={navigationSteps} 
                renderItem={renderStep} 
                keyExtractor={(item, index) => `step_${index}`} 
                contentContainerStyle={S.navStepsList} 
                ListEmptyComponent={
                  <View style={S.navEmptyState}>
                    <Text style={S.navEmptyIcon}>🗺️</Text>
                    <Text style={S.navEmptyText}>No navigation steps</Text>
                  </View>
                } 
              />
            </View>
          </SafeAreaView>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

/* ─────────── STYLES ─────────── */
const S = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8F9FA' },
  container: { flex: 1 },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' },
  loadingTitle: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111' },

  routeLoadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 1000 },
  routeLoadingCard: { backgroundColor: '#fff', padding: 30, borderRadius: 20, alignItems: 'center', elevation: 10, minWidth: 200 },
  routeLoadingText: { marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111' },

  activeNavHeader: { position: 'absolute', left: 0, right: 0, backgroundColor: '#E53935', zIndex: 100, elevation: 15 },
  activeNavContent: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 12 },
  activeNavIconWrap: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  activeNavIcon: { fontSize: 32 },
  activeNavInfo: { flex: 1, marginLeft: 16 },
  activeNavDistance: { fontSize: 36, fontWeight: '800', color: '#fff', letterSpacing: -1 },
  activeNavInstruction: { fontSize: 18, fontWeight: '700', color: 'rgba(255,255,255,0.95)', marginTop: 2 },
  activeNavStreet: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginTop: 4 },
  activeNavClose: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  activeNavCloseText: { fontSize: 20, color: '#fff', fontWeight: '700' },
  nextStepPreview: { backgroundColor: 'rgba(0,0,0,0.2)', paddingVertical: 10, paddingHorizontal: 16 },
  nextStepText: { fontSize: 14, color: 'rgba(255,255,255,0.9)' },

  searchBarWrap: { position: 'absolute', left: 16, right: 16, zIndex: 30 },
  searchBar: { height: 52, backgroundColor: '#fff', borderRadius: 16, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', elevation: 8 },
  searchIcon: { fontSize: 18, marginRight: 10 },
  searchInput: { flex: 1, fontSize: 15, color: '#111', paddingVertical: 0 },
  searchClear: { fontSize: 18, color: '#999', marginRight: 10, padding: 4 },
  searchActionBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  searchAction: { fontSize: 18, color: '#E53935', fontWeight: '700' },

  topPillsRow: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 25 },
  pillBtn: { backgroundColor: '#fff', paddingHorizontal: 20, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', elevation: 4 },
  pillDisabled: { opacity: 0.5 },
  pillIcon: { fontSize: 16, marginRight: 8 },
  pillText: { fontSize: 14, fontWeight: '700', color: '#111' },

  routeInfoCard: { position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', elevation: 6, zIndex: 24 },
  routeInfoContent: { flex: 1, flexDirection: 'row' },
  routeInfoItem: { flex: 1, alignItems: 'center' },
  routeInfoValue: { fontSize: 18, fontWeight: '800', color: '#E53935' },
  routeInfoLabel: { fontSize: 11, color: '#666', marginTop: 2, fontWeight: '500' },
  routeInfoDivider: { width: 1, height: 32, backgroundColor: '#E0E0E0', marginHorizontal: 8 },
  routeInfoClose: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  routeInfoCloseText: { fontSize: 14, color: '#666', fontWeight: '600' },

  rightControls: { position: 'absolute', right: 16, zIndex: 20, gap: 10 },
  ctrlBtn: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 4 },
  ctrlIcon: { fontSize: 20 },

  findParkingWrap: { position: 'absolute', left: 20, right: 20, zIndex: 20 },
  findParkingBtn: { height: 58, backgroundColor: '#E53935', borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 10 },
  findParkingIcon: { fontSize: 22, marginRight: 10 },
  findParkingText: { fontSize: 17, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  findParkingBadge: { backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, marginLeft: 12 },
  findParkingBadgeText: { fontSize: 14, fontWeight: '800', color: '#E53935' },

  tabBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, flexDirection: 'row', justifyContent: 'space-around', elevation: 15 },
  tabItem: { width: 60, alignItems: 'center', paddingVertical: 6 },
  tabIcon: { fontSize: 22, color: '#999' },
  tabLabel: { fontSize: 10, marginTop: 4, color: '#999', fontWeight: '600' },
  tabIconActive: { color: '#E53935' },
  tabLabelActive: { color: '#E53935' },
  tabCenterPlus: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', marginTop: -20, elevation: 10 },
  tabPlus: { fontSize: 30, color: '#fff', fontWeight: '300' },

  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: { backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: '80%', elevation: 20 },
  modalHandle: { width: 40, height: 4, backgroundColor: '#DDD', borderRadius: 2, alignSelf: 'center', marginTop: 12 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 16, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#111' },
  modalClose: { fontSize: 26, color: '#999', padding: 4 },
  modalBody: { padding: 20 },

  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginBottom: 16 },
  statusText: { fontSize: 14, fontWeight: '700' },

  infoCard: { backgroundColor: '#F8F9FA', borderRadius: 16, padding: 16, marginBottom: 20 },
  infoRow: { fontSize: 15, color: '#111', paddingVertical: 8, fontWeight: '500' },

  modalActions: { gap: 12 },
  startNavBtn: { backgroundColor: '#4CAF50', padding: 18, borderRadius: 14, alignItems: 'center', elevation: 4 },
  startNavBtnText: { fontSize: 16, fontWeight: '800', color: '#fff' },
  routeBtn: { backgroundColor: '#F0F0F0', padding: 16, borderRadius: 14, alignItems: 'center' },
  routeBtnText: { fontSize: 15, fontWeight: '700', color: '#111' },
  navigationBtn: { backgroundColor: '#FFF3E0', padding: 16, borderRadius: 14, alignItems: 'center' },
  navigationBtnText: { fontSize: 15, fontWeight: '700', color: '#E65100' },
  navigateBtn: { backgroundColor: '#E53935', padding: 16, borderRadius: 14, alignItems: 'center', elevation: 4 },
  navigateBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  navModalContainer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  navModalContent: { flex: 1, backgroundColor: '#fff', marginTop: 50, borderTopLeftRadius: 28, borderTopRightRadius: 28, elevation: 20 },
  navModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  navModalCloseBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  navModalClose: { fontSize: 24, color: '#111' },
  navModalTitle: { fontSize: 18, fontWeight: '800', color: '#111' },
  navStartBtn: { backgroundColor: '#4CAF50', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 },
  navStartBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  navSummary: { flexDirection: 'row', padding: 16, backgroundColor: '#F8F9FA', borderBottomWidth: 1, borderBottomColor: '#EEE' },
  navSummaryItem: { flex: 1, alignItems: 'center' },
  navSummaryValue: { fontSize: 20, fontWeight: '800', color: '#111' },
  navSummaryLabel: { fontSize: 11, color: '#666', marginTop: 4, fontWeight: '500' },
  navSummaryDivider: { width: 1, backgroundColor: '#E0E0E0', marginHorizontal: 10 },

  navStepsList: { padding: 16, paddingBottom: 32 },
  navStep: { flexDirection: 'row', marginBottom: 4 },
  navStepLeft: { alignItems: 'center', marginRight: 14, width: 48 },
  navIconContainer: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center', elevation: 4 },
  navIcon: { fontSize: 22 },
  navConnector: { width: 3, flex: 1, backgroundColor: '#E8E8E8', marginVertical: 6, borderRadius: 2, minHeight: 20 },
  navStepRight: { flex: 1, backgroundColor: '#F8F9FA', padding: 14, borderRadius: 14, marginBottom: 8 },
  navStepHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6, alignItems: 'center' },
  navStepNumber: { fontSize: 11, color: '#666', fontWeight: '700', textTransform: 'uppercase' },
  navStepDistance: { fontSize: 14, color: '#E53935', fontWeight: '800' },
  navStepInstruction: { fontSize: 15, color: '#111', fontWeight: '700', lineHeight: 22 },
  navStepStreet: { fontSize: 13, color: '#666', marginTop: 6, fontWeight: '500' },

  navEmptyState: { alignItems: 'center', paddingVertical: 60 },
  navEmptyIcon: { fontSize: 60, marginBottom: 20 },
  navEmptyText: { fontSize: 16, color: '#666', fontWeight: '500' },
});