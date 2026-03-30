// src/screens/ParkingMapScreen.jsx
// ═══════════════════════════════════════════════════════════════
// PARKIT v7.0 - Production Ready (Android + iOS)
// ═══════════════════════════════════════════════════════════════
// 
// FEATURES:
// ✅ All markers using ShapeSource (Android release safe)
// ✅ No MarkerView, No PointAnnotation (crash-proof)
// ✅ Synchronous cleanup (no crashes on unmount)
// ✅ Memory leak prevention with proper refs
// ✅ Race condition fixes with flags
// ✅ Better error recovery with fallbacks
// ✅ Proper navigation lifecycle management
// ✅ Voice guidance integration
// ✅ Step-by-step navigation with hysteresis
// ✅ Spots refresh after navigation stops
//
// CHANGELOG v7.0:
// - Removed all async delays from cleanup
// - Added comprehensive null checks
// - Fixed race conditions in navigation
// - Improved error handling
// - Added cleanupNavigation helper usage
// - Better state synchronization
//
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
  PermissionsAndroid,
} from 'react-native';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Geolocation from '@react-native-community/geolocation';
import ParkingService from '../services/ParkingService';

import {
  Logger,
  NAV_CONFIG,
  NEARBY_CONFIG,
  DEFAULT_LOC,
  EMPTY_STYLE,
  API_BASE_URL,
  BACKEND_CONFIG,
  APP_CONFIG,
  validLL,
  calcDistance,
  calcBearing,
  smoothHeading,
  findNearestPointOnRoute,
  snapToRoute,
  formatDistance,
  formatDuration,
  formatDistanceNav,
  formatTime,
  fetchWithTimeout,
  VoiceGuidance,
  RoutingService,
  RouteCache,
  routeLineManager,
  stepTracker,
  estimateRemainingTime,
  LOCATION_TRACKING_CONFIG,
  locationProcessor,
  NavigationDebug,
  cleanupNavigation,
} from '../services/NavigationService';

// ═══════════════════════════════════════════════════════════════
// MAPLIBRE INITIALIZATION
// ═══════════════════════════════════════════════════════════════
MapLibreGL.setAccessToken(null);

const { BluetoothModule } = NativeModules;

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const EMPTY_LINE_COORDS = [[0, 0], [0.00001, 0.00001]];

const EMPTY_GEOJSON = {
  type: 'FeatureCollection',
  features: [],
};

