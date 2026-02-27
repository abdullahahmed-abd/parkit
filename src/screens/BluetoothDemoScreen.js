import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  StatusBar,
  ScrollView,
  Alert,
  TouchableOpacity,
  Animated,
  FlatList,
  Modal,
  Linking,
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  NativeModules,
  DeviceEventEmitter,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import BluetoothService from '../services/BluetoothService';

const { BluetoothModule, ActivityRecognitionModule } = NativeModules;

// ═══════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════

const DEBUG = __DEV__;
const STORAGE_KEYS = {
  SELECTED_DEVICE: 'selectedDevice',
  HISTORY: 'history',
  PARKED_LOC: 'parkedLoc',
  DRIVING_LOC: 'drivingLoc',
  PARKING_STATUS: 'parkingStatus',
};

const MAX_HISTORY_ITEMS = 30;
const AR_POLL_INTERVAL = 10000;
const AR_DETECTION_DELAY = 3000;

// Logger
const createLogger = (prefix) => ({
  log: (...args) => DEBUG && console.log(`[${prefix}][${new Date().toISOString()}]`, ...args),
  warn: (...args) => DEBUG && console.warn(`[${prefix}][${new Date().toISOString()}]`, ...args),
  error: (...args) => console.error(`[${prefix}][${new Date().toISOString()}]`, ...args),
});

const logger = createLogger('ParkIt');

// Utility functions
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isValidLatLng = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const formatLatLng = (loc, decimals = 6) => {
  const lat = toNum(loc?.latitude);
  const lng = toNum(loc?.longitude);
  if (!isValidLatLng(lat, lng)) return 'N/A';
  return `${lat.toFixed(decimals)}, ${lng.toFixed(decimals)}`;
};

const formatCoordinate = (value, decimals = 6) => {
  const num = toNum(value);
  return num !== null ? num.toFixed(decimals) : 'N/A';
};

const calculateDistance = (a, b) => {
  const lat1 = toNum(a?.latitude);
  const lon1 = toNum(a?.longitude);
  const lat2 = toNum(b?.latitude);
  const lon2 = toNum(b?.longitude);

  if (!isValidLatLng(lat1, lon1) || !isValidLatLng(lat2, lon2)) return null;

  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - (s1 + s2)));
  return R * c;
};

const formatDistance = (meters) => {
  if (!Number.isFinite(meters)) return 'N/A';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
};

const ACTIVITY_CONFIG = {
  still: { label: 'STILL', icon: '🧍', color: '#37474F' },
  walking: { label: 'WALKING', icon: '🚶', color: '#2E7D32' },
  running: { label: 'RUNNING', icon: '🏃', color: '#E65100' },
  in_vehicle: { label: 'IN VEHICLE', icon: '🚗', color: '#1565C0' },
  on_bicycle: { label: 'BICYCLE', icon: '🚲', color: '#6A1B9A' },
  unknown: { label: 'UNKNOWN', icon: '❓', color: '#455A64' },
};

const getActivityConfig = (state) => ACTIVITY_CONFIG[state] || ACTIVITY_CONFIG.unknown;

// ═══════════════════════════════════════════════════════════
// CUSTOM HOOKS
// ═══════════════════════════════════════════════════════════

const useLatestRef = (value) => {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

const usePulseAnimation = (isActive) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let animation;
    if (isActive) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.3,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => animation?.stop();
  }, [isActive, pulseAnim]);

  return pulseAnim;
};

