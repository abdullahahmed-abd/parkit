// src/screens/ParkingMapScreen.js
// ═══════════════════════════════════════════════════════════════
// PARKIT v5.3 - PRODUCTION READY WITH IMPROVED LOCATION TRACKING
// ═══════════════════════════════════════════════════════════════

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, NativeModules, Linking, Modal,
  ScrollView, FlatList, TextInput, Keyboard, Platform,
  AppState, PermissionsAndroid,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Geolocation from '@react-native-community/geolocation';
import ParkingService from '../services/ParkingService';

import {
  Logger, NAV_CONFIG, NEARBY_CONFIG, DEFAULT_LOC, EMPTY_STYLE,
  API_BASE_URL, BACKEND_CONFIG, APP_CONFIG,
  validLL, calcDistance, calcBearing, smoothHeading,
  findNearestPointOnRoute, formatDistance, formatDuration,
  formatDistanceNav, formatTime, fetchWithTimeout,
  VoiceGuidance, RoutingService, RouteCache,
  routeLineManager, stepTracker, estimateRemainingTime,
  LOCATION_TRACKING_CONFIG, locationProcessor, NavigationDebug,
} from '../services/NavigationService';

MapLibreGL.setAccessToken(null);
const {BluetoothModule} = NativeModules;

// ═══════════════════════════════════════════════════════════════
// MARKERS
// ═══════════════════════════════════════════════════════════════
const ParkingMarker = React.memo(({spot, onPress}) => {
  let color = '#4CAF50', icon = '✓';
  if (spot.isMySpot) { color = '#1976D2'; icon = '🚗'; }
  else if (spot.isOccupied) { color = '#E53935'; icon = '🅿️'; }
  return (
    <MapLibreGL.MarkerView id={`marker-${spot.id}`} coordinate={[spot.longitude, spot.latitude]} anchor={{x: 0.5, y: 1}}>
      <TouchableOpacity onPress={() => onPress(spot)} activeOpacity={0.8} style={S.markerTouchable}>
        <View style={[S.markerContainer, {backgroundColor: color}]}><Text style={S.markerIcon}>{icon}</Text></View>
        <View style={[S.markerArrow, {borderTopColor: color}]} />
      </TouchableOpacity>
    </MapLibreGL.MarkerView>
  );
});

const UserLocationMarker = React.memo(({coordinate, heading, isNavigating, accuracy}) => {
  if (!coordinate || coordinate.length !== 2) return null;
  
  const rotationStyle = heading !== null ? {
    transform: [{rotate: `${heading}deg`}]
  } : {};
  
  return (
    <MapLibreGL.MarkerView 
      id="user-location-marker" 
      coordinate={coordinate} 
      anchor={{x: 0.5, y: 0.5}}
      allowOverlap={true}
    >
      <View style={S.userMarkerContainer}>
        {isNavigating && accuracy > 0 && (
          <View style={[S.userMarkerAccuracy, {
            width: Math.min(accuracy * 2, 100), height: Math.min(accuracy * 2, 100),
            borderRadius: Math.min(accuracy, 50),
          }]} />
        )}
        <View style={[S.userMarkerOuter, isNavigating && S.userMarkerOuterNav]}>
          <View style={[S.userMarkerInner, isNavigating && S.userMarkerInnerNav, rotationStyle]}>
            {isNavigating && heading !== null && (
              <View style={S.userMarkerArrowWrap}>
                <View style={S.userMarkerArrow2} />
              </View>
            )}
          </View>
        </View>
      </View>
    </MapLibreGL.MarkerView>
  );
});

const SearchMarker = React.memo(({coordinate}) => (
  <MapLibreGL.MarkerView id="search-marker" coordinate={[coordinate.longitude, coordinate.latitude]} anchor={{x: 0.5, y: 1}}>
    <View style={{alignItems: 'center'}}><Text style={{fontSize: 40}}>📍</Text></View>
  </MapLibreGL.MarkerView>
));

const DestinationMarker = React.memo(({coordinate}) => (
  <MapLibreGL.MarkerView id="destination-marker" coordinate={[coordinate.longitude, coordinate.latitude]} anchor={{x: 0.5, y: 1}}>
    <View style={{alignItems: 'center'}}>
      <View style={S.destMarker}><Text style={{fontSize: 26}}>🎯</Text></View>
      <View style={S.destMarkerArrow} />
    </View>
  </MapLibreGL.MarkerView>
));

// ═══════════════════════════════════════════════════════════════
// NAVIGATION PANEL
// ═══════════════════════════════════════════════════════════════
const NavigationPanel = React.memo(({
  currentStep, nextStep, distanceToNextStep, totalRemainingDistance,
  totalRemainingTime, progress, onClose, onRecenter, isRecentering,
  voiceEnabled, onToggleVoice,
}) => {
  if (!currentStep) return null;
  return (
    <View style={S.navPanel}>
      <View style={S.navPanelProgressWrap}>
        <View style={[S.navPanelProgressFill, {width: `${Math.min(progress * 100, 100)}%`}]} />
      </View>
      <View style={S.navPanelHeader}>
        <TouchableOpacity style={S.navPanelCloseBtn} onPress={onClose}>
          <Text style={S.navPanelCloseTxt}>✕</Text>
        </TouchableOpacity>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text style={S.navPanelETA}>{formatDuration(totalRemainingTime)}</Text>
          <Text style={{fontSize: 18, color: '#999', marginHorizontal: 8}}>•</Text>
          <Text style={S.navPanelDist}>{formatDistance(totalRemainingDistance)}</Text>
        </View>
        <View style={{flexDirection: 'row', gap: 8}}>
          <TouchableOpacity style={[S.navPanelSmBtn, !voiceEnabled && {backgroundColor: '#FFEBEE'}]} onPress={onToggleVoice}>
            <Text style={{fontSize: 18}}>{voiceEnabled ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[S.navPanelSmBtn, isRecentering && {backgroundColor: '#E3F2FD'}]} onPress={onRecenter}>
            <Text style={{fontSize: 18}}>🎯</Text>
          </TouchableOpacity>
        </View>
      </View>
      <View style={S.navPanelCard}>
        <View style={S.navPanelIconBox}><Text style={{fontSize: 34}}>{currentStep.icon}</Text></View>
        <View style={{flex: 1}}>
          <Text style={S.navPanelTurnDist}>{distanceToNextStep > 0 ? formatDistanceNav(distanceToNextStep) : 'Now'}</Text>
          <Text style={S.navPanelInstruction} numberOfLines={2}>{currentStep.instruction}</Text>
        </View>
      </View>
      {nextStep && nextStep.maneuverType !== 'arrive' && (
        <View style={S.navPanelNext}>
          <Text style={{fontSize: 13, color: '#999', marginRight: 12, fontWeight: '600'}}>Then</Text>
          <View style={S.navPanelNextIconBox}><Text style={{fontSize: 18}}>{nextStep.icon}</Text></View>
          <Text style={{flex: 1, fontSize: 14, color: '#666', fontWeight: '500'}} numberOfLines={1}>{nextStep.instruction}</Text>
        </View>
      )}
    </View>
  );
});

const NavigationStepItem = React.memo(({step, index, currentStepIndex, distanceToNextStep, totalSteps}) => {
  const isCurrent = index === currentStepIndex;
  const isPast = index < currentStepIndex;
  return (
    <View style={[S.navStep, isCurrent && S.navStepCurrent, isPast && S.navStepPast]}>
      <View style={S.navStepLeft}>
        <View style={[S.navIconBox, step.maneuverType === 'arrive' && {backgroundColor: '#4CAF50'}, isCurrent && S.navIconBoxCurrent, isPast && S.navIconBoxPast]}>
          <Text style={{fontSize: 24}}>{step.icon}</Text>
        </View>
        {index < totalSteps - 1 && <View style={[S.navConnector, isPast && S.navConnectorPast]} />}
      </View>
      <View style={[S.navStepRight, isCurrent && S.navStepRightCurrent]}>
        <View style={{flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8}}>
          <Text style={[S.navStepNum, isPast && S.navStepTxtPast]}>Step {step.stepNumber}</Text>
          <Text style={[S.navStepDist, isPast && S.navStepTxtPast]}>{formatDistance(step.distance)}</Text>
        </View>
        <Text style={[S.navStepInstr, isPast && S.navStepTxtPast]} numberOfLines={2}>{step.instruction}</Text>
        {step.name ? <Text style={[{fontSize: 13, color: '#666', marginBottom: 6, fontWeight: '500'}, isPast && S.navStepTxtPast]} numberOfLines={1}>📍 {step.name}</Text> : null}
        <Text style={[{fontSize: 12, color: '#999', fontWeight: '500'}, isPast && S.navStepTxtPast]}>⏱️ ~{formatDuration(step.duration)}</Text>
        {isCurrent && distanceToNextStep > 0 && (
          <View style={S.navStepBadge}><Text style={S.navStepBadgeTxt}>📍 In {formatDistanceNav(distanceToNextStep)}</Text></View>
        )}
      </View>
    </View>
  );
});

class MapErrorBoundary extends React.Component {
  state = {hasError: false};
  static getDerivedStateFromError() { return {hasError: true}; }
  componentDidCatch(error) { Logger.error('BOUNDARY', 'Map crash', error); }
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

const LocationPermission = {
  async request() {
    if (Platform.OS === 'android') {
      try {
        const fine = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          { title: 'Location Permission', message: 'ParkIt needs location access for navigation.', buttonPositive: 'Allow', buttonNegative: 'Deny' });
        if (fine !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Required', 'Location permission is needed for navigation.', [
            {text: 'Cancel'}, 
            {text: 'Settings', onPress: () => Linking.openSettings()}
          ]);
          return false;
        }
        if (Platform.Version >= 29) {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
        }
        return true;
      } catch (e) { 
        Logger.error('PERMISSION', 'Request failed', e);
        return false; 
      }
    }
    return true;
  },
};

