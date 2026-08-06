// src/screens/ParkingMapScreen.js
// PARKIT - Parking Map Screen (Production behaviour)
// ✅ AUTO-FETCH PARKING SPOTS ON APP START
// ✅ AUTO-OPEN FIND PARKING SHEET
// ✅ AUTO-HIT USER'S LIVE LOCATION (No manual click needed)
// ✅ WEBSOCKET REAL-TIME SLOT NOTIFICATIONS

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  useContext,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Linking,
  Modal,
  ScrollView,
  FlatList,
  TextInput,
  Keyboard,
  Platform,
  AppState,
  PermissionsAndroid,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Geolocation from '@react-native-community/geolocation';
import LinearGradient from 'react-native-linear-gradient';
import { RFValue } from 'react-native-responsive-fontsize';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters';

import ParkingService from '../services/ParkingService';
import AppContext from '../context/AppContext';

// ✅ WebSocket Hook & Components
import useParkingWebSocket, { WS_STATUS } from '../hooks/useParkingWebSocket';
import SlotFreeNotification from '../components/SlotFreeNotification';
import WsStatusDot from '../components/WsStatusDot';

// ✅ Bottom bar
import BottomNavBar from './BottomNavBar';

import {
  Logger,
  NAV_CONFIG,
  NEARBY_CONFIG,
  DEFAULT_LOC,
  EMPTY_STYLE,
  APP_CONFIG,
  validLL,
  calcDistance,
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
  rerouteManager,
  getDistanceFromRouteLine,
} from '../services/NavigationService';

import {
  isUserLoggedIn,
  getValidAccessToken,
  clearAuthData,
  refreshAccessToken,
} from '../utils/GoogleAuthHandler';

MapLibreGL.setAccessToken(null);

const s = (v) => scale(v);
const ms = (v) => moderateScale(v, 0.3);
const vs = (v) => verticalScale(v);
const rf = (v) => RFValue(v);

const COLORS = {
  primary: '#E53935',
  primaryDark: '#C62828',
  secondary: '#1976D2',
  success: '#4CAF50',
  warning: '#FF9800',
  danger: '#F44336',
  white: '#FFFFFF',
  bg: '#F7F7F7',
  text: '#1F1F1F',
  text2: '#6F6F6F',
  hint: '#9E9E9E',
  border: '#ECECEC',
  shadow: '#000000',
};

const EMPTY_LINE_COORDS = [
  [0, 0],
  [0.00001, 0.00001],
];
const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };

const Card = ({ children, style }) => (
  <View style={[styles.card, style]}>{children}</View>
);

// ───────────────────────────────────────────────────────────────
// Map layers
// ───────────────────────────────────────────────────────────────
const ParkingSpotsLayer = React.memo(({ spots, isHidden, onSpotPress }) => {
  const spotsGeoJson = useMemo(() => {
    if (!spots || spots.length === 0 || isHidden) return EMPTY_GEOJSON;
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
          isMySpot: !!spot.isMySpot,
          isOccupied: !!spot.isOccupied,
          color: spot.isMySpot
            ? COLORS.secondary
            : spot.isOccupied
            ? COLORS.danger
            : COLORS.success,
        },
      })),
    };
  }, [spots, isHidden]);

  const handlePress = useCallback(
    (e) => {
      if (!e?.features?.length) return;
      const f = e.features[0];
      const spotId = f.properties?.id || f.id;
      const spot = spots.find((sp) => String(sp.id) === String(spotId));
      if (spot) onSpotPress?.(spot);
    },
    [spots, onSpotPress],
  );

  return (
    <MapLibreGL.ShapeSource
      id="parking-spots-source"
      shape={spotsGeoJson}
      onPress={handlePress}>
      <MapLibreGL.CircleLayer
        id="parking-spots-border"
        style={{
          circleRadius: ms(14),
          circleColor: COLORS.white,
          circleOpacity: isHidden ? 0 : 1,
        }}
      />
      <MapLibreGL.CircleLayer
        id="parking-spots-fill"
        style={{
          circleRadius: ms(11),
          circleColor: ['get', 'color'],
          circleOpacity: isHidden ? 0 : 1,
          circleStrokeWidth: ms(2),
          circleStrokeColor: COLORS.white,
        }}
      />
      <MapLibreGL.CircleLayer
        id="parking-spots-inner"
        filter={['==', ['get', 'isOccupied'], false]}
        style={{
          circleRadius: ms(4),
          circleColor: COLORS.white,
          circleOpacity: isHidden ? 0 : 0.85,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

const DestinationLayer = React.memo(({ coordinate }) => {
  const geo = useMemo(() => {
    if (!coordinate?.latitude || !coordinate?.longitude) return EMPTY_GEOJSON;
    if (!validLL(coordinate.latitude, coordinate.longitude)) return EMPTY_GEOJSON;
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

  const visible = !!(
    coordinate?.latitude &&
    coordinate?.longitude &&
    validLL(coordinate.latitude, coordinate.longitude)
  );

  return (
    <MapLibreGL.ShapeSource id="destination-source" shape={geo}>
      <MapLibreGL.CircleLayer
        id="destination-pulse"
        style={{
          circleRadius: ms(22),
          circleColor: 'rgba(76, 175, 80, 0.20)',
          circleStrokeWidth: ms(2),
          circleStrokeColor: 'rgba(76, 175, 80, 0.45)',
          circleOpacity: visible ? 1 : 0,
        }}
      />
      <MapLibreGL.CircleLayer
        id="destination-main"
        style={{
          circleRadius: ms(14),
          circleColor: COLORS.success,
          circleStrokeWidth: ms(3),
          circleStrokeColor: COLORS.white,
          circleOpacity: visible ? 1 : 0,
        }}
      />
      <MapLibreGL.CircleLayer
        id="destination-inner"
        style={{
          circleRadius: ms(5),
          circleColor: COLORS.white,
          circleOpacity: visible ? 1 : 0,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

const SearchMarkerLayer = React.memo(({ coordinate, isVisible }) => {
  const geo = useMemo(() => {
    if (!coordinate?.latitude || !coordinate?.longitude) return EMPTY_GEOJSON;
    if (!validLL(coordinate.latitude, coordinate.longitude)) return EMPTY_GEOJSON;
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
    <MapLibreGL.ShapeSource id="search-marker-source" shape={geo}>
      <MapLibreGL.CircleLayer
        id="search-marker-outer"
        style={{
          circleRadius: ms(18),
          circleColor: 'rgba(233, 30, 99, 0.14)',
          circleStrokeWidth: ms(2),
          circleStrokeColor: 'rgba(233, 30, 99, 0.45)',
          circleOpacity: show ? 1 : 0,
        }}
      />
      <MapLibreGL.CircleLayer
        id="search-marker-main"
        style={{
          circleRadius: ms(10),
          circleColor: '#E91E63',
          circleStrokeWidth: ms(3),
          circleStrokeColor: COLORS.white,
          circleOpacity: show ? 1 : 0,
        }}
      />
      <MapLibreGL.CircleLayer
        id="search-marker-inner"
        style={{
          circleRadius: ms(3),
          circleColor: COLORS.white,
          circleOpacity: show ? 1 : 0,
        }}
      />
    </MapLibreGL.ShapeSource>
  );
});

const UserLocationLayer = React.memo(
  ({ coordinate, snappedCoordinate, isNavigating, accuracy }) => {
    const display = useMemo(() => {
      if (isNavigating && snappedCoordinate && snappedCoordinate.length === 2)
        return snappedCoordinate;
      if (coordinate && coordinate.length === 2) return coordinate;
      return [DEFAULT_LOC.longitude, DEFAULT_LOC.latitude];
    }, [coordinate, snappedCoordinate, isNavigating]);

    const feature = useMemo(
      () => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: display },
        properties: {},
      }),
      [display],
    );

    const accRadius = useMemo(() => {
      if (!isNavigating || !accuracy || accuracy <= 0) return 0;
      return Math.min(Math.max(accuracy / 2, ms(10)), ms(44));
    }, [isNavigating, accuracy]);

    return (
      <MapLibreGL.ShapeSource id="user-location-source" shape={feature}>
        <MapLibreGL.CircleLayer
          id="user-accuracy"
          style={{
            circleRadius: accRadius,
            circleColor: 'rgba(25, 118, 210, 0.12)',
            circleStrokeColor: 'rgba(25, 118, 210, 0.26)',
            circleStrokeWidth: ms(1),
            circleOpacity: accRadius > 0 ? 1 : 0,
          }}
        />
        <MapLibreGL.CircleLayer
          id="user-outer"
          style={{
            circleRadius: isNavigating ? ms(20) : ms(16),
            circleColor: 'rgba(25, 118, 210, 0.22)',
          }}
        />
        <MapLibreGL.CircleLayer
          id="user-inner"
          style={{
            circleRadius: isNavigating ? ms(10) : ms(8),
            circleColor: COLORS.secondary,
            circleStrokeColor: COLORS.white,
            circleStrokeWidth: ms(3),
          }}
        />
        {isNavigating && (
          <MapLibreGL.CircleLayer
            id="user-center"
            style={{ circleRadius: ms(3), circleColor: COLORS.white }}
          />
        )}
      </MapLibreGL.ShapeSource>
    );
  },
);

// ───────────────────────────────────────────────────────────────
// Error Boundary
// ───────────────────────────────────────────────────────────────
class MapErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error) {
    Logger.error('BOUNDARY', 'Map crash', error);
  }
  handleRetry = () => this.setState({ hasError: false });
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={styles.errorWrap}>
          <Text style={styles.errorIcon}>🗺️</Text>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorSub}>
            Map encountered an error. Please try again.
          </Text>
          <TouchableOpacity onPress={this.handleRetry} activeOpacity={0.9}>
            <LinearGradient
              colors={[COLORS.primary, COLORS.primaryDark]}
              style={styles.errorBtn}>
              <Text style={styles.errorBtnText}>Retry</Text>
            </LinearGradient>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ───────────────────────────────────────────────────────────────
// Permissions
// ───────────────────────────────────────────────────────────────
const LocationPermission = {
  async request() {
    if (Platform.OS !== 'android') return true;
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'ParkIt needs location access for navigation.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );

      if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
        Alert.alert('Permission Required', 'Location permission needed.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Settings', onPress: () => Linking.openSettings() },
        ]);
        return false;
      }

      if (Platform.Version >= 29) {
        try {
          await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
          );
        } catch (e) {
          Logger.warn('PERM', 'Background location denied', e);
        }
      }

      return true;
    } catch (e) {
      Logger.error('PERM', 'Permission failed', e);
      return false;
    }
  },
};

// ───────────────────────────────────────────────────────────────
// Styled UI pieces
// ───────────────────────────────────────────────────────────────
const TopSearchBar = React.memo(
  ({ insets, value, onChange, onSubmit, onClear, searching }) => {
    return (
      <View
        style={[styles.topWrap, { paddingTop: insets.top + vs(8) }]}
        pointerEvents="box-none">
        <Card style={styles.searchCard}>
          <View style={styles.searchRow}>
            <Text style={styles.searchEmoji}>🔍</Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              placeholder="Search here"
              placeholderTextColor={COLORS.hint}
              style={styles.searchInput}
              returnKeyType="search"
              onSubmitEditing={onSubmit}
            />
            {!!value?.length && (
              <TouchableOpacity
                onPress={onClear}
                style={styles.searchClear}
                hitSlop={10}>
                <Text style={styles.searchClearText}>✕</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={onSubmit}
              activeOpacity={0.85}
              style={styles.searchGoBtn}>
              {searching ? (
                <ActivityIndicator size="small" color={COLORS.white} />
              ) : (
                <Text style={styles.searchGoBtnText}>→</Text>
              )}
            </TouchableOpacity>
          </View>
        </Card>
      </View>
    );
  },
);

const ActionChipsRow = React.memo(
  ({ insets, mySpot, gettingLoc, onOccupy, onVacate }) => {
    const occupyDisabled = !!mySpot?.isOccupied || gettingLoc;
    const vacateDisabled = !mySpot?.isOccupied || gettingLoc;

    return (
      <View
        style={[styles.chipsWrap, { top: insets.top + vs(62) }]}
        pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onOccupy}
          disabled={occupyDisabled}
          style={[styles.chipBtn, occupyDisabled && styles.chipDisabled]}>
          <View style={styles.chipInner}>
            {gettingLoc && !mySpot?.isOccupied ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Text style={styles.chipText}>Occupy Spot</Text>
                <Text style={styles.chipIcon}>📍</Text>
              </>
            )}
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onVacate}
          disabled={vacateDisabled}
          style={[styles.chipBtn, vacateDisabled && styles.chipDisabled]}>
          <View style={styles.chipInner}>
            {gettingLoc && !!mySpot?.isOccupied ? (
              <ActivityIndicator size="small" color={COLORS.primary} />
            ) : (
              <>
                <Text style={styles.chipText}>Vacate Spot</Text>
                <Text style={styles.chipIcon}>🚗</Text>
              </>
            )}
          </View>
        </TouchableOpacity>
      </View>
    );
  },
);

