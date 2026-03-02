// src/screens/BluetoothDemoScreen.js

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
// CONSTANTS
// ═══════════════════════════════════════════════════════════

const DEBUG = __DEV__;
const STORAGE_KEYS = {
  SELECTED_DEVICE: 'selectedDevice',
  HISTORY: 'history',
  PARKED_LOC: 'parkedLoc',
  DRIVING_LOC: 'drivingLoc',
  PARKING_STATUS: 'parkingStatus',
};
const MAX_HISTORY = 30;
const AR_POLL_MS = 10000;
const AR_DELAY_MS = 3000;
const LOC_TIMEOUT = 10000;

// ═══════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════

const L = {
  log: (...a) => DEBUG && console.log('[ParkIt]', new Date().toLocaleTimeString(), ...a),
  warn: (...a) => DEBUG && console.warn('[ParkIt]', new Date().toLocaleTimeString(), ...a),
  error: (...a) => console.error('[ParkIt]', new Date().toLocaleTimeString(), ...a),
};

// ═══════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const validLL = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) &&
  Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

const fmtCoord = (v, d = 6) => {
  const n = toNum(v);
  return n !== null ? n.toFixed(d) : 'N/A';
};

const calcDist = (a, b) => {
  const la = toNum(a?.latitude), lo = toNum(a?.longitude);
  const la2 = toNum(b?.latitude), lo2 = toNum(b?.longitude);
  if (!validLL(la, lo) || !validLL(la2, lo2)) return null;
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLa = rad(la2 - la), dLo = rad(lo2 - lo);
  const s = Math.sin(dLa / 2) ** 2 +
    Math.cos(rad(la)) * Math.cos(rad(la2)) * Math.sin(dLo / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
};

const fmtDist = (m) => {
  if (!Number.isFinite(m)) return 'N/A';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
};

const ACT_CFG = {
  still: { label: 'STILL', icon: '🧍', color: '#37474F' },
  walking: { label: 'WALKING', icon: '🚶', color: '#2E7D32' },
  running: { label: 'RUNNING', icon: '🏃', color: '#E65100' },
  in_vehicle: { label: 'IN VEHICLE', icon: '🚗', color: '#1565C0' },
  on_bicycle: { label: 'BICYCLE', icon: '🚲', color: '#6A1B9A' },
  unknown: { label: 'UNKNOWN', icon: '❓', color: '#455A64' },
};
const getAct = (s) => ACT_CFG[s] || ACT_CFG.unknown;

// ═══════════════════════════════════════════════════════════
// CUSTOM HOOKS
// ═══════════════════════════════════════════════════════════

const useLatestRef = (val) => {
  const r = useRef(val);
  useEffect(() => { r.current = val; }, [val]);
  return r;
};

const usePulse = (active) => {
  const anim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let a;
    if (active) {
      a = Animated.loop(Animated.sequence([
        Animated.timing(anim, { toValue: 1.3, duration: 1000, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]));
      a.start();
    } else { anim.setValue(1); }
    return () => a?.stop();
  }, [active, anim]);
  return anim;
};

const useStorage = () => {
  const save = useCallback(async (k, v) => {
    try { await AsyncStorage.setItem(k, JSON.stringify(v)); }
    catch (e) { L.error('Save:', k, e); }
  }, []);
  const load = useCallback(async (k) => {
    try { const d = await AsyncStorage.getItem(k); return d ? JSON.parse(d) : null; }
    catch (e) { L.error('Load:', k, e); return null; }
  }, []);
  const remove = useCallback(async (k) => {
    try { await AsyncStorage.multiRemove(Array.isArray(k) ? k : [k]); }
    catch (e) { L.error('Remove:', e); }
  }, []);
  return { save, load, remove };
};

// ═══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════

const BluetoothDemoScreen = () => {

  // ─── STATE ──────────────────────────────────────────────
  const [bootLoading, setBootLoading] = useState(true);
  const [btSyncing, setBtSyncing] = useState(false);
  const [btEnabled, setBtEnabled] = useState(false);
  const [paired, setPaired] = useState([]);
  const [selDevice, setSelDevice] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connDev, setConnDev] = useState(null);
  const [connTime, setConnTime] = useState(null);
  const [gettingLoc, setGettingLoc] = useState(false);
  const [locStatus, setLocStatus] = useState('Ready');
  const [driveLoc, setDriveLoc] = useState(null);
  const [parkLoc, setParkLoc] = useState(null);
  const [history, setHistory] = useState([]);

  // Manual Parking (Occupy/Vacate)
  const [isOccupied, setIsOccupied] = useState(false);
  const [occupyTime, setOccupyTime] = useState(null);
  const [vacateTime, setVacateTime] = useState(null);
  const [vacateLoc, setVacateLoc] = useState(null);
  const [actionLock, setActionLock] = useState(false);

  // Activity Recognition
  const [ar, setAr] = useState({
    perm: false, on: false, act: 'unknown', conf: 0, at: 0,
  });

  // ─── REFS ───────────────────────────────────────────────
  const mountRef = useRef(true);
  const arSubRef = useRef(null);
  const arPollRef = useRef(null);
  const btInitRef = useRef(false);

  const selRef = useLatestRef(selDevice);
  const connDevRef = useLatestRef(connDev);
  const driveLocRef = useLatestRef(driveLoc);
  const arRef = useLatestRef(ar);
  const parkLocRef = useLatestRef(parkLoc);
  const isOccupiedRef = useLatestRef(isOccupied);
  const connectedRef = useLatestRef(connected);

  // ─── HOOKS ──────────────────────────────────────────────
  const pulse = usePulse(connected || isOccupied);
  const store = useStorage();

  // ─── DERIVED ────────────────────────────────────────────
  const lastDist = useMemo(() => {
    if (!parkLoc || !vacateLoc) return null;
    return calcDist(parkLoc, vacateLoc);
  }, [parkLoc, vacateLoc]);

  const actCfg = useMemo(() => getAct(ar.act), [ar.act]);

  const arBadge = useMemo(() => {
    if (!ActivityRecognitionModule) return 'AR N/A';
    if (!ar.on) return 'AR OFF';
    return `${actCfg.icon} ${actCfg.label}`;
  }, [ar.on, actCfg]);

  // ═══════════════════════════════════════════════════════════
  // LOCATION
  // ═══════════════════════════════════════════════════════════

  const getIPLoc = useCallback(async () => {
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
      clearTimeout(tid);
      const d = await res.json();
      const lat = toNum(d?.latitude), lng = toNum(d?.longitude);
      if (validLL(lat, lng)) {
        return { latitude: lat, longitude: lng, city: d.city || 'Unknown', source: 'IP (~5km)', accuracy: 5000, time: Date.now() };
      }
    } catch (e) { if (e.name !== 'AbortError') L.error('IP loc:', e); }
    return null;
  }, []);

  const getNativeLoc = useCallback(async (fresh = false) => {
    try {
      if (!BluetoothModule) return null;
      const fn = fresh ? BluetoothModule.getFreshLocation : BluetoothModule.getCurrentLocation;
      if (typeof fn !== 'function') return null;
      const loc = await Promise.race([
        fn(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('GPS timeout')), LOC_TIMEOUT)),
      ]);
      const lat = toNum(loc?.latitude), lng = toNum(loc?.longitude);
      if (validLL(lat, lng)) return { ...loc, latitude: lat, longitude: lng };
    } catch (e) { L.warn('Native loc:', e?.message); }
    return null;
  }, []);

  const getLoc = useCallback(async ({ fresh = false, allowDefault = false } = {}) => {
    if (!mountRef.current) return null;
    setGettingLoc(true);
    setLocStatus(fresh ? '📡 LIVE GPS...' : '📡 GPS...');
    try {
      const native = await getNativeLoc(fresh);
      if (native) { if (mountRef.current) setLocStatus('GPS ✅'); return { ...native, source: native.source || 'GPS' }; }

      const ip = await getIPLoc();
      if (ip) { if (mountRef.current) setLocStatus(`${ip.city} (IP) ⚠️`); return ip; }

      if (allowDefault) {
        if (mountRef.current) setLocStatus('Default ⚠️');
        return { latitude: 23.2599, longitude: 77.4126, city: 'Bhopal', source: 'Default', accuracy: 99999, time: Date.now() };
      }
      if (mountRef.current) setLocStatus('❌ Unavailable');
      return null;
    } finally { if (mountRef.current) setGettingLoc(false); }
  }, [getNativeLoc, getIPLoc]);

  const openMap = useCallback((loc) => {
    const lat = toNum(loc?.latitude), lng = toNum(loc?.longitude);
    if (!validLL(lat, lng)) { Alert.alert('Error', 'Invalid coordinates'); return; }
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`)
      .catch(() => Alert.alert('Error', 'Could not open Maps'));
  }, []);

  // ═══════════════════════════════════════════════════════════
  // HISTORY HELPER
  // ═══════════════════════════════════════════════════════════

  const addHistory = useCallback((entry) => {
    L.log('📝 Adding history:', entry.type, entry.device || '');
    setHistory((prev) => {
      const h = [entry, ...prev.slice(0, MAX_HISTORY - 1)];
      store.save(STORAGE_KEYS.HISTORY, h).catch(() => { });
      return h;
    });
  }, [store]);

  // ═══════════════════════════════════════════════════════════
  // MANUAL PARKING (OCCUPY/VACATE)
  // ═══════════════════════════════════════════════════════════

  const handleOccupy = useCallback(async () => {
    if (actionLock) return;
    try {
      setActionLock(true);
      setGettingLoc(true);
      const loc = await getLoc({ fresh: true });
      if (!loc || !mountRef.current) {
        if (mountRef.current) Alert.alert('Error', 'Could not get GPS. Enable location and try again.');
        return;
      }

      if (loc.source === 'IP (~5km)') {
        const ok = await new Promise((res) => {
          Alert.alert('⚠️ Low Accuracy', 'Only approximate IP location (~5km). Save anyway?',
            [{ text: 'Cancel', onPress: () => res(false), style: 'cancel' },
            { text: 'Save', onPress: () => res(true) }]);
        });
        if (!ok || !mountRef.current) return;
      }

      const now = new Date();
      const data = { ...loc, occupiedAt: now.toISOString() };

      setParkLoc(data);
      setIsOccupied(true);
      setOccupyTime(now.toLocaleTimeString());
      setVacateLoc(null);
      setVacateTime(null);

      await Promise.all([
        store.save(STORAGE_KEYS.PARKED_LOC, data),
        store.save(STORAGE_KEYS.PARKING_STATUS, { isOccupied: true, occupyTime: now.toISOString() }),
      ]);

      addHistory({
        type: 'occupy', time: now.toLocaleTimeString(), date: now.toLocaleDateString(),
        location: data, activity: arRef.current.act,
      });

      if (mountRef.current) {
        Alert.alert('🅿️ Occupied!',
          `📍 ${fmtCoord(loc.latitude)}, ${fmtCoord(loc.longitude)}\n📡 ${loc.source}\n⏱️ ${now.toLocaleTimeString()}`,
          [{ text: 'OK' }, { text: '🗺️ Map', onPress: () => openMap(loc) }]);
      }
    } catch (e) {
      L.error('Occupy:', e);
      if (mountRef.current) Alert.alert('Error', 'Failed to occupy.');
    } finally {
      if (mountRef.current) { setGettingLoc(false); setActionLock(false); }
    }
  }, [actionLock, getLoc, store, arRef, openMap, addHistory]);

  const handleVacate = useCallback(async () => {
    if (!isOccupiedRef.current || !parkLocRef.current) {
      Alert.alert('Notice', 'Occupy a spot first.');
      return;
    }
    if (actionLock) return;
    try {
      setActionLock(true);
      setGettingLoc(true);
      const loc = await getLoc({ fresh: true });
      if (!loc || !mountRef.current) {
        if (mountRef.current) Alert.alert('Error', 'Could not get GPS.');
        return;
      }

      const now = new Date();
      const occupied = parkLocRef.current;
      const dist = calcDist(occupied, loc);

      setVacateLoc(loc);
      setVacateTime(now.toLocaleTimeString());
      setIsOccupied(false);

      await store.save(STORAGE_KEYS.PARKING_STATUS, { isOccupied: false, vacateTime: now.toISOString() });

      addHistory({
        type: 'vacate', time: now.toLocaleTimeString(), date: now.toLocaleDateString(),
        location: loc, parkLocation: occupied, distanceMeters: dist, activity: arRef.current.act,
      });

      if (mountRef.current) {
        Alert.alert('🚗 Vacated!',
          `📍 Occupied: ${fmtCoord(occupied.latitude)}, ${fmtCoord(occupied.longitude)}\n📍 Now: ${fmtCoord(loc.latitude)}, ${fmtCoord(loc.longitude)}\n📏 ${fmtDist(dist)}`,
          [{ text: 'OK' }, { text: '🗺️ Occupied Spot', onPress: () => openMap(occupied) }]);
      }
    } catch (e) {
      L.error('Vacate:', e);
      if (mountRef.current) Alert.alert('Error', 'Failed to vacate.');
    } finally {
      if (mountRef.current) { setGettingLoc(false); setActionLock(false); }
    }
  }, [actionLock, isOccupiedRef, parkLocRef, getLoc, store, arRef, openMap, addHistory]);

  // ═══════════════════════════════════════════════════════════
  // PERMISSIONS
  // ═══════════════════════════════════════════════════════════

  const reqPerms = useCallback(async () => {
    if (Platform.OS !== 'android') return true;
    try {
      const perms = [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
      if (Platform.Version >= 31) {
        perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        perms.push(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
      }
      if (Platform.Version >= 29) perms.push(PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION);
      if (Platform.Version >= 33) perms.push(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);

      const valid = perms.filter(Boolean);
      const res = await PermissionsAndroid.requestMultiple(valid);

      const locOk = res[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
      const arOk = !PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION ||
        res[PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION] === PermissionsAndroid.RESULTS.GRANTED;

      if (mountRef.current) {
        setLocStatus(locOk ? 'Permission ✅' : 'Permission ❌');
        setAr(p => ({ ...p, perm: arOk }));
      }

      if (locOk && Platform.Version >= 29) {
        try {
          await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION, {
            title: 'Background Location',
            message: 'ParkIt needs background location to detect parking when app is minimized.',
            buttonPositive: 'Allow', buttonNegative: 'Deny',
          });
        } catch { }
      }

      return locOk;
    } catch (e) { L.error('Perms:', e); return false; }
  }, []);

  // ═══════════════════════════════════════════════════════════
  // ACTIVITY RECOGNITION
  // ═══════════════════════════════════════════════════════════

  const readAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.getLast || !mountRef.current) return;
    try {
      const last = await ActivityRecognitionModule.getLast();
      if (last && mountRef.current) {
        setAr(p => ({
          ...p,
          act: last.state || p.act || 'unknown',
          conf: Number(last.confidence ?? p.conf ?? 0),
          at: Number(last.timestamp ?? Date.now()),
          on: Boolean(last.enabled ?? p.on),
        }));
      }
    } catch (e) { L.error('Read AR:', e); }
  }, []);

  const startAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.start) {
      Alert.alert('N/A', 'Activity Recognition not available.');
      return;
    }
    try {
      await ActivityRecognitionModule.start(5000);
      if (mountRef.current) setAr(p => ({ ...p, on: true }));
      setTimeout(() => { if (mountRef.current) readAr(); }, AR_DELAY_MS);
    } catch (e) {
      L.error('Start AR:', e);
      Alert.alert('Error', `AR failed: ${e?.message}`);
    }
  }, [readAr]);

  const stopAr = useCallback(async () => {
    if (!ActivityRecognitionModule?.stop) return;
    try {
      await ActivityRecognitionModule.stop();
      if (mountRef.current) setAr(p => ({ ...p, on: false }));
    } catch (e) { L.error('Stop AR:', e); }
  }, []);

  const initAR = useCallback(async () => {
    if (!ActivityRecognitionModule) { L.warn('AR module N/A'); return; }

    if (!arSubRef.current) {
      arSubRef.current = DeviceEventEmitter.addListener('ActivityRecognition', (ev) => {
        if (ev?.state && mountRef.current) {
          setAr(p => ({
            ...p, act: ev.state,
            conf: Number(ev.confidence ?? 0),
            at: Number(ev.timestamp ?? Date.now()),
          }));
        }
      });
    }

    await readAr();

    try {
      await ActivityRecognitionModule.start(5000);
      if (mountRef.current) setAr(p => ({ ...p, on: true }));
      setTimeout(() => { if (mountRef.current) readAr(); }, AR_DELAY_MS);
    } catch (e) { L.warn('AR auto-start fail:', e); }

    if (!arPollRef.current) {
      arPollRef.current = setInterval(() => { if (mountRef.current) readAr(); }, AR_POLL_MS);
    }
  }, [readAr]);

  // ═══════════════════════════════════════════════════════════
  // BLUETOOTH - CORE HANDLERS
  // ═══════════════════════════════════════════════════════════

  // Check if this device should be handled
  const shouldHandle = useCallback((dev) => {
    const sel = selRef.current;
    if (!sel) {
      L.log('No device selected - ignoring event');
      return false;
    }
    const devAddr = dev?.address || '';
    const matches = devAddr === sel.address;
    L.log(`shouldHandle: ${devAddr} === ${sel.address} ? ${matches}`);
    return matches;
  }, [selRef]);

  // Get device name safely
  const getDevName = useCallback((dev) => {
    return dev?.name || connDevRef.current?.name || selRef.current?.name || 'Unknown';
  }, [connDevRef, selRef]);

  // ─── ON CONNECT ───────────────────────────────────────────
  const onBtConnect = useCallback(async (dev) => {
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    L.log('🟢 CONNECT EVENT RECEIVED');
    L.log('   Device:', dev?.name, dev?.address);
    L.log('   Selected:', selRef.current?.name, selRef.current?.address);
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (!shouldHandle(dev)) {
      L.log('❌ Not our selected device - IGNORING');
      return;
    }

    if (!mountRef.current) return;

    const now = new Date();

    // ═══ IMMEDIATE UI UPDATE ═══
    setConnected(true);
    setConnDev(dev);
    setConnTime(now.toLocaleTimeString());
    L.log('✅ UI updated: CONNECTED');

    // ═══ GET LIVE LOCATION ═══
    L.log('📡 Getting LIVE location for CONNECT...');
    const loc = await getLoc({ fresh: true, allowDefault: true });

    if (!mountRef.current) return;

    if (loc) {
      L.log('📍 Connect Location:', loc.latitude, loc.longitude, loc.source);
      setDriveLoc(loc);
      store.save(STORAGE_KEYS.DRIVING_LOC, loc);

      // Store in service for BT OFF scenario
      BluetoothService.setLastConnectedDevice({
        address: dev?.address,
        name: dev?.name,
      });
    }

    // ═══ ADD TO HISTORY ═══
    addHistory({
      type: 'connect',
      device: getDevName(dev),
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      location: loc,
      activity: arRef.current.act,
    });

    L.log('✅ CONNECT handled completely!');
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, [shouldHandle, getLoc, store, arRef, addHistory, getDevName, selRef]);

  // ─── ON DISCONNECT ────────────────────────────────────────
  const onBtDisconnect = useCallback(async (dev) => {
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    L.log('🔴 DISCONNECT EVENT RECEIVED');
    L.log('   Device:', dev?.name, dev?.address);
    L.log('   Reason:', dev?.reason || 'normal');
    L.log('   Selected:', selRef.current?.name, selRef.current?.address);
    L.log('   Was connected:', connectedRef.current);
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    // Check if we should handle - also check if we WERE connected
    if (!shouldHandle(dev) && !connectedRef.current) {
      L.log('❌ Not our device & not connected - IGNORING');
      return;
    }

    if (!mountRef.current) return;

    const now = new Date();

    // ═══ IMMEDIATE UI UPDATE ═══
    setConnected(false);
    setConnTime(now.toLocaleTimeString());
    L.log('✅ UI updated: DISCONNECTED');

    // ═══ GET LIVE LOCATION (THIS IS OCCUPIED LOCATION!) ═══
    L.log('📡 Getting LIVE location for DISCONNECT (OCCUPIED LOCATION)...');
    const loc = await getLoc({ fresh: true, allowDefault: true });

    if (!mountRef.current) return;

    if (loc) {
      L.log('📍 OCCUPIED Location:', loc.latitude, loc.longitude, loc.source);
      setParkLoc(loc);
      store.save(STORAGE_KEYS.PARKED_LOC, loc);
    }

    // Calculate distance from drive start
    const startLoc = driveLocRef.current;
    const dist = (loc && startLoc) ? calcDist(startLoc, loc) : null;
    L.log('📏 Distance traveled:', dist ? fmtDist(dist) : 'N/A');

    // ═══ ADD TO HISTORY ═══
    addHistory({
      type: 'disconnect',
      device: getDevName(dev),
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      location: loc,
      distanceMeters: dist,
      activity: arRef.current.act,
    });

    L.log('✅ DISCONNECT handled completely!');
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }, [shouldHandle, getLoc, store, driveLocRef, arRef, addHistory, getDevName, selRef, connectedRef]);

  // ─── ON STATE CHANGE ──────────────────────────────────────
  const onBtStateChange = useCallback((state) => {
    L.log('🔵 BT State Change:', state?.enabled ? 'ON' : 'OFF');
    if (mountRef.current) {
      setBtEnabled(!!state?.enabled);
    }
    // Note: Disconnect is handled in BluetoothService when BT turns OFF
  }, []);

  // ═══════════════════════════════════════════════════════════
  // BLUETOOTH SETUP
  // ═══════════════════════════════════════════════════════════

  const setupBt = useCallback(async () => {
    if (btInitRef.current) {
      L.log('BT already initialized - skipping');
      return;
    }

    setBtSyncing(true);
    L.log('🔧 Setting up Bluetooth...');

    try {
      const on = await BluetoothService.isBluetoothEnabled();
      if (mountRef.current) setBtEnabled(on);

      if (!on) {
        L.warn('⚠️ Bluetooth is OFF');
        setBtSyncing(false);
        return;
      }

      const devs = await BluetoothService.getPairedDevices();
      if (mountRef.current) setPaired(devs || []);

      // Start listening with our handlers
      const ok = await BluetoothService.startListening({
        onConnect: onBtConnect,
        onDisconnect: onBtDisconnect,
        onStateChange: onBtStateChange,
      });

      if (ok) {
        btInitRef.current = true;
        L.log('✅ BT listeners ready!');

        // Check if selected device is already connected
        const sel = selRef.current;
        if (sel?.address) {
          L.log('Checking if', sel.name, 'is already connected...');
          const isConn = await BluetoothService.isDeviceConnected(sel.address);

          if (isConn && mountRef.current) {
            L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            L.log('📱 DEVICE ALREADY CONNECTED AT STARTUP!');
            L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

            const now = new Date();
            setConnected(true);
            setConnDev(sel);
            setConnTime(now.toLocaleTimeString());

            // Store in service
            BluetoothService.setLastConnectedDevice({
              address: sel.address,
              name: sel.name,
            });

            // Get location for already connected device
            L.log('📡 Getting location for already connected device...');
            const loc = await getLoc({ fresh: true, allowDefault: true });

            if (loc && mountRef.current) {
              L.log('📍 Startup Location:', loc.latitude, loc.longitude);
              setDriveLoc(loc);
              store.save(STORAGE_KEYS.DRIVING_LOC, loc);

              // Add to history
              addHistory({
                type: 'connect',
                device: sel.name,
                time: now.toLocaleTimeString(),
                date: now.toLocaleDateString(),
                location: loc,
                activity: arRef.current.act,
                note: 'Already connected at app start',
              });
            }
          }
        }
      }
    } catch (e) {
      L.error('Setup BT error:', e);
    } finally {
      if (mountRef.current) setBtSyncing(false);
    }
  }, [onBtConnect, onBtDisconnect, onBtStateChange, selRef, getLoc, store, addHistory, arRef]);

  const restartBt = useCallback(async () => {
    if (btSyncing) return;
    L.log('🔄 Restarting Bluetooth...');
    btInitRef.current = false;
    await BluetoothService.stopListening();
    await setupBt();
  }, [btSyncing, setupBt]);

  const refreshDevs = useCallback(async () => {
    try {
      const on = await BluetoothService.isBluetoothEnabled();
      if (mountRef.current) setBtEnabled(on);
      if (!on) { Alert.alert('BT Off', 'Enable Bluetooth to see devices.'); return; }
      const devs = await BluetoothService.getPairedDevices();
      if (mountRef.current) setPaired(devs || []);
    } catch (e) { L.error('Refresh:', e); }
  }, []);

  // ─── WHEN SELECTED DEVICE CHANGES ─────────────────────
  useEffect(() => {
    if (!selDevice || bootLoading) return;

    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    L.log('📱 SELECTED DEVICE CHANGED:', selDevice.name);
    L.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const reSetup = async () => {
      btInitRef.current = false;
      await BluetoothService.stopListening();

      const ok = await BluetoothService.startListening({
        onConnect: onBtConnect,
        onDisconnect: onBtDisconnect,
        onStateChange: onBtStateChange,
      });

      if (ok) {
        btInitRef.current = true;

        // Check if newly selected device is already connected
        if (selDevice.address) {
          const isConn = await BluetoothService.isDeviceConnected(selDevice.address);
          L.log('Is', selDevice.name, 'connected?', isConn);

          if (isConn && mountRef.current) {
            L.log('📱 Selected device is ALREADY CONNECTED!');
            const now = new Date();

            setConnected(true);
            setConnDev(selDevice);
            setConnTime(now.toLocaleTimeString());

            BluetoothService.setLastConnectedDevice({
              address: selDevice.address,
              name: selDevice.name,
            });

            // Get location
            const loc = await getLoc({ fresh: true, allowDefault: true });
            if (loc && mountRef.current) {
              L.log('📍 Location:', loc.latitude, loc.longitude);
              setDriveLoc(loc);

              addHistory({
                type: 'connect',
                device: selDevice.name,
                time: now.toLocaleTimeString(),
                date: now.toLocaleDateString(),
                location: loc,
                activity: arRef.current.act,
                note: 'Device selected while connected',
              });
            }
          } else {
            // Device not connected
            setConnected(false);
            setConnDev(null);
          }
        }
      }
    };

    reSetup();
  }, [selDevice]); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══════════════════════════════════════════════════════════
  // INIT & CLEANUP
  // ═══════════════════════════════════════════════════════════

  const loadData = useCallback(async () => {
    try {
      const [dev, hist, parked, drv, status] = await Promise.all([
        store.load(STORAGE_KEYS.SELECTED_DEVICE),
        store.load(STORAGE_KEYS.HISTORY),
        store.load(STORAGE_KEYS.PARKED_LOC),
        store.load(STORAGE_KEYS.DRIVING_LOC),
        store.load(STORAGE_KEYS.PARKING_STATUS),
      ]);
      if (!mountRef.current) return;
      if (dev) setSelDevice(dev);
      if (Array.isArray(hist)) setHistory(hist);
      if (parked) setParkLoc(parked);
      if (drv) setDriveLoc(drv);
      if (status && typeof status === 'object') {
        // Support both old (isParked) and new (isOccupied) keys
        setIsOccupied(Boolean(status.isOccupied ?? status.isParked));
        const timeKey = status.occupyTime || status.parkTime;
        if (timeKey) try { setOccupyTime(new Date(timeKey).toLocaleTimeString()); } catch { }
      }
    } catch (e) { L.error('Load data:', e); }
  }, [store]);

  useEffect(() => {
    L.log('🚀 App mounting...');
    mountRef.current = true;

    const init = async () => {
      try {
        await reqPerms();
        await loadData();
        await setupBt();
        await initAR();
      } catch (e) { L.error('Init:', e); }
      finally { if (mountRef.current) setBootLoading(false); }
    };
    init();

    return () => {
      L.log('🛑 Unmounting...');
      mountRef.current = false;
      btInitRef.current = false;
      try { BluetoothService.stopListening(); } catch { }
      try { arSubRef.current?.remove(); arSubRef.current = null; } catch { }
      if (arPollRef.current) { clearInterval(arPollRef.current); arPollRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ═══════════════════════════════════════════════════════════
  // UI ACTIONS
  // ═══════════════════════════════════════════════════════════

  const testLoc = useCallback(async () => {
    try {
      const loc = await getLoc({ fresh: true, allowDefault: true });
      if (!loc) { Alert.alert('Error', 'Could not get location.'); return; }
      Alert.alert('📍 GPS',
        `Lat: ${fmtCoord(loc.latitude)}\nLng: ${fmtCoord(loc.longitude)}\nAcc: ${loc.accuracy ? Math.round(loc.accuracy) + 'm' : 'N/A'}\nSrc: ${loc.source}`,
        [{ text: 'OK' }, { text: '🗺️', onPress: () => openMap(loc) }]);
    } catch { Alert.alert('Error', 'Location failed.'); }
  }, [getLoc, openMap]);

  const selectDev = useCallback(async (dev) => {
    if (!dev?.address) return;
    setSelDevice(dev);
    setShowModal(false);
    await store.save(STORAGE_KEYS.SELECTED_DEVICE, dev);
    Alert.alert('✅ Selected', `"${dev.name}" will be tracked.\n\nConnect/Disconnect this device and location will be saved automatically!`);
  }, [store]);

  const clearDev = useCallback(() => {
    Alert.alert('Remove Device', 'Stop tracking?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          setSelDevice(null); setConnected(false); setConnDev(null);
          await store.remove(STORAGE_KEYS.SELECTED_DEVICE);
        }
      },
    ]);
  }, [store]);

  const clearAll = useCallback(() => {
    Alert.alert('Clear All', 'Delete everything?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          setHistory([]); setParkLoc(null); setDriveLoc(null); setVacateLoc(null);
          setIsOccupied(false); setOccupyTime(null); setVacateTime(null); setConnTime(null);
          await store.remove([STORAGE_KEYS.HISTORY, STORAGE_KEYS.PARKED_LOC,
          STORAGE_KEYS.DRIVING_LOC, STORAGE_KEYS.PARKING_STATUS]);
        }
      },
    ]);
  }, [store]);

  // ═══════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════

  if (bootLoading) {
    return (
      <SafeAreaView style={S.loading}>
        <ActivityIndicator size="large" color="#FFF" />
        <Text style={S.loadingText}>Loading ParkIt...</Text>
      </SafeAreaView>
    );
  }

  const headerBg = isOccupied ? '#E65100' : connected ? '#2E7D32' : '#1565C0';

  return (
    <SafeAreaView style={S.container}>
      <StatusBar barStyle="light-content" backgroundColor={headerBg} />

      {/* ═══ HEADER ═══ */}
      <View style={[S.header, { backgroundColor: headerBg }]}>
        <Text style={S.title}>🅿️ ParkIt</Text>
        <Text style={S.subtitle}>Smart Parking Assistant</Text>
        <View style={S.badges}>
          <View style={S.badge}><Text style={S.badgeT}>{btEnabled ? '🔵 BT ON' : '⚫ BT OFF'}</Text></View>
          <View style={S.badge}><Text style={S.badgeT}>{gettingLoc ? '📡 Locating...' : locStatus}</Text></View>
          <View style={[S.badge, !ActivityRecognitionModule && S.badgeW]}>
            <Text style={S.badgeT}>{arBadge}</Text>
          </View>
          {btSyncing && <View style={S.badge}><Text style={S.badgeT}>⏳ Syncing...</Text></View>}
        </View>
      </View>

      <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}>

        {/* ═══ DEVICE SELECTION - PROMINENT ═══ */}
        <View style={[S.card, { borderLeftWidth: 4, borderLeftColor: selDevice ? '#4CAF50' : '#FF9800' }]}>
          <View style={S.row}>
            <Text style={S.cardT}>🎧 {selDevice ? 'Tracking Device' : '⚠️ Select a Device First!'}</Text>
            <TouchableOpacity style={S.btn} onPress={async () => { await refreshDevs(); setShowModal(true); }}>
              <Text style={S.btnT}>{selDevice ? '✏️ Change' : '+ Select'}</Text>
            </TouchableOpacity>
          </View>
          {selDevice ? (
            <View style={S.devBox}>
              <Text style={{ fontSize: 28, marginRight: 12 }}>🎧</Text>
              <View style={{ flex: 1 }}>
                <Text style={S.devName}>{selDevice.name}</Text>
                <Text style={S.devAddr}>{selDevice.address}</Text>
              </View>
              <TouchableOpacity onPress={clearDev}>
                <Text style={{ fontSize: 22, color: '#F44336', paddingHorizontal: 8 }}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={{ backgroundColor: '#FFF3E0', padding: 12, borderRadius: 10, marginTop: 8 }}>
              <Text style={{ color: '#E65100', textAlign: 'center', fontWeight: '600' }}>
                👆 Tap "+ Select" to choose your Bluetooth device{'\n'}
                (Car stereo, earphones, etc.)
              </Text>
            </View>
          )}
        </View>

        {/* ═══ BT STATUS ═══ */}
        <View style={[S.btCard, { backgroundColor: connected ? '#43A047' : '#78909C' }]}>
          <Animated.View style={[S.dot, { transform: [{ scale: pulse }] }]} />
          <Text style={S.btTitle}>{connected ? '🔗 CONNECTED' : '🔌 DISCONNECTED'}</Text>
          <Text style={S.btSub}>{connected ? connDev?.name || 'Device Connected' : selDevice?.name || 'Select a device first'}</Text>
          {connTime && <Text style={S.btTime}>Last: {connTime}</Text>}
          {ar.on && ar.act !== 'unknown' && (
            <View style={S.arTag}><Text style={S.arTagT}>{actCfg.icon} {actCfg.label}</Text></View>
          )}
        </View>

        {/* ═══ CURRENT LOCATIONS ═══ */}
        {(driveLoc || parkLoc) && (
          <View style={S.card}>
            <Text style={S.cardT}>📍 Current Locations</Text>

            {driveLoc && (
              <View style={{ marginTop: 10, padding: 12, backgroundColor: '#E3F2FD', borderRadius: 10 }}>
                <Text style={{ fontWeight: '600', color: '#1565C0' }}>🚗 Drive Start (Connect):</Text>
                <Text style={{ color: '#333', marginTop: 4 }}>
                  {fmtCoord(driveLoc.latitude)}, {fmtCoord(driveLoc.longitude)}
                </Text>
                <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                  Source: {driveLoc.source} | Acc: {driveLoc.accuracy ? Math.round(driveLoc.accuracy) + 'm' : 'N/A'}
                </Text>
                <TouchableOpacity onPress={() => openMap(driveLoc)}>
                  <Text style={{ color: '#1976D2', marginTop: 6, fontWeight: '600' }}>🗺️ View on Map</Text>
                </TouchableOpacity>
              </View>
            )}

            {parkLoc && (
              <View style={{ marginTop: 10, padding: 12, backgroundColor: '#FFF3E0', borderRadius: 10 }}>
                <Text style={{ fontWeight: '600', color: '#E65100' }}>🅿️ Occupied (Disconnect):</Text>
                <Text style={{ color: '#333', marginTop: 4 }}>
                  {fmtCoord(parkLoc.latitude)}, {fmtCoord(parkLoc.longitude)}
                </Text>
                <Text style={{ color: '#666', fontSize: 11, marginTop: 2 }}>
                  Source: {parkLoc.source} | Acc: {parkLoc.accuracy ? Math.round(parkLoc.accuracy) + 'm' : 'N/A'}
                </Text>
                <TouchableOpacity onPress={() => openMap(parkLoc)}>
                  <Text style={{ color: '#E65100', marginTop: 6, fontWeight: '600' }}>🗺️ View on Map</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* ═══ MANUAL PARKING (OCCUPY/VACATE) ═══ */}
        <View style={S.parkCard}>
          <Text style={S.parkTitle}>🚗 Manual Parking</Text>
          <Text style={S.parkSub}>Or save location manually</Text>

          <View style={S.parkRow}>
            <TouchableOpacity
              style={[S.parkBtn, (isOccupied || actionLock) && S.disabled]}
              onPress={handleOccupy}
              disabled={isOccupied || gettingLoc || actionLock}
              activeOpacity={0.7}>
              {gettingLoc && !isOccupied ? <ActivityIndicator color="#FFF" /> : (
                <><Text style={S.parkIcon}>🅿️</Text><Text style={S.parkBtnT}>OCCUPY</Text></>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[S.unparkBtn, (!isOccupied || actionLock) && S.disabled]}
              onPress={handleVacate}
              disabled={!isOccupied || gettingLoc || actionLock}
              activeOpacity={0.7}>
              {gettingLoc && isOccupied ? <ActivityIndicator color="#FFF" /> : (
                <><Text style={S.parkIcon}>🚗</Text><Text style={S.parkBtnT}>VACATE</Text></>
              )}
            </TouchableOpacity>
          </View>

          <View style={[S.statusBox, { backgroundColor: isOccupied ? '#FFF3E0' : '#E8F5E9' }]}>
            <Text style={[S.statusBoxT, { color: isOccupied ? '#E65100' : '#2E7D32' }]}>
              {isOccupied ? '🅿️ OCCUPIED' : '🚗 VACATED'}
            </Text>
            {occupyTime && isOccupied && <Text style={S.statusTime}>Since: {occupyTime}</Text>}
          </View>
        </View>

        {/* ═══ TRIP SUMMARY ═══ */}
        {!isOccupied && vacateLoc && parkLoc && (
          <View style={S.tripCard}>
            <Text style={S.tripTitle}>🚗 Trip Summary</Text>
            <View style={S.tripSec}>
              <Text style={S.tripLbl}>📍 Occupied</Text>
              <Text style={S.tripCoord}>{fmtCoord(parkLoc.latitude)}, {fmtCoord(parkLoc.longitude)}</Text>
              <TouchableOpacity onPress={() => openMap(parkLoc)}>
                <Text style={S.tripLink}>View on Map →</Text>
              </TouchableOpacity>
            </View>
            <View style={S.tripSec}>
              <Text style={S.tripLbl}>🏁 Vacated</Text>
              <Text style={S.tripCoord}>{fmtCoord(vacateLoc.latitude)}, {fmtCoord(vacateLoc.longitude)}</Text>
              <TouchableOpacity onPress={() => openMap(vacateLoc)}>
                <Text style={S.tripLink}>View on Map →</Text>
              </TouchableOpacity>
            </View>
            {Number.isFinite(lastDist) && (
              <View style={S.distBox}>
                <Text style={S.distL}>📏 Distance</Text>
                <Text style={S.distV}>{fmtDist(lastDist)}</Text>
              </View>
            )}
            {vacateTime && <Text style={S.tripTime}>Vacated: {vacateTime}</Text>}
          </View>
        )}

        {/* ═══ ACTIVITY RECOGNITION ═══ */}
        <View style={[S.card, S.arBorder]}>
          <View style={S.row}>
            <Text style={S.cardT}>🏃 Activity</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[S.btn, { backgroundColor: '#455A64' }]} onPress={readAr}>
                <Text style={S.btnT}>↻</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[S.btn, { backgroundColor: ar.on ? '#D32F2F' : '#1976D2' }]}
                onPress={ar.on ? stopAr : startAr}>
                <Text style={S.btnT}>{ar.on ? '⏹' : '▶'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <Text style={S.arInfo}>Perm: {ar.perm ? '✅' : '❌'} | {ar.on ? '🟢 Active' : '🔴 Off'}</Text>
          <View style={[S.actBox, { backgroundColor: actCfg.color }]}>
            <Text style={S.actIcon}>{actCfg.icon}</Text>
            <Text style={S.actLbl}>{actCfg.label}</Text>
            <Text style={S.actConf}>{Math.round(ar.conf)}%</Text>
          </View>
          <Text style={S.arInfo}>Updated: {ar.at ? new Date(ar.at).toLocaleTimeString() : 'Never'}</Text>
        </View>

        {/* ═══ GPS TEST ═══ */}
        <View style={S.card}>
          <Text style={S.cardT}>📡 GPS Location</Text>
          <Text style={S.locStat}>Status: {locStatus}</Text>
          <TouchableOpacity style={S.testBtn} onPress={testLoc}>
            <Text style={S.testBtnT}>📍 Test GPS</Text>
          </TouchableOpacity>
        </View>

        {/* ═══ HISTORY ═══ */}
        <View style={S.card}>
          <View style={S.row}>
            <Text style={S.cardT}>📋 History ({history.length})</Text>
            {history.length > 0 && (
              <TouchableOpacity onPress={clearAll}>
                <Text style={S.clearT}>🗑️ Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {history.length > 0 ? (
            history.slice(0, 20).map((item, i) => (
              <View key={`${item.type}-${i}`} style={S.hItem}>
                <Text style={S.hIcon}>
                  {item.type === 'connect' ? '🟢' :
                    item.type === 'disconnect' ? '🔴' :
                      item.type === 'occupy' || item.type === 'park' ? '🅿️' :
                        item.type === 'vacate' || item.type === 'unpark' ? '🚗' : '📍'}
                </Text>

                <View style={{ flex: 1 }}>
                  <Text style={S.hTitle}>
                    {item.type === 'occupy' || item.type === 'park' ? 'Occupied (Manual)' :
                      item.type === 'vacate' || item.type === 'unpark' ? 'Vacated (Manual)' :
                        item.type === 'connect' ? `${item.device} Connected` :
                          `${item.device} Disconnected`}
                  </Text>

                  <Text style={S.hTime}>🕐 {item.time} | 📅 {item.date}</Text>

                  {item.note && (
                    <Text style={{ fontSize: 10, color: '#888', fontStyle: 'italic' }}>
                      {item.note}
                    </Text>
                  )}

                  {item.activity && item.activity !== 'unknown' && (
                    <Text style={S.hAct}>
                      {getAct(item.activity).icon} {getAct(item.activity).label}
                    </Text>
                  )}

                  {item.location && (
                    <TouchableOpacity onPress={() => openMap(item.location)}>
                      <Text style={S.hLoc}>
                        📍 {fmtCoord(item.location.latitude, 4)}, {fmtCoord(item.location.longitude, 4)}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {(item.type === 'disconnect' || item.type === 'vacate' || item.type === 'unpark') &&
                    Number.isFinite(item.distanceMeters) && (
                      <Text style={S.hDist}>📏 {fmtDist(item.distanceMeters)}</Text>
                    )}
                </View>
              </View>
            ))
          ) : (
            <Text style={S.muted}>
              No history yet.{'\n'}
              Select a device and connect/disconnect to start tracking!
            </Text>
          )}
        </View>

        {/* ═══ REFRESH ═══ */}
        <TouchableOpacity
          style={[S.refreshBtn, btSyncing && { opacity: 0.5 }]}
          onPress={restartBt} disabled={btSyncing}>
          <Text style={S.refreshT}>{btSyncing ? '⏳ Syncing...' : '🔄 Refresh Bluetooth'}</Text>
        </TouchableOpacity>

        <View style={{ height: 50 }} />
      </ScrollView>

      {/* ═══ DEVICE MODAL ═══ */}
      <Modal visible={showModal} transparent animationType="slide">
        <View style={S.modalBg}>
          <View style={S.modalBox}>
            <View style={S.row}>
              <Text style={S.modalT}>Select Device to Track</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Text style={{ fontSize: 26, color: '#999' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <Text style={{ color: '#666', marginBottom: 12, textAlign: 'center' }}>
              Choose the Bluetooth device you want to track{'\n'}(e.g., car stereo, earphones)
            </Text>

            {paired.length > 0 ? (
              <FlatList
                data={paired}
                keyExtractor={(d) => d.address}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[S.modalDev, selDevice?.address === item.address && S.modalDevActive]}
                    onPress={() => selectDev(item)}>
                    <Text style={{ fontSize: 26, marginRight: 12 }}>🎧</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={S.modalDevN}>{item.name}</Text>
                      <Text style={S.modalDevA}>{item.address}</Text>
                    </View>
                    {selDevice?.address === item.address && (
                      <Text style={{ fontSize: 22, color: '#4CAF50', fontWeight: 'bold' }}>✓</Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={S.muted}>No paired devices found.{'\n'}Pair a device in Bluetooth settings first.</Text>
            )}

            <TouchableOpacity style={S.modalRefresh} onPress={refreshDevs}>
              <Text style={S.modalRefreshT}>🔄 Refresh List</Text>
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

const S = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F0F2F5' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A237E' },
  loadingText: { color: '#FFF', fontSize: 18, marginTop: 12 },

  header: { paddingTop: 16, paddingBottom: 20, paddingHorizontal: 20, alignItems: 'center' },
  title: { fontSize: 28, fontWeight: 'bold', color: '#FFF' },
  subtitle: { fontSize: 12, color: '#FFF', opacity: 0.85, marginTop: 2 },
  badges: { flexDirection: 'row', marginTop: 12, flexWrap: 'wrap', justifyContent: 'center', gap: 6 },
  badge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12 },
  badgeW: { backgroundColor: 'rgba(255,160,0,0.5)' },
  badgeT: { color: '#FFF', fontSize: 11, fontWeight: '600' },

  scroll: { flex: 1, padding: 12 },

  parkCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 20, marginBottom: 12, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4 },
  parkTitle: { fontSize: 18, fontWeight: 'bold', color: '#222', textAlign: 'center' },
  parkSub: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 4, marginBottom: 16 },
  parkRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  parkBtn: { flex: 1, backgroundColor: '#E65100', paddingVertical: 20, borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  unparkBtn: { flex: 1, backgroundColor: '#2E7D32', paddingVertical: 20, borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  disabled: { backgroundColor: '#BDBDBD' },
  parkIcon: { fontSize: 32 },
  parkBtnT: { fontSize: 16, fontWeight: 'bold', color: '#FFF', marginTop: 4 },
  statusBox: { marginTop: 16, padding: 12, borderRadius: 10, alignItems: 'center' },
  statusBoxT: { fontSize: 14, fontWeight: '600' },
  statusTime: { fontSize: 12, color: '#666', marginTop: 4 },

  locCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#E65100', elevation: 2 },
  locTitle: { fontSize: 16, fontWeight: 'bold', color: '#E65100', marginBottom: 12 },
  coordRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  coordBox: { flex: 1, backgroundColor: '#FFF3E0', padding: 12, borderRadius: 10, alignItems: 'center' },
  coordL: { fontSize: 11, color: '#666', marginBottom: 4 },
  coordV: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  metaT: { fontSize: 11, color: '#888' },
  mapBtn: { backgroundColor: '#4285F4', marginTop: 12, padding: 12, borderRadius: 10, alignItems: 'center' },
  mapBtnT: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },

  tripCard: { backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: '#2E7D32', elevation: 2 },
  tripTitle: { fontSize: 16, fontWeight: 'bold', color: '#2E7D32', marginBottom: 12 },
  tripSec: { backgroundColor: '#F5F5F5', padding: 12, borderRadius: 10, marginBottom: 10 },
  tripLbl: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 4 },
  tripCoord: { fontSize: 12, color: '#555' },
  tripLink: { fontSize: 12, color: '#1976D2', marginTop: 6, fontWeight: '600' },
  distBox: { backgroundColor: '#E8F5E9', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  distL: { fontSize: 12, color: '#666' },
  distV: { fontSize: 22, fontWeight: 'bold', color: '#2E7D32', marginTop: 4 },
  tripTime: { fontSize: 12, color: '#666', textAlign: 'center', marginTop: 10 },

  card: { backgroundColor: '#FFF', borderRadius: 14, padding: 16, marginBottom: 12, elevation: 2 },
  arBorder: { borderLeftWidth: 4, borderLeftColor: '#1976D2' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  cardT: { fontSize: 16, fontWeight: 'bold', color: '#222' },
  btn: { backgroundColor: '#1976D2', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10 },
  btnT: { color: '#FFF', fontWeight: '600', fontSize: 13 },

  actBox: { borderRadius: 14, padding: 20, alignItems: 'center', marginVertical: 10 },
  actIcon: { fontSize: 42 },
  actLbl: { fontSize: 22, fontWeight: 'bold', color: '#FFF', marginTop: 6 },
  actConf: { fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4 },
  arInfo: { fontSize: 12, color: '#555', marginBottom: 4 },

  devBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E3F2FD', padding: 14, borderRadius: 12 },
  devName: { fontSize: 15, fontWeight: 'bold', color: '#1565C0' },
  devAddr: { fontSize: 11, color: '#64B5F6', marginTop: 2 },
  muted: { color: '#888', fontStyle: 'italic', textAlign: 'center', padding: 10, lineHeight: 20 },

  btCard: { borderRadius: 18, padding: 24, alignItems: 'center', marginBottom: 12, elevation: 4 },
  dot: { width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.4)', marginBottom: 10 },
  btTitle: { fontSize: 22, fontWeight: 'bold', color: '#FFF' },
  btSub: { fontSize: 13, color: '#FFF', opacity: 0.9, marginTop: 4 },
  btTime: { fontSize: 12, color: '#FFF', opacity: 0.8, marginTop: 6 },
  arTag: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, marginTop: 10 },
  arTagT: { color: '#FFF', fontWeight: '700', fontSize: 14 },

  locStat: { fontSize: 13, color: '#555', marginBottom: 10 },
  testBtn: { backgroundColor: '#9C27B0', padding: 13, borderRadius: 10, alignItems: 'center' },
  testBtnT: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  clearT: { fontSize: 13, color: '#F44336', fontWeight: '600' },

  hItem: { flexDirection: 'row', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', alignItems: 'flex-start' },
  hIcon: { fontSize: 18, marginRight: 10, marginTop: 2 },
  hTitle: { fontSize: 14, fontWeight: '600', color: '#222' },
  hTime: { fontSize: 11, color: '#666', marginTop: 2 },
  hAct: { fontSize: 11, color: '#1976D2', marginTop: 2, fontWeight: '600' },
  hLoc: { fontSize: 11, color: '#1976D2', marginTop: 3 },
  hDist: { fontSize: 11, color: '#2E7D32', marginTop: 4, fontWeight: '600' },

  refreshBtn: { backgroundColor: '#1976D2', padding: 15, borderRadius: 12, alignItems: 'center', elevation: 2 },
  refreshT: { color: '#FFF', fontSize: 15, fontWeight: 'bold' },

  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '70%' },
  modalT: { fontSize: 18, fontWeight: 'bold', color: '#222' },
  modalDev: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: '#F5F5F5', borderRadius: 12, marginBottom: 10 },
  modalDevActive: { backgroundColor: '#E3F2FD', borderWidth: 2, borderColor: '#1976D2' },
  modalDevN: { fontSize: 15, fontWeight: '600', color: '#222' },
  modalDevA: { fontSize: 11, color: '#888', marginTop: 2 },
  modalRefresh: { backgroundColor: '#E3F2FD', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  modalRefreshT: { color: '#1976D2', fontWeight: 'bold', fontSize: 14 },
});

export default BluetoothDemoScreen;