// ═══════════════════════════════════════════════════════════════
// ═══ MAIN SCREEN v5.3 — PRODUCTION READY ═══════════════════════
// ═══════════════════════════════════════════════════════════════
function ParkingMapScreenInner({navigation}) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Tracking refs
  const locationWatchId = useRef(null);
  const passiveWatchId = useRef(null);
  const navIntervalRef = useRef(null);
  const isNavigatingRef = useRef(false);
  const followUserRef = useRef(true);
  const totalDistanceRef = useRef(0);
  const totalDurationRef = useRef(0);
  const lastLocationRef = useRef(null);
  const lastCameraUpdateRef = useRef(0);
  const gpsSpeedRef = useRef(0);
  const reroutingRef = useRef(false);
  const rerouteCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);
  const nearbyRefreshTimerRef = useRef(null);
  const lastNearbyFetchLocRef = useRef(null);
  const hasActiveRouteRef = useRef(false);
  const lastRouteUpdateRef = useRef(0);
  const isMountedRef = useRef(true);
  const isStoppingRef = useRef(false);
  const smoothedHeadingRef = useRef(0);
  const renderCountRef = useRef(0);

  // User marker state
  const [userMarkerCoord, setUserMarkerCoord] = useState([DEFAULT_LOC.longitude, DEFAULT_LOC.latitude]);
  const userMarkerCoordRef = useRef([DEFAULT_LOC.longitude, DEFAULT_LOC.latitude]);
  const lastMarkerUpdateRef = useRef(0);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [spotsLoading, setSpotsLoading] = useState(false);

  // Location & tracking state
  const [userLoc, setUserLoc] = useState(DEFAULT_LOC);
  const [userHeading, setUserHeading] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(0);
  const [locationSource, setLocationSource] = useState('waiting');

  // Parking state
  const [mySpot, setMySpot] = useState(null);
  const [allSpots, setAllSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Route state
  const [routeCoordinates, setRouteCoordinates] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [destination, setDestination] = useState(null);

  // Navigation state
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

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMarker, setSearchMarker] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(14);

  renderCountRef.current++;

  // ═════════════════════════════════════════════════════════════
  // GET LOCATION (INITIAL)
  // ═════════════════════════════════════════════════════════════
  const getLoc = useCallback(async () => {
    Logger.loc('🔍 Getting current location...');
    setGettingLoc(true);
    try {
      const hasPermission = await LocationPermission.request();
      if (!hasPermission) {
        Logger.warn('LOC', 'Permission denied, using default');
        return {...DEFAULT_LOC, source: 'Default'};
      }

      // Try high accuracy GPS
      try {
        const pos = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
          Geolocation.getCurrentPosition(
            res => { clearTimeout(timeout); resolve(res); },
            err => { clearTimeout(timeout); reject(err); },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000, forceLocationManager: false });
        });
        if (validLL(pos.coords.latitude, pos.coords.longitude)) {
          Logger.success('LOC', `📍 GPS: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)} ±${pos.coords.accuracy?.toFixed(0)}m`);
          setLocationSource(`GPS ±${pos.coords.accuracy?.toFixed(0)}m`);
          return { 
            latitude: pos.coords.latitude, 
            longitude: pos.coords.longitude, 
            accuracy: pos.coords.accuracy, 
            heading: pos.coords.heading, 
            source: 'GPS' 
          };
        }
      } catch (e) { 
        Logger.warn('LOC', 'High accuracy GPS failed', e.message); 
      }

      // Fallback to network
      try {
        const pos = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 8000);
          Geolocation.getCurrentPosition(
            res => { clearTimeout(timeout); resolve(res); },
            err => { clearTimeout(timeout); reject(err); },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 });
        });
        if (validLL(pos.coords.latitude, pos.coords.longitude)) {
          Logger.info('LOC', `📡 Network: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)} ±${pos.coords.accuracy?.toFixed(0)}m`);
          setLocationSource(`Network ±${pos.coords.accuracy?.toFixed(0)}m`);
          return { 
            latitude: pos.coords.latitude, 
            longitude: pos.coords.longitude, 
            accuracy: pos.coords.accuracy, 
            source: 'Network' 
          };
        }
      } catch (e) { 
        Logger.warn('LOC', 'Network location failed', e.message); 
      }

      // Fallback to cached
      try {
        const pos = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 3000);
          Geolocation.getCurrentPosition(
            res => { clearTimeout(timeout); resolve(res); },
            err => { clearTimeout(timeout); reject(err); },
            { enableHighAccuracy: false, timeout: 3000, maximumAge: 600000 });
        });
        if (validLL(pos.coords.latitude, pos.coords.longitude)) {
          Logger.info('LOC', `💾 Cached: ${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`);
          setLocationSource(`Cached ±${pos.coords.accuracy?.toFixed(0)}m`);
          return { 
            latitude: pos.coords.latitude, 
            longitude: pos.coords.longitude, 
            accuracy: pos.coords.accuracy, 
            source: 'Cached' 
          };
        }
      } catch (_) {}

      Logger.warn('LOC', 'All location methods failed, using default');
      setLocationSource('Default');
      return {...DEFAULT_LOC, source: 'Default'};
    } finally {
      setGettingLoc(false);
    }
  }, []);

  // ═════════════════════════════════════════════════════════════
  // UPDATE MARKER POSITION
  // ═════════════════════════════════════════════════════════════
  const updateMarkerPosition = useCallback((lat, lng) => {
    const now = Date.now();
    const minInterval = isNavigatingRef.current ? 200 : 100;
    if (now - lastMarkerUpdateRef.current < minInterval) return;
    lastMarkerUpdateRef.current = now;

    const newCoord = [lng, lat];
    userMarkerCoordRef.current = newCoord;
    setUserMarkerCoord(newCoord);
  }, []);

  // ═════════════════════════════════════════════════════════════
  // CAMERA CONTROLS
  // ═════════════════════════════════════════════════════════════
  const flyTo = useCallback((lat, lng, zoom = 16, force = false) => {
    const now = Date.now();
    if (!force && now - lastCameraUpdateRef.current < 500) return;
    const z = Math.min(zoom, 18);
    Logger.camera(`🛫 flyTo: ${lat.toFixed(6)}, ${lng.toFixed(6)} zoom=${z}`);
    cameraRef.current?.setCamera({
      centerCoordinate: [lng, lat], zoomLevel: z,
      animationDuration: 600, animationMode: 'flyTo',
    });
    lastCameraUpdateRef.current = Date.now();
    setZoomLevel(z);
  }, []);

  const fitBounds = useCallback((coords, padding = [100, 100, 100, 100]) => {
    if (!coords || coords.length < 2 || !cameraRef.current) return;
    const lngs = coords.map(c => c[0]);
    const lats = coords.map(c => c[1]);
    cameraRef.current.fitBounds(
      [Math.max(...lngs), Math.max(...lats)],
      [Math.min(...lngs), Math.min(...lats)],
      padding, 1000);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // CLEAR WATCHES
  // ═══════════════════════════════════════════════════════════
  const clearNavigationWatch = useCallback(() => {
    if (locationWatchId.current !== null) {
      try { Geolocation.clearWatch(locationWatchId.current); } catch (e) {}
      locationWatchId.current = null;
      Logger.loc('⏹️ Navigation watch cleared');
    }
    if (navIntervalRef.current) {
      clearInterval(navIntervalRef.current);
      navIntervalRef.current = null;
      Logger.loc('⏹️ Fallback interval cleared');
    }
  }, []);

  const clearPassiveWatch = useCallback(() => {
    if (passiveWatchId.current !== null) {
      try { Geolocation.clearWatch(passiveWatchId.current); } catch (e) {}
      passiveWatchId.current = null;
      Logger.loc('⏹️ Passive watch cleared');
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // FULL CLEANUP
  // ═══════════════════════════════════════════════════════════
  const doFullCleanup = useCallback(() => {
    Logger.info('CLEANUP', '🧹 Full cleanup started');
    isNavigatingRef.current = false;
    followUserRef.current = false;
    hasActiveRouteRef.current = false;
    rerouteCountRef.current = 0;
    gpsSpeedRef.current = 0;
    isStoppingRef.current = false;
    totalDistanceRef.current = 0;
    totalDurationRef.current = 0;
    smoothedHeadingRef.current = 0;

    clearNavigationWatch();
    try { routeLineManager.clear(); } catch (_) {}
    try { stepTracker.reset(); } catch (_) {}
    try { VoiceGuidance.stop(); } catch (_) {}
    try { locationProcessor.reset(); } catch (_) {}

    if (isMountedRef.current) {
      setIsNavigating(false);
      setFollowUser(false);
      setCurrentStepIndex(0);
      setDistanceToNextStep(0);
      setNavigationProgress(0);
      setRouteCoordinates(null);
      setRouteInfo(null);
      setNavigationSteps([]);
      setDestination(null);
      setSearchMarker(null);
      setRemainingDistance(0);
      setRemainingDuration(0);
    }
    try { 
      cameraRef.current?.setCamera({pitch: 0, animationDuration: 500}); 
    } catch (_) {}
    
    Logger.success('CLEANUP', '🧹 Full cleanup complete');
  }, [clearNavigationWatch]);

  // ═══════════════════════════════════════════════════════════
  // STOP NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const stopNavigation = useCallback(() => {
    if (isStoppingRef.current) return;
    isStoppingRef.current = true;
    Logger.nav('⏹️ Stopping navigation...');

    isNavigatingRef.current = false;
    followUserRef.current = false;
    smoothedHeadingRef.current = 0;

    clearNavigationWatch();
    try { stepTracker.reset(); } catch (_) {}
    try { VoiceGuidance.stop(); } catch (_) {}
    try { locationProcessor.reset(); } catch (_) {}

    if (isMountedRef.current) {
      setIsNavigating(false);
      setFollowUser(false);
      setCurrentStepIndex(0);
      setDistanceToNextStep(0);
      setNavigationProgress(0);
    }
    try { 
      cameraRef.current?.setCamera({pitch: 0, animationDuration: 500}); 
    } catch (_) {}
    isStoppingRef.current = false;

    Logger.success('NAV', '⏹️ Navigation stopped');

    // Restart passive tracking
    setTimeout(() => {
      if (isMountedRef.current && !isNavigatingRef.current) {
        doStartPassiveTracking();
      }
    }, 500);
  }, [clearNavigationWatch]);

  // ═══════════════════════════════════════════════════════════
  // REROUTE
  // ═══════════════════════════════════════════════════════════
  const reroute = useCallback(async currentLoc => {
    const dest = destination;
    if (!dest || reroutingRef.current || !isNavigatingRef.current) return;
    const now = Date.now();
    if (now - lastRerouteTimeRef.current < NAV_CONFIG.REROUTE_COOLDOWN) return;
    if (rerouteCountRef.current >= NAV_CONFIG.MAX_REROUTES) {
      Logger.warn('NAV', `Max reroutes (${NAV_CONFIG.MAX_REROUTES}) reached`);
      return;
    }

    reroutingRef.current = true;
    lastRerouteTimeRef.current = now;
    rerouteCountRef.current++;
    Logger.nav(`🔄 Rerouting #${rerouteCountRef.current}...`);
    try { VoiceGuidance.announceRerouting(); } catch (_) {}

    try {
      RouteCache._cache.delete(RouteCache.key(currentLoc.latitude, currentLoc.longitude, dest.latitude, dest.longitude));
      const routeData = await RoutingService.fetchRoute(currentLoc.latitude, currentLoc.longitude, dest.latitude, dest.longitude);
      if (!isNavigatingRef.current || !isMountedRef.current) return;

      const route = routeData.routes[0];
      const coords = route.geometry.coordinates;
      const steps = route.steps || [];

      routeLineManager.setFullRoute(coords, dest);
      stepTracker.setSteps(steps);
      totalDistanceRef.current = route.distance;
      totalDurationRef.current = route.duration;

      setRouteCoordinates(coords);
      setNavigationSteps(steps);
      setRouteInfo({ totalDistance: route.distance, totalDuration: route.duration, stepsCount: steps.length });
      setRemainingDistance(route.distance);
      setRemainingDuration(route.duration);
      setCurrentStepIndex(0);
      setNavigationProgress(0);
      
      Logger.success('NAV', '✅ Reroute complete');
    } catch (e) { 
      Logger.error('NAV', 'Reroute failed', e); 
    }
    finally { reroutingRef.current = false; }
  }, [destination]);

  // ═══════════════════════════════════════════════════════════════
  // ROUTE VISUAL UPDATER
  // ═══════════════════════════════════════════════════════════════
  const updateRouteVisual = useCallback(currentLoc => {
    if (!isMountedRef.current || !currentLoc || isStoppingRef.current) return;

    const fullRoute = routeLineManager.getFullRoute();
    if (!fullRoute) return;

    const now = Date.now();
    if (now - lastRouteUpdateRef.current < 300) return;
    lastRouteUpdateRef.current = now;

    // Check arrival
    if (routeLineManager.hasArrived(currentLoc)) {
      Logger.success('NAV', '🎉 ARRIVED AT DESTINATION!');
      if (isNavigatingRef.current) {
        try { VoiceGuidance.announceArrival(); } catch (_) {}
        isNavigatingRef.current = false;
        followUserRef.current = false;
        clearNavigationWatch();
        try { stepTracker.reset(); } catch (_) {}
        try { VoiceGuidance.stop(); } catch (_) {}
        if (isMountedRef.current) { 
          setIsNavigating(false); 
          setFollowUser(false); 
        }
        try { 
          cameraRef.current?.setCamera({pitch: 0, animationDuration: 500}); 
        } catch (_) {}
        Alert.alert('🎉 Arrived!', 'You have reached your destination.', [{
          text: 'OK', onPress: () => {
            if (isMountedRef.current) {
              doFullCleanup();
              setTimeout(() => { 
                if (isMountedRef.current) doStartPassiveTracking(); 
              }, 300);
            }
          },
        }]);
      }
      return;
    }

    // Update visible route
    const visibleRoute = routeLineManager.getVisibleRoute(currentLoc);
    if (!visibleRoute) return;

    if (visibleRoute.changed && isMountedRef.current) {
      Logger.route(`📏 Updated: remaining=${visibleRoute.remainingDistance.toFixed(0)}m | progress=${(visibleRoute.progress * 100).toFixed(1)}% | pts=${visibleRoute.coordinates.length}`);

      setRouteCoordinates(visibleRoute.coordinates);
      setRemainingDistance(visibleRoute.remainingDistance);
      setNavigationProgress(visibleRoute.progress);

      const remainingTime = estimateRemainingTime(
        visibleRoute.remainingDistance, totalDistanceRef.current,
        totalDurationRef.current, gpsSpeedRef.current);
      setRemainingDuration(remainingTime);

      setRouteInfo(prev => prev ? {
        ...prev, 
        remainingDistance: visibleRoute.remainingDistance, 
        remainingDuration: remainingTime,
      } : prev);
    }

    // Update steps and check off-route
    if (isNavigatingRef.current && !isStoppingRef.current) {
      if (routeLineManager.isOffRoute(currentLoc)) {
        Logger.warn('NAV', '⚠️ Off route detected, rerouting...');
        reroute(currentLoc);
        return;
      }

      try {
        const stepResult = stepTracker.update(currentLoc);
        if (stepResult.changed && isMountedRef.current) {
          setCurrentStepIndex(stepTracker.currentIndex);
        }
        if (isMountedRef.current) {
          setDistanceToNextStep(stepResult.distanceToStep);
        }
      } catch (_) {}
    }
  }, [reroute, doFullCleanup, clearNavigationWatch]);

  // ═══════════════════════════════════════════════════════════
  // PASSIVE TRACKING
  // ═══════════════════════════════════════════════════════════
  const doStartPassiveTracking = useCallback(() => {
    if (!isMountedRef.current || isNavigatingRef.current) return;
    clearPassiveWatch();
    Logger.loc('📍 Starting passive tracking...');

    passiveWatchId.current = Geolocation.watchPosition(
      pos => {
        if (!isMountedRef.current) return;
        const {latitude, longitude, accuracy, heading, speed} = pos.coords;
        if (!validLL(latitude, longitude) || accuracy > 200) return;

        const newLoc = {latitude, longitude};
        if (lastLocationRef.current) {
          const moved = calcDistance(lastLocationRef.current.latitude, lastLocationRef.current.longitude, latitude, longitude);
          if (moved < 3) return;
        }

        // Update location source
        if (accuracy <= 50) setLocationSource(`GPS ±${accuracy.toFixed(0)}m`);
        else if (accuracy <= 100) setLocationSource(`Network ±${accuracy.toFixed(0)}m`);
        else setLocationSource(`Low ±${accuracy.toFixed(0)}m`);

        lastLocationRef.current = newLoc;
        setUserLoc(newLoc);
        updateMarkerPosition(latitude, longitude);
        setLocationAccuracy(accuracy || 0);
        if (heading !== null && !isNaN(heading) && heading >= 0) setUserHeading(heading);
        if (speed !== null && !isNaN(speed) && speed >= 0) gpsSpeedRef.current = speed;

        // Update route if active
        if (hasActiveRouteRef.current) updateRouteVisual(newLoc);
      },
      err => Logger.error('LOC', 'Passive watch error', err),
      LOCATION_TRACKING_CONFIG.PASSIVE
    );
    
    Logger.success('LOC', '✅ Passive tracking started');
  }, [clearPassiveWatch, updateRouteVisual, updateMarkerPosition]);

  // ═══════════════════════════════════════════════════════════
  // CHECK LOCATION ENABLED
  // ═══════════════════════════════════════════════════════════
  const checkLocationEnabled = useCallback(async () => {
    if (Platform.OS === 'android') {
      try {
        const enabled = await new Promise((resolve) => {
          Geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 3000 }
          );
        });
        
        if (!enabled) {
          Alert.alert(
            '📍 Location Disabled',
            'Please enable location services for accurate navigation.',
            [
              { text: 'Cancel' },
              { text: 'Settings', onPress: () => Linking.openSettings() }
            ]
          );
          return false;
        }
        return true;
      } catch (_) {
        return true;
      }
    }
    return true;
  }, []);

  // ═══════════════════════════════════════════════════════════
  // ✅ IMPROVED NAVIGATION TRACKING v5.3
  // ═══════════════════════════════════════════════════════════
  const startLocationTracking = useCallback(() => {
    clearPassiveWatch();
    clearNavigationWatch();
    
    if (navIntervalRef.current) {
      clearInterval(navIntervalRef.current);
      navIntervalRef.current = null;
    }
    
    // Reset location processor
    locationProcessor.reset();
    
    Logger.loc('🧭 ═══ STARTING NAVIGATION TRACKING v5.3 ═══');

    let navUpdateCount = 0;
    let lastWatchUpdate = Date.now();
    let watchHealthy = false;
    let lastLogTime = 0;

    // ✅ UNIFIED LOCATION PROCESSOR
    const processLocation = (latitude, longitude, accuracy, heading, speed, source) => {
      if (!isMountedRef.current || isStoppingRef.current) return;
      
      const position = {coords: {latitude, longitude, accuracy}};
      const check = locationProcessor.shouldProcess(position, true);
      
      if (!check.process) {
        // Suppress frequent rejection logs
        return;
      }

      // Track watch health
      if (source === 'WATCH') {
        lastWatchUpdate = Date.now();
        watchHealthy = true;
      }

      navUpdateCount++;
      locationProcessor.markProcessed(latitude, longitude);

      const newLoc = {latitude, longitude};
      
      // Log every update with context
      const now = Date.now();
      if (now - lastLogTime > 1000 || source !== 'WATCH') {
        Logger.loc(
          `🧭 Nav #${navUpdateCount} [${source}]: ` +
          `${latitude.toFixed(6)}, ${longitude.toFixed(6)} ` +
          `±${accuracy?.toFixed(0)}m`
        );
        lastLogTime = now;
      }

      // Update refs and state
      lastLocationRef.current = newLoc;
      updateMarkerPosition(latitude, longitude);

      if (heading !== null && !isNaN(heading) && heading >= 0) {
        setUserHeading(heading);
      }
      if (speed !== null && !isNaN(speed) && speed >= 0) {
        gpsSpeedRef.current = speed;
      }
      
      setLocationAccuracy(accuracy || 0);
      setLocationSource(`Nav ±${accuracy?.toFixed(0)}m [${source}]`);

      // Update route visual
      if (isNavigatingRef.current && !isStoppingRef.current) {
        updateRouteVisual(newLoc);
      }
    };

    // ═══════════════════════════════════════════════════════
    // METHOD 1: watchPosition with OPTIMIZED settings
    // ═══════════════════════════════════════════════════════
    try {
      locationWatchId.current = Geolocation.watchPosition(
        pos => {
          const {latitude, longitude, accuracy, heading, speed} = pos.coords;
          processLocation(latitude, longitude, accuracy || 20, heading, speed, 'WATCH');
        },
        err => {
          Logger.error('LOC', `watchPosition error: ${err.message} (code: ${err.code})`);
          watchHealthy = false;
        },
        LOCATION_TRACKING_CONFIG.WATCH
      );
      Logger.success('LOC', '✅ watchPosition started with optimized config');
    } catch (e) {
      Logger.error('LOC', 'watchPosition failed to start', e);
      watchHealthy = false;
    }

    // ═══════════════════════════════════════════════════════
    // METHOD 2: SMART FALLBACK - Only when needed
    // ═══════════════════════════════════════════════════════
    Logger.loc('⏱️ Starting smart fallback monitor (3s interval)');
    
    navIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current || isStoppingRef.current || !isNavigatingRef.current) {
        return;
      }

      const timeSinceLastWatch = Date.now() - lastWatchUpdate;
      const silenceThreshold = LOCATION_TRACKING_CONFIG.FALLBACK.watchSilenceThreshold;
      
      // ✅ SMART: Only use fallback if watch is silent for threshold seconds
      if (watchHealthy && timeSinceLastWatch < silenceThreshold) {
        // Watch working fine, skip fallback
        return;
      }

      // Watch is failing, use fallback
      if (timeSinceLastWatch >= silenceThreshold) {
        Logger.warn('LOC', `⚠️ Using interval fallback (watch silent for ${(timeSinceLastWatch/1000).toFixed(0)}s)`);
        watchHealthy = false;
      }

      // Try high accuracy first
      Geolocation.getCurrentPosition(
        pos => {
          const {latitude, longitude, accuracy, heading, speed} = pos.coords;
          processLocation(latitude, longitude, accuracy || 20, heading, speed, 'INTERVAL');
        },
        err => {
          // High accuracy failed, try low accuracy
          Geolocation.getCurrentPosition(
            pos => {
              const {latitude, longitude, accuracy, heading, speed} = pos.coords;
              processLocation(latitude, longitude, accuracy || 100, heading, speed, 'INTERVAL-LOW');
            },
            err2 => {
              // Both failed - only log if watch also failing
              if (!watchHealthy) {
                Logger.error('LOC', `❌ All location methods failing`);
              }
            },
            {
              enableHighAccuracy: false,
              timeout: LOCATION_TRACKING_CONFIG.FALLBACK.lowAccuracyTimeout,
              maximumAge: 10000,
            }
          );
        },
        {
          enableHighAccuracy: true,
          timeout: LOCATION_TRACKING_CONFIG.FALLBACK.highAccuracyTimeout,
          maximumAge: LOCATION_TRACKING_CONFIG.FALLBACK.maxAge,
        }
      );
    }, LOCATION_TRACKING_CONFIG.FALLBACK.checkInterval);

    Logger.success('LOC', '✅ Navigation tracking started (watch + smart fallback)');
  }, [updateRouteVisual, clearPassiveWatch, clearNavigationWatch, updateMarkerPosition]);

  // ═══════════════════════════════════════════════════════════
  // START NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const startNavigation = useCallback(async () => {
    // Check location first
    const locationOK = await checkLocationEnabled();
    if (!locationOK) {
      Logger.warn('NAV', 'Location not enabled, canceling navigation');
      return;
    }

    Logger.nav('🧭 ═══ STARTING NAVIGATION ═══');
    isNavigatingRef.current = true;
    followUserRef.current = true;
    hasActiveRouteRef.current = true;
    rerouteCountRef.current = 0;
    isStoppingRef.current = false;
    smoothedHeadingRef.current = 0;

    setIsNavigating(true);
    setFollowUser(true);
    setCurrentStepIndex(0);

    startLocationTracking();

    // Setup initial camera
    setTimeout(() => {
      if (cameraRef.current && lastLocationRef.current) {
        Logger.camera(`🧭 Nav camera init: zoom=${NAV_CONFIG.NAVIGATION_ZOOM}, tilt=${NAV_CONFIG.NAVIGATION_TILT}`);
        cameraRef.current.setCamera({
          centerCoordinate: [lastLocationRef.current.longitude, lastLocationRef.current.latitude],
          zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM,
          pitch: NAV_CONFIG.NAVIGATION_TILT,
          animationDuration: 800,
        });
      }
    }, 300);
  }, [startLocationTracking, checkLocationEnabled]);

  // ═══════════════════════════════════════════════════════════
  // RECENTER
  // ═══════════════════════════════════════════════════════════
  const recenterOnUser = useCallback(() => {
    Logger.camera('🎯 Recentering on user');
    followUserRef.current = true;
    setFollowUser(true);
    lastCameraUpdateRef.current = 0;

    if (lastLocationRef.current && cameraRef.current) {
      const heading = routeLineManager.getNavigationBearing(lastLocationRef.current);
      smoothedHeadingRef.current = heading;
      cameraRef.current.setCamera({
        centerCoordinate: [lastLocationRef.current.longitude, lastLocationRef.current.latitude],
        zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM,
        heading,
        pitch: isNavigatingRef.current ? NAV_CONFIG.NAVIGATION_TILT : 0,
        animationDuration: 600,
      });
    }
  }, []);

  const toggleVoice = useCallback(() => { 
    setVoiceEnabled(VoiceGuidance.toggle()); 
  }, []);

  // ═════════════════════════════════════════════════════════════
  // LOAD SPOTS
  // ═════════════════════════════════════════════════════════════
  const loadSpots = useCallback(async (location, forceRefresh = false) => {
    setSpotsLoading(true);
    try {
      const saved = await ParkingService.getMySpot();
      setMySpot(saved);
      
      let shouldFetch = forceRefresh;
      if (!shouldFetch && lastNearbyFetchLocRef.current) {
        shouldFetch = calcDistance(location.latitude, location.longitude,
          lastNearbyFetchLocRef.current.latitude, lastNearbyFetchLocRef.current.longitude) > NEARBY_CONFIG.MIN_MOVE_TO_REFRESH;
      } else {
        shouldFetch = true;
      }

      let nearbySpots = [];
      if (shouldFetch) {
        try {
          nearbySpots = await ParkingService.fetchNearbySpots(location.latitude, location.longitude, NEARBY_CONFIG.RADIUS);
          lastNearbyFetchLocRef.current = {...location};
        } catch (error) { 
          Logger.error('SPOTS', 'Fetch failed', error); 
        }
      } else {
        nearbySpots = allSpots.filter(s => !s.isMySpot);
      }

      let combined = [...nearbySpots];
      if (saved && saved.isOccupied) {
        combined = combined.filter(s => calcDistance(s.latitude, s.longitude, saved.latitude, saved.longitude) > 5);
        combined.push({...saved, isMySpot: true});
      }
      combined = combined.map(s => ({
        ...s, 
        distance: calcDistance(location.latitude, location.longitude, s.latitude, s.longitude)
      }));
      combined.sort((a, b) => a.distance - b.distance);
      setAllSpots(combined);
      Logger.info('SPOTS', `📊 ${combined.length} spots loaded (${combined.filter(s => !s.isOccupied).length} available)`);
    } catch (error) { 
      Logger.error('SPOTS', 'loadSpots error', error); 
    }
    finally { setSpotsLoading(false); }
  }, [allSpots]);

  const refreshNearbySpots = useCallback(async () => {
    await loadSpots(lastLocationRef.current || userLoc, true);
  }, [loadSpots, userLoc]);

  // ═════════════════════════════════════════════════════════════
  // INIT
  // ═════════════════════════════════════════════════════════════
  useEffect(() => {
    Logger.info('INIT', `🚀 ParkingMapScreen v${APP_CONFIG.VERSION}`);
    isMountedRef.current = true;

    (async () => {
      await VoiceGuidance.init();
      const loc = await getLoc();
      if (!isMountedRef.current) return;
      
      setUserLoc(loc);
      lastLocationRef.current = loc;
      updateMarkerPosition(loc.latitude, loc.longitude);
      await loadSpots(loc, true);
      setLoading(false);
      doStartPassiveTracking();

      setTimeout(() => {
        if (cameraRef.current) {
          Logger.camera(`🏁 Initial camera: ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)} zoom=15`);
          cameraRef.current.setCamera({
            centerCoordinate: [loc.longitude, loc.latitude],
            zoomLevel: 15,
            animationDuration: 1000,
          });
        }
      }, 500);
    })();

    // Auto refresh nearby spots
    nearbyRefreshTimerRef.current = setInterval(() => {
      if (!isNavigatingRef.current && lastLocationRef.current) {
        loadSpots(lastLocationRef.current, true);
      }
    }, NEARBY_CONFIG.AUTO_REFRESH_INTERVAL);

    // App state listener
    const sub = AppState.addEventListener('change', next => {
      if (appStateRef.current.match(/inactive|background/) && next === 'active') {
        Logger.info('APP', '📱 App foregrounded');
        if (isNavigatingRef.current) {
          startLocationTracking();
        } else {
          doStartPassiveTracking();
        }
        if (lastLocationRef.current) {
          loadSpots(lastLocationRef.current, true);
        }
      }
      appStateRef.current = next;
    });

    return () => {
      Logger.info('CLEANUP', '🧹 Component unmounting');
      isMountedRef.current = false;
      RouteCache.clear();
      isNavigatingRef.current = false;
      hasActiveRouteRef.current = false;
      clearNavigationWatch(); 
      clearPassiveWatch();
      if (navIntervalRef.current) {
        clearInterval(navIntervalRef.current);
        navIntervalRef.current = null;
      }
      if (nearbyRefreshTimerRef.current) {
        clearInterval(nearbyRefreshTimerRef.current);
      }
      try { VoiceGuidance.stop(); } catch (_) {}
      try { routeLineManager.clear(); } catch (_) {}
      try { stepTracker.reset(); } catch (_) {}
      try { locationProcessor.reset(); } catch (_) {}
      sub.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ═════════════════════════════════════════════════════════════
  // FETCH AND SHOW ROUTE
  // ═════════════════════════════════════════════════════════════
  const fetchAndShowRoute = useCallback(async (destLat, destLng, startNav = false) => {
    const currentLoc = lastLocationRef.current || userLoc;
    Logger.nav(`📍 Route to ${destLat.toFixed(6)}, ${destLng.toFixed(6)} | startNav=${startNav}`);
    setRouteLoading(true);
    
    try {
      const distance = calcDistance(currentLoc.latitude, currentLoc.longitude, destLat, destLng);
      if (distance < 20) {
        setRouteLoading(false);
        Alert.alert('📍 Too Close', `Only ${distance.toFixed(0)}m away.`, [
          {text: 'OK'},
          { text: 'Walk There', onPress: () => {
            const straightLine = [[currentLoc.longitude, currentLoc.latitude], [destLng, destLat]];
            const dest = {latitude: destLat, longitude: destLng};
            routeLineManager.setFullRoute(straightLine, dest);
            hasActiveRouteRef.current = true;
            totalDistanceRef.current = distance;
            totalDurationRef.current = distance / 1.4;
            setRouteCoordinates(straightLine); 
            setDestination(dest);
            setRemainingDistance(distance); 
            setRemainingDuration(distance / 1.4);
            setRouteInfo({ totalDistance: distance, totalDuration: distance / 1.4, stepsCount: 0 });
            fitBounds(straightLine);
          }},
        ]);
        return;
      }

      const routeData = await RoutingService.fetchRoute(currentLoc.latitude, currentLoc.longitude, destLat, destLng);
      const route = routeData.routes[0];
      const coords = route.geometry.coordinates;
      const steps = route.steps || [];
      const dest = {latitude: destLat, longitude: destLng};

      routeLineManager.setFullRoute(coords, dest);
      stepTracker.setSteps(steps);
      hasActiveRouteRef.current = true;
      totalDistanceRef.current = route.distance;
      totalDurationRef.current = route.duration;

      setRouteCoordinates(coords); 
      setDestination(dest);
      setNavigationSteps(steps);
      setRouteInfo({ totalDistance: route.distance, totalDuration: route.duration, stepsCount: steps.length });
      setRemainingDistance(route.distance); 
      setRemainingDuration(route.duration);
      setCurrentStepIndex(0); 
      setNavigationProgress(0);
      fitBounds(coords);

      Logger.success('NAV', `✅ Route ready: ${coords.length} pts, ${steps.length} steps, ${formatDistance(route.distance)}`);

      if (startNav) {
        setTimeout(() => startNavigation(), 500);
      } else {
        Alert.alert('✅ Route Ready',
          `📏 ${formatDistance(route.distance)}\n⏱️ ${formatDuration(route.duration)}\n📝 ${steps.length} steps`,
          [
            {text: 'View Steps', onPress: () => setShowNavigation(true)},
            {text: 'Start Nav', onPress: () => startNavigation()},
            {text: 'OK'},
          ]);
      }
    } catch (error) {
      Logger.error('NAV', 'Route failed', error);
      
      // Fallback straight line
      const fb = [[currentLoc.longitude, currentLoc.latitude], [destLng, destLat]];
      const dist = calcDistance(currentLoc.latitude, currentLoc.longitude, destLat, destLng);
      const dest = {latitude: destLat, longitude: destLng};
      routeLineManager.setFullRoute(fb, dest);
      hasActiveRouteRef.current = true;
      totalDistanceRef.current = dist; 
      totalDurationRef.current = dist / 11.11;
      setRouteCoordinates(fb); 
      setDestination(dest); 
      fitBounds(fb);
      setRouteInfo({ totalDistance: dist, totalDuration: dist / 11.11, stepsCount: 2 });
      setRemainingDistance(dist); 
      setRemainingDuration(dist / 11.11);
      
      const fallbackSteps = [
        { id: '1', stepNumber: 1, icon: '🚀', instruction: 'Head towards destination', distance: dist, duration: dist / 11.11, maneuverType: 'depart', location: [currentLoc.longitude, currentLoc.latitude], name: '', modifier: '', coordinates: [] },
        { id: '2', stepNumber: 2, icon: '🎯', instruction: 'Arrive at destination', distance: 0, duration: 0, maneuverType: 'arrive', location: [destLng, destLat], name: '', modifier: '', coordinates: [] },
      ];
      stepTracker.setSteps(fallbackSteps); 
      setNavigationSteps(fallbackSteps);
      Alert.alert('⚠️ Route Error', `${error.message}\n\nShowing straight line.`);
    } finally { 
      setRouteLoading(false); 
    }
  }, [userLoc, fitBounds, startNavigation]);

  const clearRoute = useCallback(() => {
    Logger.info('ROUTE', '🧹 Clearing route');
    doFullCleanup();
    setTimeout(() => { 
      if (isMountedRef.current) doStartPassiveTracking(); 
    }, 300);
  }, [doFullCleanup, doStartPassiveTracking]);

  // ═════════════════════════════════════════════════════════════
  // OCCUPY / VACATE
  // ═════════════════════════════════════════════════════════════
  const handleOccupy = useCallback(async () => {
    const loc = await getLoc();
    if (!loc?.latitude) return Alert.alert('❌', 'Location not found');
    Alert.alert('🅿️ Occupy Spot', `Park at:\n📍 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}`, [
      {text: 'Cancel', style: 'cancel'},
      { text: 'Occupy', onPress: async () => {
        setGettingLoc(true);
        try {
          const spotData = await ParkingService.occupySpot(loc.latitude, loc.longitude);
          setMySpot(spotData); 
          setUserLoc(loc);
          lastLocationRef.current = loc;
          updateMarkerPosition(loc.latitude, loc.longitude);
          await loadSpots(loc, true);
          flyTo(loc.latitude, loc.longitude, 17, true);
          Alert.alert('✅ Spot Occupied!', 'Your parking spot has been saved.');
        } catch (error) { 
          Alert.alert('❌ Failed', error.message); 
        }
        finally { setGettingLoc(false); }
      }},
    ]);
  }, [getLoc, loadSpots, flyTo, updateMarkerPosition]);

  const handleVacate = useCallback(() => {
    if (!mySpot?.isOccupied) return Alert.alert('ℹ️', 'No spot to vacate');
    Alert.alert('🚗 Vacate Spot', `📍 ${mySpot.latitude.toFixed(6)}, ${mySpot.longitude.toFixed(6)}`, [
      {text: 'Cancel', style: 'cancel'},
      { text: 'Vacate', style: 'destructive', onPress: async () => {
        setGettingLoc(true);
        try {
          const vacated = await ParkingService.vacateSpot(mySpot.latitude, mySpot.longitude);
          setMySpot(vacated);
          await loadSpots(userLoc, true);
          Alert.alert('✅ Spot Vacated!', 'Your parking spot is now available.');
        } catch (error) { 
          Alert.alert('❌ Failed', error.message); 
        }
        finally { setGettingLoc(false); }
      }},
    ]);
  }, [mySpot, loadSpots, userLoc]);

  // ═════════════════════════════════════════════════════════════
  // ACTIONS
  // ═════════════════════════════════════════════════════════════
  const handleSpotPress = useCallback(spot => { 
    setSelectedSpot(spot); 
    setShowModal(true); 
  }, []);

  const onLocate = useCallback(async () => {
    Logger.loc('🎯 Locating user...');
    const loc = await getLoc();
    if (!loc) return;
    setUserLoc(loc); 
    lastLocationRef.current = loc;
    updateMarkerPosition(loc.latitude, loc.longitude);
    await loadSpots(loc, true);
    flyTo(loc.latitude, loc.longitude, 16, true);
    if (hasActiveRouteRef.current) updateRouteVisual(loc);
  }, [getLoc, loadSpots, flyTo, updateRouteVisual, updateMarkerPosition]);

  const onShowRoute = useCallback(spot => {
    setShowModal(false); 
    fetchAndShowRoute(spot.latitude, spot.longitude, false);
  }, [fetchAndShowRoute]);

  const onStartNavigation = useCallback(spot => {
    setShowModal(false); 
    setShowNavigation(false);
    fetchAndShowRoute(spot.latitude, spot.longitude, true);
  }, [fetchAndShowRoute]);

  const onShowSteps = useCallback(spot => {
    setShowModal(false); 
    setShowNavigation(true);
    if (!routeCoordinates) fetchAndShowRoute(spot.latitude, spot.longitude, false);
  }, [fetchAndShowRoute, routeCoordinates]);

  const onNavigateExternal = useCallback(spot => {
    const loc = lastLocationRef.current || userLoc;
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${loc.latitude},${loc.longitude}&destination=${spot.latitude},${spot.longitude}&travelmode=driving`);
  }, [userLoc]);

  const onFindParking = useCallback(() => {
    const nearest = allSpots.find(s => !s.isOccupied && !s.isMySpot);
    if (!nearest) return Alert.alert('😕', 'No available spots within 500m');
    flyTo(nearest.latitude, nearest.longitude, 17, true);
    setSelectedSpot(nearest); 
    setShowModal(true);
  }, [allSpots, flyTo]);

  const showRouteStats = useCallback(() => {
    const stats = NavigationDebug.getFullStatus();
    const loc = lastLocationRef.current || userLoc;
    Alert.alert('📊 Debug v5.3',
      `📡 Routing: ${stats.routing.total} total | ✅ ${stats.routing.success} | ❌ ${stats.routing.fail} | 🚀 ${stats.routing.cache} cached\n\n` +
      `🅿️ Spots: ${allSpots.length} (${allSpots.filter(s => !s.isOccupied).length} available)\n\n` +
      `📍 Location: ${locationSource}\n📌 ${loc.latitude.toFixed(6)}, ${loc.longitude.toFixed(6)}\n🎯 Accuracy: ±${locationAccuracy.toFixed(0)}m\n\n` +
      `🗺️ Route: ${hasActiveRouteRef.current ? 'ACTIVE' : 'NONE'}\n📏 Remaining: ${formatDistance(remainingDistance)}\n📈 Progress: ${(navigationProgress * 100).toFixed(0)}%\n\n` +
      `🔄 Renders: ${renderCountRef.current}\n📦 Cache: ${stats.cache} routes`
    );
  }, [allSpots.length, locationSource, userLoc, locationAccuracy, remainingDistance, navigationProgress]);

  const zoomIn = useCallback(() => {
    const z = Math.min(zoomLevel + 1, 18);
    setZoomLevel(z);
    cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300});
  }, [zoomLevel]);

  const zoomOut = useCallback(() => {
    const z = Math.max(zoomLevel - 1, 5);
    setZoomLevel(z);
    cameraRef.current?.setCamera({zoomLevel: z, animationDuration: 300});
  }, [zoomLevel]);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    Keyboard.dismiss(); 
    setSearching(true);
    try {
      const res = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': `${APP_CONFIG.APP_NAME}/${APP_CONFIG.VERSION}` } }, 8000);
      const results = await res.json();
      if (!results?.length) return Alert.alert('Not Found', 'Location not found');
      const lat = parseFloat(results[0].lat), lng = parseFloat(results[0].lon);
      setSearchMarker({latitude: lat, longitude: lng});
      flyTo(lat, lng, 16, true);
      Logger.info('SEARCH', `Found: ${results[0].display_name}`);
    } catch (e) { 
      Alert.alert('Error', 'Search failed'); 
      Logger.error('SEARCH', 'Failed', e);
    }
    finally { setSearching(false); }
  }, [searchQuery, flyTo]);

  // ═════════════════════════════════════════════════════════════
  // MEMOIZED
  // ═════════════════════════════════════════════════════════════
  const renderStep = useCallback(({item, index}) => (
    <NavigationStepItem step={item} index={index} currentStepIndex={currentStepIndex}
      distanceToNextStep={distanceToNextStep} totalSteps={navigationSteps.length} />
  ), [currentStepIndex, distanceToNextStep, navigationSteps.length]);

  const stepKeyExtractor = useCallback(item => item.id, []);

  const availableCount = useMemo(() => allSpots.filter(s => !s.isOccupied && !s.isMySpot).length, [allSpots]);
  const occupiedCount = useMemo(() => allSpots.filter(s => s.isOccupied).length, [allSpots]);

  if (loading) {
    return (
      <SafeAreaView style={S.loading}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={{marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111'}}>Loading Map...</Text>
      </SafeAreaView>
    );
  }

  // ═════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={S.safe} edges={['top', 'bottom']}>
      <View style={{flex: 1}}>
        <MapLibreGL.MapView
          ref={mapRef} style={StyleSheet.absoluteFill} styleJSON={EMPTY_STYLE}
          logoEnabled={false} attributionEnabled={false} compassEnabled={true} compassViewPosition={3}
          rotateEnabled={!isNavigating} pitchEnabled={true}
          scrollEnabled={!isNavigating || !followUser} zoomEnabled={true}
          onDidFinishLoadingMap={() => Logger.success('MAP', '🗺️ Map loaded')}
          onDidFinishRenderingMapFully={() => setTilesLoaded(true)}
          onTouchStart={() => {
            if (isNavigating && followUser) {
              Logger.camera('👆 Touch — disabling follow mode');
              followUserRef.current = false;
              setFollowUser(false);
            }
          }}>

          <MapLibreGL.Camera
            ref={cameraRef}
            maxZoomLevel={18} 
            minZoomLevel={5}
            followUserLocation={isNavigating && followUser}
            followUserMode={isNavigating && followUser ? 'course' : 'normal'}
            followZoomLevel={isNavigating ? NAV_CONFIG.NAVIGATION_ZOOM : 15}
            followPitch={isNavigating ? NAV_CONFIG.NAVIGATION_TILT : 0}
            animationMode="easeTo"
            animationDuration={600}
          />

          <MapLibreGL.RasterSource id="osm"
            tileUrlTemplates={['https://tile.openstreetmap.org/{z}/{x}/{y}.png']}
            tileSize={256} maxZoomLevel={18} minZoomLevel={3}>
            <MapLibreGL.RasterLayer id="osmLayer" sourceID="osm" style={{rasterOpacity: 1}} maxZoomLevel={18} />
          </MapLibreGL.RasterSource>

          {!isNavigating && allSpots.map(spot => (
            <ParkingMarker key={spot.id} spot={spot} onPress={handleSpotPress} />
          ))}
          {searchMarker && !isNavigating && <SearchMarker coordinate={searchMarker} />}
          {destination && <DestinationMarker coordinate={destination} />}

          {/* ROUTE VISUALIZATION */}
          {routeCoordinates && routeCoordinates.length > 1 && (() => {
            const currentLoc = lastLocationRef.current;
            let traveledCoords = [];
            let remainingCoords = routeCoordinates;

            if (currentLoc && isNavigating && routeCoordinates.length > 2) {
              let minDist = Infinity;
              let splitIndex = 0;

              for (let i = 0; i < routeCoordinates.length - 1; i++) {
                const segStart = routeCoordinates[i];
                const dist = calcDistance(
                  currentLoc.latitude, 
                  currentLoc.longitude,
                  segStart[1], 
                  segStart[0]
                );
                
                if (dist < minDist) {
                  minDist = dist;
                  splitIndex = i;
                }
              }

              if (splitIndex > 0 && minDist < 50) {
                traveledCoords = routeCoordinates.slice(0, splitIndex + 1);
                remainingCoords = routeCoordinates.slice(splitIndex);
              }
            }

            return (
              <>
                {/* TRAVELED ROUTE (GRAY) */}
                {traveledCoords.length > 1 && (
                  <MapLibreGL.ShapeSource 
                    id="traveledRouteSource" 
                    shape={{
                      type: 'Feature',
                      geometry: {
                        type: 'LineString',
                        coordinates: traveledCoords
                      }
                    }}
                  >
                    <MapLibreGL.LineLayer 
                      id="traveledRouteLine" 
                      style={{
                        lineColor: '#9E9E9E',
                        lineWidth: 8,
                        lineOpacity: 0.6,
                        lineCap: 'round',
                        lineJoin: 'round'
                      }} 
                    />
                  </MapLibreGL.ShapeSource>
                )}

                {/* REMAINING ROUTE (BLUE/RED) */}
                {remainingCoords.length > 1 && (
                  <MapLibreGL.ShapeSource 
                    id="remainingRouteSource" 
                    shape={{
                      type: 'Feature',
                      geometry: {
                        type: 'LineString',
                        coordinates: remainingCoords
                      }
                    }}
                  >
                    <MapLibreGL.LineLayer 
                      id="remainingRouteBorder" 
                      style={{
                        lineColor: '#FFFFFF',
                        lineWidth: 12,
                        lineOpacity: 0.9,
                        lineCap: 'round',
                        lineJoin: 'round'
                      }} 
                    />
                    <MapLibreGL.LineLayer 
                      id="remainingRouteLine" 
                      style={{
                        lineColor: isNavigating ? '#4285F4' : '#E53935',
                        lineWidth: 7,
                        lineOpacity: 1,
                        lineCap: 'round',
                        lineJoin: 'round'
                      }} 
                    />
                  </MapLibreGL.ShapeSource>
                )}
              </>
            );
          })()}

          <UserLocationMarker
            coordinate={userMarkerCoord}
            heading={userHeading}
            isNavigating={isNavigating}
            accuracy={locationAccuracy}
          />
        </MapLibreGL.MapView>

        {/* NAVIGATION PANEL */}
        {isNavigating && navigationSteps.length > 0 && (
          <NavigationPanel
            currentStep={navigationSteps[currentStepIndex]}
            nextStep={navigationSteps[currentStepIndex + 1]}
            distanceToNextStep={distanceToNextStep}
            totalRemainingDistance={remainingDistance}
            totalRemainingTime={remainingDuration}
            progress={navigationProgress}
            onClose={stopNavigation} 
            onRecenter={recenterOnUser}
            isRecentering={followUser} 
            voiceEnabled={voiceEnabled}
            onToggleVoice={toggleVoice} 
          />
        )}

        {/* TILES LOADING */}
        {!tilesLoaded && (
          <View style={S.tilesLoading}>
            <ActivityIndicator size="small" color="#E53935" />
            <Text style={{fontSize: 14, color: '#333', fontWeight: '600'}}>Loading tiles...</Text>
          </View>
        )}

        {/* ROUTE LOADING */}
        {routeLoading && (
          <View style={S.routeLoadingOverlay}>
            <View style={S.routeLoadingCard}>
              <ActivityIndicator size="large" color="#E53935" />
              <Text style={{marginTop: 16, fontSize: 16, fontWeight: '700', color: '#111'}}>Fetching route...</Text>
            </View>
          </View>
        )}

        {/* SEARCH BAR */}
        {!isNavigating && (
          <View style={[S.searchWrap, {top: insets.top + 12}]}>
            <View style={S.searchBar}>
              <Text style={{fontSize: 18, marginRight: 10}}>🔍</Text>
              <TextInput 
                value={searchQuery} 
                onChangeText={setSearchQuery} 
                placeholder="Search location..."
                placeholderTextColor="#999" 
                style={{flex: 1, fontSize: 15, color: '#111', fontWeight: '500'}}
                returnKeyType="search" 
                onSubmitEditing={runSearch} 
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setSearchMarker(null); }}>
                  <Text style={{fontSize: 18, color: '#999', marginRight: 10, padding: 4}}>✕</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={runSearch} style={S.searchBtn}>
                {searching ? <ActivityIndicator size="small" color="#E53935" /> :
                  <Text style={{fontSize: 20, color: '#E53935', fontWeight: '700'}}>→</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* PILLS ROW */}
        {!isNavigating && (
          <View style={[S.pillsRow, {top: insets.top + 68}]}>
            <TouchableOpacity style={[S.pill, mySpot?.isOccupied && S.pillOff]} onPress={handleOccupy} disabled={mySpot?.isOccupied || gettingLoc}>
              {gettingLoc ? <ActivityIndicator size="small" color="#E53935" /> :
                <><Text style={{fontSize: 14, marginRight: 5}}>📍</Text><Text style={S.pillTxt}>Occupy</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={[S.pill, !mySpot?.isOccupied && S.pillOff]} onPress={handleVacate} disabled={!mySpot?.isOccupied || gettingLoc}>
              {gettingLoc ? <ActivityIndicator size="small" color="#E53935" /> :
                <><Text style={{fontSize: 14, marginRight: 5}}>🚗</Text><Text style={S.pillTxt}>Vacate</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={S.pill} onPress={refreshNearbySpots} disabled={spotsLoading}>
              {spotsLoading ? <ActivityIndicator size="small" color="#E53935" /> :
                <><Text style={{fontSize: 14, marginRight: 5}}>🔄</Text><Text style={S.pillTxt}>Refresh</Text></>}
            </TouchableOpacity>
          </View>
        )}

        {/* SPOTS BADGE */}
        {!isNavigating && (
          <View style={[S.spotsBadge, {top: insets.top + 118}]}>
            <Text style={{fontSize: 12, fontWeight: '600', color: '#555', textAlign: 'center'}}>
              🅿️ {allSpots.length} spots • 🟢 {availableCount} free • 🔴 {occupiedCount} taken</Text>
            <Text style={{fontSize: 10, fontWeight: '500', color: '#999', textAlign: 'center', marginTop: 2}}>
              📍 {locationSource} {hasActiveRouteRef.current ? '• 🗺️ Route active' : ''}</Text>
          </View>
        )}

        {/* ROUTE INFO CARD */}
        {routeInfo && !isNavigating && (
          <View style={[S.routeInfoCard, {top: insets.top + (allSpots.length > 0 ? 158 : 130)}]}>
            <View style={{flex: 1}}>
              {navigationProgress > 0.01 && (
                <View style={{height: 4, backgroundColor: '#E0E0E0', borderRadius: 2, marginBottom: 10, overflow: 'hidden'}}>
                  <View style={{height: '100%', backgroundColor: '#4CAF50', borderRadius: 2, width: `${Math.min(navigationProgress * 100, 100)}%`}} />
                </View>
              )}
              <View style={{flexDirection: 'row'}}>
                <View style={{flex: 1, alignItems: 'center'}}>
                  <Text style={S.routeInfoVal}>{formatDistance(remainingDistance)}</Text>
                  <Text style={S.routeInfoLbl}>{navigationProgress > 0.01 ? 'Remaining' : 'Distance'}</Text>
                </View>
                <View style={S.routeInfoDiv} />
                <View style={{flex: 1, alignItems: 'center'}}>
                  <Text style={S.routeInfoVal}>{formatDuration(remainingDuration)}</Text>
                  <Text style={S.routeInfoLbl}>Duration</Text>
                </View>
                <View style={S.routeInfoDiv} />
                <View style={{flex: 1, alignItems: 'center'}}>
                  <Text style={S.routeInfoVal}>{navigationProgress > 0.01 ? `${(navigationProgress * 100).toFixed(0)}%` : routeInfo.stepsCount}</Text>
                  <Text style={S.routeInfoLbl}>{navigationProgress > 0.01 ? 'Progress' : 'Steps'}</Text>
                </View>
              </View>
            </View>
            <TouchableOpacity style={S.routeInfoClose} onPress={clearRoute}>
              <Text style={{fontSize: 16, color: '#666', fontWeight: '600'}}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* RIGHT CONTROLS */}
        <View style={[S.rightCtrls, {top: isNavigating ? insets.top + 240 : routeInfo ? insets.top + 235 : insets.top + 170}]}>
          <TouchableOpacity style={S.ctrlBtn} onPress={onLocate} onLongPress={showRouteStats}>
            <Text style={{fontSize: 24}}>📍</Text>
          </TouchableOpacity>
          {routeCoordinates && !isNavigating && (
            <TouchableOpacity style={S.ctrlBtn} onPress={clearRoute}>
              <Text style={{fontSize: 24}}>🧹</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomIn}>
            <Text style={{fontSize: 24}}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.ctrlBtn} onPress={zoomOut}>
            <Text style={{fontSize: 24}}>－</Text>
          </TouchableOpacity>
        </View>

        {/* FIND PARKING BUTTON */}
        {!isNavigating && (
          <View style={[S.findWrap, {bottom: 86 + insets.bottom}]}>
            <TouchableOpacity style={S.findBtn} onPress={onFindParking}>
              <Text style={{fontSize: 24, marginRight: 10}}>🅿️</Text>
              <Text style={{fontSize: 18, fontWeight: '800', color: '#fff'}}>Find Parking</Text>
              <View style={S.findBadge}>
                <Text style={{fontSize: 14, fontWeight: '800', color: '#E53935'}}>{availableCount}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* END NAVIGATION BUTTON */}
        {isNavigating && (
          <View style={[S.endNavWrap, {bottom: 100 + insets.bottom}]}>
            <TouchableOpacity style={S.endNavBtn} onPress={stopNavigation}>
              <Text style={{fontSize: 22, color: '#fff', marginRight: 8, fontWeight: '700'}}>✕</Text>
              <Text style={{fontSize: 17, fontWeight: '700', color: '#fff'}}>End Navigation</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* TAB BAR */}
        <View style={[S.tabBar, {paddingBottom: Math.max(12, insets.bottom)}]}>
          <TouchableOpacity style={S.tabItem}>
            <Text style={[S.tabIcon, S.tabActive]}>🗺️</Text>
            <Text style={[S.tabLbl, S.tabActive]}>Explore</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>🔖</Text>
            <Text style={S.tabLbl}>Saved</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabCenter}>
            <Text style={{fontSize: 36, color: '#fff', marginTop: -2}}>＋</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>👥</Text>
            <Text style={S.tabLbl}>Contribute</Text>
          </TouchableOpacity>
          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>👤</Text>
            <Text style={S.tabLbl}>Profile</Text>
          </TouchableOpacity>
        </View>

        {/* SPOT MODAL */}
        <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
          <View style={{flex: 1, justifyContent: 'flex-end'}}>
            <TouchableOpacity 
              style={{...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)'}} 
              onPress={() => setShowModal(false)} 
              activeOpacity={1} 
            />
            <View style={S.modalContent}>
              <View style={S.modalHandle} />
              <View style={S.modalHeader}>
                <Text style={{fontSize: 22, fontWeight: '800', color: '#111'}}>
                  {selectedSpot?.isMySpot ? '🚗 Your Spot' : '🅿️ Parking Spot'}
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Text style={{fontSize: 28, color: '#999'}}>✕</Text>
                </TouchableOpacity>
              </View>
              {selectedSpot && (
                <ScrollView style={{padding: 22}}>
                  <View style={[S.statusBadge, {backgroundColor: selectedSpot.isOccupied ? '#FFEBEE' : '#E8F5E9'}]}>
                    <Text style={[S.statusTxt, {color: selectedSpot.isOccupied ? '#E53935' : '#4CAF50'}]}>
                      {selectedSpot.isOccupied ? '🔴 Occupied' : '🟢 Available'}
                    </Text>
                  </View>
                  <View style={S.infoCard}>
                    <Text style={S.infoRow}>📏 {formatDistance(selectedSpot.distance)}</Text>
                    <Text style={S.infoRow}>🚗 {selectedSpot.deviceName}</Text>
                    <Text style={S.infoRow}>🕐 {formatTime(selectedSpot.createdAt)}</Text>
                    <Text style={S.infoRow}>📍 {selectedSpot.latitude?.toFixed(6)}, {selectedSpot.longitude?.toFixed(6)}</Text>
                  </View>
                  <View style={{gap: 12}}>
                    <TouchableOpacity style={S.routeBtn} onPress={() => onShowRoute(selectedSpot)}>
                      <Text style={S.routeBtnTxt}>🗺️ Show Route</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.navBtn} onPress={() => onShowSteps(selectedSpot)}>
                      <Text style={S.navBtnTxt}>📋 View Steps</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.startBtn} onPress={() => onStartNavigation(selectedSpot)}>
                      <Text style={S.startBtnTxt}>🧭 Start Navigation</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={S.extBtn} onPress={() => onNavigateExternal(selectedSpot)}>
                      <Text style={S.extBtnTxt}>📱 Google Maps</Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* NAVIGATION STEPS MODAL */}
        <Modal visible={showNavigation} transparent animationType="slide" onRequestClose={() => setShowNavigation(false)}>
          <SafeAreaView style={{flex: 1, backgroundColor: 'rgba(0,0,0,0.5)'}}>
            <View style={S.navModalContent}>
              <View style={S.navModalHeader}>
                <TouchableOpacity onPress={() => setShowNavigation(false)} style={S.navModalCloseBtn}>
                  <Text style={{fontSize: 26, color: '#111', fontWeight: '600'}}>←</Text>
                </TouchableOpacity>
                <Text style={{fontSize: 18, fontWeight: '800', color: '#111'}}>Navigation Steps</Text>
                <TouchableOpacity 
                  onPress={() => { 
                    if (destination) { 
                      setShowNavigation(false); 
                      onStartNavigation(destination); 
                    } 
                  }} 
                  style={S.navModalStartBtn}
                >
                  <Text style={{fontSize: 14, fontWeight: '700', color: '#fff'}}>▶️ Start</Text>
                </TouchableOpacity>
              </View>
              {routeInfo && (
                <View style={S.navSummary}>
                  <View style={{flex: 1, alignItems: 'center'}}>
                    <Text style={S.navSumVal}>{formatDistance(remainingDistance)}</Text>
                    <Text style={S.navSumLbl}>{navigationProgress > 0.01 ? 'Remaining' : 'Total'}</Text>
                  </View>
                  <View style={S.navSumDiv} />
                  <View style={{flex: 1, alignItems: 'center'}}>
                    <Text style={S.navSumVal}>{formatDuration(remainingDuration)}</Text>
                    <Text style={S.navSumLbl}>Duration</Text>
                  </View>
                  <View style={S.navSumDiv} />
                  <View style={{flex: 1, alignItems: 'center'}}>
                    <Text style={S.navSumVal}>
                      {navigationProgress > 0.01 ? `${(navigationProgress * 100).toFixed(0)}%` : routeInfo.stepsCount}
                    </Text>
                    <Text style={S.navSumLbl}>{navigationProgress > 0.01 ? 'Progress' : 'Steps'}</Text>
                  </View>
                </View>
              )}
              {(isNavigating || navigationProgress > 0.01) && (
                <View style={{padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#EEE'}}>
                  <View style={{height: 10, backgroundColor: '#E0E0E0', borderRadius: 5, overflow: 'hidden'}}>
                    <View style={{height: '100%', backgroundColor: '#4CAF50', borderRadius: 5, width: `${navigationProgress * 100}%`}} />
                  </View>
                  <Text style={{fontSize: 13, color: '#666', marginTop: 10, textAlign: 'center', fontWeight: '500'}}>
                    {formatDistance(totalDistanceRef.current - remainingDistance)} traveled ({(navigationProgress * 100).toFixed(0)}%)
                  </Text>
                </View>
              )}
              <FlatList 
                data={navigationSteps} 
                renderItem={renderStep} 
                keyExtractor={stepKeyExtractor}
                contentContainerStyle={{padding: 16}}
                ListEmptyComponent={
                  <View style={{alignItems: 'center', paddingVertical: 80}}>
                    <Text style={{fontSize: 70, marginBottom: 24}}>🗺️</Text>
                    <Text style={{fontSize: 16, color: '#666', fontWeight: '600'}}>No steps available</Text>
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

export default function ParkingMapScreen(props) {
  return (
    <MapErrorBoundary>
      <ParkingMapScreenInner {...props} />
    </MapErrorBoundary>
  );
}

// ═════════════════════════════════════════════════════════════
// STYLES
// ═════════════════════════════════════════════════════════════
const S = StyleSheet.create({
  safe: {flex: 1, backgroundColor: '#F8F9FA'},
  loading: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff'},
  errorBoundary: {flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 24},
  errorBtn: {marginTop: 24, paddingHorizontal: 28, paddingVertical: 14, backgroundColor: '#E53935', borderRadius: 14},
  navPanel: {position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#fff', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, elevation: 20, shadowColor: '#000', shadowOffset: {width: 0, height: 8}, shadowOpacity: 0.25, shadowRadius: 12, zIndex: 100},
  navPanelProgressWrap: {position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: '#E0E0E0'},
  navPanelProgressFill: {height: '100%', backgroundColor: '#4CAF50'},
  navPanelHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14},
  navPanelCloseBtn: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navPanelCloseTxt: {fontSize: 22, color: '#666', fontWeight: '600'},
  navPanelETA: {fontSize: 20, fontWeight: '800', color: '#4CAF50'},
  navPanelDist: {fontSize: 18, fontWeight: '700', color: '#333'},
  navPanelSmBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navPanelCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1976D2', borderRadius: 20, padding: 18, marginBottom: 12, elevation: 6},
  navPanelIconBox: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 16, elevation: 3},
  navPanelDist: {fontSize: 18, fontWeight: '700', color: '#333'},
  navPanelSmBtn: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navPanelCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1976D2', borderRadius: 20, padding: 18, marginBottom: 12, elevation: 6},
  navPanelIconBox: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', marginRight: 16, elevation: 3},
  navPanelTurnDist: {fontSize: 28, fontWeight: '900', color: '#fff', marginBottom: 4},
  navPanelInstruction: {fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.95)', lineHeight: 22},
  navPanelNext: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E0E0E0'},
  navPanelNextIconBox: {width: 38, height: 38, borderRadius: 19, backgroundColor: '#E0E0E0', justifyContent: 'center', alignItems: 'center', marginRight: 12},
  endNavWrap: {position: 'absolute', left: 20, right: 20, zIndex: 50},
  endNavBtn: {height: 56, backgroundColor: '#E53935', borderRadius: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 10},
  userMarkerContainer: {alignItems: 'center', justifyContent: 'center'},
  userMarkerAccuracy: {position: 'absolute', backgroundColor: 'rgba(25,118,210,0.1)', borderWidth: 1, borderColor: 'rgba(25,118,210,0.3)'},
  userMarkerOuter: {width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(25,118,210,0.2)', justifyContent: 'center', alignItems: 'center'},
  userMarkerOuterNav: {width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(25,118,210,0.25)'},
  userMarkerInner: {width: 26, height: 26, borderRadius: 13, backgroundColor: '#1976D2', borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 6},
  userMarkerInnerNav: {width: 34, height: 34, borderRadius: 17, borderWidth: 5},
  userMarkerArrowWrap: {position: 'absolute', width: 60, height: 60, justifyContent: 'flex-start', alignItems: 'center'},
  userMarkerArrow2: {width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderBottomWidth: 20, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#1976D2', marginTop: -25},
  tilesLoading: {position: 'absolute', top: '45%', alignSelf: 'center', backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 25, elevation: 8, gap: 10, zIndex: 50},
  markerTouchable: {alignItems: 'center'},
  markerContainer: {width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.25, shadowRadius: 4},
  markerIcon: {fontSize: 20},
  markerArrow: {width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10, borderTopWidth: 12, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -3},
  destMarker: {width: 54, height: 54, borderRadius: 27, backgroundColor: '#4CAF50', borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 10},
  destMarkerArrow: {width: 0, height: 0, borderLeftWidth: 14, borderRightWidth: 14, borderTopWidth: 16, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#4CAF50', marginTop: -4},
  routeLoadingOverlay: {position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', zIndex: 1000},
  routeLoadingCard: {backgroundColor: '#fff', padding: 32, borderRadius: 24, alignItems: 'center', elevation: 15},
  searchWrap: {position: 'absolute', left: 16, right: 16, zIndex: 30},
  searchBar: {height: 54, backgroundColor: '#fff', borderRadius: 18, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', elevation: 8},
  searchBtn: {width: 38, height: 38, borderRadius: 12, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  pillsRow: {position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', zIndex: 25},
  pill: {backgroundColor: '#fff', paddingHorizontal: 16, height: 42, borderRadius: 21, flexDirection: 'row', alignItems: 'center', elevation: 6, shadowColor: '#000', shadowOffset: {width: 0, height: 2}, shadowOpacity: 0.12, shadowRadius: 4},
  pillOff: {opacity: 0.5},
  pillTxt: {fontSize: 13, fontWeight: '700', color: '#111'},
  spotsBadge: {position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, elevation: 4, zIndex: 24},
  routeInfoCard: {position: 'absolute', left: 16, right: 16, backgroundColor: '#fff', borderRadius: 18, padding: 16, flexDirection: 'row', alignItems: 'center', elevation: 8, zIndex: 24},
  routeInfoVal: {fontSize: 18, fontWeight: '800', color: '#E53935'},
  routeInfoLbl: {fontSize: 11, color: '#666', marginTop: 2, fontWeight: '500'},
  routeInfoDiv: {width: 1, height: 36, backgroundColor: '#E0E0E0', marginHorizontal: 12},
  routeInfoClose: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  rightCtrls: {position: 'absolute', right: 16, zIndex: 20, gap: 10},
  ctrlBtn: {width: 52, height: 52, borderRadius: 16, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', elevation: 6},
  findWrap: {position: 'absolute', left: 20, right: 20, zIndex: 20},
  findBtn: {height: 62, backgroundColor: '#E53935', borderRadius: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 12},
  findBadge: {backgroundColor: '#fff', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, marginLeft: 14},
  tabBar: {position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 14, backgroundColor: '#fff', borderTopLeftRadius: 26, borderTopRightRadius: 26, flexDirection: 'row', justifyContent: 'space-around', elevation: 20},
  tabItem: {width: 60, alignItems: 'center', paddingVertical: 6},
  tabIcon: {fontSize: 24, color: '#999'},
  tabLbl: {fontSize: 10, marginTop: 4, color: '#999', fontWeight: '600'},
  tabActive: {color: '#E53935'},
  tabCenter: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#E53935', alignItems: 'center', justifyContent: 'center', marginBottom: 14, elevation: 12},
  modalContent: {backgroundColor: '#fff', borderTopLeftRadius: 32, borderTopRightRadius: 32, maxHeight: '80%', elevation: 25},
  modalHandle: {width: 48, height: 5, backgroundColor: '#DDD', borderRadius: 3, alignSelf: 'center', marginTop: 14},
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 22, borderBottomWidth: 1, borderBottomColor: '#F0F0F0'},
  statusBadge: {alignSelf: 'flex-start', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24, marginBottom: 18},
  statusTxt: {fontSize: 14, fontWeight: '700'},
  infoCard: {backgroundColor: '#F8F9FA', borderRadius: 18, padding: 18, marginBottom: 20, borderWidth: 1, borderColor: '#F0F0F0'},
  infoRow: {fontSize: 15, color: '#111', paddingVertical: 8, fontWeight: '500'},
  routeBtn: {backgroundColor: '#F0F0F0', padding: 18, borderRadius: 16, alignItems: 'center'},
  routeBtnTxt: {fontSize: 16, fontWeight: '700', color: '#111'},
  navBtn: {backgroundColor: '#FFF3E0', padding: 18, borderRadius: 16, alignItems: 'center', borderWidth: 1, borderColor: '#FFE0B2'},
  navBtnTxt: {fontSize: 16, fontWeight: '700', color: '#E65100'},
  startBtn: {backgroundColor: '#4CAF50', padding: 18, borderRadius: 16, alignItems: 'center', elevation: 4},
  startBtnTxt: {fontSize: 16, fontWeight: '700', color: '#fff'},
  extBtn: {backgroundColor: '#E53935', padding: 18, borderRadius: 16, alignItems: 'center', elevation: 4},
  extBtnTxt: {fontSize: 16, fontWeight: '700', color: '#fff'},
  navModalContent: {flex: 1, backgroundColor: '#fff', marginTop: 60, borderTopLeftRadius: 32, borderTopRightRadius: 32, elevation: 25},
  navModalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 18, borderBottomWidth: 1, borderBottomColor: '#F0F0F0'},
  navModalCloseBtn: {width: 46, height: 46, borderRadius: 23, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center'},
  navModalStartBtn: {paddingHorizontal: 18, paddingVertical: 12, borderRadius: 22, backgroundColor: '#4CAF50', elevation: 3},
  navSummary: {flexDirection: 'row', padding: 18, backgroundColor: '#F8F9FA', borderBottomWidth: 1, borderBottomColor: '#EEE'},
  navSumVal: {fontSize: 20, fontWeight: '800', color: '#111'},
  navSumLbl: {fontSize: 11, color: '#666', marginTop: 3, fontWeight: '500'},
  navSumDiv: {width: 1, backgroundColor: '#E0E0E0', marginHorizontal: 12},
  navStep: {flexDirection: 'row', marginBottom: 8},
  navStepCurrent: {backgroundColor: '#FFF8E1', borderRadius: 18, marginLeft: -10, marginRight: -10, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 2, borderColor: '#FFE082'},
  navStepPast: {opacity: 0.5},
  navStepLeft: {alignItems: 'center', marginRight: 14},
  navIconBox: {width: 50, height: 50, borderRadius: 25, backgroundColor: '#E53935', justifyContent: 'center', alignItems: 'center', elevation: 5},
  navIconBoxCurrent: {backgroundColor: '#FF9800', width: 58, height: 58, borderRadius: 29, borderWidth: 3, borderColor: '#FFE082'},
  navIconBoxPast: {backgroundColor: '#9E9E9E'},
  navConnector: {width: 4, flex: 1, backgroundColor: '#E53935', marginVertical: 6, borderRadius: 2},
  navConnectorPast: {backgroundColor: '#BDBDBD'},
  navStepRight: {flex: 1, backgroundColor: '#F8F9FA', padding: 16, borderRadius: 16, marginBottom: 8, borderWidth: 1, borderColor: '#F0F0F0'},
  navStepRightCurrent: {backgroundColor: '#FFECB3', borderWidth: 2, borderColor: '#FF9800'},
  navStepNum: {fontSize: 11, color: '#666', fontWeight: '700', textTransform: 'uppercase'},
  navStepDist: {fontSize: 14, color: '#E53935', fontWeight: '800'},
  navStepInstr: {fontSize: 16, color: '#111', fontWeight: '700', marginBottom: 6, lineHeight: 23},
  navStepTxtPast: {color: '#9E9E9E'},
  navStepBadge: {backgroundColor: '#FF9800', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, alignSelf: 'flex-start', marginTop: 10, elevation: 2},
  navStepBadgeTxt: {fontSize: 13, fontWeight: '700', color: '#fff'},
});