const RightMapControls = React.memo(
  ({ insets, onLocate, onZoomIn, onZoomOut, onLongLocate }) => {
    return (
      <View
        style={[styles.rightControlsWrap, { top: insets.top + vs(210) }]}
        pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onLocate}
          onLongPress={onLongLocate}
          style={styles.ctrlBtn}>
          <Card style={styles.ctrlCard}>
            <Text style={styles.ctrlIcon}>⌖</Text>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onZoomIn}
          style={styles.ctrlBtn}>
          <Card style={styles.ctrlCard}>
            <Text style={styles.ctrlIcon}>＋</Text>
          </Card>
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onZoomOut}
          style={styles.ctrlBtn}>
          <Card style={styles.ctrlCard}>
            <Text style={styles.ctrlIcon}>－</Text>
          </Card>
        </TouchableOpacity>
      </View>
    );
  },
);

const FindParkingButton = React.memo(
  ({ insets, count, onPress, hidden, disabled }) => {
    if (hidden) return null;
    return (
      <View
        style={[
          styles.findBtnWrap,
          { bottom: vs(86) + (insets?.bottom || 0) },
        ]}
        pointerEvents="box-none">
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onPress}
          disabled={disabled}>
          <LinearGradient
            colors={['#E46C67', '#DF5A55']}
            style={[styles.findBtn, disabled && { opacity: 0.75 }]}>
            <Text style={styles.findBtnIcon}>🅿️</Text>
            <Text style={styles.findBtnText}>
              {disabled ? 'Loading…' : 'Find Parking'}
            </Text>
            <View style={styles.findCountPill}>
              <Text style={styles.findCountText}>{count}</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      </View>
    );
  },
);

const EndNavigationButton = React.memo(({ insets, onPress, hidden }) => {
  if (hidden) return null;
  return (
    <View
      style={[
        styles.endBtnWrap,
        { bottom: vs(86) + (insets?.bottom || 0) },
      ]}
      pointerEvents="box-none">
      <TouchableOpacity activeOpacity={0.9} onPress={onPress}>
        <LinearGradient
          colors={['#F44336', '#D32F2F']}
          style={styles.endBtn}>
          <Text style={styles.endBtnIcon}>✕</Text>
          <Text style={styles.endBtnText}>End Navigation</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
});

const SpotsSheet = React.memo(
  ({ insets, spots, onPressSpot, hidden, locationSource }) => {
    if (hidden) return null;

    const data = useMemo(() => {
      return (spots || [])
        .filter((sp) => !sp.isMySpot)
        .sort((a, b) => {
          const avA = a.isOccupied ? 1 : 0;
          const avB = b.isOccupied ? 1 : 0;
          if (avA !== avB) return avA - avB;
          return (a.distance ?? 0) - (b.distance ?? 0);
        });
    }, [spots]);

    if (!data.length) return null;

    const renderItem = ({ item: sp }) => {
      const dist = sp.distance ?? 0;
      const etaSec = dist / 1.25;

      return (
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onPressSpot?.(sp)}
          style={styles.sheetRow}>
          <View style={styles.pIcon}>
            <Text style={styles.pIconText}>P</Text>
          </View>

          <View style={styles.sheetRowMid}>
            <Text style={styles.sheetRowTitle} numberOfLines={1}>
              Parking spot
            </Text>
            <Text style={styles.sheetRowSub} numberOfLines={1}>
              {sp.deviceName ? `${sp.deviceName}` : 'Nearby'} •{' '}
              {sp.isOccupied ? 'Occupied' : 'Available'}
            </Text>
          </View>

          <View style={styles.sheetRowRight}>
            <Text style={[styles.sheetEta, { color: COLORS.primary }]}>
              {Math.max(1, Math.round(etaSec / 60))}min
            </Text>
            <Text style={styles.sheetDist}>{formatDistance(dist)}</Text>
          </View>
        </TouchableOpacity>
      );
    };

    return (
      <View
        style={[
          styles.sheetWrap,
          {
            bottom:
              vs(16) + (insets?.bottom || 0) + ms(64),
          },
        ]}
        pointerEvents="box-none">
        <Card style={styles.sheetCard}>
          <View style={styles.sheetHandle} />

          <View style={styles.sheetListWrap}>
            <FlatList
              data={data}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetListContent}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews={true}
            />
          </View>

          <View style={styles.sheetFooter}>
            <Text style={styles.sheetFooterText}>
              ⓘ Parking availability is based on high probability and is not
              guaranteed.
            </Text>
            <Text style={styles.sheetFooterText2}>📍 {locationSource}</Text>
          </View>
        </Card>
      </View>
    );
  },
);

// ───────────────────────────────────────────────────────────────
// Navigation panel + Steps item
// ───────────────────────────────────────────────────────────────
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
    isRerouting,
    rerouteCount,
    isOffRoute,
  }) => {
    const insets = useSafeAreaInsets();
    if (!currentStep) return null;

    return (
      <View
        style={[styles.navPanelWrap, { paddingTop: insets.top + vs(8) }]}
        pointerEvents="box-none">
        <Card style={styles.navPanel}>
          {isRerouting && (
            <View style={styles.navBannerWarn}>
              <ActivityIndicator size="small" color={COLORS.warning} />
              <Text style={styles.navBannerText}>
                Recalculating... ({rerouteCount})
              </Text>
            </View>
          )}

          {isOffRoute && !isRerouting && (
            <View style={styles.navBannerOff}>
              <Text style={styles.navBannerOffText}>
                ⚠️ You are off route
              </Text>
            </View>
          )}

          <View style={styles.navProgressTrack}>
            <View
              style={[
                styles.navProgressFill,
                { width: `${Math.min(progress * 100, 100)}%` },
              ]}
            />
          </View>

          <View style={styles.navTopRow}>
            <TouchableOpacity
              onPress={onClose}
              style={styles.navCloseBtn}
              hitSlop={10}>
              <Text style={styles.navCloseText}>✕</Text>
            </TouchableOpacity>

            <View style={styles.navStats}>
              <Text style={styles.navEta}>
                {formatDuration(totalRemainingTime)}
              </Text>
              <View style={styles.navDot} />
              <Text style={styles.navDist}>
                {formatDistance(totalRemainingDistance)}
              </Text>
            </View>

            <View style={styles.navSmBtns}>
              <TouchableOpacity
                onPress={onToggleVoice}
                style={[
                  styles.navSmBtn,
                  !voiceEnabled && styles.navSmBtnInactive,
                ]}
                hitSlop={10}>
                <Text style={styles.navSmBtnText}>
                  {voiceEnabled ? '🔊' : '🔇'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={onRecenter}
                style={[
                  styles.navSmBtn,
                  isRecentering && styles.navSmBtnActive,
                ]}
                hitSlop={10}>
                <Text style={styles.navSmBtnText}>🎯</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.navMainRow}>
            <View style={styles.navIconBox}>
              <Text style={styles.navIcon}>{currentStep.icon || '➡️'}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.navNextDist}>
                {distanceToNextStep > 0
                  ? formatDistanceNav(distanceToNextStep)
                  : 'Now'}
              </Text>
              <Text style={styles.navInstr} numberOfLines={2}>
                {currentStep.instruction}
              </Text>
            </View>
          </View>

          {nextStep && nextStep.maneuverType !== 'arrive' && (
            <View style={styles.navThenRow}>
              <Text style={styles.navThenLabel}>Then</Text>
              <Text style={styles.navThenText} numberOfLines={1}>
                {nextStep.icon || '➡️'} {nextStep.instruction}
              </Text>
            </View>
          )}
        </Card>
      </View>
    );
  },
);