const useAsyncStorage = () => {
  const save = useCallback(async (key, value) => {
    try {
      await AsyncStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      logger.error('Storage save error:', key, e);
    }
  }, []);

  const load = useCallback(async (key) => {
    try {
      const data = await AsyncStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    } catch (e) {
      logger.error('Storage load error:', key, e);
      return null;
    }
  }, []);

  const remove = useCallback(async (keys) => {
    try {
      await AsyncStorage.multiRemove(Array.isArray(keys) ? keys : [keys]);
    } catch (e) {
      logger.error('Storage remove error:', keys, e);
    }
  }, []);

  return { save, load, remove };
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const BluetoothDemoScreen = () => {
  // ─── State ────────────────────────────────────────────────
  const [bootLoading, setBootLoading] = useState(true);
  const [isBtSyncing, setIsBtSyncing] = useState(false);
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showDeviceModal, setShowDeviceModal] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [connectionTime, setConnectionTime] = useState(null);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Ready');
  const [drivingLocation, setDrivingLocation] = useState(null);
  const [parkedLocation, setParkedLocation] = useState(null);
  const [connectionHistory, setConnectionHistory] = useState([]);

  // Manual Parking State
  const [isParked, setIsParked] = useState(false);
  const [parkTime, setParkTime] = useState(null);
  const [unparkTime, setUnparkTime] = useState(null);
  const [unparkLocation, setUnparkLocation] = useState(null);

  // Activity Recognition State
  const [arState, setArState] = useState({
    permission: false,
    enabled: false,
    activity: 'unknown',
    confidence: 0,
    updatedAt: 0,
  });

  // ─── Refs ─────────────────────────────────────────────────
  const mountedRef = useRef(true);
  const arSubRef = useRef(null);
  const arPollRef = useRef(null);
  const lastConnectedRef = useRef({ address: null, name: null });

  const selectedDeviceRef = useLatestRef(selectedDevice);
  const connectedDeviceRef = useLatestRef(connectedDevice);
  const drivingLocationRef = useLatestRef(drivingLocation);
  const arStateRef = useLatestRef(arState);
  const parkedLocationRef = useLatestRef(parkedLocation);

  // ─── Hooks ────────────────────────────────────────────────
  const pulseAnim = usePulseAnimation(isConnected || isParked);
  const storage = useAsyncStorage();

  // ─── Derived Values ───────────────────────────────────────
  const lastDistance = useMemo(() => {
    if (!parkedLocation || !unparkLocation) return null;
    return calculateDistance(parkedLocation, unparkLocation);
  }, [parkedLocation, unparkLocation]);

  const activityConfig = useMemo(
    () => getActivityConfig(arState.activity),
    [arState.activity]
  );

  const arBadgeText = useMemo(() => {
    if (!ActivityRecognitionModule) return 'AR N/A';
    if (!arState.enabled) return 'AR OFF';
    return `${activityConfig.icon} ${activityConfig.label}`;
  }, [arState.enabled, activityConfig]);

  // ═══════════════════════════════════════════════════════════
  // LOCATION SERVICES
  // ═══════════════════════════════════════════════════════════

  const getIPLocation = useCallback(async () => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      
      const response = await fetch('http://ip-api.com/json/', {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      const data = await response.json();
      if (data?.status === 'success') {
        return {
          latitude: data.lat,
          longitude: data.lon,
          city: data.city || 'Unknown',
          source: 'IP (Approximate)',
          accuracy: 5000,
          time: Date.now(),
        };
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        logger.error('IP location error:', e);
      }
    }
    return null;
  }, []);

  const getNativeLocation = useCallback(async (fresh = false) => {
    try {
      if (!BluetoothModule) return null;

      const locationFn = fresh
        ? BluetoothModule.getFreshLocation
        : BluetoothModule.getCurrentLocation;

      if (!locationFn) return null;

      const loc = await locationFn();
      const lat = toNum(loc?.latitude);
      const lng = toNum(loc?.longitude);

      if (isValidLatLng(lat, lng)) {
        return { ...loc, latitude: lat, longitude: lng };
      }
    } catch (e) {
      logger.error('Native location error:', e);
    }
    return null;
  }, []);

  const getLocation = useCallback(
    async ({ fresh = false } = {}) => {
      if (!mountedRef.current) return null;

      setIsGettingLocation(true);
      setLocationStatus(fresh ? 'Getting live GPS...' : 'Getting GPS...');

      try {
        const nativeLoc = await getNativeLocation(fresh);
        if (nativeLoc?.latitude && nativeLoc?.longitude) {
          setLocationStatus('GPS ✅');
          return {
            latitude: nativeLoc.latitude,
            longitude: nativeLoc.longitude,
            accuracy: nativeLoc.accuracy,
            time: nativeLoc.time || Date.now(),
            source: 'GPS',
          };
        }

        const ipLoc = await getIPLocation();
        if (ipLoc) {
          setLocationStatus(ipLoc.city || 'IP ✅');
          return ipLoc;
        }

        setLocationStatus('Default Location');
        return {
          latitude: 23.2599,
          longitude: 77.4126,
          city: 'Bhopal',
          source: 'Default',
          accuracy: 99999,
          time: Date.now(),
        };
      } finally {
        if (mountedRef.current) {
          setIsGettingLocation(false);
        }
      }
    },
    [getNativeLocation, getIPLocation]
  );

  const openMaps = useCallback((loc) => {
    const lat = toNum(loc?.latitude);
    const lng = toNum(loc?.longitude);
    if (!isValidLatLng(lat, lng)) return;
    
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch((e) => logger.error('Maps open error:', e));
  }, []);

  // ═══════════════════════════════════════════════════════════
  // PARKING ACTIONS
  // ═══════════════════════════════════════════════════════════

  const handlePark = useCallback(async () => {
    try {
      setIsGettingLocation(true);
      const loc = await getLocation({ fresh: true });
      
      if (!loc || !mountedRef.current) {
        Alert.alert('Error', 'Could not get your current location. Please try again.');
        return;
      }

      const now = new Date();
      const parkData = {
        ...loc,
        parkedAt: now.toISOString(),
      };

      setParkedLocation(parkData);
      setIsParked(true);
      setParkTime(now.toLocaleTimeString());
      setUnparkLocation(null);
      setUnparkTime(null);

      await storage.save(STORAGE_KEYS.PARKED_LOC, parkData);
      await storage.save(STORAGE_KEYS.PARKING_STATUS, { isParked: true, parkTime: now.toISOString() });

      // Add to history
      const entry = {
        type: 'park',
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        location: parkData,
        activity: arStateRef.current.activity,
      };

      setConnectionHistory((prev) => {
        const newHistory = [entry, ...prev.slice(0, MAX_HISTORY_ITEMS - 1)];
        storage.save(STORAGE_KEYS.HISTORY, newHistory);
        return newHistory;
      });

      Alert.alert(
        '🅿️ Vehicle Parked',
        `Your parking location has been saved!\n\nLatitude: ${formatCoordinate(loc.latitude)}\nLongitude: ${formatCoordinate(loc.longitude)}\nTime: ${now.toLocaleTimeString()}\nSource: ${loc.source || 'GPS'}`,
        [
          { text: 'OK' },
          { text: 'View on Map', onPress: () => openMaps(loc) },
        ]
      );

    } catch (e) {
      logger.error('Park error:', e);
      Alert.alert('Error', 'Failed to save parking location. Please try again.');
    } finally {
      setIsGettingLocation(false);
    }
  }, [getLocation, storage, arStateRef, openMaps]);

  const handleUnpark = useCallback(async () => {
    if (!isParked || !parkedLocationRef.current) {
      Alert.alert('Notice', 'No parking location found. Please park your vehicle first.');
      return;
    }

    try {
      setIsGettingLocation(true);
      const loc = await getLocation({ fresh: true });
      
      if (!loc || !mountedRef.current) {
        Alert.alert('Error', 'Could not get your current location. Please try again.');
        return;
      }

      const now = new Date();
      const parkedLoc = parkedLocationRef.current;
      const distance = calculateDistance(parkedLoc, loc);

      setUnparkLocation(loc);
      setUnparkTime(now.toLocaleTimeString());
      setIsParked(false);

      await storage.save(STORAGE_KEYS.PARKING_STATUS, { isParked: false, unparkTime: now.toISOString() });

      // Add to history
      const entry = {
        type: 'unpark',
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        location: loc,
        parkLocation: parkedLoc,
        distanceMeters: distance,
        activity: arStateRef.current.activity,
      };

      setConnectionHistory((prev) => {
        const newHistory = [entry, ...prev.slice(0, MAX_HISTORY_ITEMS - 1)];
        storage.save(STORAGE_KEYS.HISTORY, newHistory);
        return newHistory;
      });

      Alert.alert(
        '🚗 Vehicle Unparked',
        `Unpark location recorded!\n\nLatitude: ${formatCoordinate(loc.latitude)}\nLongitude: ${formatCoordinate(loc.longitude)}\nTime: ${now.toLocaleTimeString()}\n\n📍 Parked Location:\nLat: ${formatCoordinate(parkedLoc.latitude)}\nLng: ${formatCoordinate(parkedLoc.longitude)}\n\n📏 Distance: ${formatDistance(distance)}`,
        [
          { text: 'OK' },
          { text: 'View Parked Location', onPress: () => openMaps(parkedLoc) },
        ]
      );

    } catch (e) {
      logger.error('Unpark error:', e);
      Alert.alert('Error', 'Failed to record unpark location. Please try again.');
    } finally {
      setIsGettingLocation(false);
    }
  }, [isParked, parkedLocationRef, getLocation, storage, arStateRef, openMaps]);

  // ═══════════════════════════════════════════════════════════
  // PERMISSIONS
  // ═══════════════════════════════════════════════════════════

  const requestLocationPermission = useCallback(async () => {
    if (Platform.OS !== 'android') return true;

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission Required',
          message: 'ParkIt needs access to your location to save your parking spot accurately.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );

      const ok = granted === PermissionsAndroid.RESULTS.GRANTED;
      setLocationStatus(ok ? 'Permission Granted ✅' : 'Permission Denied ❌');
      return ok;
    } catch (e) {
      logger.error('Location permission error:', e);
      setLocationStatus('Permission Error');
      return false;
    }
  }, []);

  const requestArPermission = useCallback(async () => {
    if (Platform.OS !== 'android') {
      setArState((prev) => ({ ...prev, permission: true }));
      return true;
    }

    try {
      logger.log('Requesting ACTIVITY_RECOGNITION permission...');

      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
        {
          title: 'Activity Recognition Permission',
          message: 'This app needs activity recognition to detect your movement state (walking, driving, etc.).',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        }
      );

      if (Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
      }

      const ok = result === PermissionsAndroid.RESULTS.GRANTED;
      setArState((prev) => ({ ...prev, permission: ok }));
      return ok;
    } catch (e) {
      logger.error('AR permission error:', e);
      setArState((prev) => ({ ...prev, permission: false }));
      return false;
    }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // ACTIVITY RECOGNITION
  // ═══════════════════════════════════════════════════════════

  const readLastAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.getLast || !mountedRef.current) return;

    try {
      const last = await ActivityRecognitionModule.getLast();
      logger.log('AR getLast:', last);

      if (last && mountedRef.current) {
        setArState((prev) => ({
          ...prev,
          activity: last.state || 'unknown',
          confidence: Number(last.confidence ?? 0),
          updatedAt: Number(last.timestamp ?? 0),
          enabled: Boolean(last.enabled),
        }));
      }
    } catch (e) {
      logger.error('Read AR error:', e);
    }
  }, []);

  const startAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.start) {
      Alert.alert('Not Available', 'Activity Recognition module is not available on this device.');
      return;
    }

    let permOk = arStateRef.current.permission;
    if (!permOk) {
      permOk = await requestArPermission();
      if (!permOk) {
        Alert.alert('Permission Required', 'Activity recognition permission is required for this feature.');
        return;
      }
    }

    try {
      logger.log('Starting AR service...');
      await ActivityRecognitionModule.start(5000);
      setArState((prev) => ({ ...prev, enabled: true }));
      setTimeout(readLastAr, AR_DETECTION_DELAY);
    } catch (e) {
      logger.error('Start AR error:', e);
      Alert.alert('Error', `Failed to start activity recognition: ${e?.message || e}`);
    }
  }, [requestArPermission, readLastAr, arStateRef]);

  const stopAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.stop) return;

    try {
      logger.log('Stopping AR service...');
      await ActivityRecognitionModule.stop();
      setArState((prev) => ({ ...prev, enabled: false }));
      await readLastAr();
    } catch (e) {
      logger.error('Stop AR error:', e);
    }
  }, [readLastAr]);

  const initActivityRecognition = useCallback(async () => {
    if (!ActivityRecognitionModule) {
      logger.error('ActivityRecognitionModule is NULL');
      return;
    }

    // Subscribe to events
    if (!arSubRef.current) {
      arSubRef.current = DeviceEventEmitter.addListener(
        'ActivityRecognition',
        (event) => {
          logger.log('AR Event:', event);
          if (event?.state && mountedRef.current) {
            setArState((prev) => ({
              ...prev,
              activity: event.state,
              confidence: Number(event.confidence ?? 0),
              updatedAt: Number(event.timestamp ?? Date.now()),
            }));
          }
        }
      );
    }

    await readLastAr();

    const permOk = await requestArPermission();
    if (!permOk) {
      logger.warn('AR permission not granted');
      return;
    }

    try {
      await ActivityRecognitionModule.start(5000);
      setArState((prev) => ({ ...prev, enabled: true }));
      setTimeout(readLastAr, AR_DETECTION_DELAY);
    } catch (e) {
      logger.error('AR auto-start failed:', e);
    }

    // Polling
    if (!arPollRef.current) {
      arPollRef.current = setInterval(readLastAr, AR_POLL_INTERVAL);
    }
  }, [readLastAr, requestArPermission]);

  // ═══════════════════════════════════════════════════════════
  // BLUETOOTH
  // ═══════════════════════════════════════════════════════════

  const shouldHandleEvent = useCallback((device) => {
    const selected = selectedDeviceRef.current;
    if (!selected) return true;
    if (device?.address) return device.address === selected.address;
    return lastConnectedRef.current?.address === selected.address;
  }, [selectedDeviceRef]);

  const getDeviceName = useCallback((device) => {
    const nameFromEvent = device?.name || device?.namme;
    if (nameFromEvent && nameFromEvent !== 'Unknown Device') return nameFromEvent;
    return (
      connectedDeviceRef.current?.name ||
      lastConnectedRef.current?.name ||
      selectedDeviceRef.current?.name ||
      'Unknown Device'
    );
  }, [connectedDeviceRef, selectedDeviceRef]);

  const onDeviceConnect = useCallback(
    async (device) => {
      logger.log('Device connected:', device);

      if (!shouldHandleEvent(device) || !mountedRef.current) return;

      lastConnectedRef.current = {
        address: device?.address || null,
        name: device?.name || null,
      };

      const now = new Date();
      const loc = await getLocation({ fresh: true });

      if (!mountedRef.current) return;

      setDrivingLocation(loc);
      storage.save(STORAGE_KEYS.DRIVING_LOC, loc);
      setIsConnected(true);
      setConnectedDevice(device);
      setConnectionTime(now.toLocaleTimeString());

      const entry = {
        type: 'connect',
        device: device?.name || 'Unknown Device',
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        location: loc,
        activity: arStateRef.current.activity,
      };

      setConnectionHistory((prev) => {
        const newHistory = [entry, ...prev.slice(0, MAX_HISTORY_ITEMS - 1)];
        storage.save(STORAGE_KEYS.HISTORY, newHistory);
        return newHistory;
      });
    },
    [shouldHandleEvent, getLocation, storage, arStateRef]
  );

  const onDeviceDisconnect = useCallback(
    async (device) => {
      logger.log('Device disconnected:', device);

      if (!shouldHandleEvent(device) || !mountedRef.current) return;

      const now = new Date();
      const loc = await getLocation({ fresh: true });

      if (!mountedRef.current) return;

      setIsConnected(false);
      setConnectionTime(now.toLocaleTimeString());
      setParkedLocation(loc);
      storage.save(STORAGE_KEYS.PARKED_LOC, loc);

      const startLoc = drivingLocationRef.current;
      const dist = calculateDistance(startLoc, loc);

      const entry = {
        type: 'disconnect',
        device: getDeviceName(device),
        time: now.toLocaleTimeString(),
        date: now.toLocaleDateString(),
        location: loc,
        distanceMeters: dist,
        activity: arStateRef.current.activity,
      };

      setConnectionHistory((prev) => {
        const newHistory = [entry, ...prev.slice(0, MAX_HISTORY_ITEMS - 1)];
        storage.save(STORAGE_KEYS.HISTORY, newHistory);
        return newHistory;
      });
    },
    [shouldHandleEvent, getLocation, getDeviceName, storage, drivingLocationRef, arStateRef]
  );

  const startBluetoothListening = useCallback(async () => {
    setIsBtSyncing(true);
    try {
      const enabled = await BluetoothService.isBluetoothEnabled();
      setBluetoothEnabled(enabled);

      if (!enabled) return;

      const devices = await BluetoothService.getPairedDevices();
      setPairedDevices(devices);

      await BluetoothService.stopListening();
      await BluetoothService.startListening({
        onConnect: onDeviceConnect,
        onDisconnect: onDeviceDisconnect,
        onStateChange: (s) => setBluetoothEnabled(!!s.enabled),
      });
    } catch (e) {
      logger.error('Bluetooth listening error:', e);
    } finally {
      if (mountedRef.current) {
        setIsBtSyncing(false);
      }
    }
  }, [onDeviceConnect, onDeviceDisconnect]);

  // ═══════════════════════════════════════════════════════════
  // INITIALIZATION & CLEANUP
  // ═══════════════════════════════════════════════════════════

  const loadSavedData = useCallback(async () => {
    const [device, history, parked, driving, parkingStatus] = await Promise.all([
      storage.load(STORAGE_KEYS.SELECTED_DEVICE),
      storage.load(STORAGE_KEYS.HISTORY),
      storage.load(STORAGE_KEYS.PARKED_LOC),
      storage.load(STORAGE_KEYS.DRIVING_LOC),
      storage.load(STORAGE_KEYS.PARKING_STATUS),
    ]);

    if (device) setSelectedDevice(device);
    if (history) setConnectionHistory(history);
    if (parked) setParkedLocation(parked);
    if (driving) setDrivingLocation(driving);
    if (parkingStatus) {
      setIsParked(parkingStatus.isParked || false);
      if (parkingStatus.parkTime) {
        setParkTime(new Date(parkingStatus.parkTime).toLocaleTimeString());
      }
    }
  }, [storage]);

  useEffect(() => {
    logger.log('Screen mounted');
    mountedRef.current = true;

    const init = async () => {
      try {
        await requestLocationPermission();
        await loadSavedData();
        await startBluetoothListening();
        await initActivityRecognition();
      } catch (e) {
        logger.error('Init error:', e);
      } finally {
        if (mountedRef.current) {
          setBootLoading(false);
        }
      }
    };

    init();

    return () => {
      logger.log('Screen unmounting');
      mountedRef.current = false;
      BluetoothService.stopListening();

      if (arSubRef.current) {
        arSubRef.current.remove();
        arSubRef.current = null;
      }

      if (arPollRef.current) {
        clearInterval(arPollRef.current);
        arPollRef.current = null;
      }
    };
  }, []);

  // ═══════════════════════════════════════════════════════════
  // UI ACTIONS
  // ═══════════════════════════════════════════════════════════

  const testLocation = useCallback(async () => {
    try {
      const loc = await getLocation({ fresh: true });
      Alert.alert(
        '📍 Current GPS Location',
        `Latitude: ${formatCoordinate(loc.latitude)}\nLongitude: ${formatCoordinate(loc.longitude)}\nAccuracy: ${loc.accuracy ? Math.round(loc.accuracy) + ' meters' : 'N/A'}\nSource: ${loc.source || 'N/A'}`,
        [
          { text: 'OK' },
          { text: 'Open in Maps', onPress: () => openMaps(loc) },
        ]
      );
    } catch (e) {
      Alert.alert('Error', 'Could not retrieve your location. Please check GPS settings.');
    }
  }, [getLocation, openMaps]);

  const selectDevice = useCallback(
    async (device) => {
      setSelectedDevice(device);
      setShowDeviceModal(false);
      await storage.save(STORAGE_KEYS.SELECTED_DEVICE, device);
      Alert.alert('Device Selected', `${device?.name || 'Device'} has been selected for tracking.`);
    },
    [storage]
  );

  const clearDevice = useCallback(() => {
    Alert.alert(
      'Remove Device',
      'Are you sure you want to remove the selected device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setSelectedDevice(null);
            setIsConnected(false);
            await storage.remove(STORAGE_KEYS.SELECTED_DEVICE);
          },
        },
      ]
    );
  }, [storage]);

  const clearHistory = useCallback(() => {
    Alert.alert(
      'Clear History',
      'Are you sure you want to delete all history? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete All',
          style: 'destructive',
          onPress: async () => {
            setConnectionHistory([]);
            setParkedLocation(null);
            setDrivingLocation(null);
            setUnparkLocation(null);
            setIsParked(false);
            setParkTime(null);
            setUnparkTime(null);
            await storage.remove([
              STORAGE_KEYS.HISTORY,
              STORAGE_KEYS.PARKED_LOC,
              STORAGE_KEYS.DRIVING_LOC,
              STORAGE_KEYS.PARKING_STATUS,
            ]);
          },
        },
      ]
    );
  }, [storage]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (bootLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color="#FFF" />
        <Text style={styles.loadingText}>Loading ParkIt...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={isParked ? '#E65100' : isConnected ? '#2E7D32' : '#1565C0'}
      />

      {/* Header */}
      <View style={[styles.header, { backgroundColor: isParked ? '#E65100' : isConnected ? '#2E7D32' : '#1565C0' }]}>
        <Text style={styles.title}>🅿️ ParkIt</Text>
        <Text style={styles.subtitle}>Smart Parking Assistant</Text>

        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {bluetoothEnabled ? '🔵 Bluetooth ON' : '⚫ Bluetooth OFF'}
            </Text>
          </View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {isGettingLocation ? '📡 Locating...' : locationStatus}
            </Text>
          </View>

          <View style={[styles.badge, !ActivityRecognitionModule && styles.badgeWarning]}>
            <Text style={styles.badgeText}>{arBadgeText}</Text>
          </View>

          {isBtSyncing && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>⏳ Syncing...</Text>
            </View>
          )}
        </View>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* ═══════════════════════════════════════════════════════════
            PARK / UNPARK BUTTONS CARD
            ═══════════════════════════════════════════════════════════ */}
        <View style={styles.parkingCard}>
          <Text style={styles.parkingCardTitle}>🚗 Manual Parking Control</Text>
          <Text style={styles.parkingCardSubtitle}>
            Tap the buttons below to save your parking or unparking location
          </Text>

          <View style={styles.parkingButtonsRow}>
            <TouchableOpacity
              style={[
                styles.parkButton,
                isParked && styles.parkButtonDisabled,
              ]}
              onPress={handlePark}
              disabled={isParked || isGettingLocation}
            >
              {isGettingLocation && !isParked ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Text style={styles.parkButtonIcon}>🅿️</Text>
                  <Text style={styles.parkButtonText}>PARK</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.unparkButton,
                !isParked && styles.unparkButtonDisabled,
              ]}
              onPress={handleUnpark}
              disabled={!isParked || isGettingLocation}
            >
              {isGettingLocation && isParked ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <>
                  <Text style={styles.unparkButtonIcon}>🚗</Text>
                  <Text style={styles.unparkButtonText}>UNPARK</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Parking Status */}
          <View style={[styles.parkingStatusBox, { backgroundColor: isParked ? '#FFF3E0' : '#E8F5E9' }]}>
            <Text style={[styles.parkingStatusText, { color: isParked ? '#E65100' : '#2E7D32' }]}>
              {isParked ? '🅿️ Vehicle is PARKED' : '🚗 Vehicle is NOT PARKED'}
            </Text>
            {parkTime && isParked && (
              <Text style={styles.parkingTimeText}>Parked at: {parkTime}</Text>
            )}
          </View>
        </View>

        {/* ═══════════════════════════════════════════════════════════
            PARKED LOCATION DETAILS CARD
            ═══════════════════════════════════════════════════════════ */}
        {isParked && parkedLocation && (
          <View style={styles.locationDetailCard}>
            <Text style={styles.locationDetailTitle}>📍 Parked Location</Text>
            
            <View style={styles.coordinateRow}>
              <View style={styles.coordinateBox}>
                <Text style={styles.coordinateLabel}>Latitude</Text>
                <Text style={styles.coordinateValue}>{formatCoordinate(parkedLocation.latitude)}</Text>
              </View>
              <View style={styles.coordinateBox}>
                <Text style={styles.coordinateLabel}>Longitude</Text>
                <Text style={styles.coordinateValue}>{formatCoordinate(parkedLocation.longitude)}</Text>
              </View>
            </View>

            <View style={styles.locationMetaRow}>
              <Text style={styles.locationMetaText}>
                Source: {parkedLocation.source || 'GPS'}
              </Text>
              <Text style={styles.locationMetaText}>
                Accuracy: {parkedLocation.accuracy ? `${Math.round(parkedLocation.accuracy)}m` : 'N/A'}
              </Text>
            </View>

            <TouchableOpacity
              style={styles.viewMapButton}
              onPress={() => openMaps(parkedLocation)}
            >
              <Text style={styles.viewMapButtonText}>🗺️ View on Google Maps</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ═══════════════════════════════════════════════════════════
            UNPARK LOCATION DETAILS CARD
            ═══════════════════════════════════════════════════════════ */}
        {!isParked && unparkLocation && parkedLocation && (
          <View style={styles.unparkDetailCard}>
            <Text style={styles.unparkDetailTitle}>🚗 Trip Summary</Text>

            {/* Parked Location */}
            <View style={styles.tripSection}>
              <Text style={styles.tripSectionTitle}>📍 Parked Location</Text>
              <View style={styles.coordinateRowSmall}>
                <Text style={styles.tripCoordText}>
                  Lat: {formatCoordinate(parkedLocation.latitude)}
                </Text>
                <Text style={styles.tripCoordText}>
                  Lng: {formatCoordinate(parkedLocation.longitude)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => openMaps(parkedLocation)}>
                <Text style={styles.viewMapLink}>View on Map →</Text>
              </TouchableOpacity>
            </View>

            {/* Unpark Location */}
            <View style={styles.tripSection}>
              <Text style={styles.tripSectionTitle}>🏁 Unpark Location</Text>
              <View style={styles.coordinateRowSmall}>
                <Text style={styles.tripCoordText}>
                  Lat: {formatCoordinate(unparkLocation.latitude)}
                </Text>
                <Text style={styles.tripCoordText}>
                  Lng: {formatCoordinate(unparkLocation.longitude)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => openMaps(unparkLocation)}>
                <Text style={styles.viewMapLink}>View on Map →</Text>
              </TouchableOpacity>
            </View>

            {/* Distance */}
            {Number.isFinite(lastDistance) && (
              <View style={styles.distanceBox}>
                <Text style={styles.distanceLabel}>📏 Distance Traveled</Text>
                <Text style={styles.distanceValue}>{formatDistance(lastDistance)}</Text>
              </View>
            )}

            {unparkTime && (
              <Text style={styles.unparkTimeText}>Unparked at: {unparkTime}</Text>
            )}
          </View>
        )}

        {/* Activity Recognition Card */}
        <View style={[styles.card, styles.arCard]}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>🏃 Activity Recognition</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: '#455A64' }]}
                onPress={readLastAr}
              >
                <Text style={styles.btnText}>↻</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: arState.enabled ? '#D32F2F' : '#1976D2' }]}
                onPress={arState.enabled ? stopAr : startAr}
              >
                <Text style={styles.btnText}>{arState.enabled ? '⏹' : '▶'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={styles.arInfoText}>
            Permission: {arState.permission ? '✅ Granted' : '❌ Denied'} | Status: {arState.enabled ? '🟢 Active' : '🔴 Inactive'}
          </Text>

          <View style={[styles.activityBig, { backgroundColor: activityConfig.color }]}>
            <Text style={styles.activityIcon}>{activityConfig.icon}</Text>
            <Text style={styles.activityLabel}>{activityConfig.label}</Text>
            <Text style={styles.activityConf}>{Math.round(arState.confidence)}% confidence</Text>
          </View>

          <Text style={styles.arInfoText}>
            Last Updated: {arState.updatedAt ? new Date(arState.updatedAt).toLocaleTimeString() : 'Never'}
          </Text>
        </View>

        {/* Device Card */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>🎧 Tracking Device</Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                startBluetoothListening();
                setShowDeviceModal(true);
              }}
            >
              <Text style={styles.btnText}>{selectedDevice ? '✏️ Change' : '+ Select'}</Text>
            </TouchableOpacity>
          </View>

          {selectedDevice ? (
            <View style={styles.deviceBox}>
              <Text style={styles.deviceIcon}>🎧</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.deviceName}>{selectedDevice.name}</Text>
                <Text style={styles.deviceAddr}>{selectedDevice.address}</Text>
              </View>
              <TouchableOpacity onPress={clearDevice}>
                <Text style={styles.x}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.muted}>
              No device selected.{'\n'}Tap "Select" to choose a Bluetooth device for automatic parking detection.
            </Text>
          )}
        </View>

        {/* Bluetooth Status Card */}
        <View
          style={[
            styles.statusCard,
            { backgroundColor: isConnected ? '#43A047' : '#78909C' },
          ]}
        >
          <Animated.View style={[styles.dot, { transform: [{ scale: pulseAnim }] }]} />
          <Text style={styles.statusTitle}>
            {isConnected ? '🔗 CONNECTED' : '🔌 DISCONNECTED'}
          </Text>
          <Text style={styles.statusSub}>
            {isConnected
              ? connectedDevice?.name || 'Bluetooth Device Connected'
              : selectedDevice?.name || 'Select a device to monitor'}
          </Text>

          {connectionTime && (
            <Text style={styles.statusTime}>Last Update: {connectionTime}</Text>
          )}

          {arState.enabled && arState.activity !== 'unknown' && (
            <View style={styles.arStatusBadge}>
              <Text style={styles.arStatusText}>
                {activityConfig.icon} {activityConfig.label}
              </Text>
            </View>
          )}
        </View>

        {/* Location Test Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📡 GPS Location</Text>
          <Text style={styles.locStatus}>Current Status: {locationStatus}</Text>
          <TouchableOpacity style={styles.testBtn} onPress={testLocation}>
            <Text style={styles.testBtnText}>📍 Test GPS Location</Text>
          </TouchableOpacity>
        </View>

        {/* History Card */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>📋 History</Text>
            {connectionHistory.length > 0 && (
              <TouchableOpacity onPress={clearHistory}>
                <Text style={styles.clearBtn}>🗑️ Clear All</Text>
              </TouchableOpacity>
            )}
          </View>

          {connectionHistory.length > 0 ? (
            connectionHistory.slice(0, 15).map((item, i) => (
              <View key={i} style={styles.historyItem}>
                <Text style={styles.historyIcon}>
                  {item.type === 'connect' ? '🟢' : 
                   item.type === 'disconnect' ? '🔴' : 
                   item.type === 'park' ? '🅿️' : 
                   item.type === 'unpark' ? '🚗' : '📍'}
                </Text>

                <View style={{ flex: 1 }}>
                  <Text style={styles.historyDevice}>
                    {item.type === 'park' ? 'Vehicle Parked' :
                     item.type === 'unpark' ? 'Vehicle Unparked' :
                     item.device || 'Unknown'}
                  </Text>

                  <Text style={styles.historyTime}>
                    🕐 {item.time} | 📅 {item.date}
                  </Text>

                  {item.activity && item.activity !== 'unknown' && (
                    <Text style={styles.historyActivity}>
                      {getActivityConfig(item.activity).icon} {getActivityConfig(item.activity).label}
                    </Text>
                  )}

                  {item.location && (
                    <TouchableOpacity onPress={() => openMaps(item.location)}>
                      <Text style={styles.historyLoc}>
                        📍 Lat: {formatCoordinate(item.location.latitude, 4)}, Lng: {formatCoordinate(item.location.longitude, 4)}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {(item.type === 'disconnect' || item.type === 'unpark') &&
                    Number.isFinite(item.distanceMeters) && (
                      <Text style={styles.historyDistance}>
                        📏 Distance: {formatDistance(item.distanceMeters)}
                      </Text>
                    )}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No history available yet. Park your vehicle to start tracking.</Text>
          )}
        </View>

        {/* Refresh Button */}
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={startBluetoothListening}
        >
          <Text style={styles.refreshText}>🔄 Refresh Bluetooth Connection</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* Device Modal */}
      <Modal visible={showDeviceModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.row}>
              <Text style={styles.modalTitle}>Select Bluetooth Device</Text>
              <TouchableOpacity onPress={() => setShowDeviceModal(false)}>
                <Text style={styles.modalX}>✕</Text>
              </TouchableOpacity>
            </View>

            {pairedDevices.length > 0 ? (
              <FlatList
                data={pairedDevices}
                keyExtractor={(d) => d.address}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.modalDevice,
                      selectedDevice?.address === item.address && styles.modalDeviceSelected,
                    ]}
                    onPress={() => selectDevice(item)}
                  >
                    <Text style={styles.modalDeviceIcon}>🎧</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modalDeviceName}>{item.name}</Text>
                      <Text style={styles.modalDeviceAddr}>{item.address}</Text>
                    </View>
                    {selectedDevice?.address === item.address && (
                      <Text style={styles.check}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.muted}>
                No paired Bluetooth devices found.{'\n'}Please pair a device in your phone's Bluetooth settings first.
              </Text>
            )}

            <TouchableOpacity style={styles.modalRefresh} onPress={startBluetoothListening}>
              <Text style={styles.modalRefreshText}>🔄 Refresh Device List</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ═══════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A237E',
  },
  loadingText: { color: '#FFF', fontSize: 18, marginTop: 12 },
  
  header: {
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFF' },
  subtitle: { fontSize: 12, color: '#FFF', opacity: 0.85, marginTop: 2 },
  
  badges: {
    flexDirection: 'row',
    marginTop: 12,
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  badgeWarning: { backgroundColor: 'rgba(255,160,0,0.5)' },
  badgeText: { color: '#FFF', fontSize: 11, fontWeight: '600' },
  
  scroll: { flex: 1, padding: 12 },

  // ─── Parking Card Styles ────────────────────────────────────
  parkingCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  parkingCardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#222',
    textAlign: 'center',
  },
  parkingCardSubtitle: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  parkingButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  parkButton: {
    flex: 1,
    backgroundColor: '#E65100',
    paddingVertical: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  parkButtonDisabled: {
    backgroundColor: '#BDBDBD',
  },
  parkButtonIcon: {
    fontSize: 32,
  },
  parkButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 4,
  },
  unparkButton: {
    flex: 1,
    backgroundColor: '#2E7D32',
    paddingVertical: 20,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  unparkButtonDisabled: {
    backgroundColor: '#BDBDBD',
  },
  unparkButtonIcon: {
    fontSize: 32,
  },
  unparkButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 4,
  },
  parkingStatusBox: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  parkingStatusText: {
    fontSize: 14,
    fontWeight: '600',
  },
  parkingTimeText: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },

  // ─── Location Detail Card Styles ────────────────────────────
  locationDetailCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#E65100',
    elevation: 2,
  },
  locationDetailTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 12,
  },
  coordinateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  coordinateBox: {
    flex: 1,
    backgroundColor: '#FFF3E0',
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  coordinateLabel: {
    fontSize: 11,
    color: '#666',
    marginBottom: 4,
  },
  coordinateValue: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#333',
  },
  locationMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  locationMetaText: {
    fontSize: 11,
    color: '#888',
  },
  viewMapButton: {
    backgroundColor: '#4285F4',
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  viewMapButtonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 14,
  },

  // ─── Unpark Detail Card Styles ──────────────────────────────
  unparkDetailCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#2E7D32',
    elevation: 2,
  },
  unparkDetailTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginBottom: 12,
  },
  tripSection: {
    backgroundColor: '#F5F5F5',
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  tripSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  coordinateRowSmall: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  tripCoordText: {
    fontSize: 12,
    color: '#555',
  },
  viewMapLink: {
    fontSize: 12,
    color: '#1976D2',
    marginTop: 6,
    fontWeight: '600',
  },
  distanceBox: {
    backgroundColor: '#E8F5E9',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  distanceLabel: {
    fontSize: 12,
    color: '#666',
  },
  distanceValue: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginTop: 4,
  },
  unparkTimeText: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
  },

  // ─── Card Styles ────────────────────────────────────────────
  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  arCard: { borderLeftWidth: 4, borderLeftColor: '#1976D2' },
  
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: { fontSize: 16, fontWeight: 'bold', color: '#222' },
  
  btn: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  btnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  
  activityBig: {
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginVertical: 10,
  },
  activityIcon: { fontSize: 42 },
  activityLabel: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 6,
  },
  activityConf: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  arInfoText: { fontSize: 12, color: '#555', marginBottom: 4 },
  
  deviceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    padding: 14,
    borderRadius: 12,
  },
  deviceIcon: { fontSize: 28, marginRight: 12 },
  deviceName: { fontSize: 15, fontWeight: 'bold', color: '#1565C0' },
  deviceAddr: { fontSize: 11, color: '#64B5F6', marginTop: 2 },
  x: { fontSize: 22, color: '#F44336', paddingHorizontal: 8 },
  muted: {
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 10,
    lineHeight: 20,
  },
  
  statusCard: {
    borderRadius: 18,
    padding: 24,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 4,
  },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.4)',
    marginBottom: 10,
  },
  statusTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFF' },
  statusSub: { fontSize: 13, color: '#FFF', opacity: 0.9, marginTop: 4 },
  statusTime: { fontSize: 12, color: '#FFF', opacity: 0.8, marginTop: 6 },
  
  arStatusBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 10,
  },
  arStatusText: { color: '#FFF', fontWeight: '700', fontSize: 14 },
  
  locStatus: { fontSize: 13, color: '#555', marginBottom: 10 },
  testBtn: {
    backgroundColor: '#9C27B0',
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  testBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  
  clearBtn: { fontSize: 13, color: '#F44336', fontWeight: '600' },
  
  historyItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    alignItems: 'flex-start',
  },
  historyIcon: { fontSize: 18, marginRight: 10, marginTop: 2 },
  historyDevice: { fontSize: 14, fontWeight: '600', color: '#222' },
  historyTime: { fontSize: 11, color: '#666', marginTop: 2 },
  historyActivity: {
    fontSize: 11,
    color: '#1976D2',
    marginTop: 2,
    fontWeight: '600',
  },
  historyLoc: { fontSize: 11, color: '#1976D2', marginTop: 3 },
  historyDistance: { fontSize: 11, color: '#2E7D32', marginTop: 4, fontWeight: '600' },
  
  refreshBtn: {
    backgroundColor: '#1976D2',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  refreshText: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },
  
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  modalBox: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '65%',
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#222' },
  modalX: { fontSize: 26, color: '#999' },
  modalDevice: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    marginBottom: 10,
  },
  modalDeviceSelected: {
    backgroundColor: '#E3F2FD',
    borderWidth: 2,
    borderColor: '#1976D2',
  },
  modalDeviceIcon: { fontSize: 26, marginRight: 12 },
  modalDeviceName: { fontSize: 15, fontWeight: '600', color: '#222' },
  modalDeviceAddr: { fontSize: 11, color: '#888', marginTop: 2 },
  check: { fontSize: 22, color: '#4CAF50', fontWeight: 'bold' },
  modalRefresh: {
    backgroundColor: '#E3F2FD',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalRefreshText: { color: '#1976D2', fontWeight: 'bold', fontSize: 14 },
});

export default BluetoothDemoScreen;