// ═══════════════════════════════════════════════════════════════
// PARKING SPOTS LAYER
// Using ShapeSource + CircleLayer for Android release safety
// ═══════════════════════════════════════════════════════════════
const ParkingSpotsLayer = React.memo(({ spots, isHidden, onSpotPress }) => {
  // ✅ Memoize GeoJSON to prevent unnecessary re-renders
  const spotsGeoJson = useMemo(() => {
    if (!spots || spots.length === 0 || isHidden) {
      return EMPTY_GEOJSON;
    }

    return {
      type: 'FeatureCollection',
      features: spots.map((spot) => ({
        type: 'Feature',
        id: String(spot.id),
        geometry: {
          type: 'Point',
          coordinates: [spot.longitude, spot.latitude],
        },
        properties: {
          id: String(spot.id),
          isMySpot: spot.isMySpot || false,
          isOccupied: spot.isOccupied || false,
          color: spot.isMySpot
            ? '#1976D2'
            : spot.isOccupied
              ? '#E53935'
              : '#4CAF50',
        },
      })),
    };
  }, [spots, isHidden]);

  // ✅ Handle spot press with proper ID matching
  const handlePress = useCallback(
    (e) => {
      if (!e?.features?.length) return;

      const feature = e.features[0];
      const spotId = feature.properties?.id || feature.id;

      const spot = spots.find(
        (s) => String(s.id) === String(spotId)
      );

      if (spot && onSpotPress) {
        onSpotPress(spot);
      }
    },
    [spots, onSpotPress]
  );

  return (
    <MapLibreGL.ShapeSource
      id="parking-spots-source"
      shape={spotsGeoJson}
      onPress={handlePress}
    >
      {/* Outer white border circle */}
      <MapLibreGL.CircleLayer
        id="parking-spots-border"
        style={{
          circleRadius: 14,
          circleColor: '#FFFFFF',
          circleOpacity: isHidden ? 0 : 1,
        }}
      />

      {/* Main colored circle */}
      <MapLibreGL.CircleLayer
        id="parking-spots-fill"
        style={{
          circleRadius: 11,
          circleColor: ['get', 'color'],
          circleOpacity: isHidden ? 0 : 1,
          circleStrokeWidth: 2,
          circleStrokeColor: '#FFFFFF',
        }}
      />

      {/* Inner dot for available spots */}
      <MapLibreGL.CircleLayer
        id="parking-spots-inner"
        filter={['==', ['get', 'isOccupied'], false]}
        style={{
          circleRadius: 4,
          circleColor: '#FFFFFF',
          circleOpacity: isHidden ? 0 : 0.8,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

// ═══════════════════════════════════════════════════════════════
// DESTINATION LAYER
// Green marker showing navigation destination
// ═══════════════════════════════════════════════════════════════
const DestinationLayer = React.memo(({ coordinate }) => {
  const destGeoJson = useMemo(() => {
    if (!coordinate?.latitude || !coordinate?.longitude) {
      return EMPTY_GEOJSON;
    }

    if (!validLL(coordinate.latitude, coordinate.longitude)) {
      return EMPTY_GEOJSON;
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [coordinate.longitude, coordinate.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [coordinate]);

  const isVisible = !!(
    coordinate?.latitude &&
    coordinate?.longitude &&
    validLL(coordinate.latitude, coordinate.longitude)
  );

  return (
    <MapLibreGL.ShapeSource id="destination-source" shape={destGeoJson}>
      {/* Outer pulse ring */}
      <MapLibreGL.CircleLayer
        id="destination-pulse"
        style={{
          circleRadius: 22,
          circleColor: 'rgba(76, 175, 80, 0.2)',
          circleStrokeWidth: 2,
          circleStrokeColor: 'rgba(76, 175, 80, 0.5)',
          circleOpacity: isVisible ? 1 : 0,
        }}
      />

      {/* Main destination circle */}
      <MapLibreGL.CircleLayer
        id="destination-main"
        style={{
          circleRadius: 14,
          circleColor: '#4CAF50',
          circleStrokeWidth: 3,
          circleStrokeColor: '#FFFFFF',
          circleOpacity: isVisible ? 1 : 0,
        }}
      />

      {/* Inner white dot */}
      <MapLibreGL.CircleLayer
        id="destination-inner"
        style={{
          circleRadius: 5,
          circleColor: '#FFFFFF',
          circleOpacity: isVisible ? 1 : 0,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

// ═══════════════════════════════════════════════════════════════
// SEARCH MARKER LAYER
// Pink marker showing search result location
// ═══════════════════════════════════════════════════════════════
const SearchMarkerLayer = React.memo(({ coordinate, isVisible }) => {
  const searchGeoJson = useMemo(() => {
    if (!coordinate?.latitude || !coordinate?.longitude) {
      return EMPTY_GEOJSON;
    }

    if (!validLL(coordinate.latitude, coordinate.longitude)) {
      return EMPTY_GEOJSON;
    }

    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [coordinate.longitude, coordinate.latitude],
          },
          properties: {},
        },
      ],
    };
  }, [coordinate]);

  const show = !!(
    isVisible &&
    coordinate?.latitude &&
    coordinate?.longitude &&
    validLL(coordinate.latitude, coordinate.longitude)
  );

  return (
    <MapLibreGL.ShapeSource id="search-marker-source" shape={searchGeoJson}>
      {/* Outer ring */}
      <MapLibreGL.CircleLayer
        id="search-marker-outer"
        style={{
          circleRadius: 18,
          circleColor: 'rgba(233, 30, 99, 0.15)',
          circleStrokeWidth: 2,
          circleStrokeColor: 'rgba(233, 30, 99, 0.5)',
          circleOpacity: show ? 1 : 0,
        }}
      />

      {/* Main circle */}
      <MapLibreGL.CircleLayer
        id="search-marker-main"
        style={{
          circleRadius: 10,
          circleColor: '#E91E63',
          circleStrokeWidth: 3,
          circleStrokeColor: '#FFFFFF',
          circleOpacity: show ? 1 : 0,
        }}
      />

      {/* Inner dot */}
      <MapLibreGL.CircleLayer
        id="search-marker-inner"
        style={{
          circleRadius: 3,
          circleColor: '#FFFFFF',
          circleOpacity: show ? 1 : 0,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

// ═══════════════════════════════════════════════════════════════
// USER LOCATION LAYER
// Blue dot showing user's current position
// ═══════════════════════════════════════════════════════════════
const UserLocationLayer = React.memo(
  ({ coordinate, snappedCoordinate, isNavigating, accuracy }) => {
    // ✅ Use snapped coordinate during navigation, raw otherwise
    const displayCoordinate = useMemo(() => {
      if (isNavigating && snappedCoordinate && snappedCoordinate.length === 2) {
        return snappedCoordinate;
      }
      if (coordinate && coordinate.length === 2) {
        return coordinate;
      }
      return [DEFAULT_LOC.longitude, DEFAULT_LOC.latitude];
    }, [coordinate, snappedCoordinate, isNavigating]);

    const userPointFeature = useMemo(
      () => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: displayCoordinate,
        },
        properties: {},
      }),
      [displayCoordinate]
    );

    // ✅ Calculate accuracy circle radius
    const accuracyRadius = useMemo(() => {
      if (!isNavigating || !accuracy || accuracy <= 0) return 0;
      // Scale accuracy to reasonable visual size
      return Math.min(Math.max(accuracy / 2, 8), 40);
    }, [isNavigating, accuracy]);

    return (
      <MapLibreGL.ShapeSource id="user-location-source" shape={userPointFeature}>
        {/* Accuracy circle (only during navigation) */}
        <MapLibreGL.CircleLayer
          id="user-accuracy-layer"
          style={{
            circleRadius: accuracyRadius,
            circleColor: 'rgba(25, 118, 210, 0.12)',
            circleStrokeColor: 'rgba(25, 118, 210, 0.3)',
            circleStrokeWidth: 1,
            circleOpacity: accuracyRadius > 0 ? 1 : 0,
          }}
        />

        {/* Outer glow */}
        <MapLibreGL.CircleLayer
          id="user-outer-layer"
          style={{
            circleRadius: isNavigating ? 20 : 16,
            circleColor: 'rgba(25, 118, 210, 0.25)',
          }}
        />

        {/* Main blue dot */}
        <MapLibreGL.CircleLayer
          id="user-inner-layer"
          style={{
            circleRadius: isNavigating ? 10 : 8,
            circleColor: '#1976D2',
            circleStrokeColor: '#FFFFFF',
            circleStrokeWidth: 3,
          }}
        />

        {/* Center white dot (during navigation) */}
        {isNavigating && (
          <MapLibreGL.CircleLayer
            id="user-center-layer"
            style={{
              circleRadius: 3,
              circleColor: '#FFFFFF',
            }}
          />
        )}
      </MapLibreGL.ShapeSource>
    );
  }
);

// ═══════════════════════════════════════════════════════════════
// NAVIGATION PANEL
// Shows current step, ETA, and navigation controls
// ═══════════════════════════════════════════════════════════════
const NavigationPanel = React.memo(
  ({
    currentStep,
    nextStep,
    distanceToNextStep,
    totalRemainingDistance,
    totalRemainingTime,
    progress,
    onClose,
    onRecenter,
    isRecentering,
    voiceEnabled,
    onToggleVoice,
  }) => {
    if (!currentStep) return null;

    return (
      <View style={S.navPanel}>
        {/* Progress bar */}
        <View style={S.navPanelProgressWrap}>
          <View
            style={[
              S.navPanelProgressFill,
              { width: `${Math.min(progress * 100, 100)}%` },
            ]}
          />
        </View>

        {/* Header with ETA and controls */}
        <View style={S.navPanelHeader}>
          <TouchableOpacity style={S.navPanelCloseBtn} onPress={onClose}>
            <Text style={S.navPanelCloseTxt}>✕</Text>
          </TouchableOpacity>

          <View style={S.navPanelStats}>
            <Text style={S.navPanelETA}>
              {formatDuration(totalRemainingTime)}
            </Text>
            <Text style={S.navPanelStatsDivider}>•</Text>
            <Text style={S.navPanelDist}>
              {formatDistance(totalRemainingDistance)}
            </Text>
          </View>

          <View style={S.navPanelControls}>
            <TouchableOpacity
              style={[
                S.navPanelSmBtn,
                !voiceEnabled && S.navPanelSmBtnInactive,
              ]}
              onPress={onToggleVoice}
            >
              <Text style={S.navPanelSmBtnIcon}>
                {voiceEnabled ? '🔊' : '🔇'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                S.navPanelSmBtn,
                isRecentering && S.navPanelSmBtnActive,
              ]}
              onPress={onRecenter}
            >
              <Text style={S.navPanelSmBtnIcon}>🎯</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Current step card */}
        <View style={S.navPanelCard}>
          <View style={S.navPanelIconBox}>
            <Text style={S.navPanelIcon}>{currentStep.icon}</Text>
          </View>

          <View style={S.navPanelCardContent}>
            <Text style={S.navPanelTurnDist}>
              {distanceToNextStep > 0
                ? formatDistanceNav(distanceToNextStep)
                : 'Now'}
            </Text>
            <Text style={S.navPanelInstruction} numberOfLines={2}>
              {currentStep.instruction}
            </Text>
          </View>
        </View>

        {/* Next step preview */}
        {nextStep && nextStep.maneuverType !== 'arrive' && (
          <View style={S.navPanelNext}>
            <Text style={S.navPanelNextLabel}>Then</Text>
            <View style={S.navPanelNextIconBox}>
              <Text style={S.navPanelNextIcon}>{nextStep.icon}</Text>
            </View>
            <Text style={S.navPanelNextText} numberOfLines={1}>
              {nextStep.instruction}
            </Text>
          </View>
        )}
      </View>
    );
  }
);

// ═══════════════════════════════════════════════════════════════
// NAVIGATION STEP ITEM
// Individual step in the steps list modal
// ═══════════════════════════════════════════════════════════════
const NavigationStepItem = React.memo(
  ({ step, index, currentStepIndex, distanceToNextStep, totalSteps }) => {
    const isCurrent = index === currentStepIndex;
    const isPast = index < currentStepIndex;

    return (
      <View
        style={[
          S.navStep,
          isCurrent && S.navStepCurrent,
          isPast && S.navStepPast,
        ]}
      >
        {/* Left side with icon and connector */}
        <View style={S.navStepLeft}>
          <View
            style={[
              S.navIconBox,
              step.maneuverType === 'arrive' && S.navIconBoxArrive,
              isCurrent && S.navIconBoxCurrent,
              isPast && S.navIconBoxPast,
            ]}
          >
            <Text style={S.navIconText}>{step.icon}</Text>
          </View>

          {index < totalSteps - 1 && (
            <View
              style={[
                S.navConnector,
                isPast && S.navConnectorPast,
              ]}
            />
          )}
        </View>

        {/* Right side with step details */}
        <View
          style={[
            S.navStepRight,
            isCurrent && S.navStepRightCurrent,
          ]}
        >
          <View style={S.navStepHeader}>
            <Text style={[S.navStepNum, isPast && S.navStepTxtPast]}>
              Step {step.stepNumber}
            </Text>
            <Text style={[S.navStepDist, isPast && S.navStepTxtPast]}>
              {formatDistance(step.distance)}
            </Text>
          </View>

          <Text
            style={[S.navStepInstr, isPast && S.navStepTxtPast]}
            numberOfLines={2}
          >
            {step.instruction}
          </Text>

          {step.name ? (
            <Text
              style={[S.navStepName, isPast && S.navStepTxtPast]}
              numberOfLines={1}
            >
              📍 {step.name}
            </Text>
          ) : null}

          <Text style={[S.navStepTime, isPast && S.navStepTxtPast]}>
            ⏱️ ~{formatDuration(step.duration)}
          </Text>

          {isCurrent && distanceToNextStep > 0 && (
            <View style={S.navStepBadge}>
              <Text style={S.navStepBadgeTxt}>
                📍 In {formatDistanceNav(distanceToNextStep)}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }
);

// ═══════════════════════════════════════════════════════════════
// ERROR BOUNDARY
// Catches and handles map rendering errors
// ═══════════════════════════════════════════════════════════════
class MapErrorBoundary extends React.Component {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    Logger.error('BOUNDARY', 'Map crash caught', error);
    // TODO: Send to crash reporting service (Sentry, Crashlytics, etc.)
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={S.errorBoundary}>
          <Text style={S.errorIcon}>🗺️</Text>
          <Text style={S.errorTitle}>Something went wrong</Text>
          <Text style={S.errorMessage}>
            The map encountered an error. Please try again.
          </Text>
          <TouchableOpacity style={S.errorBtn} onPress={this.handleRetry}>
            <Text style={S.errorBtnText}>Retry</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }

    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════
// LOCATION PERMISSION HELPER
// Handles location permission requests for Android & iOS
// ═══════════════════════════════════════════════════════════════
const LocationPermission = {
  async request() {
    if (Platform.OS === 'android') {
      try {
        const fineLocationGranted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          {
            title: 'Location Permission',
            message: 'ParkIt needs location access to show your position and provide navigation.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          }
        );

        if (fineLocationGranted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert(
            'Permission Required',
            'Location permission is needed for navigation features.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return false;
        }

        // Request background location for Android 10+ (optional, for future features)
        if (Platform.Version >= 29) {
          try {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
              {
                title: 'Background Location',
                message: 'Allow background location for continuous navigation.',
                buttonPositive: 'Allow',
                buttonNegative: 'Deny',
              }
            );
          } catch (e) {
            // Background location is optional, don't fail if denied
            Logger.warn('PERM', 'Background location denied', e);
          }
        }

        return true;
      } catch (e) {
        Logger.error('PERM', 'Permission request failed', e);
        return false;
      }
    }

    // iOS handles permissions automatically via Info.plist
    return true;
  },
};

// ═══════════════════════════════════════════════════════════════
// MAIN SCREEN COMPONENT
// ═══════════════════════════════════════════════════════════════
function ParkingMapScreenInner({ navigation }) {
  const insets = useSafeAreaInsets();

  // ═══════════════════════════════════════════════════════════
  // REFS
  // ═══════════════════════════════════════════════════════════
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  // Location tracking refs
  const locationWatchId = useRef(null);
  const passiveWatchId = useRef(null);
  const navIntervalRef = useRef(null);

  // State tracking refs (to avoid stale closures)
  const isMountedRef = useRef(true);
  const isNavigatingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const followUserRef = useRef(true);

  // Route data refs
  const totalDistanceRef = useRef(0);
  const totalDurationRef = useRef(0);
  const routeCoordinatesRef = useRef(null);
  const hasActiveRouteRef = useRef(false);

  // Location refs
  const lastLocationRef = useRef(null);
  const lastCameraUpdateRef = useRef(0);
  const lastMarkerUpdateRef = useRef(0);
  const lastRouteUpdateRef = useRef(0);
  const snappedUserCoordRef = useRef(null);
  const gpsSpeedRef = useRef(0);

  // Rerouting refs
  const reroutingRef = useRef(false);
  const rerouteCountRef = useRef(0);
  const lastRerouteTimeRef = useRef(0);

  // Spots refresh refs
  const nearbyRefreshTimerRef = useRef(null);
  const lastNearbyFetchLocRef = useRef(null);

  // ═══════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════

  // Loading states
  const [loading, setLoading] = useState(true);
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [spotsLoading, setSpotsLoading] = useState(false);

  // User location
  const [userLoc, setUserLoc] = useState(DEFAULT_LOC);
  const [userMarkerCoord, setUserMarkerCoord] = useState([
    DEFAULT_LOC.longitude,
    DEFAULT_LOC.latitude,
  ]);
  const [snappedUserCoord, setSnappedUserCoord] = useState(null);
  const [userHeading, setUserHeading] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(0);
  const [locationSource, setLocationSource] = useState('waiting');

  // Parking spots
  const [mySpot, setMySpot] = useState(null);
  const [allSpots, setAllSpots] = useState([]);
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [showModal, setShowModal] = useState(false);

  // Route & Navigation
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

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMarker, setSearchMarker] = useState(null);

  // Map
  const [zoomLevel, setZoomLevel] = useState(14);

  // ═══════════════════════════════════════════════════════════
  // SYNC REFS WITH STATE
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    routeCoordinatesRef.current = routeCoordinates;
  }, [routeCoordinates]);

  // ═══════════════════════════════════════════════════════════
  // GET CURRENT LOCATION
  // ═══════════════════════════════════════════════════════════
  const getLoc = useCallback(async () => {
    setGettingLoc(true);

    try {
      const hasPermission = await LocationPermission.request();
      if (!hasPermission) {
        Logger.warn('LOC', 'Permission denied, using default location');
        return { ...DEFAULT_LOC, source: 'Default' };
      }

      // Try high accuracy GPS first
      try {
        const position = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('GPS Timeout')), 10000);

          Geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(timeout);
              resolve(pos);
            },
            (err) => {
              clearTimeout(timeout);
              reject(err);
            },
            {
              enableHighAccuracy: true,
              timeout: 10000,
              maximumAge: 5000,
            }
          );
        });

        if (validLL(position.coords.latitude, position.coords.longitude)) {
          const accuracy = position.coords.accuracy || 0;
          setLocationSource(`GPS ±${accuracy.toFixed(0)}m`);

          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            source: 'GPS',
          };
        }
      } catch (gpsError) {
        Logger.warn('LOC', 'High accuracy GPS failed, trying network', gpsError);
      }

      // Fallback to network/low accuracy
      try {
        const position = await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Network Timeout')), 8000);

          Geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(timeout);
              resolve(pos);
            },
            (err) => {
              clearTimeout(timeout);
              reject(err);
            },
            {
              enableHighAccuracy: false,
              timeout: 8000,
              maximumAge: 30000,
            }
          );
        });

        if (validLL(position.coords.latitude, position.coords.longitude)) {
          const accuracy = position.coords.accuracy || 0;
          setLocationSource(`Network ±${accuracy.toFixed(0)}m`);

          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: accuracy,
            source: 'Network',
          };
        }
      } catch (networkError) {
        Logger.warn('LOC', 'Network location also failed', networkError);
      }

      // Final fallback to default
      Logger.warn('LOC', 'All location methods failed, using default');
      setLocationSource('Default');
      return { ...DEFAULT_LOC, source: 'Default' };

    } finally {
      setGettingLoc(false);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // UPDATE MARKER POSITION
  // Handles snapping to route during navigation
  // ═══════════════════════════════════════════════════════════
  const updateMarkerPosition = useCallback((lat, lng, forceRaw = false) => {
    if (!isMountedRef.current) return;
    if (!validLL(lat, lng)) return;

    const now = Date.now();
    const minInterval = isNavigatingRef.current ? 150 : 100;

    if (now - lastMarkerUpdateRef.current < minInterval) return;
    lastMarkerUpdateRef.current = now;

    // During navigation, try to snap to route
    if (isNavigatingRef.current && routeCoordinatesRef.current && !forceRaw) {
      const snapped = snapToRoute(
        { latitude: lat, longitude: lng },
        routeCoordinatesRef.current,
        NAV_CONFIG.SNAP_TO_ROUTE_THRESHOLD
      );

      if (snapped && snapped.coordinate) {
        snappedUserCoordRef.current = snapped.coordinate;
        setSnappedUserCoord(snapped.coordinate);
        setUserMarkerCoord(snapped.coordinate);
        return;
      }
    }

    // Use raw coordinates
    setUserMarkerCoord([lng, lat]);
    snappedUserCoordRef.current = null;
    setSnappedUserCoord(null);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // CAMERA CONTROLS
  // ═══════════════════════════════════════════════════════════
  const flyTo = useCallback((lat, lng, zoom = 16, force = false) => {
    if (!cameraRef.current) return;
    if (!validLL(lat, lng)) return;

    const now = Date.now();
    if (!force && now - lastCameraUpdateRef.current < 500) return;

    const safeZoom = Math.min(Math.max(zoom, 5), 18);

    try {
      cameraRef.current.setCamera({
        centerCoordinate: [lng, lat],
        zoomLevel: safeZoom,
        animationDuration: 600,
        animationMode: 'flyTo',
      });

      lastCameraUpdateRef.current = Date.now();
      setZoomLevel(safeZoom);
    } catch (e) {
      Logger.error('CAMERA', 'flyTo failed', e);
    }
  }, []);

  const fitBounds = useCallback((coords, padding = [100, 100, 100, 100]) => {
    if (!coords || coords.length < 2 || !cameraRef.current) return;

    try {
      const validCoords = coords.filter(c => c && c.length >= 2);
      if (validCoords.length < 2) return;

      const lngs = validCoords.map((c) => c[0]);
      const lats = validCoords.map((c) => c[1]);

      cameraRef.current.fitBounds(
        [Math.max(...lngs), Math.max(...lats)],
        [Math.min(...lngs), Math.min(...lats)],
        padding,
        1000
      );
    } catch (e) {
      Logger.error('CAMERA', 'fitBounds failed', e);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // WATCH CLEANUP HELPERS
  // ═══════════════════════════════════════════════════════════
  const clearNavigationWatch = useCallback(() => {
    if (locationWatchId.current !== null) {
      try {
        Geolocation.clearWatch(locationWatchId.current);
      } catch (e) {
        // Ignore cleanup errors
      }
      locationWatchId.current = null;
    }

    if (navIntervalRef.current) {
      try {
        clearInterval(navIntervalRef.current);
      } catch (e) {
        // Ignore cleanup errors
      }
      navIntervalRef.current = null;
    }
  }, []);

  const clearPassiveWatch = useCallback(() => {
    if (passiveWatchId.current !== null) {
      try {
        Geolocation.clearWatch(passiveWatchId.current);
      } catch (e) {
        // Ignore cleanup errors
      }
      passiveWatchId.current = null;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // PASSIVE LOCATION TRACKING (when not navigating)
  // ═══════════════════════════════════════════════════════════
  const startPassiveTracking = useCallback(() => {
    if (!isMountedRef.current) return;
    if (isNavigatingRef.current) return;

    clearPassiveWatch();

    try {
      passiveWatchId.current = Geolocation.watchPosition(
        (position) => {
          if (!isMountedRef.current) return;
          if (isNavigatingRef.current) return;

          const { latitude, longitude, accuracy, heading, speed } = position.coords;

          if (!validLL(latitude, longitude)) return;
          if (accuracy > 200) return;

          const newLoc = { latitude, longitude };

          // Skip if hasn't moved much
          if (lastLocationRef.current) {
            const moved = calcDistance(
              lastLocationRef.current.latitude,
              lastLocationRef.current.longitude,
              latitude,
              longitude
            );
            if (moved < 3) return;
          }

          // Update location source indicator
          if (accuracy <= 50) {
            setLocationSource(`GPS ±${accuracy.toFixed(0)}m`);
          } else if (accuracy <= 100) {
            setLocationSource(`Network ±${accuracy.toFixed(0)}m`);
          } else {
            setLocationSource(`Low ±${accuracy.toFixed(0)}m`);
          }

          lastLocationRef.current = newLoc;
          setUserLoc(newLoc);
          updateMarkerPosition(latitude, longitude, true);
          setLocationAccuracy(accuracy || 0);

          if (heading !== null && !isNaN(heading) && heading >= 0) {
            setUserHeading(heading);
          }

          if (speed !== null && !isNaN(speed) && speed >= 0) {
            gpsSpeedRef.current = speed;
          }
        },
        (error) => {
          Logger.warn('LOC', 'Passive watch error', error);
        },
        LOCATION_TRACKING_CONFIG.PASSIVE
      );

      Logger.info('LOC', '📍 Passive tracking started');
    } catch (e) {
      Logger.error('LOC', 'Failed to start passive tracking', e);
    }
  }, [clearPassiveWatch, updateMarkerPosition]);

  // ═══════════════════════════════════════════════════════════
  // LOAD PARKING SPOTS
  // ═══════════════════════════════════════════════════════════
  const loadSpots = useCallback(async (location, forceRefresh = false) => {
    if (!location) return;
    if (!validLL(location.latitude, location.longitude)) return;

    setSpotsLoading(true);

    try {
      // Get user's saved spot
      const savedSpot = await ParkingService.getMySpot();
      setMySpot(savedSpot);

      // Check if we need to fetch new spots
      let shouldFetch = forceRefresh;

      if (!shouldFetch && lastNearbyFetchLocRef.current) {
        const distMoved = calcDistance(
          location.latitude,
          location.longitude,
          lastNearbyFetchLocRef.current.latitude,
          lastNearbyFetchLocRef.current.longitude
        );
        shouldFetch = distMoved > NEARBY_CONFIG.MIN_MOVE_TO_REFRESH;
      } else {
        shouldFetch = true;
      }

      let nearbySpots = [];

      if (shouldFetch) {
        try {
          nearbySpots = await ParkingService.fetchNearbySpots(
            location.latitude,
            location.longitude,
            NEARBY_CONFIG.RADIUS
          );
          lastNearbyFetchLocRef.current = { ...location };
          Logger.success('SPOTS', `Loaded ${nearbySpots.length} nearby spots`);
        } catch (e) {
          Logger.error('SPOTS', 'Fetch failed', e);
          nearbySpots = [];
        }
      } else {
        // Reuse existing spots (excluding my spot)
        nearbySpots = allSpots.filter((s) => !s.isMySpot);
      }

      // Combine spots
      let combined = [...nearbySpots];

      // Add user's spot if occupied
      if (savedSpot && savedSpot.isOccupied) {
        // Remove duplicates near user's spot
        combined = combined.filter((s) => {
          const dist = calcDistance(
            s.latitude,
            s.longitude,
            savedSpot.latitude,
            savedSpot.longitude
          );
          return dist > 5;
        });

        combined.push({ ...savedSpot, isMySpot: true });
      }

      // Add distance to each spot
      combined = combined.map((s) => ({
        ...s,
        distance: calcDistance(
          location.latitude,
          location.longitude,
          s.latitude,
          s.longitude
        ),
      }));

      // Sort by distance
      combined.sort((a, b) => a.distance - b.distance);

      setAllSpots(combined);
      Logger.success('SPOTS', `Total ${combined.length} spots available`);

    } catch (e) {
      Logger.error('SPOTS', 'Load spots failed', e);
    } finally {
      setSpotsLoading(false);
    }
  }, [allSpots]);

  const refreshNearbySpots = useCallback(async () => {
    const location = lastLocationRef.current || userLoc;
    await loadSpots(location, true);
  }, [loadSpots, userLoc]);

  // ═══════════════════════════════════════════════════════════
  // RESET NAVIGATION STATE
  // Synchronous reset of all navigation-related state
  // ═══════════════════════════════════════════════════════════
  const resetNavigationState = useCallback(() => {
    // ✅ Reset refs
    routeCoordinatesRef.current = null;
    snappedUserCoordRef.current = null;
    hasActiveRouteRef.current = false;
    rerouteCountRef.current = 0;

    // ✅ Reset state
    setRouteCoordinates(null);
    setDestination(null);
    setSnappedUserCoord(null);
    setNavigationSteps([]);
    setRouteInfo(null);
    setCurrentStepIndex(0);
    setDistanceToNextStep(0);
    setNavigationProgress(0);
    setRemainingDistance(0);
    setRemainingDuration(0);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // HANDLE ARRIVAL
  // ═══════════════════════════════════════════════════════════
  const handleArrival = useCallback(async () => {
    // ✅ Guard against multiple calls
    if (!isMountedRef.current) return;
    if (!isNavigatingRef.current) return;
    if (isStoppingRef.current) return;

    Logger.success('NAV', '🎉 Handling arrival...');

    // ✅ Set flags immediately
    isNavigatingRef.current = false;
    isStoppingRef.current = true;

    try {
      // Stop location tracking
      clearNavigationWatch();

      // Announce arrival
      VoiceGuidance.announceArrival();

      // Reset camera tilt
      try {
        cameraRef.current?.setCamera({
          pitch: 0,
          animationDuration: 300,
        });
      } catch (e) {
        // Ignore camera errors
      }

      if (isMountedRef.current) {
        setIsNavigating(false);
        setFollowUser(false);
        setNavigationProgress(1);

        // Show arrival alert
        Alert.alert(
          '🎉 You Have Arrived!',
          'You have reached your destination.',
          [
            {
              text: 'OK',
              onPress: () => {
                if (!isMountedRef.current) return;

                // ✅ Synchronous cleanup
                cleanupNavigation();
                resetNavigationState();

                // Restart passive tracking after short delay
                setTimeout(() => {
                  if (isMountedRef.current && !isNavigatingRef.current) {
                    startPassiveTracking();
                    if (lastLocationRef.current) {
                      loadSpots(lastLocationRef.current, true);
                    }
                  }
                }, 300);
              },
            },
          ]
        );
      }

    } catch (e) {
      Logger.error('NAV', 'Arrival handling error', e);
    } finally {
      isStoppingRef.current = false;
    }
  }, [clearNavigationWatch, resetNavigationState, startPassiveTracking, loadSpots]);

  // ═══════════════════════════════════════════════════════════
  // STOP NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const stopNavigation = useCallback(async () => {
    Logger.nav('⏹️ Stopping navigation...');

    // ✅ Guard against multiple calls
    if (!isMountedRef.current) return;
    if (isStoppingRef.current) return;

    // ✅ Set flags immediately
    isStoppingRef.current = true;
    isNavigatingRef.current = false;
    followUserRef.current = false;

    try {
      // Stop location tracking
      clearNavigationWatch();

      // ✅ Synchronous cleanup (no delays!)
      cleanupNavigation();

      // Reset camera tilt
      try {
        cameraRef.current?.setCamera({
          pitch: 0,
          animationDuration: 300,
        });
      } catch (e) {
        // Ignore camera errors
      }

      if (isMountedRef.current) {
        // ✅ Reset all state synchronously
        setIsNavigating(false);
        setFollowUser(false);
        resetNavigationState();
      }

      Logger.success('NAV', '⏹️ Navigation stopped');

      // Restart passive tracking after short delay
      setTimeout(() => {
        if (isMountedRef.current && !isNavigatingRef.current) {
          startPassiveTracking();
          if (lastLocationRef.current) {
            loadSpots(lastLocationRef.current, true);
          }
        }
      }, 300);

    } catch (e) {
      Logger.error('NAV', 'Stop navigation error', e);
    } finally {
      isStoppingRef.current = false;
    }
  }, [clearNavigationWatch, resetNavigationState, startPassiveTracking, loadSpots]);

  // ═══════════════════════════════════════════════════════════
  // REROUTE
  // ═══════════════════════════════════════════════════════════
  const reroute = useCallback(async (currentLoc) => {
    const dest = destination;

    if (!dest) return;
    if (reroutingRef.current) return;
    if (!isNavigatingRef.current) return;

    const now = Date.now();
    if (now - lastRerouteTimeRef.current < NAV_CONFIG.REROUTE_COOLDOWN) return;
    if (rerouteCountRef.current >= NAV_CONFIG.MAX_REROUTES) {
      Logger.warn('NAV', 'Max reroutes reached');
      return;
    }

    reroutingRef.current = true;
    lastRerouteTimeRef.current = now;
    rerouteCountRef.current++;

    Logger.nav(`🔄 Rerouting (attempt ${rerouteCountRef.current})...`);

    VoiceGuidance.announceRerouting();

    try {
      // Invalidate cache for this route
      RouteCache.invalidate(
        currentLoc.latitude,
        currentLoc.longitude,
        dest.latitude,
        dest.longitude
      );

      const routeData = await RoutingService.fetchRoute(
        currentLoc.latitude,
        currentLoc.longitude,
        dest.latitude,
        dest.longitude
      );

      if (!isNavigatingRef.current || !isMountedRef.current) return;

      const route = routeData.routes[0];
      const coords = route.geometry.coordinates;
      const steps = route.steps || [];

      // Update route manager
      routeLineManager.setFullRoute(coords, dest);
      stepTracker.setSteps(steps);

      // Update refs
      totalDistanceRef.current = route.distance;
      totalDurationRef.current = route.duration;
      routeCoordinatesRef.current = coords;

      // Update state
      setRouteCoordinates(coords);
      setNavigationSteps(steps);
      setRouteInfo({
        totalDistance: route.distance,
        totalDuration: route.duration,
        stepsCount: steps.length,
      });
      setRemainingDistance(route.distance);
      setRemainingDuration(route.duration);
      setCurrentStepIndex(0);
      setNavigationProgress(0);

      Logger.success('NAV', '✅ Rerouted successfully');

    } catch (e) {
      Logger.error('NAV', 'Reroute failed', e);
    } finally {
      reroutingRef.current = false;
    }
  }, [destination]);

  // ═══════════════════════════════════════════════════════════
  // UPDATE ROUTE VISUAL
  // Called on each location update during navigation
  // ═══════════════════════════════════════════════════════════
  const updateRouteVisual = useCallback((currentLoc) => {
    // ✅ Guard checks
    if (!isMountedRef.current) return;
    if (!currentLoc) return;
    if (isStoppingRef.current) return;
    if (!isNavigatingRef.current) return;

    const now = Date.now();
    if (now - lastRouteUpdateRef.current < 300) return;
    lastRouteUpdateRef.current = now;

    // ✅ Check for arrival
    try {
      if (routeLineManager.hasArrived(currentLoc)) {
        // Handle arrival in next tick to avoid state update during render
        setTimeout(() => {
          if (isMountedRef.current && !isStoppingRef.current) {
            handleArrival();
          }
        }, 100);
        return;
      }
    } catch (e) {
      Logger.error('NAV', 'hasArrived check failed', e);
    }

    // ✅ Update visible route
    try {
      const visibleRoute = routeLineManager.getVisibleRoute(currentLoc);

      if (visibleRoute && visibleRoute.changed) {
        if (isMountedRef.current && !isStoppingRef.current) {
          routeCoordinatesRef.current = visibleRoute.coordinates;
          setRouteCoordinates(visibleRoute.coordinates);
          setRemainingDistance(visibleRoute.remainingDistance);
          setNavigationProgress(visibleRoute.progress);

          const remainingTime = estimateRemainingTime(
            visibleRoute.remainingDistance,
            totalDistanceRef.current,
            totalDurationRef.current,
            gpsSpeedRef.current
          );

          setRemainingDuration(remainingTime);

          setRouteInfo((prev) =>
            prev
              ? {
                  ...prev,
                  remainingDistance: visibleRoute.remainingDistance,
                  remainingDuration: remainingTime,
                }
              : prev
          );
        }
      }
    } catch (e) {
      Logger.error('NAV', 'getVisibleRoute failed', e);
    }

    // ✅ Check for off-route (needs rerouting)
    if (isNavigatingRef.current && !isStoppingRef.current) {
      try {
        if (routeLineManager.isOffRoute(currentLoc)) {
          reroute(currentLoc);
          return;
        }
      } catch (e) {
        Logger.error('NAV', 'isOffRoute check failed', e);
      }

      // ✅ Update step tracker
      try {
        const stepResult = stepTracker.update(currentLoc);

        if (stepResult.changed && isMountedRef.current) {
          setCurrentStepIndex(stepTracker.currentIndex);
        }

        if (isMountedRef.current) {
          setDistanceToNextStep(stepResult.distanceToStep);
        }
      } catch (e) {
        Logger.error('NAV', 'stepTracker update failed', e);
      }
    }
  }, [reroute, handleArrival]);

  // ═══════════════════════════════════════════════════════════
  // CHECK LOCATION ENABLED
  // ═══════════════════════════════════════════════════════════
  const checkLocationEnabled = useCallback(async () => {
    if (Platform.OS === 'android') {
      try {
        const isEnabled = await new Promise((resolve) => {
          Geolocation.getCurrentPosition(
            () => resolve(true),
            () => resolve(false),
            { timeout: 3000 }
          );
        });

        if (!isEnabled) {
          Alert.alert(
            '📍 Location Disabled',
            'Please enable location services to use navigation.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return false;
        }

        return true;
      } catch (e) {
        // Assume enabled if check fails
        return true;
      }
    }

    return true;
  }, []);

  // ═══════════════════════════════════════════════════════════
  // START LOCATION TRACKING (during navigation)
  // ═══════════════════════════════════════════════════════════
  const startLocationTracking = useCallback(() => {
    // Clear existing watches
    clearPassiveWatch();
    clearNavigationWatch();

    // Reset location processor
    locationProcessor.reset();

    let navUpdateCount = 0;
    let lastLogTime = 0;
    let lastLocationTime = Date.now();
    let watchWorking = false;

    // Process incoming location updates
    const processLocation = (latitude, longitude, accuracy, heading, speed, source) => {
      if (!isMountedRef.current) return;
      if (isStoppingRef.current) return;
      if (!validLL(latitude, longitude)) return;
      if (accuracy > 500) return;

      const now = Date.now();

      // Throttle updates
      if (now - lastLocationTime < 500 && navUpdateCount > 0) return;

      navUpdateCount++;
      lastLocationTime = now;
      watchWorking = true;

      const newLoc = { latitude, longitude };

      // Log periodically
      if (now - lastLogTime > 2000 || navUpdateCount <= 3) {
        Logger.loc(
          `🧭 #${navUpdateCount} [${source}]: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} ±${accuracy?.toFixed(0)}m`
        );
        lastLogTime = now;
      }

      // Update UI in next animation frame
      requestAnimationFrame(() => {
        if (!isMountedRef.current) return;
        if (isStoppingRef.current) return;

        lastLocationRef.current = newLoc;
        updateMarkerPosition(latitude, longitude, false);

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
      });
    };

    // Start watch position
    const startWatch = (name, config) => {
      try {
        locationWatchId.current = Geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy, heading, speed } = pos.coords;
            processLocation(latitude, longitude, accuracy || 50, heading, speed, `W-${name}`);
          },
          (error) => {
            Logger.warn('LOC', `Watch error [${name}]`, error);
            watchWorking = false;
          },
          config
        );
        return true;
      } catch (e) {
        Logger.error('LOC', `Failed to start watch [${name}]`, e);
        return false;
      }
    };

    // Start main watch
    startWatch('STD', {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: 2000,
      fastestInterval: 1000,
      timeout: 20000,
      maximumAge: 5000,
    });

    // Fallback location getter
    const doFallback = () => {
      if (!isMountedRef.current) return;
      if (!isNavigatingRef.current) return;
      if (isStoppingRef.current) return;

      // Try high accuracy first
      Geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy, heading, speed } = pos.coords;
          processLocation(latitude, longitude, accuracy || 50, heading, speed, 'FB-H');
        },
        () => {
          // Try low accuracy as last resort
          Geolocation.getCurrentPosition(
            (pos) => {
              const c = pos.coords;
              processLocation(c.latitude, c.longitude, c.accuracy || 100, c.heading, c.speed, 'FB-L');
            },
            () => {
              // Give up
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
          );
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
      );
    };

    // Initial fallback check after 3 seconds
    setTimeout(() => {
      if (!watchWorking && isMountedRef.current && isNavigatingRef.current) {
        Logger.warn('LOC', 'Watch not working, using fallback');
        doFallback();
      }
    }, 3000);

    // Periodic fallback check
    navIntervalRef.current = setInterval(() => {
      if (!isMountedRef.current) return;
      if (!isNavigatingRef.current) return;
      if (isStoppingRef.current) return;

      const timeSinceLastLocation = Date.now() - lastLocationTime;

      if (timeSinceLastLocation > 5000) {
        Logger.warn('LOC', `No location for ${(timeSinceLastLocation / 1000).toFixed(1)}s, using fallback`);
        doFallback();

        // If watch hasn't worked for 30 seconds, restart it
        if (timeSinceLastLocation > 30000 && !watchWorking) {
          Logger.warn('LOC', 'Restarting watch...');

          if (locationWatchId.current !== null) {
            try {
              Geolocation.clearWatch(locationWatchId.current);
            } catch (e) {
              // Ignore
            }
            locationWatchId.current = null;
          }

          startWatch('RETRY', {
            enableHighAccuracy: false,
            distanceFilter: 0,
            timeout: 30000,
            maximumAge: 10000,
          });
        }
      }
    }, 3000);

    Logger.info('LOC', '🧭 Navigation tracking started');

  }, [clearPassiveWatch, clearNavigationWatch, updateMarkerPosition, updateRouteVisual]);

  // ═══════════════════════════════════════════════════════════
  // START NAVIGATION
  // ═══════════════════════════════════════════════════════════
  const startNavigation = useCallback(async () => {
    // Check if location is enabled
    const locationEnabled = await checkLocationEnabled();
    if (!locationEnabled) return;

    // Initialize voice guidance
    await VoiceGuidance.init();

    // Set flags
    isNavigatingRef.current = true;
    followUserRef.current = true;
    hasActiveRouteRef.current = true;
    rerouteCountRef.current = 0;
    isStoppingRef.current = false;

    // Update state
    setIsNavigating(true);
    setFollowUser(true);
    setCurrentStepIndex(0);

    // Start location tracking
    startLocationTracking();

    // Set camera to navigation mode
    setTimeout(() => {
      if (!cameraRef.current) return;
      if (!lastLocationRef.current) return;
      if (!isNavigatingRef.current) return;

      try {
        cameraRef.current.setCamera({
          centerCoordinate: [
            lastLocationRef.current.longitude,
            lastLocationRef.current.latitude,
          ],
          zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM,
          pitch: NAV_CONFIG.NAVIGATION_TILT,
          animationDuration: 800,
        });
      } catch (e) {
        Logger.error('CAMERA', 'Failed to set navigation camera', e);
      }
    }, 300);

    Logger.success('NAV', '🧭 Navigation started');

  }, [checkLocationEnabled, startLocationTracking]);

  // ═══════════════════════════════════════════════════════════
  // RECENTER ON USER
  // ═══════════════════════════════════════════════════════════
  const recenterOnUser = useCallback(() => {
    followUserRef.current = true;
    setFollowUser(true);
    lastCameraUpdateRef.current = 0;

    if (!lastLocationRef.current) return;
    if (!cameraRef.current) return;

    try {
      const heading = routeLineManager.getNavigationBearing(lastLocationRef.current);

      cameraRef.current.setCamera({
        centerCoordinate: [
          lastLocationRef.current.longitude,
          lastLocationRef.current.latitude,
        ],
        zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM,
        heading: heading,
        pitch: isNavigatingRef.current ? NAV_CONFIG.NAVIGATION_TILT : 0,
        animationDuration: 600,
      });
    } catch (e) {
      Logger.error('CAMERA', 'Recenter failed', e);
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // TOGGLE VOICE
  // ═══════════════════════════════════════════════════════════
  const toggleVoice = useCallback(() => {
    const enabled = VoiceGuidance.toggle();
    setVoiceEnabled(enabled);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION
  // ═══════════════════════════════════════════════════════════
  useEffect(() => {
    isMountedRef.current = true;

    const initialize = async () => {
      try {
        // Initialize voice guidance
        await VoiceGuidance.init();

        // Get initial location
        const location = await getLoc();
        if (!isMountedRef.current) return;

        setUserLoc(location);
        lastLocationRef.current = location;
        updateMarkerPosition(location.latitude, location.longitude, true);

        // Load parking spots
        await loadSpots(location, true);

        setLoading(false);

        // Start passive tracking
        startPassiveTracking();

        // Set initial camera position
        setTimeout(() => {
          if (!cameraRef.current) return;
          if (!isMountedRef.current) return;

          try {
            cameraRef.current.setCamera({
              centerCoordinate: [location.longitude, location.latitude],
              zoomLevel: 15,
              animationDuration: 1000,
            });
          } catch (e) {
            // Ignore camera errors
          }
        }, 500);

      } catch (e) {
        Logger.error('INIT', 'Initialization failed', e);
        setLoading(false);
      }
    };

    initialize();

    // Setup periodic spots refresh
    nearbyRefreshTimerRef.current = setInterval(() => {
      if (isNavigatingRef.current) return;
      if (!lastLocationRef.current) return;
      if (!isMountedRef.current) return;

      loadSpots(lastLocationRef.current, true);
    }, NEARBY_CONFIG.AUTO_REFRESH_INTERVAL);

    // Handle app state changes
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextState === 'active';

      if (wasBackground && isNowActive) {
        Logger.info('APP', 'App came to foreground');

        if (isNavigatingRef.current && !isStoppingRef.current) {
          // Restart navigation tracking
          startLocationTracking();
        } else if (!isNavigatingRef.current) {
          // Restart passive tracking
          startPassiveTracking();
        }

        // Refresh spots
        if (lastLocationRef.current) {
          loadSpots(lastLocationRef.current, true);
        }
      }

      appStateRef.current = nextState;
    });

    // ✅ Cleanup on unmount
    return () => {
      Logger.cleanup('🧹 Component unmounting...');

      isMountedRef.current = false;
      isNavigatingRef.current = false;
      hasActiveRouteRef.current = false;

      // Clear all watches and intervals
      clearNavigationWatch();
      clearPassiveWatch();

      if (navIntervalRef.current) {
        clearInterval(navIntervalRef.current);
        navIntervalRef.current = null;
      }

      if (nearbyRefreshTimerRef.current) {
        clearInterval(nearbyRefreshTimerRef.current);
        nearbyRefreshTimerRef.current = null;
      }

      // Clear route cache
      RouteCache.clear();

      // Full synchronous cleanup
      cleanupNavigation();

      // Remove app state listener
      appStateSubscription.remove();

      Logger.cleanup('✅ Component cleanup complete');
    };
  }, []);

  // ═══════════════════════════════════════════════════════════
  // FETCH AND SHOW ROUTE
  // ═══════════════════════════════════════════════════════════
  const fetchAndShowRoute = useCallback(async (destLat, destLng, startNav = false) => {
    const currentLoc = lastLocationRef.current || userLoc;

    if (!validLL(destLat, destLng)) {
      Alert.alert('Error', 'Invalid destination coordinates');
      return;
    }

    setRouteLoading(true);

    try {
      const distance = calcDistance(
        currentLoc.latitude,
        currentLoc.longitude,
        destLat,
        destLng
      );

      // Handle very close destinations
      if (distance < 20) {
        setRouteLoading(false);

        Alert.alert(
          '📍 Very Close',
          `You are only ${distance.toFixed(0)}m away from the destination.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Walk There',
              onPress: () => {
                const straightLine = [
                  [currentLoc.longitude, currentLoc.latitude],
                  [destLng, destLat],
                ];
                const dest = { latitude: destLat, longitude: destLng };

                routeLineManager.setFullRoute(straightLine, dest);
                hasActiveRouteRef.current = true;
                totalDistanceRef.current = distance;
                totalDurationRef.current = distance / 1.4; // ~walking speed
                routeCoordinatesRef.current = straightLine;

                setRouteCoordinates(straightLine);
                setDestination(dest);
                setRemainingDistance(distance);
                setRemainingDuration(distance / 1.4);
                setRouteInfo({
                  totalDistance: distance,
                  totalDuration: distance / 1.4,
                  stepsCount: 0,
                });

                fitBounds(straightLine);
              },
            },
          ]
        );
        return;
      }

      // Fetch route from backend
      const routeData = await RoutingService.fetchRoute(
        currentLoc.latitude,
        currentLoc.longitude,
        destLat,
        destLng
      );

      const route = routeData.routes[0];
      const coords = route.geometry.coordinates;
      const steps = route.steps || [];
      const dest = { latitude: destLat, longitude: destLng };

      // Setup route manager
      routeLineManager.setFullRoute(coords, dest);
      stepTracker.setSteps(steps);
      hasActiveRouteRef.current = true;
      totalDistanceRef.current = route.distance;
      totalDurationRef.current = route.duration;
      routeCoordinatesRef.current = coords;

      // Update state
      setRouteCoordinates(coords);
      setDestination(dest);
      setNavigationSteps(steps);
      setRouteInfo({
        totalDistance: route.distance,
        totalDuration: route.duration,
        stepsCount: steps.length,
      });
      setRemainingDistance(route.distance);
      setRemainingDuration(route.duration);
      setCurrentStepIndex(0);
      setNavigationProgress(0);

      // Fit map to route
      fitBounds(coords);

      if (startNav) {
        // Start navigation after short delay
        setTimeout(() => startNavigation(), 500);
      } else {
        // Show route summary
        Alert.alert(
          '✅ Route Ready',
          `📏 ${formatDistance(route.distance)}\n⏱️ ${formatDuration(route.duration)}\n📝 ${steps.length} steps`,
          [
            { text: 'View Steps', onPress: () => setShowNavigation(true) },
            { text: 'Start Navigation', onPress: () => startNavigation() },
            { text: 'OK', style: 'cancel' },
          ]
        );
      }

    } catch (error) {
      Logger.error('ROUTE', 'fetchAndShowRoute failed', error);

      // Fallback to straight line
      const straightLine = [
        [currentLoc.longitude, currentLoc.latitude],
        [destLng, destLat],
      ];
      const distance = calcDistance(
        currentLoc.latitude,
        currentLoc.longitude,
        destLat,
        destLng
      );
      const dest = { latitude: destLat, longitude: destLng };

      routeLineManager.setFullRoute(straightLine, dest);
      hasActiveRouteRef.current = true;
      totalDistanceRef.current = distance;
      totalDurationRef.current = distance / 11.11; // ~40 km/h
      routeCoordinatesRef.current = straightLine;

      setRouteCoordinates(straightLine);
      setDestination(dest);
      fitBounds(straightLine);

      setRouteInfo({
        totalDistance: distance,
        totalDuration: distance / 11.11,
        stepsCount: 2,
      });
      setRemainingDistance(distance);
      setRemainingDuration(distance / 11.11);

      // Create fallback steps
      const fallbackSteps = [
        {
          id: `step_fb_1_${Date.now()}`,
          stepNumber: 1,
          icon: '🚀',
          instruction: 'Head towards destination',
          distance: distance,
          duration: distance / 11.11,
          maneuverType: 'depart',
          location: [currentLoc.longitude, currentLoc.latitude],
          name: '',
          modifier: '',
          coordinates: [],
        },
        {
          id: `step_fb_2_${Date.now()}`,
          stepNumber: 2,
          icon: '🎯',
          instruction: 'Arrive at destination',
          distance: 0,
          duration: 0,
          maneuverType: 'arrive',
          location: [destLng, destLat],
          name: '',
          modifier: '',
          coordinates: [],
        },
      ];

      stepTracker.setSteps(fallbackSteps);
      setNavigationSteps(fallbackSteps);

      Alert.alert(
        '⚠️ Route Error',
        `${error.message}\n\nShowing straight line to destination.`
      );

    } finally {
      setRouteLoading(false);
    }
  }, [userLoc, fitBounds, startNavigation]);

  // ═══════════════════════════════════════════════════════════
  // CLEAR ROUTE
  // ═══════════════════════════════════════════════════════════
  const clearRoute = useCallback(async () => {
    await stopNavigation();
  }, [stopNavigation]);

  // ═══════════════════════════════════════════════════════════
  // SPOT ACTIONS
  // ═══════════════════════════════════════════════════════════
  const handleOccupy = useCallback(async () => {
    const location = await getLoc();

    if (!location?.latitude || !validLL(location.latitude, location.longitude)) {
      Alert.alert('❌ Error', 'Could not get your current location');
      return;
    }

    Alert.alert(
      '🅿️ Occupy Parking Spot',
      `Save your parking location at:\n📍 ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            setGettingLoc(true);
            try {
              const spotData = await ParkingService.occupySpot(
                location.latitude,
                location.longitude
              );

              setMySpot(spotData);
              setUserLoc(location);
              lastLocationRef.current = location;
              updateMarkerPosition(location.latitude, location.longitude, true);

              await loadSpots(location, true);
              flyTo(location.latitude, location.longitude, 17, true);

              Alert.alert('✅ Success', 'Parking spot saved!');

            } catch (e) {
              Alert.alert('❌ Failed', e.message || 'Could not save parking spot');
            } finally {
              setGettingLoc(false);
            }
          },
        },
      ]
    );
  }, [getLoc, loadSpots, flyTo, updateMarkerPosition]);

  const handleVacate = useCallback(() => {
    if (!mySpot?.isOccupied) {
      Alert.alert('ℹ️ Info', 'You don\'t have an active parking spot');
      return;
    }

    Alert.alert(
      '🚗 Vacate Parking Spot',
      `Release your spot at:\n📍 ${mySpot.latitude.toFixed(6)}, ${mySpot.longitude.toFixed(6)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Vacate',
          style: 'destructive',
          onPress: async () => {
            setGettingLoc(true);
            try {
              const vacatedSpot = await ParkingService.vacateSpot(
                mySpot.latitude,
                mySpot.longitude
              );

              setMySpot(vacatedSpot);
              await loadSpots(userLoc, true);

              Alert.alert('✅ Success', 'Parking spot released!');

            } catch (e) {
              Alert.alert('❌ Failed', e.message || 'Could not release parking spot');
            } finally {
              setGettingLoc(false);
            }
          },
        },
      ]
    );
  }, [mySpot, loadSpots, userLoc]);

  const handleSpotPress = useCallback((spot) => {
    setSelectedSpot(spot);
    setShowModal(true);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // MODAL ACTIONS
  // ═══════════════════════════════════════════════════════════
  const onLocate = useCallback(async () => {
    const location = await getLoc();
    if (!location) return;

    setUserLoc(location);
    lastLocationRef.current = location;
    updateMarkerPosition(location.latitude, location.longitude, true);

    await loadSpots(location, true);
    flyTo(location.latitude, location.longitude, 16, true);
  }, [getLoc, loadSpots, flyTo, updateMarkerPosition]);

  const onShowRoute = useCallback((spot) => {
    setShowModal(false);
    fetchAndShowRoute(spot.latitude, spot.longitude, false);
  }, [fetchAndShowRoute]);

  const onStartNavigation = useCallback((spot) => {
    setShowModal(false);
    setShowNavigation(false);
    fetchAndShowRoute(spot.latitude, spot.longitude, true);
  }, [fetchAndShowRoute]);

  const onShowSteps = useCallback((spot) => {
    setShowModal(false);
    setShowNavigation(true);

    if (!routeCoordinates) {
      fetchAndShowRoute(spot.latitude, spot.longitude, false);
    }
  }, [fetchAndShowRoute, routeCoordinates]);

  const onNavigateExternal = useCallback((spot) => {
    const location = lastLocationRef.current || userLoc;
    const url = `https://www.google.com/maps/dir/?api=1&origin=${location.latitude},${location.longitude}&destination=${spot.latitude},${spot.longitude}&travelmode=driving`;
    Linking.openURL(url);
  }, [userLoc]);

  const onFindParking = useCallback(() => {
    const availableSpot = allSpots.find((s) => !s.isOccupied && !s.isMySpot);

    if (!availableSpot) {
      Alert.alert('😕 No Spots Available', 'No parking spots available within 500m');
      return;
    }

    flyTo(availableSpot.latitude, availableSpot.longitude, 17, true);
    setSelectedSpot(availableSpot);
    setShowModal(true);
  }, [allSpots, flyTo]);

  // ═══════════════════════════════════════════════════════════
  // DEBUG
  // ═══════════════════════════════════════════════════════════
  const showRouteStats = useCallback(() => {
    const stats = NavigationDebug.getFullStatus();

    Alert.alert(
      '📊 Debug Info v7.0',
      [
        `📡 Routes: ${stats.routing.total} total | ${stats.routing.success} success`,
        `🅿️ Spots: ${allSpots.length}`,
        `📍 Location: ${locationSource}`,
        `🗺️ Route: ${routeCoordinates ? 'ACTIVE' : 'NONE'}`,
        `⚡ Cache: ${stats.cache.hitRate}`,
        `🔊 Voice: ${stats.voice.enabled ? 'ON' : 'OFF'}`,
      ].join('\n')
    );
  }, [allSpots.length, locationSource, routeCoordinates]);

  // ═══════════════════════════════════════════════════════════
  // ZOOM CONTROLS
  // ═══════════════════════════════════════════════════════════
  const zoomIn = useCallback(() => {
    const newZoom = Math.min(zoomLevel + 1, 18);
    setZoomLevel(newZoom);
    cameraRef.current?.setCamera({
      zoomLevel: newZoom,
      animationDuration: 300,
    });
  }, [zoomLevel]);

  const zoomOut = useCallback(() => {
    const newZoom = Math.max(zoomLevel - 1, 5);
    setZoomLevel(newZoom);
    cameraRef.current?.setCamera({
      zoomLevel: newZoom,
      animationDuration: 300,
    });
  }, [zoomLevel]);

  // ═══════════════════════════════════════════════════════════
  // SEARCH
  // ═══════════════════════════════════════════════════════════
  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    Keyboard.dismiss();
    setSearching(true);

    try {
      const response = await fetchWithTimeout(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
        {
          headers: {
            'User-Agent': `${APP_CONFIG.APP_NAME}/${APP_CONFIG.VERSION}`,
          },
        },
        8000
      );

      const results = await response.json();

      if (!results?.length) {
        Alert.alert('Not Found', 'No results found for your search');
        return;
      }

      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);

      if (!validLL(lat, lon)) {
        Alert.alert('Error', 'Invalid location data');
        return;
      }

      setSearchMarker({ latitude: lat, longitude: lon });
      flyTo(lat, lon, 16, true);

    } catch (e) {
      Alert.alert('Error', 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery, flyTo]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchMarker(null);
  }, []);

  // ═══════════════════════════════════════════════════════════
  // MEMOIZED VALUES
  // ═══════════════════════════════════════════════════════════
  const renderStep = useCallback(
    ({ item, index }) => (
      <NavigationStepItem
        step={item}
        index={index}
        currentStepIndex={currentStepIndex}
        distanceToNextStep={distanceToNextStep}
        totalSteps={navigationSteps.length}
      />
    ),
    [currentStepIndex, distanceToNextStep, navigationSteps.length]
  );

  const stepKeyExtractor = useCallback((item) => item.id, []);

  const availableCount = useMemo(
    () => allSpots.filter((s) => !s.isOccupied && !s.isMySpot).length,
    [allSpots]
  );

  const occupiedCount = useMemo(
    () => allSpots.filter((s) => s.isOccupied).length,
    [allSpots]
  );

  // ═══════════════════════════════════════════════════════════
  // ROUTE VISUALIZATION
  // Computes traveled and remaining route segments
  // ═══════════════════════════════════════════════════════════
  const routeVisualization = useMemo(() => {
    const hasRoute = !!(
      routeCoordinates &&
      routeCoordinates.length >= 2 &&
      !isStoppingRef.current
    );

    if (!hasRoute) {
      return {
        traveledCoords: EMPTY_LINE_COORDS,
        remainingCoords: EMPTY_LINE_COORDS,
        showTraveled: false,
        showRemaining: false,
      };
    }

    try {
      const currentLoc = lastLocationRef.current;
      let traveledCoords = EMPTY_LINE_COORDS;
      let remainingCoords = routeCoordinates;
      let showTraveled = false;

      // Split route into traveled/remaining during navigation
      if (currentLoc && isNavigating && routeCoordinates.length > 2) {
        let minDist = Infinity;
        let splitIndex = 0;

        // Find closest point on route
        for (let i = 0; i < routeCoordinates.length - 1; i++) {
          const point = routeCoordinates[i];
          if (!point || point.length !== 2) continue;

          const dist = calcDistance(
            currentLoc.latitude,
            currentLoc.longitude,
            point[1],
            point[0]
          );

          if (dist < minDist) {
            minDist = dist;
            splitIndex = i;
          }
        }

        // Only split if we're close enough to the route
        if (splitIndex > 0 && minDist < 50) {
          traveledCoords = routeCoordinates.slice(0, splitIndex + 1);
          remainingCoords = routeCoordinates.slice(splitIndex);
          showTraveled = traveledCoords.length >= 2;
        }
      }

      // Validate coordinates
      if (!remainingCoords || remainingCoords.length < 2) {
        remainingCoords = EMPTY_LINE_COORDS;
      }

      if (!traveledCoords || traveledCoords.length < 2) {
        traveledCoords = EMPTY_LINE_COORDS;
        showTraveled = false;
      }

      return {
        traveledCoords,
        remainingCoords,
        showTraveled,
        showRemaining: true,
      };

    } catch (e) {
      Logger.error('ROUTE', 'Route visualization error', e);
      return {
        traveledCoords: EMPTY_LINE_COORDS,
        remainingCoords: EMPTY_LINE_COORDS,
        showTraveled: false,
        showRemaining: false,
      };
    }
  }, [routeCoordinates, isNavigating]);

  // ═══════════════════════════════════════════════════════════
  // RENDER - LOADING STATE
  // ═══════════════════════════════════════════════════════════
  if (loading) {
    return (
      <SafeAreaView style={S.loadingContainer}>
        <ActivityIndicator size="large" color="#E53935" />
        <Text style={S.loadingText}>Loading Map...</Text>
      </SafeAreaView>
    );
  }

  // ═══════════════════════════════════════════════════════════
  // RENDER - MAIN
  // ═══════════════════════════════════════════════════════════
  return (
    <SafeAreaView style={S.container} edges={['top', 'bottom']}>
      <View style={S.mapContainer}>
        {/* ═══════════════════════════════════════════════════════
            MAP VIEW
        ═══════════════════════════════════════════════════════ */}
        <MapLibreGL.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          styleJSON={EMPTY_STYLE}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={true}
          compassViewPosition={3}
          rotateEnabled={!isNavigating}
          pitchEnabled={true}
          scrollEnabled={!isNavigating || !followUser}
          zoomEnabled={true}
          onDidFinishLoadingMap={() => Logger.success('MAP', '🗺️ Map loaded')}
          onDidFinishRenderingMapFully={() => setTilesLoaded(true)}
          onTouchStart={() => {
            if (isNavigating && followUser) {
              followUserRef.current = false;
              setFollowUser(false);
            }
          }}
        >
          {/* Camera */}
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

          {/* OpenStreetMap Tiles */}
          <MapLibreGL.RasterSource
            id="osm"
            tileUrlTemplates={['https://tile.openstreetmap.org/{z}/{x}/{y}.png']}
            tileSize={256}
            maxZoomLevel={18}
            minZoomLevel={3}
          >
            <MapLibreGL.RasterLayer
              id="osmLayer"
              sourceID="osm"
              style={{ rasterOpacity: 1 }}
              maxZoomLevel={18}
            />
          </MapLibreGL.RasterSource>

          {/* ═══════════════════════════════════════════════════
              ROUTE LAYERS
          ═══════════════════════════════════════════════════ */}

          {/* Traveled route (gray) */}
          <MapLibreGL.ShapeSource
            id="traveled-route-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.traveledCoords,
              },
            }}
          >
            <MapLibreGL.LineLayer
              id="traveled-route"
              style={{
                lineColor: '#9E9E9E',
                lineWidth: 8,
                lineOpacity: routeVisualization.showTraveled ? 0.6 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Remaining route border (white) */}
          <MapLibreGL.ShapeSource
            id="remaining-route-border-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.remainingCoords,
              },
            }}
          >
            <MapLibreGL.LineLayer
              id="remaining-route-border"
              style={{
                lineColor: '#FFFFFF',
                lineWidth: 12,
                lineOpacity: routeVisualization.showRemaining ? 0.9 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Remaining route (colored) */}
          <MapLibreGL.ShapeSource
            id="remaining-route-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.remainingCoords,
              },
            }}
          >
            <MapLibreGL.LineLayer
              id="remaining-route"
              style={{
                lineColor: isNavigating ? '#4285F4' : '#E53935',
                lineWidth: 7,
                lineOpacity: routeVisualization.showRemaining ? 1 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* ═══════════════════════════════════════════════════
              MARKER LAYERS (ShapeSource - Android Safe)
          ═══════════════════════════════════════════════════ */}

          {/* Parking spots */}
          <ParkingSpotsLayer
            spots={allSpots}
            isHidden={isNavigating}
            onSpotPress={handleSpotPress}
          />

          {/* Search marker */}
          <SearchMarkerLayer
            coordinate={searchMarker}
            isVisible={!isNavigating && !!searchMarker}
          />

          {/* Destination marker */}
          <DestinationLayer coordinate={destination} />

          {/* User location */}
          <UserLocationLayer
            coordinate={userMarkerCoord}
            snappedCoordinate={snappedUserCoord}
            isNavigating={isNavigating}
            accuracy={locationAccuracy}
          />
        </MapLibreGL.MapView>

        {/* ═══════════════════════════════════════════════════════
            NAVIGATION PANEL (shown during navigation)
        ═══════════════════════════════════════════════════════ */}
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

        {/* ═══════════════════════════════════════════════════════
            LOADING OVERLAYS
        ═══════════════════════════════════════════════════════ */}

        {/* Tiles loading indicator */}
        {!tilesLoaded && (
          <View style={S.tilesLoading}>
            <ActivityIndicator size="small" color="#E53935" />
            <Text style={S.tilesLoadingText}>Loading tiles...</Text>
          </View>
        )}

        {/* Route loading overlay */}
        {routeLoading && (
          <View style={S.routeLoadingOverlay}>
            <View style={S.routeLoadingCard}>
              <ActivityIndicator size="large" color="#E53935" />
              <Text style={S.routeLoadingText}>Calculating route...</Text>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            SEARCH BAR (hidden during navigation)
        ═══════════════════════════════════════════════════════ */}
        {!isNavigating && (
          <View style={[S.searchContainer, { top: insets.top + 12 }]}>
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
                <TouchableOpacity onPress={clearSearch} style={S.searchClear}>
                  <Text style={S.searchClearText}>✕</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={runSearch} style={S.searchButton}>
                {searching ? (
                  <ActivityIndicator size="small" color="#E53935" />
                ) : (
                  <Text style={S.searchButtonText}>→</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            ACTION PILLS (hidden during navigation)
        ═══════════════════════════════════════════════════════ */}
        {!isNavigating && (
          <View style={[S.pillsContainer, { top: insets.top + 68 }]}>
            <TouchableOpacity
              style={[S.pill, mySpot?.isOccupied && S.pillDisabled]}
              onPress={handleOccupy}
              disabled={mySpot?.isOccupied || gettingLoc}
            >
              {gettingLoc ? (
                <ActivityIndicator size="small" color="#E53935" />
              ) : (
                <>
                  <Text style={S.pillIcon}>📍</Text>
                  <Text style={S.pillText}>Occupy</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[S.pill, !mySpot?.isOccupied && S.pillDisabled]}
              onPress={handleVacate}
              disabled={!mySpot?.isOccupied || gettingLoc}
            >
              {gettingLoc ? (
                <ActivityIndicator size="small" color="#E53935" />
              ) : (
                <>
                  <Text style={S.pillIcon}>🚗</Text>
                  <Text style={S.pillText}>Vacate</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={S.pill}
              onPress={refreshNearbySpots}
              disabled={spotsLoading}
            >
              {spotsLoading ? (
                <ActivityIndicator size="small" color="#E53935" />
              ) : (
                <>
                  <Text style={S.pillIcon}>🔄</Text>
                  <Text style={S.pillText}>Refresh</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            SPOTS INFO BADGE (hidden during navigation)
        ═══════════════════════════════════════════════════════ */}
        {!isNavigating && (
          <View style={[S.spotsBadge, { top: insets.top + 118 }]}>
            <Text style={S.spotsBadgeText}>
              🅿️ {allSpots.length} spots • 🟢 {availableCount} free • 🔴 {occupiedCount} taken
            </Text>
            <Text style={S.spotsBadgeSubtext}>📍 {locationSource}</Text>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            ROUTE INFO CARD (shown when route exists, not navigating)
        ═══════════════════════════════════════════════════════ */}
        {routeInfo && !isNavigating && (
          <View style={[S.routeInfoCard, { top: insets.top + (allSpots.length > 0 ? 158 : 130) }]}>
            <View style={S.routeInfoContent}>
              <View style={S.routeInfoItem}>
                <Text style={S.routeInfoValue}>
                  {formatDistance(remainingDistance)}
                </Text>
                <Text style={S.routeInfoLabel}>Distance</Text>
              </View>

              <View style={S.routeInfoDivider} />

              <View style={S.routeInfoItem}>
                <Text style={S.routeInfoValue}>
                  {formatDuration(remainingDuration)}
                </Text>
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

        {/* ═══════════════════════════════════════════════════════
            RIGHT CONTROLS
        ═══════════════════════════════════════════════════════ */}
        <View
          style={[
            S.rightControls,
            {
              top: isNavigating
                ? insets.top + 240
                : routeInfo
                  ? insets.top + 235
                  : insets.top + 170,
            },
          ]}
        >
          <TouchableOpacity
            style={S.controlButton}
            onPress={onLocate}
            onLongPress={showRouteStats}
          >
            <Text style={S.controlButtonIcon}>📍</Text>
          </TouchableOpacity>

          {routeCoordinates && !isNavigating && (
            <TouchableOpacity style={S.controlButton} onPress={clearRoute}>
              <Text style={S.controlButtonIcon}>🧹</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={S.controlButton} onPress={zoomIn}>
            <Text style={S.controlButtonIcon}>＋</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.controlButton} onPress={zoomOut}>
            <Text style={S.controlButtonIcon}>－</Text>
          </TouchableOpacity>
        </View>

        {/* ═══════════════════════════════════════════════════════
            FIND PARKING BUTTON (hidden during navigation)
        ═══════════════════════════════════════════════════════ */}
        {!isNavigating && (
          <View style={[S.findParkingContainer, { bottom: 86 + insets.bottom }]}>
            <TouchableOpacity style={S.findParkingButton} onPress={onFindParking}>
              <Text style={S.findParkingIcon}>🅿️</Text>
              <Text style={S.findParkingText}>Find Parking</Text>
              <View style={S.findParkingBadge}>
                <Text style={S.findParkingBadgeText}>{availableCount}</Text>
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            END NAVIGATION BUTTON (shown during navigation)
        ═══════════════════════════════════════════════════════ */}
        {isNavigating && (
          <View style={[S.endNavContainer, { bottom: 100 + insets.bottom }]}>
            <TouchableOpacity style={S.endNavButton} onPress={stopNavigation}>
              <Text style={S.endNavIcon}>✕</Text>
              <Text style={S.endNavText}>End Navigation</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════
            TAB BAR
        ═══════════════════════════════════════════════════════ */}
        <View style={[S.tabBar, { paddingBottom: Math.max(12, insets.bottom) }]}>
          <TouchableOpacity style={S.tabItem}>
            <Text style={[S.tabIcon, S.tabIconActive]}>🗺️</Text>
            <Text style={[S.tabLabel, S.tabLabelActive]}>Explore</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.tabItem}>
            <Text style={S.tabIcon}>🔖</Text>
            <Text style={S.tabLabel}>Saved</Text>
          </TouchableOpacity>

          <TouchableOpacity style={S.tabCenter}>
            <Text style={S.tabCenterIcon}>＋</Text>
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

        {/* ═══════════════════════════════════════════════════════
            SPOT DETAILS MODAL
        ═══════════════════════════════════════════════════════ */}
        <Modal
          visible={showModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowModal(false)}
        >
          <View style={S.modalOverlay}>
            <TouchableOpacity
              style={S.modalBackdrop}
              onPress={() => setShowModal(false)}
              activeOpacity={1}
            />

            <View style={S.modalContent}>
              <View style={S.modalHandle} />

              <View style={S.modalHeader}>
                <Text style={S.modalTitle}>
                  {selectedSpot?.isMySpot ? '🚗 Your Spot' : '🅿️ Parking Spot'}
                </Text>
                <TouchableOpacity onPress={() => setShowModal(false)}>
                  <Text style={S.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {selectedSpot && (
                <ScrollView style={S.modalBody}>
                  {/* Status badge */}
                  <View
                    style={[
                      S.statusBadge,
                      selectedSpot.isOccupied
                        ? S.statusBadgeOccupied
                        : S.statusBadgeAvailable,
                    ]}
                  >
                    <Text
                      style={[
                        S.statusBadgeText,
                        selectedSpot.isOccupied
                          ? S.statusBadgeTextOccupied
                          : S.statusBadgeTextAvailable,
                      ]}
                    >
                      {selectedSpot.isOccupied ? '🔴 Occupied' : '🟢 Available'}
                    </Text>
                  </View>

                  {/* Spot info */}
                  <View style={S.spotInfoCard}>
                    <Text style={S.spotInfoRow}>
                      📏 {formatDistance(selectedSpot.distance)}
                    </Text>
                    <Text style={S.spotInfoRow}>
                      🚗 {selectedSpot.deviceName || 'Unknown Device'}
                    </Text>
                    <Text style={S.spotInfoRow}>
                      🕐 {formatTime(selectedSpot.createdAt)}
                    </Text>
                    <Text style={S.spotInfoRow}>
                      📍 {selectedSpot.latitude?.toFixed(6)},{' '}
                      {selectedSpot.longitude?.toFixed(6)}
                    </Text>
                  </View>

                  {/* Action buttons */}
                  <View style={S.modalActions}>
                    <TouchableOpacity
                      style={S.actionButtonRoute}
                      onPress={() => onShowRoute(selectedSpot)}
                    >
                      <Text style={S.actionButtonRouteText}>🗺️ Show Route</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={S.actionButtonSteps}
                      onPress={() => onShowSteps(selectedSpot)}
                    >
                      <Text style={S.actionButtonStepsText}>📋 View Steps</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={S.actionButtonStart}
                      onPress={() => onStartNavigation(selectedSpot)}
                    >
                      <Text style={S.actionButtonStartText}>
                        🧭 Start Navigation
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={S.actionButtonExternal}
                      onPress={() => onNavigateExternal(selectedSpot)}
                    >
                      <Text style={S.actionButtonExternalText}>
                        📱 Open in Google Maps
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>

        {/* ═══════════════════════════════════════════════════════
            NAVIGATION STEPS MODAL
        ═══════════════════════════════════════════════════════ */}
        <Modal
          visible={showNavigation}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNavigation(false)}
        >
          <SafeAreaView style={S.stepsModalOverlay}>
            <View style={S.stepsModalContent}>
              {/* Header */}
              <View style={S.stepsModalHeader}>
                <TouchableOpacity
                  onPress={() => setShowNavigation(false)}
                  style={S.stepsModalBackButton}
                >
                  <Text style={S.stepsModalBackIcon}>←</Text>
                </TouchableOpacity>

                <Text style={S.stepsModalTitle}>Navigation Steps</Text>

                <TouchableOpacity
                  onPress={() => {
                    if (destination) {
                      setShowNavigation(false);
                      onStartNavigation(destination);
                    }
                  }}
                  style={S.stepsModalStartButton}
                >
                  <Text style={S.stepsModalStartText}>▶️ Start</Text>
                </TouchableOpacity>
              </View>

              {/* Summary */}
              {routeInfo && (
                <View style={S.stepsSummary}>
                  <View style={S.stepsSummaryItem}>
                    <Text style={S.stepsSummaryValue}>
                      {formatDistance(remainingDistance)}
                    </Text>
                    <Text style={S.stepsSummaryLabel}>Total</Text>
                  </View>

                  <View style={S.stepsSummaryDivider} />

                  <View style={S.stepsSummaryItem}>
                    <Text style={S.stepsSummaryValue}>
                      {formatDuration(remainingDuration)}
                    </Text>
                    <Text style={S.stepsSummaryLabel}>Duration</Text>
                  </View>

                  <View style={S.stepsSummaryDivider} />

                  <View style={S.stepsSummaryItem}>
                    <Text style={S.stepsSummaryValue}>
                      {routeInfo.stepsCount}
                    </Text>
                    <Text style={S.stepsSummaryLabel}>Steps</Text>
                  </View>
                </View>
              )}

              {/* Steps list */}
              <FlatList
                data={navigationSteps}
                renderItem={renderStep}
                keyExtractor={stepKeyExtractor}
                contentContainerStyle={S.stepsList}
                ListEmptyComponent={
                  <View style={S.stepsEmpty}>
                    <Text style={S.stepsEmptyIcon}>🗺️</Text>
                    <Text style={S.stepsEmptyText}>No steps available</Text>
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

// ═══════════════════════════════════════════════════════════════
// WRAPPED COMPONENT WITH ERROR BOUNDARY
// ═══════════════════════════════════════════════════════════════
export default function ParkingMapScreen(props) {
  return (
    <MapErrorBoundary>
      <ParkingMapScreenInner {...props} />
    </MapErrorBoundary>
  );
}

// ═══════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// STYLES - ParkingMapScreen v7.0
// ═══════════════════════════════════════════════════════════════

// or inline in the same file
// const styles = StyleSheet.create({ ... });
// ═══════════════════════════════════════════════════════════════
// STYLES - ParkingMapScreen v7.0
// ═══════════════════════════════════════════════════════════════


const S = StyleSheet.create({
  // ═══════════════════════════════════════════════════════════
  // CONTAINER STYLES
  // ═══════════════════════════════════════════════════════════
  container: {
    flex: 1,
    backgroundColor: '#F8F9FA',
  },
  mapContainer: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },

  // ═══════════════════════════════════════════════════════════
  // ERROR BOUNDARY STYLES
  // ═══════════════════════════════════════════════════════════
  errorBoundary: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    padding: 24,
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111111',
  },
  errorMessage: {
    fontSize: 14,
    color: '#666666',
    marginTop: 8,
    textAlign: 'center',
  },
  errorBtn: {
    marginTop: 24,
    paddingHorizontal: 28,
    paddingVertical: 14,
    backgroundColor: '#E53935',
    borderRadius: 14,
  },
  errorBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION PANEL STYLES
  // ═══════════════════════════════════════════════════════════
  navPanel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    elevation: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    zIndex: 100,
  },
  navPanelProgressWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: '#E0E0E0',
  },
  navPanelProgressFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
  },
  navPanelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  navPanelCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navPanelCloseTxt: {
    fontSize: 22,
    color: '#666666',
    fontWeight: '600',
  },
  navPanelStats: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  navPanelETA: {
    fontSize: 20,
    fontWeight: '800',
    color: '#4CAF50',
  },
  navPanelStatsDivider: {
    fontSize: 18,
    color: '#999999',
    marginHorizontal: 8,
  },
  navPanelDist: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333333',
  },
  navPanelControls: {
    flexDirection: 'row',
    gap: 8,
  },
  navPanelSmBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navPanelSmBtnActive: {
    backgroundColor: '#E3F2FD',
  },
  navPanelSmBtnInactive: {
    backgroundColor: '#FFEBEE',
  },
  navPanelSmBtnIcon: {
    fontSize: 18,
  },
  navPanelCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1976D2',
    borderRadius: 20,
    padding: 18,
    marginBottom: 12,
    elevation: 6,
    shadowColor: '#1976D2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  navPanelIconBox: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    elevation: 3,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  navPanelIcon: {
    fontSize: 34,
  },
  navPanelCardContent: {
    flex: 1,
  },
  navPanelTurnDist: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  navPanelInstruction: {
    fontSize: 17,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.95)',
    lineHeight: 22,
  },
  navPanelNext: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  navPanelNextLabel: {
    fontSize: 13,
    color: '#999999',
    marginRight: 12,
    fontWeight: '600',
  },
  navPanelNextIconBox: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#E0E0E0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  navPanelNextIcon: {
    fontSize: 18,
  },
  navPanelNextText: {
    flex: 1,
    fontSize: 14,
    color: '#666666',
    fontWeight: '500',
  },

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION STEP ITEM STYLES
  // ═══════════════════════════════════════════════════════════
  navStep: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  navStepCurrent: {
    backgroundColor: '#FFF8E1',
    borderRadius: 18,
    marginLeft: -10,
    marginRight: -10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 2,
    borderColor: '#FFE082',
  },
  navStepPast: {
    opacity: 0.5,
  },
  navStepLeft: {
    alignItems: 'center',
    marginRight: 14,
  },
  navIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  navIconBoxArrive: {
    backgroundColor: '#4CAF50',
  },
  navIconBoxCurrent: {
    backgroundColor: '#FF9800',
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 3,
    borderColor: '#FFE082',
  },
  navIconBoxPast: {
    backgroundColor: '#9E9E9E',
  },
  navIconText: {
    fontSize: 24,
  },
  navConnector: {
    width: 4,
    flex: 1,
    backgroundColor: '#E53935',
    marginVertical: 6,
    borderRadius: 2,
  },
  navConnectorPast: {
    backgroundColor: '#BDBDBD',
  },
  navStepRight: {
    flex: 1,
    backgroundColor: '#F8F9FA',
    padding: 16,
    borderRadius: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  navStepRightCurrent: {
    backgroundColor: '#FFECB3',
    borderWidth: 2,
    borderColor: '#FF9800',
  },
  navStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  navStepNum: {
    fontSize: 11,
    color: '#666666',
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  navStepDist: {
    fontSize: 14,
    color: '#E53935',
    fontWeight: '800',
  },
  navStepInstr: {
    fontSize: 16,
    color: '#111111',
    fontWeight: '700',
    marginBottom: 6,
    lineHeight: 23,
  },
  navStepName: {
    fontSize: 13,
    color: '#666666',
    marginBottom: 6,
    fontWeight: '500',
  },
  navStepTime: {
    fontSize: 12,
    color: '#999999',
    fontWeight: '500',
  },
  navStepTxtPast: {
    color: '#9E9E9E',
  },
  navStepBadge: {
    backgroundColor: '#FF9800',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 14,
    alignSelf: 'flex-start',
    marginTop: 10,
    elevation: 2,
    shadowColor: '#FF9800',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  navStepBadgeTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ═══════════════════════════════════════════════════════════
  // LOADING OVERLAYS
  // ═══════════════════════════════════════════════════════════
  tilesLoading: {
    position: 'absolute',
    top: '45%',
    alignSelf: 'center',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    gap: 10,
    zIndex: 50,
  },
  tilesLoadingText: {
    fontSize: 14,
    color: '#333333',
    fontWeight: '600',
  },
  routeLoadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  routeLoadingCard: {
    backgroundColor: '#FFFFFF',
    padding: 32,
    borderRadius: 24,
    alignItems: 'center',
    elevation: 15,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  routeLoadingText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },

  // ═══════════════════════════════════════════════════════════
  // SEARCH BAR
  // ═══════════════════════════════════════════════════════════
  searchContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 30,
  },
  searchBar: {
    height: 54,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  searchIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#111111',
    fontWeight: '500',
    paddingVertical: 0,
  },
  searchClear: {
    padding: 4,
    marginRight: 10,
  },
  searchClearText: {
    fontSize: 18,
    color: '#999999',
  },
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchButtonText: {
    fontSize: 20,
    color: '#E53935',
    fontWeight: '700',
  },

  // ═══════════════════════════════════════════════════════════
  // ACTION PILLS
  // ═══════════════════════════════════════════════════════════
  pillsContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    zIndex: 25,
  },
  pill: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    height: 42,
    borderRadius: 21,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  pillDisabled: {
    opacity: 0.5,
  },
  pillIcon: {
    fontSize: 14,
    marginRight: 5,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#111111',
  },

  // ═══════════════════════════════════════════════════════════
  // SPOTS BADGE
  // ═══════════════════════════════════════════════════════════
  spotsBadge: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    elevation: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    zIndex: 24,
  },
  spotsBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#555555',
    textAlign: 'center',
  },
  spotsBadgeSubtext: {
    fontSize: 10,
    fontWeight: '500',
    color: '#999999',
    textAlign: 'center',
    marginTop: 2,
  },

  // ═══════════════════════════════════════════════════════════
  // ROUTE INFO CARD
  // ═══════════════════════════════════════════════════════════
  routeInfoCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    zIndex: 24,
  },
  routeInfoContent: {
    flex: 1,
    flexDirection: 'row',
  },
  routeInfoItem: {
    flex: 1,
    alignItems: 'center',
  },
  routeInfoValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#E53935',
  },
  routeInfoLabel: {
    fontSize: 11,
    color: '#666666',
    marginTop: 2,
    fontWeight: '500',
  },
  routeInfoDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 12,
  },
  routeInfoClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  routeInfoCloseText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
  },

  // ═══════════════════════════════════════════════════════════
  // RIGHT CONTROLS
  // ═══════════════════════════════════════════════════════════
  rightControls: {
    position: 'absolute',
    right: 16,
    zIndex: 20,
    gap: 10,
  },
  controlButton: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  controlButtonIcon: {
    fontSize: 24,
  },

  // ═══════════════════════════════════════════════════════════
  // FIND PARKING BUTTON
  // ═══════════════════════════════════════════════════════════
  findParkingContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 20,
  },
  findParkingButton: {
    height: 62,
    backgroundColor: '#E53935',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 12,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  findParkingIcon: {
    fontSize: 24,
    marginRight: 10,
  },
  findParkingText: {
    fontSize: 18,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  findParkingBadge: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginLeft: 14,
  },
  findParkingBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#E53935',
  },

  // ═══════════════════════════════════════════════════════════
  // END NAVIGATION BUTTON
  // ═══════════════════════════════════════════════════════════
  endNavContainer: {
    position: 'absolute',
    left: 20,
    right: 20,
    zIndex: 50,
  },
  endNavButton: {
    height: 56,
    backgroundColor: '#E53935',
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 10,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  endNavIcon: {
    fontSize: 22,
    color: '#FFFFFF',
    marginRight: 8,
    fontWeight: '700',
  },
  endNavText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ═══════════════════════════════════════════════════════════
  // TAB BAR
  // ═══════════════════════════════════════════════════════════
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 14,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    flexDirection: 'row',
    justifyContent: 'space-around',
    elevation: 20,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  tabItem: {
    width: 60,
    alignItems: 'center',
    paddingVertical: 6,
  },
  tabIcon: {
    fontSize: 24,
    color: '#999999',
  },
  tabIconActive: {
    color: '#E53935',
  },
  tabLabel: {
    fontSize: 10,
    marginTop: 4,
    color: '#999999',
    fontWeight: '600',
  },
  tabLabelActive: {
    color: '#E53935',
  },
  tabCenter: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E53935',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    elevation: 12,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  tabCenterIcon: {
    fontSize: 36,
    color: '#FFFFFF',
    marginTop: -2,
  },

  // ═══════════════════════════════════════════════════════════
  // SPOT MODAL
  // ═══════════════════════════════════════════════════════════
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    maxHeight: '80%',
    elevation: 25,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  modalHandle: {
    width: 48,
    height: 5,
    backgroundColor: '#DDDDDD',
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 22,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111111',
  },
  modalClose: {
    fontSize: 28,
    color: '#999999',
  },
  modalBody: {
    padding: 22,
  },

  // ═══════════════════════════════════════════════════════════
  // STATUS BADGE
  // ═══════════════════════════════════════════════════════════
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    marginBottom: 18,
  },
  statusBadgeAvailable: {
    backgroundColor: '#E8F5E9',
  },
  statusBadgeOccupied: {
    backgroundColor: '#FFEBEE',
  },
  statusBadgeText: {
    fontSize: 14,
    fontWeight: '700',
  },
  statusBadgeTextAvailable: {
    color: '#4CAF50',
  },
  statusBadgeTextOccupied: {
    color: '#E53935',
  },

  // ═══════════════════════════════════════════════════════════
  // SPOT INFO CARD
  // ═══════════════════════════════════════════════════════════
  spotInfoCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 18,
    padding: 18,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F0F0F0',
  },
  spotInfoRow: {
    fontSize: 15,
    color: '#111111',
    paddingVertical: 8,
    fontWeight: '500',
  },

  // ═══════════════════════════════════════════════════════════
  // MODAL ACTION BUTTONS
  // ═══════════════════════════════════════════════════════════
  modalActions: {
    gap: 12,
  },
  actionButtonRoute: {
    backgroundColor: '#F0F0F0',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
  },
  actionButtonRouteText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111111',
  },
  actionButtonSteps: {
    backgroundColor: '#FFF3E0',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  actionButtonStepsText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E65100',
  },
  actionButtonStart: {
    backgroundColor: '#4CAF50',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  actionButtonStartText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  actionButtonExternal: {
    backgroundColor: '#E53935',
    padding: 18,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  actionButtonExternalText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ═══════════════════════════════════════════════════════════
  // NAVIGATION STEPS MODAL
  // ═══════════════════════════════════════════════════════════
  stepsModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  stepsModalContent: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    marginTop: 60,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    elevation: 25,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  stepsModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  stepsModalBackButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F5F5F5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  stepsModalBackIcon: {
    fontSize: 26,
    color: '#111111',
    fontWeight: '600',
  },
  stepsModalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111111',
  },
  stepsModalStartButton: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 22,
    backgroundColor: '#4CAF50',
    elevation: 3,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  stepsModalStartText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },

  // ═══════════════════════════════════════════════════════════
  // STEPS SUMMARY
  // ═══════════════════════════════════════════════════════════
  stepsSummary: {
    flexDirection: 'row',
    padding: 18,
    backgroundColor: '#F8F9FA',
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  stepsSummaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  stepsSummaryValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111111',
  },
  stepsSummaryLabel: {
    fontSize: 11,
    color: '#666666',
    marginTop: 3,
    fontWeight: '500',
  },
  stepsSummaryDivider: {
    width: 1,
    backgroundColor: '#E0E0E0',
    marginHorizontal: 12,
  },

  // ═══════════════════════════════════════════════════════════
  // STEPS LIST
  // ═══════════════════════════════════════════════════════════
  stepsList: {
    padding: 16,
  },
  stepsEmpty: {
    alignItems: 'center',
    paddingVertical: 80,
  },
  stepsEmptyIcon: {
    fontSize: 70,
    marginBottom: 24,
  },
  stepsEmptyText: {
    fontSize: 16,
    color: '#666666',
    fontWeight: '600',
  },

  // ═══════════════════════════════════════════════════════════
  // ADDITIONAL UTILITY STYLES
  // ═══════════════════════════════════════════════════════════
  flexRow: {
    flexDirection: 'row',
  },
  flexCenter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  flex1: {
    flex: 1,
  },
  absolute: {
    position: 'absolute',
  },
  absoluteFill: {
    ...StyleSheet.absoluteFillObject,
  },
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
  },

  // ═══════════════════════════════════════════════════════════
  // TEXT STYLES
  // ═══════════════════════════════════════════════════════════
  textCenter: {
    textAlign: 'center',
  },
  textBold: {
    fontWeight: '700',
  },
  textExtraBold: {
    fontWeight: '800',
  },
  textLight: {
    color: '#666666',
  },
  textMuted: {
    color: '#999999',
  },
  textPrimary: {
    color: '#E53935',
  },
  textSuccess: {
    color: '#4CAF50',
  },
  textWarning: {
    color: '#FF9800',
  },
  textWhite: {
    color: '#FFFFFF',
  },
  textDark: {
    color: '#111111',
  },

  // ═══════════════════════════════════════════════════════════
  // SPACING STYLES
  // ═══════════════════════════════════════════════════════════
  mt4: { marginTop: 4 },
  mt8: { marginTop: 8 },
  mt12: { marginTop: 12 },
  mt16: { marginTop: 16 },
  mt24: { marginTop: 24 },
  mb4: { marginBottom: 4 },
  mb8: { marginBottom: 8 },
  mb12: { marginBottom: 12 },
  mb16: { marginBottom: 16 },
  mb24: { marginBottom: 24 },
  ml8: { marginLeft: 8 },
  mr8: { marginRight: 8 },
  mh16: { marginHorizontal: 16 },
  mv8: { marginVertical: 8 },
  p8: { padding: 8 },
  p12: { padding: 12 },
  p16: { padding: 16 },
  p24: { padding: 24 },
  ph16: { paddingHorizontal: 16 },
  pv8: { paddingVertical: 8 },
  pv12: { paddingVertical: 12 },

  // ═══════════════════════════════════════════════════════════
  // GAP STYLES (React Native 0.71+)
  // ═══════════════════════════════════════════════════════════
  gap4: { gap: 4 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  gap16: { gap: 16 },
});