const NavigationStepItem = React.memo(
  ({ step, index, currentStepIndex, distanceToNextStep, totalSteps }) => {
    const isCurrent = index === currentStepIndex;
    const isPast = index < currentStepIndex;

    return (
      <View
        style={[
          styles.stepItem,
          isCurrent && styles.stepItemCurrent,
          isPast && styles.stepItemPast,
        ]}>
        <View style={styles.stepLeft}>
          <View
            style={[
              styles.stepIcon,
              isCurrent && styles.stepIconCurrent,
              isPast && styles.stepIconPast,
            ]}>
            <Text style={styles.stepIconText}>{step.icon || '➡️'}</Text>
          </View>
          {index < totalSteps - 1 && (
            <View
              style={[styles.stepLine, isPast && styles.stepLinePast]}
            />
          )}
        </View>

        <View style={styles.stepRight}>
          <View style={styles.stepTop}>
            <Text style={[styles.stepNum, isPast && styles.stepTxtPast]}>
              Step {step.stepNumber}
            </Text>
            <Text style={[styles.stepDist, isPast && styles.stepTxtPast]}>
              {formatDistance(step.distance)}
            </Text>
          </View>

          <Text
            style={[styles.stepInstr, isPast && styles.stepTxtPast]}
            numberOfLines={2}>
            {step.instruction}
          </Text>

          <Text style={[styles.stepTime, isPast && styles.stepTxtPast]}>
            ⏱️ ~{formatDuration(step.duration)}
          </Text>

          {isCurrent && distanceToNextStep > 0 && (
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>
                In {formatDistanceNav(distanceToNextStep)}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  },
);

// ───────────────────────────────────────────────────────────────
// MAIN SCREEN
// ───────────────────────────────────────────────────────────────
function ParkingMapScreenInner({ navigation, route }) {
  const { userId, prefetchedLocation, skipAuthCheck } = route?.params || {};
  const { userData, setUserData } = useContext(AppContext);
  const currentUserId = userId || userData?.userId;

  const insets = useSafeAreaInsets();

  // ── Refs ──────────────────────────────────────────────────────
  const mapRef = useRef(null);
  const cameraRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);

  const locationWatchId = useRef(null);
  const passiveWatchId = useRef(null);
  const navIntervalRef = useRef(null);

  const isMountedRef = useRef(true);
  const isNavigatingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const followUserRef = useRef(true);

  const totalDistanceRef = useRef(0);
  const totalDurationRef = useRef(0);
  const routeCoordinatesRef = useRef(null);
  const lastLocationRef = useRef(null);

  const lastCameraUpdateRef = useRef(0);
  const lastMarkerUpdateRef = useRef(0);
  const lastRouteUpdateRef = useRef(0);

  const snappedUserCoordRef = useRef(null);
  const gpsSpeedRef = useRef(0);

  const nearbyRefreshTimerRef = useRef(null);
  const lastNearbyFetchLocRef = useRef(null);
  const destinationRef = useRef(null);
  const permissionGrantedRef = useRef(false);
  const hasAutoOpenedRef = useRef(false);
  const hasAutoLocationHitRef = useRef(false);

  // ── State ─────────────────────────────────────────────────────
  const [tilesLoaded, setTilesLoaded] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [spotsLoading, setSpotsLoading] = useState(true);
  const [isRefreshingLocation, setIsRefreshingLocation] = useState(false);

  const [userLoc, setUserLoc] = useState(DEFAULT_LOC);
  const [userMarkerCoord, setUserMarkerCoord] = useState([
    DEFAULT_LOC.longitude,
    DEFAULT_LOC.latitude,
  ]);
  const [snappedUserCoord, setSnappedUserCoord] = useState(null);
  const [userHeading, setUserHeading] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(0);
  const [locationSource, setLocationSource] = useState(
    '📍 Getting location...',
  );

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

  const [isRerouting, setIsRerouting] = useState(false);
  const [rerouteCount, setRerouteCount] = useState(0);
  const [isOffRoute, setIsOffRoute] = useState(false);
  const [offRouteDistance, setOffRouteDistance] = useState(0);

  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchMarker, setSearchMarker] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(14);

  const [showSpotsSheet, setShowSpotsSheet] = useState(false);

  // ── ✅ WebSocket notification state ───────────────────────────
  const [slotFreeNotif, setSlotFreeNotif] = useState(null);

  // ── Keep refs synced ──────────────────────────────────────────
  useEffect(() => {
    routeCoordinatesRef.current = routeCoordinates;
  }, [routeCoordinates]);

  useEffect(() => {
    destinationRef.current = destination;
  }, [destination]);

  // ── Auth error handler ────────────────────────────────────────
  const handleAuthError = useCallback(
    async (error) => {
      if (
        error?.code === 'AUTH_EXPIRED' ||
        error?.message?.includes('Session expired')
      ) {
        try {
          const newToken = await refreshAccessToken();
          if (newToken) return false;
        } catch {}

        await clearAuthData();
        setUserData(null);

        Alert.alert(
          'Session Expired',
          'Please login again.',
          [
            {
              text: 'Login',
              onPress: () =>
                navigation.reset({
                  index: 0,
                  routes: [{ name: 'Login' }],
                }),
            },
          ],
          { cancelable: false },
        );
        return true;
      }
      return false;
    },
    [navigation, setUserData],
  );

  // ── Auth check ────────────────────────────────────────────────
  useEffect(() => {
    if (skipAuthCheck && currentUserId) return;

    const checkAuth = async () => {
      try {
        const loggedIn = await isUserLoggedIn();
        if (!loggedIn) {
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
        const token = await getValidAccessToken();
        if (!token) {
          await clearAuthData();
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
          return;
        }
      } catch (error) {
        await handleAuthError(error);
      }
    };

    checkAuth();
  }, [currentUserId, navigation, handleAuthError, skipAuthCheck]);

  useEffect(() => {
    if (!currentUserId) {
      navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
    }
  }, [currentUserId, navigation]);

  // ── Location helpers ──────────────────────────────────────────
  const getQuickLocation = useCallback(async () => {
    try {
      if (!permissionGrantedRef.current) {
        const has = await LocationPermission.request();
        if (!has) return null;
        permissionGrantedRef.current = true;
      }

      const position = await new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Quick timeout')), 3000);
        Geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(t);
            resolve(pos);
          },
          (err) => {
            clearTimeout(t);
            reject(err);
          },
          { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 },
        );
      });

      if (validLL(position.coords.latitude, position.coords.longitude)) {
        const accuracy = position.coords.accuracy || 0;
        setLocationSource(`Quick ±${accuracy.toFixed(0)}m`);
        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy,
          source: 'Quick',
        };
      }
    } catch (e) {
      Logger.warn('QUICK_LOC', 'Quick location failed', e);
    }
    return null;
  }, []);

  const getAccurateLocation = useCallback(async () => {
    try {
      if (!permissionGrantedRef.current) {
        const has = await LocationPermission.request();
        if (!has) {
          Logger.warn('LOCATION', 'Permission denied');
          return null;
        }
        permissionGrantedRef.current = true;
      }

      const position = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(
          () => reject(new Error('GPS timeout')),
          10000,
        );

        Geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timeoutId);
            resolve(pos);
          },
          (err) => {
            clearTimeout(timeoutId);
            reject(err);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0,
          },
        );
      });

      if (validLL(position.coords.latitude, position.coords.longitude)) {
        const accuracy = position.coords.accuracy || 0;
        const source = accuracy < 50 ? 'GPS Accurate' : 'GPS';
        setLocationSource(`${source} ±${accuracy.toFixed(0)}m`);
        return {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy,
          heading: position.coords.heading,
          speed: position.coords.speed,
          source,
        };
      }
    } catch (e) {
      Logger.warn('LOCATION', 'Accurate location failed', e);
    }
    return null;
  }, []);

  const getLoc = useCallback(async () => {
    try {
      if (!permissionGrantedRef.current) {
        const has = await LocationPermission.request();
        if (!has) return { ...DEFAULT_LOC, source: 'Default' };
        permissionGrantedRef.current = true;
      }

      try {
        const position = await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('GPS Timeout')), 10000);
          Geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(t);
              resolve(pos);
            },
            (err) => {
              clearTimeout(t);
              reject(err);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 },
          );
        });

        if (validLL(position.coords.latitude, position.coords.longitude)) {
          const accuracy = position.coords.accuracy || 0;
          setLocationSource(`GPS ±${accuracy.toFixed(0)}m`);
          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            source: 'GPS',
          };
        }
      } catch {}

      try {
        const position = await new Promise((resolve, reject) => {
          const t = setTimeout(
            () => reject(new Error('Network Timeout')),
            8000,
          );
          Geolocation.getCurrentPosition(
            (pos) => {
              clearTimeout(t);
              resolve(pos);
            },
            (err) => {
              clearTimeout(t);
              reject(err);
            },
            { enableHighAccuracy: false, timeout: 8000, maximumAge: 30000 },
          );
        });

        if (validLL(position.coords.latitude, position.coords.longitude)) {
          const accuracy = position.coords.accuracy || 0;
          setLocationSource(`Network ±${accuracy.toFixed(0)}m`);
          return {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy,
            source: 'Network',
          };
        }
      } catch {}

      setLocationSource('Default');
      return { ...DEFAULT_LOC, source: 'Default' };
    } finally {
    }
  }, []);

  // ── Marker update ─────────────────────────────────────────────
  const updateMarkerPosition = useCallback(
    (lat, lng, forceRaw = false) => {
      if (!isMountedRef.current || !validLL(lat, lng)) return;

      const now = Date.now();
      if (
        now - lastMarkerUpdateRef.current <
        (isNavigatingRef.current ? 150 : 100)
      )
        return;
      lastMarkerUpdateRef.current = now;

      if (
        isNavigatingRef.current &&
        routeCoordinatesRef.current &&
        !forceRaw
      ) {
        const snapped = snapToRoute(
          { latitude: lat, longitude: lng },
          routeCoordinatesRef.current,
          NAV_CONFIG.SNAP_TO_ROUTE_THRESHOLD,
        );
        if (snapped?.coordinate) {
          snappedUserCoordRef.current = snapped.coordinate;
          setSnappedUserCoord(snapped.coordinate);
          setUserMarkerCoord(snapped.coordinate);
          return;
        }
      }

      setUserMarkerCoord([lng, lat]);
      snappedUserCoordRef.current = null;
      setSnappedUserCoord(null);
    },
    [],
  );

  // ── Camera helpers ────────────────────────────────────────────
  const flyTo = useCallback(
    (lat, lng, zoom = 16, force = false) => {
      if (!cameraRef.current || !validLL(lat, lng)) return;

      const now = Date.now();
      if (!force && now - lastCameraUpdateRef.current < 500) return;

      const safeZoom = Math.min(Math.max(zoom, 5), 18);
      try {
        cameraRef.current.setCamera({
          centerCoordinate: [lng, lat],
          zoomLevel: safeZoom,
          animationDuration: 650,
          animationMode: 'flyTo',
        });
        lastCameraUpdateRef.current = Date.now();
        setZoomLevel(safeZoom);
      } catch {}
    },
    [],
  );

  const fitBounds = useCallback(
    (coords, padding = [ms(120), ms(40), ms(320), ms(40)]) => {
      if (!coords || coords.length < 2 || !cameraRef.current) return;
      try {
        const validCoords = coords.filter((c) => c && c.length >= 2);
        if (validCoords.length < 2) return;
        const lngs = validCoords.map((c) => c[0]);
        const lats = validCoords.map((c) => c[1]);
        cameraRef.current.fitBounds(
          [Math.max(...lngs), Math.max(...lats)],
          [Math.min(...lngs), Math.min(...lats)],
          padding,
          1000,
        );
      } catch {}
    },
    [],
  );

  // ── Watch cleanup ─────────────────────────────────────────────
  const clearNavigationWatch = useCallback(() => {
    if (locationWatchId.current !== null) {
      try {
        Geolocation.clearWatch(locationWatchId.current);
      } catch {}
      locationWatchId.current = null;
    }
    if (navIntervalRef.current) {
      try {
        clearInterval(navIntervalRef.current);
      } catch {}
      navIntervalRef.current = null;
    }
  }, []);

  const clearPassiveWatch = useCallback(() => {
    if (passiveWatchId.current !== null) {
      try {
        Geolocation.clearWatch(passiveWatchId.current);
      } catch {}
      passiveWatchId.current = null;
    }
  }, []);

  // ── Passive tracking ──────────────────────────────────────────
  const startPassiveTracking = useCallback(() => {
    if (!isMountedRef.current || isNavigatingRef.current) return;
    clearPassiveWatch();

    try {
      passiveWatchId.current = Geolocation.watchPosition(
        (position) => {
          if (!isMountedRef.current || isNavigatingRef.current) return;

          const { latitude, longitude, accuracy, heading, speed } =
            position.coords;
          if (!validLL(latitude, longitude) || accuracy > 200) return;

          const newLoc = { latitude, longitude };

          if (lastLocationRef.current) {
            const moved = calcDistance(
              lastLocationRef.current.latitude,
              lastLocationRef.current.longitude,
              latitude,
              longitude,
            );
            if (moved < 3) return;
          }

          setLocationSource(
            accuracy <= 50
              ? `GPS ±${accuracy.toFixed(0)}m`
              : accuracy <= 100
              ? `Network ±${accuracy.toFixed(0)}m`
              : `Low ±${accuracy.toFixed(0)}m`,
          );

          lastLocationRef.current = newLoc;
          setUserLoc(newLoc);
          updateMarkerPosition(latitude, longitude, true);
          setLocationAccuracy(accuracy || 0);

          if (heading !== null && !isNaN(heading) && heading >= 0)
            setUserHeading(heading);
          if (speed !== null && !isNaN(speed) && speed >= 0)
            gpsSpeedRef.current = speed;
        },
        () => {},
        LOCATION_TRACKING_CONFIG.PASSIVE,
      );
    } catch {}
  }, [clearPassiveWatch, updateMarkerPosition]);

  // ── Load spots ────────────────────────────────────────────────
  const loadSpots = useCallback(
    async (location, forceRefresh = false) => {
      if (!location || !validLL(location.latitude, location.longitude)) return;

      setSpotsLoading(true);
      try {
        const savedSpot = await ParkingService.getMySpot();
        setMySpot(savedSpot);

        let shouldFetch = forceRefresh;

        if (!shouldFetch && lastNearbyFetchLocRef.current) {
          const distMoved = calcDistance(
            location.latitude,
            location.longitude,
            lastNearbyFetchLocRef.current.latitude,
            lastNearbyFetchLocRef.current.longitude,
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
              NEARBY_CONFIG.RADIUS,
            );
            lastNearbyFetchLocRef.current = { ...location };
          } catch (e) {
            const isAuthErr = await handleAuthError(e);
            if (isAuthErr) return;
          }
        }

        let combined = [...nearbySpots];

        if (savedSpot?.isOccupied) {
          combined = combined.filter(
            (sp) =>
              calcDistance(
                sp.latitude,
                sp.longitude,
                savedSpot.latitude,
                savedSpot.longitude,
              ) > 5,
          );
          combined.push({ ...savedSpot, isMySpot: true });
        }

        combined = combined
          .map((sp) => ({
            ...sp,
            distance: calcDistance(
              location.latitude,
              location.longitude,
              sp.latitude,
              sp.longitude,
            ),
          }))
          .sort((a, b) => a.distance - b.distance);

        setAllSpots(combined);

        // ✅ Auto-open sheet after first load
        if (!hasAutoOpenedRef.current && combined.length > 0) {
          hasAutoOpenedRef.current = true;
          setTimeout(() => {
            if (isMountedRef.current) {
              setShowSpotsSheet(true);
              if (lastLocationRef.current) {
                flyTo(
                  lastLocationRef.current.latitude,
                  lastLocationRef.current.longitude,
                  16,
                  true,
                );
              }
              setTimeout(() => {
                autoHitFindParking();
              }, 1500);
            }
          }, 800);
        }
      } catch (e) {
        const isAuthErr = await handleAuthError(e);
        if (!isAuthErr) Logger.error('SPOTS', 'Load failed', e);
      } finally {
        setSpotsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleAuthError, flyTo],
  );

  // ── Auto hit find parking ─────────────────────────────────────
  const autoHitFindParking = useCallback(async () => {
    if (hasAutoLocationHitRef.current || spotsLoading) return;
    hasAutoLocationHitRef.current = true;

    setIsRefreshingLocation(true);
    try {
      const currentLocation = await getAccurateLocation();
      if (!isMountedRef.current) return;

      const displayLocation =
        currentLocation || lastLocationRef.current || userLoc;

      if (displayLocation) {
        setUserLoc(displayLocation);
        lastLocationRef.current = displayLocation;
        updateMarkerPosition(
          displayLocation.latitude,
          displayLocation.longitude,
          true,
        );
        flyTo(displayLocation.latitude, displayLocation.longitude, 16, true);
        await loadSpots(displayLocation, true);
      }
    } catch (e) {
      Logger.error('AUTO_LOCATION', 'Failed to get location', e);
    } finally {
      setIsRefreshingLocation(false);
    }
  }, [getAccurateLocation, userLoc, updateMarkerPosition, flyTo, loadSpots, spotsLoading]);

  // ── Reset nav state ───────────────────────────────────────────
  const resetNavigationState = useCallback(() => {
    routeCoordinatesRef.current = null;
    snappedUserCoordRef.current = null;
    destinationRef.current = null;

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
    setIsRerouting(false);
    setRerouteCount(0);
    setIsOffRoute(false);
    setOffRouteDistance(0);

    rerouteManager.reset();
  }, []);

  // ── Arrival ───────────────────────────────────────────────────
  const handleArrival = useCallback(async () => {
    if (
      !isMountedRef.current ||
      !isNavigatingRef.current ||
      isStoppingRef.current
    )
      return;

    isNavigatingRef.current = false;
    isStoppingRef.current = true;

    try {
      clearNavigationWatch();
      VoiceGuidance.announceArrival();

      if (isMountedRef.current) {
        setIsNavigating(false);
        setFollowUser(false);
        setNavigationProgress(1);
        setShowSpotsSheet(false);

        Alert.alert(
          'You Have Arrived!',
          'You have reached your destination.',
          [
            {
              text: 'OK',
              onPress: () => {
                if (!isMountedRef.current) return;
                cleanupNavigation();
                resetNavigationState();
                setTimeout(() => {
                  if (isMountedRef.current && !isNavigatingRef.current) {
                    startPassiveTracking();
                    if (lastLocationRef.current)
                      loadSpots(lastLocationRef.current, true);
                  }
                }, 250);
              },
            },
          ],
        );
      }
    } catch (e) {
      Logger.error('NAV', 'Arrival error', e);
    } finally {
      isStoppingRef.current = false;
    }
  }, [clearNavigationWatch, resetNavigationState, startPassiveTracking, loadSpots]);

  // ── Stop nav ──────────────────────────────────────────────────
  const stopNavigation = useCallback(async () => {
    if (!isMountedRef.current || isStoppingRef.current) return;

    isStoppingRef.current = true;
    isNavigatingRef.current = false;
    followUserRef.current = false;

    try {
      clearNavigationWatch();
      cleanupNavigation();

      if (isMountedRef.current) {
        setIsNavigating(false);
        setFollowUser(false);
        setShowSpotsSheet(false);
        resetNavigationState();
      }

      setTimeout(() => {
        if (isMountedRef.current && !isNavigatingRef.current) {
          startPassiveTracking();
          if (lastLocationRef.current)
            loadSpots(lastLocationRef.current, true);
        }
      }, 250);
    } catch (e) {
      Logger.error('NAV', 'Stop error', e);
    } finally {
      isStoppingRef.current = false;
    }
  }, [clearNavigationWatch, resetNavigationState, startPassiveTracking, loadSpots]);

  // ── Reroute ───────────────────────────────────────────────────
  const performReroute = useCallback(
    async (currentLoc) => {
      const dest = destinationRef.current;

      if (!dest || !validLL(currentLoc.latitude, currentLoc.longitude)) return;
      if (!isNavigatingRef.current || isStoppingRef.current) return;
      if (rerouteManager.isRerouting) return;

      rerouteManager.startReroute();
      setIsRerouting(true);
      setRerouteCount(rerouteManager.rerouteCount);

      try {
        RouteCache.invalidate(
          currentLoc.latitude,
          currentLoc.longitude,
          dest.latitude,
          dest.longitude,
        );

        const routeData = await RoutingService.fetchRoute(
          currentLoc.latitude,
          currentLoc.longitude,
          dest.latitude,
          dest.longitude,
          { skipCache: true, isReroute: true },
        );

        if (
          !isNavigatingRef.current ||
          !isMountedRef.current ||
          isStoppingRef.current
        ) {
          rerouteManager.completeReroute(false);
          setIsRerouting(false);
          return;
        }

        const routeObj = routeData.routes[0];
        const coords = routeObj.geometry.coordinates;
        const steps = routeObj.steps || [];

        routeLineManager.setFullRoute(coords, dest, routeObj.duration);
        stepTracker.setSteps(steps);

        totalDistanceRef.current = routeObj.distance;
        totalDurationRef.current = routeObj.duration;
        routeCoordinatesRef.current = coords;

        setRouteCoordinates(coords);
        setNavigationSteps(steps);
        setRouteInfo({
          totalDistance: routeObj.distance,
          totalDuration: routeObj.duration,
          stepsCount: steps.length,
        });
        setRemainingDistance(routeObj.distance);
        setRemainingDuration(routeObj.duration);
        setCurrentStepIndex(0);
        setNavigationProgress(0);
        setIsOffRoute(false);
        setOffRouteDistance(0);

        rerouteManager.completeReroute(true);
        setIsRerouting(false);
        setRerouteCount(rerouteManager.rerouteCount);
      } catch (error) {
        const isAuthErr = await handleAuthError(error);
        rerouteManager.completeReroute(false);
        setIsRerouting(false);
        setRerouteCount(rerouteManager.rerouteCount);

        if (isAuthErr) return;

        if (
          rerouteManager.rerouteCount >= 3 &&
          isMountedRef.current
        ) {
          Alert.alert(
            'Reroute Failed',
            `Unable to recalculate after ${rerouteManager.rerouteCount} attempts.`,
            [
              { text: 'Continue', style: 'cancel' },
              {
                text: 'Stop',
                style: 'destructive',
                onPress: () => stopNavigation(),
              },
            ],
          );
        }
      }
    },
    [stopNavigation, handleAuthError],
  );

  // ── Update route visual ───────────────────────────────────────
  const updateRouteVisual = useCallback(
    (currentLoc) => {
      if (!isMountedRef.current || !currentLoc) return;
      if (isStoppingRef.current || !isNavigatingRef.current) return;

      const now = Date.now();
      if (now - lastRouteUpdateRef.current < 250) return;
      lastRouteUpdateRef.current = now;

      try {
        if (routeLineManager.hasArrived(currentLoc)) {
          setTimeout(() => {
            if (isMountedRef.current && !isStoppingRef.current)
              handleArrival();
          }, 100);
          return;
        }
      } catch {}

      const currentCoords = routeCoordinatesRef.current;
      const dest = destinationRef.current;

      if (currentCoords?.length >= 2 && dest) {
        const distFromRoute = getDistanceFromRouteLine(
          currentLoc.latitude,
          currentLoc.longitude,
          currentCoords,
        );

        const distToDest = calcDistance(
          currentLoc.latitude,
          currentLoc.longitude,
          dest.latitude,
          dest.longitude,
        );

        const off = distFromRoute > NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD;
        setIsOffRoute(off);
        setOffRouteDistance(distFromRoute);

        if (
          distFromRoute > NAV_CONFIG.ROUTE_DEVIATION_THRESHOLD &&
          distToDest > NAV_CONFIG.REROUTE_MIN_DISTANCE_TO_DEST &&
          !rerouteManager.isRerouting &&
          rerouteManager.canReroute()
        ) {
          performReroute(currentLoc);
        }
      }

      try {
        const visibleRoute = routeLineManager.getVisibleRoute(currentLoc);
        if (visibleRoute?.changed && !isStoppingRef.current) {
          routeCoordinatesRef.current = visibleRoute.coordinates;
          setRouteCoordinates(visibleRoute.coordinates);
          setRemainingDistance(visibleRoute.remainingDistance);
          setNavigationProgress(visibleRoute.progress);

          const remainingTime = estimateRemainingTime(
            visibleRoute.remainingDistance,
            totalDistanceRef.current,
            totalDurationRef.current,
            gpsSpeedRef.current,
          );
          setRemainingDuration(remainingTime);
        }
      } catch {}

      try {
        const stepResult = stepTracker.update(currentLoc);
        if (stepResult.changed)
          setCurrentStepIndex(stepTracker.currentIndex);
        setDistanceToNextStep(stepResult.distanceToStep);
      } catch {}
    },
    [handleArrival, performReroute],
  );

  // ── Location enabled check ────────────────────────────────────
  const checkLocationEnabled = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const enabled = await new Promise((resolve) => {
        Geolocation.getCurrentPosition(
          () => resolve(true),
          () => resolve(false),
          { timeout: 3000 },
        );
      });
      if (!enabled) {
        Alert.alert(
          'Location Disabled',
          'Please enable location services.',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Settings', onPress: () => Linking.openSettings() },
          ],
        );
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  // ── Start location tracking ───────────────────────────────────
  const startLocationTracking = useCallback(() => {
    clearPassiveWatch();
    clearNavigationWatch();
    locationProcessor.reset();

    let lastLocationTime = Date.now();
    let watchWorking = false;

    const processLocation = (
      latitude,
      longitude,
      accuracy,
      heading,
      speed,
      source,
    ) => {
      if (!isMountedRef.current || isStoppingRef.current) return;
      if (!validLL(latitude, longitude) || accuracy > 500) return;

      const now = Date.now();
      if (now - lastLocationTime < 500) return;

      lastLocationTime = now;
      watchWorking = true;

      requestAnimationFrame(() => {
        if (!isMountedRef.current || isStoppingRef.current) return;

        const newLoc = { latitude, longitude };
        lastLocationRef.current = newLoc;

        updateMarkerPosition(latitude, longitude, false);

        if (heading !== null && !isNaN(heading) && heading >= 0)
          setUserHeading(heading);
        if (speed !== null && !isNaN(speed) && speed >= 0)
          gpsSpeedRef.current = speed;

        setLocationAccuracy(accuracy || 0);
        setLocationSource(`Nav ±${accuracy?.toFixed(0)}m [${source}]`);

        updateRouteVisual(newLoc);
      });
    };

    const startWatch = (name, config) => {
      try {
        locationWatchId.current = Geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude, accuracy, heading, speed } =
              pos.coords;
            processLocation(
              latitude,
              longitude,
              accuracy || 50,
              heading,
              speed,
              `W-${name}`,
            );
          },
          () => {
            watchWorking = false;
          },
          config,
        );
      } catch {}
    };

    startWatch('STD', {
      enableHighAccuracy: true,
      distanceFilter: 5,
      interval: 2000,
      fastestInterval: 1000,
      timeout: 20000,
      maximumAge: 5000,
    });

    const doFallback = () => {
      if (
        !isMountedRef.current ||
        !isNavigatingRef.current ||
        isStoppingRef.current
      )
        return;

      Geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude, accuracy, heading, speed } =
            pos.coords;
          processLocation(
            latitude,
            longitude,
            accuracy || 50,
            heading,
            speed,
            'FB-H',
          );
        },
        () => {
          Geolocation.getCurrentPosition(
            (pos) => {
              const c = pos.coords;
              processLocation(
                c.latitude,
                c.longitude,
                c.accuracy || 100,
                c.heading,
                c.speed,
                'FB-L',
              );
            },
            () => {},
            {
              enableHighAccuracy: false,
              timeout: 10000,
              maximumAge: 30000,
            },
          );
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 },
      );
    };

    setTimeout(() => {
      if (
        !watchWorking &&
        isMountedRef.current &&
        isNavigatingRef.current
      )
        doFallback();
    }, 3000);

    navIntervalRef.current = setInterval(() => {
      if (
        !isMountedRef.current ||
        !isNavigatingRef.current ||
        isStoppingRef.current
      )
        return;
      const dt = Date.now() - lastLocationTime;
      if (dt > 5000) doFallback();
    }, 3000);
  }, [
    clearPassiveWatch,
    clearNavigationWatch,
    updateMarkerPosition,
    updateRouteVisual,
  ]);

  // ── Start navigation ──────────────────────────────────────────
  const startNavigation = useCallback(async () => {
    const enabled = await checkLocationEnabled();
    if (!enabled) return;

    await VoiceGuidance.init();
    rerouteManager.reset();

    setShowSpotsSheet(false);

    isNavigatingRef.current = true;
    followUserRef.current = true;
    isStoppingRef.current = false;

    setIsNavigating(true);
    setFollowUser(true);
    setCurrentStepIndex(0);
    setIsRerouting(false);
    setRerouteCount(0);
    setIsOffRoute(false);

    startLocationTracking();

    setTimeout(() => {
      if (
        !cameraRef.current ||
        !lastLocationRef.current ||
        !isNavigatingRef.current
      )
        return;
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
      } catch {}
    }, 300);
  }, [checkLocationEnabled, startLocationTracking]);

  // ── Recenter ──────────────────────────────────────────────────
  const recenterOnUser = useCallback(() => {
    followUserRef.current = true;
    setFollowUser(true);
    lastCameraUpdateRef.current = 0;

    if (!lastLocationRef.current || !cameraRef.current) return;

    try {
      const heading = routeLineManager.getNavigationBearing(
        lastLocationRef.current,
      );
      cameraRef.current.setCamera({
        centerCoordinate: [
          lastLocationRef.current.longitude,
          lastLocationRef.current.latitude,
        ],
        zoomLevel: NAV_CONFIG.NAVIGATION_ZOOM,
        heading,
        pitch: isNavigatingRef.current ? NAV_CONFIG.NAVIGATION_TILT : 0,
        animationDuration: 600,
      });
    } catch {}
  }, []);

  const toggleVoice = useCallback(() => {
    const enabled = VoiceGuidance.toggle();
    setVoiceEnabled(enabled);
  }, []);

  // ── ✅ WebSocket callbacks ─────────────────────────────────────
  const handleSlotFree = useCallback(
    (wsMessage) => {
      // wsMessage = { type, latitude, longitude, message }
      if (!isMountedRef.current) return;

      Logger.success('WS', '🅿️ Slot free notification received!', wsMessage);

      // Calculate distance from user to the free slot
      const userLocation = lastLocationRef.current || userLoc;
      let distance = null;
      if (
        wsMessage.latitude &&
        wsMessage.longitude &&
        userLocation?.latitude
      ) {
        distance = calcDistance(
          userLocation.latitude,
          userLocation.longitude,
          wsMessage.latitude,
          wsMessage.longitude,
        );
      }

      // Show notification banner
      setSlotFreeNotif({
        latitude: wsMessage.latitude,
        longitude: wsMessage.longitude,
        message: wsMessage.message || 'A parking spot just opened up!',
        distance,
      });

      // Refresh spots list so map updates
      setTimeout(() => {
        if (isMountedRef.current) {
          loadSpots(lastLocationRef.current || userLoc, true);
        }
      }, 1500);
    },
    [userLoc, loadSpots],
  );

  const handleWsConnected = useCallback(() => {
    Logger.success('WS', '✅ Real-time parking updates active');
  }, []);

  const handleWsDisconnected = useCallback(() => {
    Logger.warn('WS', '⚠️ Real-time updates disconnected');
  }, []);

  // ── ✅ WebSocket hook ──────────────────────────────────────────
  const {
    status: wsStatus,
    reconnect: wsReconnect,
    isConnected: wsConnected,
  } = useParkingWebSocket({
    onSlotFree: handleSlotFree,
    onConnected: handleWsConnected,
    onDisconnected: handleWsDisconnected,
    enabled: !!currentUserId,
  });

  // ── ✅ Dismiss notification ────────────────────────────────────
  const dismissSlotFreeNotif = useCallback(() => {
    setSlotFreeNotif(null);
  }, []);

  // ── ✅ Navigate to free slot ───────────────────────────────────
  const navigateToFreeSlot = useCallback(
    (slotInfo) => {
      setSlotFreeNotif(null);
      if (slotInfo?.latitude && slotInfo?.longitude) {
        fetchAndShowRoute(slotInfo.latitude, slotInfo.longitude, true);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Init ──────────────────────────────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;

    const initialize = async () => {
      try {
        VoiceGuidance.init().catch(() => {});

        let initialLocation = null;

        if (
          prefetchedLocation?.latitude &&
          prefetchedLocation?.longitude
        ) {
          initialLocation = prefetchedLocation;
          permissionGrantedRef.current = true;
          setLocationSource(
            `Ready ±${prefetchedLocation.accuracy?.toFixed(0) || '?'}m`,
          );
        } else {
          initialLocation = await getQuickLocation();

          getAccurateLocation()
            .then((accurateLoc) => {
              if (!isMountedRef.current || !accurateLoc) return;

              const initLoc = lastLocationRef.current;
              const moved = initLoc
                ? calcDistance(
                    initLoc.latitude,
                    initLoc.longitude,
                    accurateLoc.latitude,
                    accurateLoc.longitude,
                  )
                : Infinity;

              if (moved > 30) {
                setUserLoc(accurateLoc);
                lastLocationRef.current = accurateLoc;
                updateMarkerPosition(
                  accurateLoc.latitude,
                  accurateLoc.longitude,
                  true,
                );
                loadSpots(accurateLoc, true).catch(() => {});
                flyTo(accurateLoc.latitude, accurateLoc.longitude, 16);
              }
            })
            .catch(() => {});
        }

        if (!isMountedRef.current) return;

        const displayLocation = initialLocation || {
          latitude: 40.7128,
          longitude: -74.006,
          accuracy: 0,
          source: 'Default (NYC)',
        };

        setUserLoc(displayLocation);
        lastLocationRef.current = displayLocation;
        updateMarkerPosition(
          displayLocation.latitude,
          displayLocation.longitude,
          true,
        );

        // Center map immediately
        setTimeout(() => {
          if (!cameraRef.current || !isMountedRef.current) return;
          try {
            cameraRef.current.setCamera({
              centerCoordinate: [
                displayLocation.longitude,
                displayLocation.latitude,
              ],
              zoomLevel: 16,
              animationDuration: 400,
            });
          } catch {}
        }, 50);

        startPassiveTracking();
        loadSpots(displayLocation, true).catch(() => {});
      } catch (e) {
        Logger.error('INIT', 'Initialization failed', e);
      }
    };

    initialize();

    nearbyRefreshTimerRef.current = setInterval(() => {
      if (
        isNavigatingRef.current ||
        !lastLocationRef.current ||
        !isMountedRef.current
      )
        return;
      loadSpots(lastLocationRef.current, true);
    }, NEARBY_CONFIG.AUTO_REFRESH_INTERVAL);

    const appStateSub = AppState.addEventListener(
      'change',
      (nextState) => {
        const wasBackground = appStateRef.current.match(
          /inactive|background/,
        );
        const isNowActive = nextState === 'active';

        if (wasBackground && isNowActive) {
          if (isNavigatingRef.current && !isStoppingRef.current)
            startLocationTracking();
          else if (!isNavigatingRef.current) startPassiveTracking();

          if (lastLocationRef.current)
            loadSpots(lastLocationRef.current, true);
        }
        appStateRef.current = nextState;
      },
    );

    return () => {
      isMountedRef.current = false;
      isNavigatingRef.current = false;

      clearNavigationWatch();
      clearPassiveWatch();

      if (nearbyRefreshTimerRef.current)
        clearInterval(nearbyRefreshTimerRef.current);
      if (navIntervalRef.current) clearInterval(navIntervalRef.current);

      RouteCache.clear();
      cleanupNavigation();
      rerouteManager.reset();
      appStateSub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Route fetch ───────────────────────────────────────────────
  const fetchAndShowRoute = useCallback(
    async (destLat, destLng, startNav = false) => {
      const currentLoc = lastLocationRef.current || userLoc;
      if (!validLL(destLat, destLng)) {
        Alert.alert('Error', 'Invalid destination');
        return;
      }

      setRouteLoading(true);
      try {
        const distance = calcDistance(
          currentLoc.latitude,
          currentLoc.longitude,
          destLat,
          destLng,
        );

        if (distance < 20) {
          setRouteLoading(false);
          Alert.alert('Very Close', `Only ${distance.toFixed(0)}m away.`);
          return;
        }

        const routeData = await RoutingService.fetchRoute(
          currentLoc.latitude,
          currentLoc.longitude,
          destLat,
          destLng,
        );

        const routeObj = routeData.routes[0];
        const coords = routeObj.geometry.coordinates;
        const steps = routeObj.steps || [];
        const dest = { latitude: destLat, longitude: destLng };

        routeLineManager.setFullRoute(coords, dest);
        stepTracker.setSteps(steps);

        totalDistanceRef.current = routeObj.distance;
        totalDurationRef.current = routeObj.duration;
        routeCoordinatesRef.current = coords;

        setRouteCoordinates(coords);
        setDestination(dest);
        setNavigationSteps(steps);
        setRouteInfo({
          totalDistance: routeObj.distance,
          totalDuration: routeObj.duration,
          stepsCount: steps.length,
        });
        setRemainingDistance(routeObj.distance);
        setRemainingDuration(routeObj.duration);
        setCurrentStepIndex(0);
        setNavigationProgress(0);

        fitBounds(coords);

        if (startNav) setTimeout(() => startNavigation(), 450);
      } catch (error) {
        const isAuthErr = await handleAuthError(error);
        if (!isAuthErr)
          Alert.alert('Route Error', 'Unable to calculate route.');
      } finally {
        setRouteLoading(false);
      }
    },
    [userLoc, fitBounds, startNavigation, handleAuthError],
  );

  // Update navigateToFreeSlot now that fetchAndShowRoute is defined
  const navigateToFreeSlotFinal = useCallback(
    (slotInfo) => {
      setSlotFreeNotif(null);
      if (slotInfo?.latitude && slotInfo?.longitude) {
        fetchAndShowRoute(slotInfo.latitude, slotInfo.longitude, true);
      }
    },
    [fetchAndShowRoute],
  );

  // ── Actions ───────────────────────────────────────────────────
  const refreshNearbySpots = useCallback(async () => {
    await loadSpots(lastLocationRef.current || userLoc, true);
  }, [loadSpots, userLoc]);

  const handleSpotPress = useCallback((spot) => {
    setShowSpotsSheet(false);
    setSelectedSpot(spot);
    setShowModal(true);
  }, []);

  const handleOccupy = useCallback(async () => {
    if (!currentUserId) {
      Alert.alert('Not Logged In', 'Please login.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Login',
          onPress: () =>
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] }),
        },
      ]);
      return;
    }

    const location = await getLoc();
    if (!location?.latitude || !validLL(location.latitude, location.longitude)) {
      Alert.alert('Error', 'Could not get location');
      return;
    }

    Alert.alert(
      'Occupy Spot',
      `📍 ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: async () => {
            try {
              const spotData = await ParkingService.occupySpot(
                location.latitude,
                location.longitude,
                currentUserId,
              );
              setMySpot(spotData);
              setUserLoc(location);
              lastLocationRef.current = location;
              updateMarkerPosition(
                location.latitude,
                location.longitude,
                true,
              );
              await loadSpots(location, true);
              flyTo(location.latitude, location.longitude, 17, true);
              Alert.alert('Success', 'Parking spot saved!');
            } catch (e) {
              const isAuthErr = await handleAuthError(e);
              if (!isAuthErr)
                Alert.alert('Failed', e.message || 'Could not save spot');
            }
          },
        },
      ],
    );
  }, [
    currentUserId,
    getLoc,
    loadSpots,
    flyTo,
    updateMarkerPosition,
    navigation,
    handleAuthError,
  ]);

  const handleVacate = useCallback(() => {
    if (!currentUserId) {
      Alert.alert('Not Logged In', 'Please login.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Login',
          onPress: () =>
            navigation.reset({ index: 0, routes: [{ name: 'Login' }] }),
        },
      ]);
      return;
    }
    if (!mySpot?.isOccupied) {
      Alert.alert('Info', 'No active parking spot');
      return;
    }

    Alert.alert(
      'Vacate Spot',
      `📍 ${mySpot.latitude.toFixed(6)}, ${mySpot.longitude.toFixed(6)}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Vacate',
          style: 'destructive',
          onPress: async () => {
            try {
              const vacatedSpot = await ParkingService.vacateSpot(
                mySpot.latitude,
                mySpot.longitude,
                currentUserId,
              );
              setMySpot(vacatedSpot);
              await loadSpots(userLoc, true);
              Alert.alert('Success', 'Spot released!');
            } catch (e) {
              const isAuthErr = await handleAuthError(e);
              if (!isAuthErr)
                Alert.alert(
                  'Failed',
                  e.message || 'Could not release spot',
                );
            }
          },
        },
      ],
    );
  }, [
    currentUserId,
    mySpot,
    loadSpots,
    userLoc,
    navigation,
    handleAuthError,
  ]);

  const onLocate = useCallback(async () => {
    setShowSpotsSheet(false);
    const location = await getLoc();
    if (!location) return;
    setUserLoc(location);
    lastLocationRef.current = location;
    updateMarkerPosition(location.latitude, location.longitude, true);
    await loadSpots(location, true);
    flyTo(location.latitude, location.longitude, 16, true);
  }, [getLoc, loadSpots, flyTo, updateMarkerPosition]);

  const onFindParking = useCallback(async () => {
    const next = !showSpotsSheet;
    setShowSpotsSheet(next);

    if (next) {
      const available = allSpots.find(
        (sp) => !sp.isOccupied && !sp.isMySpot,
      );
      if (!available) {
        Alert.alert('No Spots', 'No spots available nearby');
        setShowSpotsSheet(false);
        return;
      }
      flyTo(available.latitude, available.longitude, 17, true);
    }
  }, [showSpotsSheet, allSpots, flyTo]);

  const zoomIn = useCallback(() => {
    const z = Math.min(zoomLevel + 1, 18);
    setZoomLevel(z);
    cameraRef.current?.setCamera({ zoomLevel: z, animationDuration: 250 });
  }, [zoomLevel]);

  const zoomOut = useCallback(() => {
    const z = Math.max(zoomLevel - 1, 5);
    setZoomLevel(z);
    cameraRef.current?.setCamera({ zoomLevel: z, animationDuration: 250 });
  }, [zoomLevel]);

  const showRouteStats = useCallback(() => {
    const stats = NavigationDebug.getFullStatus();
    const rr = rerouteManager.getStats();
    Alert.alert(
      'Debug',
      [
        `Spots: ${allSpots.length}`,
        `Location: ${locationSource}`,
        `Route: ${routeCoordinates ? 'ACTIVE' : 'NONE'}`,
        `Reroutes: ${rr.rerouteCount}/${rr.maxReroutes}`,
        `Off-route: ${offRouteDistance.toFixed(0)}m`,
        `Cache: ${stats.cache.hitRate}`,
        `Voice: ${stats.voice.enabled ? 'ON' : 'OFF'}`,
        `WS: ${wsStatus}`,
      ].join('\n'),
    );
  }, [
    allSpots.length,
    locationSource,
    routeCoordinates,
    offRouteDistance,
    wsStatus,
  ]);

  const runSearch = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query) return;

    setShowSpotsSheet(false);
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
        8000,
      );

      const results = await response.json();
      if (!results?.length) {
        Alert.alert('Not Found', 'No results found');
        return;
      }

      const lat = parseFloat(results[0].lat);
      const lon = parseFloat(results[0].lon);
      if (!validLL(lat, lon)) {
        Alert.alert('Error', 'Invalid location data');
        return;
      }

      setSearchMarker({
        latitude: lat,
        longitude: lon,
        name: results[0].display_name || query,
      });

      cameraRef.current?.setCamera({
        centerCoordinate: [lon, lat],
        zoomLevel: 17,
        animationMode: 'flyTo',
        animationDuration: 900,
      });
      setZoomLevel(17);
    } catch {
      Alert.alert('Error', 'Search failed. Please try again.');
    } finally {
      setSearching(false);
    }
  }, [searchQuery]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchMarker(null);
  }, []);

  const onStartNavigation = useCallback(
    (spot) => {
      setShowModal(false);
      setShowNavigation(false);
      setShowSpotsSheet(false);
      fetchAndShowRoute(spot.latitude, spot.longitude, true);
    },
    [fetchAndShowRoute],
  );

  const onShowSteps = useCallback(
    (spot) => {
      setShowModal(false);
      setShowNavigation(true);
      setShowSpotsSheet(false);
      if (!routeCoordinates)
        fetchAndShowRoute(spot.latitude, spot.longitude, false);
    },
    [fetchAndShowRoute, routeCoordinates],
  );

  const onNavigateExternal = useCallback(
    (spot) => {
      const location = lastLocationRef.current || userLoc;
      Linking.openURL(
        `https://www.google.com/maps/dir/?api=1&origin=${location.latitude},${location.longitude}&destination=${spot.latitude},${spot.longitude}&travelmode=driving`,
      );
    },
    [userLoc],
  );

  const handleMapTouchStart = useCallback(() => {
    if (!isNavigating) setShowSpotsSheet(false);

    if (isNavigating && followUser) {
      followUserRef.current = false;
      setFollowUser(false);
    }
  }, [isNavigating, followUser]);

  // ── Memos ──────────────────────────────────────────────────────
  const availableCount = useMemo(
    () => allSpots.filter((sp) => !sp.isOccupied && !sp.isMySpot).length,
    [allSpots],
  );

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

      if (currentLoc && isNavigating && routeCoordinates.length > 2) {
        let minDist = Infinity;
        let splitIndex = 0;

        for (let i = 0; i < routeCoordinates.length - 1; i++) {
          const p = routeCoordinates[i];
          if (!p || p.length !== 2) continue;
          const d = calcDistance(
            currentLoc.latitude,
            currentLoc.longitude,
            p[1],
            p[0],
          );
          if (d < minDist) {
            minDist = d;
            splitIndex = i;
          }
        }

        if (splitIndex > 0 && minDist < 50) {
          traveledCoords = routeCoordinates.slice(0, splitIndex + 1);
          remainingCoords = routeCoordinates.slice(splitIndex);
          showTraveled = traveledCoords.length >= 2;
        }
      }

      if (!remainingCoords || remainingCoords.length < 2)
        remainingCoords = EMPTY_LINE_COORDS;
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
    } catch {
      return {
        traveledCoords: EMPTY_LINE_COORDS,
        remainingCoords: EMPTY_LINE_COORDS,
        showTraveled: false,
        showRemaining: false,
      };
    }
  }, [routeCoordinates, isNavigating]);

  // ── Bottom nav ────────────────────────────────────────────────
  const onTabPress = useCallback((key) => {
    setShowSpotsSheet(false);
    if (key === 'Explore') return;
    if (key === 'Saved')
      return Alert.alert('Saved', 'Connect this tab to your screen.');
    if (key === 'Add') return Alert.alert('Add', 'Connect this action.');
    if (key === 'Contribute')
      return Alert.alert('Contribute', 'Connect this tab.');
    if (key === 'More') return Alert.alert('More', 'Connect this tab.');
  }, []);

  // ── Render ────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="transparent"
        translucent
      />

      <View style={styles.mapContainer}>
        <MapLibreGL.MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          styleJSON={EMPTY_STYLE}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled
          rotateEnabled
          pitchEnabled
          scrollEnabled={!isNavigating || !followUser}
          zoomEnabled
          onDidFinishRenderingMapFully={() => setTilesLoaded(true)}
          onTouchStart={handleMapTouchStart}>
          <MapLibreGL.Camera
            ref={cameraRef}
            maxZoomLevel={18}
            minZoomLevel={5}
            followUserLocation={isNavigating && followUser}
            followUserMode={
              isNavigating && followUser ? 'course' : 'normal'
            }
            followZoomLevel={isNavigating ? NAV_CONFIG.NAVIGATION_ZOOM : 15}
            followPitch={
              isNavigating && followUser ? NAV_CONFIG.NAVIGATION_TILT : 0
            }
            animationMode="easeTo"
            animationDuration={600}
          />

          <MapLibreGL.RasterSource
            id="osm"
            tileUrlTemplates={[
              'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
              'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
            ]}
            tileSize={256}
            maxZoomLevel={19}
            minZoomLevel={1}>
            <MapLibreGL.RasterLayer
              id="osmLayer"
              sourceID="osm"
              style={{ rasterOpacity: 1 }}
              maxZoomLevel={19}
            />
          </MapLibreGL.RasterSource>

          {/* Traveled route */}
          <MapLibreGL.ShapeSource
            id="traveled-route-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.traveledCoords,
              },
            }}>
            <MapLibreGL.LineLayer
              id="traveled-route"
              style={{
                lineColor: '#A0A0A0',
                lineWidth: ms(8),
                lineOpacity: routeVisualization.showTraveled ? 0.6 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Remaining route border */}
          <MapLibreGL.ShapeSource
            id="remaining-route-border-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.remainingCoords,
              },
            }}>
            <MapLibreGL.LineLayer
              id="remaining-route-border"
              style={{
                lineColor: COLORS.white,
                lineWidth: ms(12),
                lineOpacity: routeVisualization.showRemaining ? 0.9 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Remaining route */}
          <MapLibreGL.ShapeSource
            id="remaining-route-source"
            shape={{
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: routeVisualization.remainingCoords,
              },
            }}>
            <MapLibreGL.LineLayer
              id="remaining-route"
              style={{
                lineColor: isRerouting
                  ? COLORS.warning
                  : isOffRoute
                  ? '#FF5722'
                  : isNavigating
                  ? '#4285F4'
                  : COLORS.primary,
                lineWidth: ms(7),
                lineOpacity: routeVisualization.showRemaining ? 1 : 0,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>

          <ParkingSpotsLayer
            spots={allSpots}
            isHidden={isNavigating}
            onSpotPress={handleSpotPress}
          />

          <SearchMarkerLayer
            coordinate={searchMarker}
            isVisible={!isNavigating && !!searchMarker}
          />

          <DestinationLayer coordinate={destination} />

          <UserLocationLayer
            coordinate={userMarkerCoord}
            snappedCoordinate={snappedUserCoord}
            isNavigating={isNavigating}
            accuracy={locationAccuracy}
          />
        </MapLibreGL.MapView>

        {/* ── Tiles loading ─────────────────────────────────────── */}
        {!tilesLoaded && (
          <View style={styles.tilesLoading}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.tilesLoadingText}>Loading tiles...</Text>
          </View>
        )}

        {/* ── Route calculating overlay ─────────────────────────── */}
        {routeLoading && (
          <View style={styles.routeOverlay}>
            <Card style={styles.routeOverlayCard}>
              <ActivityIndicator size="large" color={COLORS.primary} />
              <Text style={styles.routeOverlayText}>
                Calculating route...
              </Text>
            </Card>
          </View>
        )}

        {/* ── Refreshing location indicator ─────────────────────── */}
        {isRefreshingLocation && (
          <View
            style={[
              styles.statusIndicator,
              { top: insets.top + vs(80) },
            ]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.statusIndicatorText}>
              📍 Updating your location...
            </Text>
          </View>
        )}

        {/* ── Finding parking indicator ─────────────────────────── */}
        {spotsLoading && !isRefreshingLocation && (
          <View
            style={[
              styles.statusIndicator,
              { top: insets.top + vs(80) },
            ]}>
            <ActivityIndicator size="small" color={COLORS.primary} />
            <Text style={styles.statusIndicatorText}>
              🅿️ Finding parking...
            </Text>
          </View>
        )}

        {/* ── ✅ WebSocket status dot ───────────────────────────── */}
        {!isNavigating && (
          <View
            style={[
              styles.wsStatusWrap,
              { top: insets.top + vs(18) },
            ]}>
            <WsStatusDot
              status={wsStatus}
              showLabel={true}
              onPress={
                wsStatus !== WS_STATUS.CONNECTED
                  ? wsReconnect
                  : undefined
              }
            />
          </View>
        )}

        {/* ── ✅ Slot Free Notification Banner ─────────────────── */}
        <SlotFreeNotification
          visible={!!slotFreeNotif}
          message={slotFreeNotif?.message}
          latitude={slotFreeNotif?.latitude}
          longitude={slotFreeNotif?.longitude}
          distance={slotFreeNotif?.distance}
          onNavigate={navigateToFreeSlotFinal}
          onDismiss={dismissSlotFreeNotif}
          topOffset={
            isNavigating
              ? insets.top + vs(140)
              : insets.top + vs(100)
          }
        />

        {/* ── Top UI (not navigating) ───────────────────────────── */}
        {!isNavigating && (
          <>
            <TopSearchBar
              insets={insets}
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={runSearch}
              onClear={clearSearch}
              searching={searching}
            />

            <ActionChipsRow
              insets={insets}
              mySpot={mySpot}
              gettingLoc={false}
              onOccupy={handleOccupy}
              onVacate={handleVacate}
            />
          </>
        )}

        {/* ── Right controls ────────────────────────────────────── */}
        <RightMapControls
          insets={insets}
          onLocate={onLocate}
          onLongLocate={showRouteStats}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
        />

        {/* ── Navigation panel ──────────────────────────────────── */}
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
            isRerouting={isRerouting}
            rerouteCount={rerouteCount}
            isOffRoute={isOffRoute}
          />
        )}

        {/* ── Find Parking button ───────────────────────────────── */}
        <FindParkingButton
          insets={insets}
          count={availableCount}
          onPress={onFindParking}
          hidden={isNavigating}
          disabled={spotsLoading || routeLoading}
        />

        {/* ── End Navigation button ─────────────────────────────── */}
        <EndNavigationButton
          insets={insets}
          onPress={stopNavigation}
          hidden={!isNavigating}
        />

        {/* ── Spots sheet ───────────────────────────────────────── */}
        <SpotsSheet
          insets={insets}
          spots={allSpots}
          onPressSpot={handleSpotPress}
          hidden={isNavigating || !showSpotsSheet}
          locationSource={locationSource}
        />

        {/* ── Bottom nav bar ────────────────────────────────────── */}
        <BottomNavBar
          activeKey="Explore"
          onTabPress={onTabPress}
          insets={insets}
        />

        {/* ── Spot detail modal ─────────────────────────────────── */}
        <Modal
          visible={showModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowModal(false)}>
          <View style={styles.modalOverlay}>
            <TouchableOpacity
              style={styles.modalBackdrop}
              onPress={() => setShowModal(false)}
              activeOpacity={1}
            />
            <Card style={styles.modalCard}>
              <View style={styles.modalHandle} />

              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {selectedSpot?.isMySpot ? 'Your Spot' : 'Parking Spot'}
                </Text>
                <TouchableOpacity
                  onPress={() => setShowModal(false)}
                  hitSlop={10}>
                  <Text style={styles.modalClose}>✕</Text>
                </TouchableOpacity>
              </View>

              {selectedSpot && (
                <ScrollView
                  style={{ maxHeight: vs(460) }}
                  showsVerticalScrollIndicator={false}>
                  <View style={styles.modalBadgeRow}>
                    <View
                      style={[
                        styles.modalStatusBadge,
                        selectedSpot.isOccupied
                          ? styles.badgeRed
                          : styles.badgeGreen,
                      ]}>
                      <Text style={styles.modalStatusText}>
                        {selectedSpot.isOccupied ? 'Occupied' : 'Available'}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.modalInfo}>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Distance</Text>
                      <Text style={styles.infoValue}>
                        {formatDistance(selectedSpot.distance)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Device</Text>
                      <Text style={styles.infoValue}>
                        {selectedSpot.deviceName || 'Unknown'}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Updated</Text>
                      <Text style={styles.infoValue}>
                        {formatTime(selectedSpot.createdAt)}
                      </Text>
                    </View>
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Coordinates</Text>
                      <Text style={styles.infoValueSmall}>
                        {selectedSpot.latitude?.toFixed(6)},{' '}
                        {selectedSpot.longitude?.toFixed(6)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => onStartNavigation(selectedSpot)}>
                      <LinearGradient
                        colors={['#4CAF50', '#2E7D32']}
                        style={styles.modalPrimaryBtn}>
                        <Text style={styles.modalPrimaryText}>
                          Start Navigation
                        </Text>
                      </LinearGradient>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.9}
                      onPress={() => onShowSteps(selectedSpot)}>
                      <View style={styles.modalSecondaryBtn}>
                        <Text style={styles.modalSecondaryText}>
                          View Steps
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => onNavigateExternal(selectedSpot)}>
                      <Text style={styles.modalLink}>
                        Open in Google Maps
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={refreshNearbySpots}
                      style={{ marginTop: vs(8) }}>
                      <Text style={styles.modalLinkMuted}>
                        {spotsLoading
                          ? 'Refreshing…'
                          : 'Refresh nearby spots'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </ScrollView>
              )}
            </Card>
          </View>
        </Modal>

        {/* ── Navigation steps modal ────────────────────────────── */}
        <Modal
          visible={showNavigation}
          transparent
          animationType="slide"
          onRequestClose={() => setShowNavigation(false)}>
          <SafeAreaView style={styles.stepsOverlay}>
            <Card style={styles.stepsCard}>
              <View style={styles.stepsHeader}>
                <TouchableOpacity
                  onPress={() => setShowNavigation(false)}
                  style={styles.stepsBack}
                  hitSlop={10}>
                  <Text style={styles.stepsBackText}>←</Text>
                </TouchableOpacity>
                <Text style={styles.stepsTitle}>Navigation Steps</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (destination) {
                      setShowNavigation(false);
                      onStartNavigation(destination);
                    }
                  }}
                  style={styles.stepsStart}
                  hitSlop={10}>
                  <Text style={styles.stepsStartText}>Start</Text>
                </TouchableOpacity>
              </View>

              <FlatList
                data={navigationSteps}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.stepsList}
                renderItem={({ item, index }) => (
                  <NavigationStepItem
                    step={item}
                    index={index}
                    currentStepIndex={currentStepIndex}
                    distanceToNextStep={distanceToNextStep}
                    totalSteps={navigationSteps.length}
                  />
                )}
                ListEmptyComponent={
                  <View style={styles.stepsEmpty}>
                    <Text style={styles.stepsEmptyText}>
                      No steps available
                    </Text>
                  </View>
                }
              />
            </Card>
          </SafeAreaView>
        </Modal>
      </View>
    </View>
  );
}

export default function ParkingMapScreen(props) {
  return (
    <MapErrorBoundary>
      <ParkingMapScreenInner {...props} />
    </MapErrorBoundary>
  );
}

// ───────────────────────────────────────────────────────────────
// STYLES
// ───────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  mapContainer: { flex: 1, backgroundColor: COLORS.bg },

  card: {
    backgroundColor: COLORS.white,
    borderRadius: ms(18),
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.09,
    shadowRadius: 18,
    elevation: 10,
  },

  // ── Status indicators ──────────────────────────────────────
  statusIndicator: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: s(14),
    paddingVertical: vs(8),
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: COLORS.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    zIndex: 50,
  },
  statusIndicatorText: {
    color: COLORS.text2,
    fontSize: rf(10.5),
    fontWeight: '700',
  },

  // ── ✅ WebSocket status ────────────────────────────────────
  wsStatusWrap: {
    position: 'absolute',
    right: s(66),
    zIndex: 45,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: s(8),
    paddingVertical: vs(4),
    borderRadius: ms(10),
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // ── Search bar ─────────────────────────────────────────────
  topWrap: {
    position: 'absolute',
    left: s(14),
    right: s(14),
    zIndex: 40,
  },
  searchCard: { borderRadius: ms(14) },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: s(12),
    height: ms(46),
  },
  searchEmoji: { fontSize: rf(14), marginRight: s(8) },
  searchInput: {
    flex: 1,
    height: '100%',
    fontSize: rf(12),
    color: COLORS.text,
    fontWeight: Platform.OS === 'ios' ? '600' : '700',
  },
  searchClear: {
    paddingHorizontal: s(8),
    height: '100%',
    justifyContent: 'center',
  },
  searchClearText: {
    color: COLORS.hint,
    fontSize: rf(12),
    fontWeight: '800',
  },
  searchGoBtn: {
    height: '100%',
    width: ms(46),
    borderTopRightRadius: ms(14),
    borderBottomRightRadius: ms(14),
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchGoBtnText: {
    color: COLORS.white,
    fontSize: rf(16),
    fontWeight: '900',
  },

  // ── Action chips ───────────────────────────────────────────
  chipsWrap: {
    position: 'absolute',
    left: s(14),
    right: s(14),
    zIndex: 39,
    flexDirection: 'row',
    gap: s(10),
  },
  chipBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
    elevation: 6,
  },
  chipDisabled: { opacity: 0.55 },
  chipInner: {
    height: ms(38),
    paddingHorizontal: s(12),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chipText: { color: COLORS.text, fontSize: rf(10.5), fontWeight: '800' },
  chipIcon: { fontSize: rf(12) },

  // ── Right controls ─────────────────────────────────────────
  rightControlsWrap: {
    position: 'absolute',
    right: s(14),
    zIndex: 35,
    gap: vs(10),
  },
  ctrlBtn: {},
  ctrlCard: {
    width: ms(42),
    height: ms(42),
    borderRadius: ms(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlIcon: { fontSize: rf(18), color: COLORS.text, fontWeight: '900' },

  // ── Tiles loading ──────────────────────────────────────────
  tilesLoading: {
    position: 'absolute',
    top: vs(120),
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: ms(14),
    paddingVertical: vs(8),
    paddingHorizontal: s(12),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  tilesLoadingText: {
    color: COLORS.text2,
    fontSize: rf(10.5),
    fontWeight: '700',
  },

  // ── Route overlay ──────────────────────────────────────────
  routeOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 60,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  routeOverlayCard: {
    padding: ms(18),
    borderRadius: ms(18),
    alignItems: 'center',
    gap: vs(10),
  },
  routeOverlayText: {
    color: COLORS.text,
    fontSize: rf(12),
    fontWeight: '800',
  },

  // ── Find parking button ────────────────────────────────────
  findBtnWrap: {
    position: 'absolute',
    left: s(20),
    right: s(20),
    zIndex: 32,
  },
  findBtn: {
    height: ms(48),
    borderRadius: ms(14),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  findBtnIcon: { fontSize: rf(15), color: COLORS.white },
  findBtnText: {
    color: COLORS.white,
    fontSize: rf(12.5),
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  findCountPill: {
    marginLeft: s(6),
    minWidth: ms(26),
    height: ms(22),
    borderRadius: ms(11),
    backgroundColor: 'rgba(255,255,255,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(8),
  },
  findCountText: {
    color: COLORS.white,
    fontWeight: '900',
    fontSize: rf(10.5),
  },

  // ── End navigation button ──────────────────────────────────
  endBtnWrap: {
    position: 'absolute',
    left: s(20),
    right: s(20),
    zIndex: 33,
  },
  endBtn: {
    height: ms(48),
    borderRadius: ms(14),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 10,
  },
  endBtnIcon: { fontSize: rf(14), color: COLORS.white, fontWeight: '900' },
  endBtnText: {
    color: COLORS.white,
    fontSize: rf(12.5),
    fontWeight: '900',
    letterSpacing: 0.2,
  },

  // ── Spots sheet ────────────────────────────────────────────
  sheetWrap: {
    position: 'absolute',
    left: s(14),
    right: s(14),
    zIndex: 28,
  },
  sheetCard: { borderRadius: ms(18), paddingBottom: vs(10) },
  sheetHandle: {
    alignSelf: 'center',
    width: ms(44),
    height: ms(5),
    borderRadius: ms(3),
    backgroundColor: '#E9E9E9',
    marginTop: vs(10),
    marginBottom: vs(10),
  },
  sheetListWrap: { maxHeight: vs(220) },
  sheetListContent: { paddingBottom: vs(6) },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  pIcon: {
    width: ms(34),
    height: ms(34),
    borderRadius: ms(17),
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: s(12),
    backgroundColor: '#FBFBFB',
  },
  pIconText: { fontWeight: '900', color: COLORS.text, fontSize: rf(12) },
  sheetRowMid: { flex: 1 },
  sheetRowTitle: {
    fontSize: rf(11.5),
    fontWeight: '900',
    color: COLORS.text,
  },
  sheetRowSub: {
    marginTop: vs(2),
    fontSize: rf(9.8),
    fontWeight: '700',
    color: COLORS.text2,
  },
  sheetRowRight: { alignItems: 'flex-end', minWidth: s(70) },
  sheetEta: { fontSize: rf(11), fontWeight: '900' },
  sheetDist: {
    marginTop: vs(2),
    fontSize: rf(9.5),
    color: COLORS.text2,
    fontWeight: '700',
  },
  sheetFooter: { paddingHorizontal: s(14), paddingTop: vs(10) },
  sheetFooterText: {
    fontSize: rf(9.2),
    color: COLORS.text2,
    fontWeight: '700',
    lineHeight: rf(12),
  },
  sheetFooterText2: {
    marginTop: vs(6),
    fontSize: rf(9.2),
    color: COLORS.hint,
    fontWeight: '800',
  },

  // ── Navigation panel ───────────────────────────────────────
  navPanelWrap: {
    position: 'absolute',
    left: s(14),
    right: s(14),
    zIndex: 70,
  },
  navPanel: { borderRadius: ms(18), paddingBottom: vs(12) },
  navBannerWarn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  navBannerText: {
    color: COLORS.text2,
    fontWeight: '800',
    fontSize: rf(10.5),
  },
  navBannerOff: {
    paddingHorizontal: s(14),
    paddingVertical: vs(10),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: '#FFF3E0',
    borderTopLeftRadius: ms(18),
    borderTopRightRadius: ms(18),
  },
  navBannerOffText: {
    color: '#8A4B00',
    fontWeight: '900',
    fontSize: rf(10.5),
  },
  navProgressTrack: {
    height: ms(6),
    backgroundColor: '#EFEFEF',
    borderTopLeftRadius: ms(18),
    borderTopRightRadius: ms(18),
    overflow: 'hidden',
  },
  navProgressFill: { height: '100%', backgroundColor: COLORS.success },
  navTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingTop: vs(10),
  },
  navCloseBtn: {
    width: ms(34),
    height: ms(34),
    borderRadius: ms(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F3F3',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  navCloseText: { fontWeight: '900', color: COLORS.text },
  navStats: {
    flex: 1,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: s(8),
  },
  navEta: { fontWeight: '900', color: COLORS.text, fontSize: rf(12) },
  navDot: {
    width: ms(5),
    height: ms(5),
    borderRadius: ms(3),
    backgroundColor: '#D0D0D0',
  },
  navDist: { fontWeight: '900', color: COLORS.text2, fontSize: rf(11) },
  navSmBtns: { flexDirection: 'row', gap: s(8) },
  navSmBtn: {
    width: ms(34),
    height: ms(34),
    borderRadius: ms(12),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  navSmBtnInactive: { opacity: 0.6 },
  navSmBtnActive: { borderColor: '#CDE7FF', backgroundColor: '#F3FAFF' },
  navSmBtnText: { fontSize: rf(12) },
  navMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(14),
    paddingTop: vs(12),
    gap: s(12),
  },
  navIconBox: {
    width: ms(46),
    height: ms(46),
    borderRadius: ms(16),
    backgroundColor: '#EAF2FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DDE9FF',
  },
  navIcon: { fontSize: rf(18) },
  navNextDist: {
    fontSize: rf(10.5),
    fontWeight: '900',
    color: COLORS.primary,
  },
  navInstr: {
    marginTop: vs(3),
    fontSize: rf(12),
    fontWeight: '900',
    color: COLORS.text,
    lineHeight: rf(16),
  },
  navThenRow: { paddingHorizontal: s(14), paddingTop: vs(10) },
  navThenLabel: {
    color: COLORS.hint,
    fontWeight: '900',
    fontSize: rf(9.5),
  },
  navThenText: {
    marginTop: vs(3),
    color: COLORS.text2,
    fontWeight: '800',
    fontSize: rf(10.5),
  },

  // ── Modals ─────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  modalBackdrop: { ...StyleSheet.absoluteFillObject },
  modalCard: {
    marginHorizontal: s(14),
    marginBottom: vs(12),
    borderRadius: ms(20),
    paddingBottom: vs(12),
  },
  modalHandle: {
    alignSelf: 'center',
    width: ms(44),
    height: ms(5),
    borderRadius: ms(3),
    backgroundColor: '#E9E9E9',
    marginTop: vs(10),
    marginBottom: vs(8),
  },
  modalHeader: {
    paddingHorizontal: s(14),
    paddingBottom: vs(10),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: { fontSize: rf(13), fontWeight: '900', color: COLORS.text },
  modalClose: {
    fontSize: rf(14),
    fontWeight: '900',
    color: COLORS.hint,
  },
  modalBadgeRow: { paddingHorizontal: s(14), paddingBottom: vs(8) },
  modalStatusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: s(10),
    paddingVertical: vs(6),
    borderRadius: ms(999),
    borderWidth: 1,
  },
  badgeGreen: { backgroundColor: '#EAF7EE', borderColor: '#CDEFD9' },
  badgeRed: { backgroundColor: '#FCEBEC', borderColor: '#F6C9CD' },
  modalStatusText: {
    fontWeight: '900',
    fontSize: rf(10),
    color: COLORS.text,
  },
  modalInfo: {
    marginHorizontal: s(14),
    borderRadius: ms(16),
    backgroundColor: '#FAFAFA',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoRow: {
    paddingHorizontal: s(12),
    paddingVertical: vs(10),
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  infoLabel: { fontSize: rf(10), fontWeight: '800', color: COLORS.text2 },
  infoValue: { fontSize: rf(10.5), fontWeight: '900', color: COLORS.text },
  infoValueSmall: {
    fontSize: rf(9.5),
    fontWeight: '900',
    color: COLORS.text,
  },
  modalActions: {
    paddingHorizontal: s(14),
    paddingTop: vs(12),
    gap: vs(10),
  },
  modalPrimaryBtn: {
    height: ms(46),
    borderRadius: ms(14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: {
    color: COLORS.white,
    fontWeight: '900',
    fontSize: rf(12),
  },
  modalSecondaryBtn: {
    height: ms(46),
    borderRadius: ms(14),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F6FF',
    borderWidth: 1,
    borderColor: '#DDE6FF',
  },
  modalSecondaryText: {
    color: COLORS.secondary,
    fontWeight: '900',
    fontSize: rf(12),
  },
  modalLink: {
    textAlign: 'center',
    color: COLORS.primary,
    fontWeight: '900',
    fontSize: rf(11.2),
    marginTop: vs(2),
  },
  modalLinkMuted: {
    textAlign: 'center',
    color: COLORS.text2,
    fontWeight: '800',
    fontSize: rf(10.5),
  },

  // ── Steps modal ────────────────────────────────────────────
  stepsOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.18)',
    justifyContent: 'flex-end',
  },
  stepsCard: {
    marginHorizontal: s(14),
    marginBottom: vs(12),
    borderRadius: ms(20),
    overflow: 'hidden',
    maxHeight: vs(560),
  },
  stepsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: vs(12),
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.white,
  },
  stepsBack: {
    width: ms(36),
    height: ms(36),
    borderRadius: ms(14),
    backgroundColor: '#F3F3F3',
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepsBackText: {
    fontWeight: '900',
    color: COLORS.text,
    fontSize: rf(12),
  },
  stepsTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '900',
    color: COLORS.text,
    fontSize: rf(12),
  },
  stepsStart: {
    paddingHorizontal: s(10),
    paddingVertical: vs(8),
    backgroundColor: '#EAF7EE',
    borderRadius: ms(12),
    borderWidth: 1,
    borderColor: '#CDEFD9',
  },
  stepsStartText: {
    color: '#2E7D32',
    fontWeight: '900',
    fontSize: rf(10.5),
  },
  stepsList: { padding: s(12), paddingBottom: vs(22) },
  stepsEmpty: { padding: s(16), alignItems: 'center' },
  stepsEmptyText: { color: COLORS.text2, fontWeight: '800' },

  stepItem: { flexDirection: 'row', paddingVertical: vs(10) },
  stepItemPast: { opacity: 0.65 },
  stepLeft: { width: ms(40), alignItems: 'center' },
  stepIcon: {
    width: ms(28),
    height: ms(28),
    borderRadius: ms(10),
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFAFA',
  },
  stepIconCurrent: {
    backgroundColor: '#EAF2FF',
    borderColor: '#DDE9FF',
  },
  stepIconPast: { backgroundColor: '#F7F7F7' },
  stepIconText: { fontSize: rf(12) },
  stepLine: {
    width: ms(3),
    flex: 1,
    backgroundColor: '#EAEAEA',
    marginTop: vs(6),
    borderRadius: ms(3),
  },
  stepLinePast: { backgroundColor: '#DEDEDE' },
  stepRight: { flex: 1, paddingLeft: s(8) },
  stepTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  stepNum: { fontSize: rf(10), fontWeight: '900', color: COLORS.text },
  stepDist: {
    fontSize: rf(9.8),
    fontWeight: '900',
    color: COLORS.text2,
  },
  stepInstr: {
    marginTop: vs(4),
    fontSize: rf(11),
    fontWeight: '900',
    color: COLORS.text,
    lineHeight: rf(15),
  },
  stepTime: {
    marginTop: vs(6),
    fontSize: rf(9.8),
    fontWeight: '800',
    color: COLORS.text2,
  },
  stepTxtPast: { color: COLORS.text2 },
  stepBadge: {
    marginTop: vs(8),
    alignSelf: 'flex-start',
    backgroundColor: '#FFF3E0',
    borderRadius: ms(999),
    paddingHorizontal: s(10),
    paddingVertical: vs(5),
    borderWidth: 1,
    borderColor: '#FFE0B2',
  },
  stepBadgeText: {
    color: '#8A4B00',
    fontWeight: '900',
    fontSize: rf(9.8),
  },

  // ── Error boundary ─────────────────────────────────────────
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: s(16),
  },
  errorIcon: { fontSize: rf(36) },
  errorTitle: {
    marginTop: vs(10),
    fontWeight: '900',
    color: COLORS.text,
    fontSize: rf(14),
  },
  errorSub: {
    marginTop: vs(6),
    color: COLORS.text2,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorBtn: {
    marginTop: vs(14),
    height: ms(46),
    borderRadius: ms(14),
    paddingHorizontal: s(18),
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBtnText: { color: COLORS.white, fontWeight: '900' },
});