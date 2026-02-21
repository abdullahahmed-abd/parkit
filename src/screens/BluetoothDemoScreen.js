import React, {useEffect, useRef, useState} from 'react';
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

const {BluetoothModule, ActivityRecognitionModule} = NativeModules;

/** ======================
 *  DEBUG LOGGER
 *  ====================== */
const DEBUG = true;
const ts = () => new Date().toISOString();
const log = (...args) => DEBUG && console.log(`[ParkIt][${ts()}]`, ...args);
const warn = (...args) => DEBUG && console.warn(`[ParkIt][${ts()}]`, ...args);
const err = (...args) => DEBUG && console.error(`[ParkIt][${ts()}]`, ...args);

const toNum = v => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isValidLatLng = (lat, lng) =>
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

const formatLatLng6 = loc => {
  const lat = toNum(loc?.latitude);
  const lng = toNum(loc?.longitude);
  if (!isValidLatLng(lat, lng)) return 'N/A';
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
};

// Haversine distance in meters
const distanceMeters = (a, b) => {
  const lat1 = toNum(a?.latitude);
  const lon1 = toNum(a?.longitude);
  const lat2 = toNum(b?.latitude);
  const lon2 = toNum(b?.longitude);

  if (!isValidLatLng(lat1, lon1) || !isValidLatLng(lat2, lon2)) return null;

  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 =
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - (s1 + s2)));
  return R * c;
};

const niceActivityLabel = s => {
  switch (s) {
    case 'still':
      return 'STILL';
    case 'walking':
      return 'WALKING';
    case 'running':
      return 'RUNNING';
    case 'in_vehicle':
      return 'IN VEHICLE';
    case 'on_bicycle':
      return 'BICYCLE';
    default:
      return (s || 'UNKNOWN').toUpperCase();
  }
};

const activityIcon = s => {
  switch (s) {
    case 'still':
      return '🧍';
    case 'walking':
      return '🚶';
    case 'running':
      return '🏃';
    case 'in_vehicle':
      return '🚗';
    case 'on_bicycle':
      return '🚲';
    default:
      return '❓';
  }
};

const BluetoothDemoScreen = () => {
  // UI loading states
  const [bootLoading, setBootLoading] = useState(true);
  const [isBtSyncing, setIsBtSyncing] = useState(false);

  // Bluetooth states
  const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
  const [pairedDevices, setPairedDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [showDeviceModal, setShowDeviceModal] = useState(false);

  // Connection states
  const [isConnected, setIsConnected] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [connectionTime, setConnectionTime] = useState(null);

  // Location states
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [locationStatus, setLocationStatus] = useState('Ready');
  const [drivingLocation, setDrivingLocation] = useState(null);
  const [parkedLocation, setParkedLocation] = useState(null);

  // History
  const [connectionHistory, setConnectionHistory] = useState([]);

  // Activity Recognition states
  const [arPermission, setArPermission] = useState(false);
  const [arEnabled, setArEnabled] = useState(false);
  const [arState, setArState] = useState('unknown');
  const [arConfidence, setArConfidence] = useState(0);
  const [arUpdatedAt, setArUpdatedAt] = useState(0);

  const arSubRef = useRef(null);
  const arPollRef = useRef(null);

  // Animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Refs to avoid stale state issues
  const selectedDeviceRef = useRef(null);
  const connectedDeviceRef = useRef(null);
  const drivingLocationRef = useRef(null);
  const lastConnectedRef = useRef({address: null, name: null});

  useEffect(() => {
    selectedDeviceRef.current = selectedDevice;
  }, [selectedDevice]);

  useEffect(() => {
    connectedDeviceRef.current = connectedDevice;
  }, [connectedDevice]);

  useEffect(() => {
    drivingLocationRef.current = drivingLocation;
  }, [drivingLocation]);

  // ─── Mount ────────────────────────────────────────────────
  useEffect(() => {
    log('Screen mounted');
    log('BluetoothModule exists?', !!BluetoothModule);
    log('ActivityRecognitionModule exists?', !!ActivityRecognitionModule);

    init();

    return () => {
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

  // ─── Pulse animation ──────────────────────────────────────
  useEffect(() => {
    let animation;
    if (isConnected) {
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
        ]),
      );
      animation.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => animation && animation.stop();
  }, [isConnected, pulseAnim]);

  // ─── INIT ─────────────────────────────────────────────────
  const init = async () => {
    try {
      await requestLocationPermission();
      await loadSavedData();
      await startBluetoothListening();
      await initActivityRecognition();
    } catch (e) {
      err('init error =>', e);
    } finally {
      setBootLoading(false);
    }
  };

  // ─── ACTIVITY RECOGNITION ─────────────────────────────────
  const requestArPermission = async () => {
    if (Platform.OS !== 'android') {
      setArPermission(true);
      return true;
    }

    try {
      log('Requesting ACTIVITY_RECOGNITION permission...');

      const ar = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
        {
          title: 'Activity Permission',
          message: 'App needs activity recognition to detect still / walk / run / vehicle.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );

      log('ACTIVITY_RECOGNITION result:', ar);

      if (Platform.Version >= 33) {
        log('Requesting POST_NOTIFICATIONS (Android 13+)');
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }

      const ok = ar === PermissionsAndroid.RESULTS.GRANTED;
      setArPermission(ok);
      return ok;
    } catch (e) {
      err('requestArPermission error =>', e);
      setArPermission(false);
      return false;
    }
  };

  const readLastAr = async () => {
    try {
      if (!ActivityRecognitionModule?.getLast) {
        warn('getLast() not available');
        return;
      }

      const last = await ActivityRecognitionModule.getLast();
      log('📖 getLast() =>', JSON.stringify(last));

      if (last) {
        setArState(last.state || 'unknown');
        setArConfidence(Number(last.confidence ?? 0));
        setArUpdatedAt(Number(last.timestamp ?? 0));
        setArEnabled(Boolean(last.enabled));
      }
    } catch (e) {
      err('readLastAr error =>', e);
    }
  };

  const startAr = async () => {
    try {
      if (!ActivityRecognitionModule?.start) {
        Alert.alert('Missing', 'ActivityRecognitionModule.start not found.');
        return;
      }

      let permOk = arPermission;
      if (!permOk) {
        permOk = await requestArPermission();
        if (!permOk) {
          Alert.alert('Permission Denied', 'Activity recognition permission not granted.');
          return;
        }
      }

      log('Calling ActivityRecognitionModule.start(5000)...');
      const res = await ActivityRecognitionModule.start(5000);
      log('start() result =>', res);

      setArEnabled(true);
      setTimeout(() => readLastAr(), 3000);
    } catch (e) {
      err('startAr error =>', e);
      Alert.alert('AR Start Error', String(e?.message || e));
    }
  };

  const stopAr = async () => {
    try {
      if (!ActivityRecognitionModule?.stop) return;

      log('Calling ActivityRecognitionModule.stop()...');
      const res = await ActivityRecognitionModule.stop();
      log('stop() result =>', res);

      setArEnabled(false);
      await readLastAr();
    } catch (e) {
      err('stopAr error =>', e);
    }
  };

  const initActivityRecognition = async () => {
    if (!ActivityRecognitionModule) {
      err('❌ ActivityRecognitionModule is NULL');
      return;
    }

    // Subscribe to events
    if (!arSubRef.current) {
      log('📡 Subscribing DeviceEventEmitter: ActivityRecognition');
      arSubRef.current = DeviceEventEmitter.addListener(
        'ActivityRecognition',
        event => {
          log('🎯 AR EVENT =>', JSON.stringify(event));

          if (event?.state) {
            setArState(event.state);
            setArConfidence(Number(event.confidence ?? 0));
            setArUpdatedAt(Number(event.timestamp ?? Date.now()));
          }
        },
      );
    }

    await readLastAr();

    const permOk = await requestArPermission();
    if (!permOk) {
      warn('AR permission not granted');
      return;
    }

    try {
      log('Starting AR service (5000ms)...');
      await ActivityRecognitionModule.start(5000);
      setArEnabled(true);
      setTimeout(() => readLastAr(), 3000);
    } catch (e) {
      err('AR auto-start failed =>', e);
    }

    // Polling every 10s
    if (!arPollRef.current) {
      arPollRef.current = setInterval(() => {
        readLastAr();
      }, 10000);
    }
  };

  // ─── PERMISSIONS ──────────────────────────────────────────
  const requestLocationPermission = async () => {
    if (Platform.OS !== 'android') return true;

    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'ParkIt needs location to save your parking spot',
          buttonPositive: 'Allow',
        },
      );

      const ok = granted === PermissionsAndroid.RESULTS.GRANTED;
      setLocationStatus(ok ? 'Permission ✅' : 'Permission ❌');
      return ok;
    } catch (e) {
      setLocationStatus('Permission error');
      return false;
    }
  };

  // ─── STORAGE ──────────────────────────────────────────────
  const loadSavedData = async () => {
    try {
      const [d, h, parked, driving] = await Promise.all([
        AsyncStorage.getItem('selectedDevice'),
        AsyncStorage.getItem('history'),
        AsyncStorage.getItem('parkedLoc'),
        AsyncStorage.getItem('drivingLoc'),
      ]);

      if (d) setSelectedDevice(JSON.parse(d));
      if (h) setConnectionHistory(JSON.parse(h));
      if (parked) setParkedLocation(JSON.parse(parked));
      if (driving) setDrivingLocation(JSON.parse(driving));
    } catch (e) {
      err('loadSavedData error =>', e);
    }
  };

  const saveHistory = async newHistory => {
    try {
      await AsyncStorage.setItem('history', JSON.stringify(newHistory));
    } catch (e) {}
  };

  const saveParkedLoc = async loc => {
    try {
      await AsyncStorage.setItem('parkedLoc', JSON.stringify(loc));
    } catch (e) {}
  };

  const saveDrivingLoc = async loc => {
    try {
      await AsyncStorage.setItem('drivingLoc', JSON.stringify(loc));
    } catch (e) {}
  };

  // ─── LOCATION ─────────────────────────────────────────────
  const getIPLocation = async () => {
    try {
      const response = await fetch('http://ip-api.com/json/');
      const data = await response.json();
      if (data?.status === 'success') {
        return {
          latitude: data.lat,
          longitude: data.lon,
          city: data.city || 'Unknown',
          source: 'IP (Approx)',
          accuracy: 5000,
          time: Date.now(),
        };
      }
    } catch (e) {
      err('getIPLocation error =>', e);
    }
    return null;
  };

  const getNativeLocation = async (fresh = false) => {
    try {
      if (!BluetoothModule) return null;

      if (fresh && BluetoothModule?.getFreshLocation) {
        const f = await BluetoothModule.getFreshLocation();
        const lat = toNum(f?.latitude);
        const lng = toNum(f?.longitude);
        if (isValidLatLng(lat, lng)) {
          return {...f, latitude: lat, longitude: lng};
        }
      }

      if (BluetoothModule?.getCurrentLocation) {
        const c = await BluetoothModule.getCurrentLocation();
        const lat = toNum(c?.latitude);
        const lng = toNum(c?.longitude);
        if (isValidLatLng(lat, lng)) {
          return {...c, latitude: lat, longitude: lng};
        }
      }

      return null;
    } catch (e) {
      err('getNativeLocation error =>', e);
      return null;
    }
  };

  const getLocation = async ({fresh = false} = {}) => {
    setIsGettingLocation(true);
    setLocationStatus(fresh ? 'Getting LIVE GPS...' : 'Getting GPS...');

    try {
      const nativeLoc = await getNativeLocation(fresh);

      if (nativeLoc?.latitude && nativeLoc?.longitude) {
        setLocationStatus(`GPS ✅`);
        return {
          latitude: nativeLoc.latitude,
          longitude: nativeLoc.longitude,
          accuracy: nativeLoc.accuracy,
          time: nativeLoc.time,
          source: 'GPS',
        };
      }

      const ipLoc = await getIPLocation();
      if (ipLoc) {
        setLocationStatus(ipLoc.city || 'IP ✅');
        return ipLoc;
      }

      setLocationStatus('Default');
      return {
        latitude: 23.2599,
        longitude: 77.4126,
        city: 'Bhopal',
        source: 'Default',
        accuracy: 99999,
        time: Date.now(),
      };
    } finally {
      setIsGettingLocation(false);
    }
  };

  const openMaps = loc => {
    const lat = toNum(loc?.latitude);
    const lng = toNum(loc?.longitude);
    if (!isValidLatLng(lat, lng)) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url).catch(() => {});
  };

  // ─── BLUETOOTH ────────────────────────────────────────────
  const shouldHandleEventForSelected = device => {
    const selected = selectedDeviceRef.current;
    if (!selected) return true;
    if (device?.address) return device.address === selected.address;
    return lastConnectedRef.current?.address === selected.address;
  };

  const getNiceDeviceName = device => {
    const nameFromEvent = device?.name || device?.namme;
    if (nameFromEvent && nameFromEvent !== 'Unknown Device') return nameFromEvent;
    return (
      connectedDeviceRef.current?.name ||
      lastConnectedRef.current?.name ||
      selectedDeviceRef.current?.name ||
      'Unknown Device'
    );
  };

  const startBluetoothListening = async () => {
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
        onStateChange: s => setBluetoothEnabled(!!s.enabled),
      });
    } catch (e) {
      err('startBluetoothListening error =>', e);
    } finally {
      setIsBtSyncing(false);
    }
  };

  const onDeviceConnect = async device => {
    log('onDeviceConnect =>', device);

    if (!shouldHandleEventForSelected(device)) return;

    lastConnectedRef.current = {
      address: device?.address || null,
      name: device?.name || null,
    };

    const now = new Date();
    const loc = await getLocation({fresh: true});

    setDrivingLocation(loc);
    saveDrivingLoc(loc);
    setIsConnected(true);
    setConnectedDevice(device);
    setConnectionTime(now.toLocaleTimeString());

    const entry = {
      type: 'connect',
      device: device?.name || 'Unknown Device',
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      location: loc,
      activity: arState,
    };

    setConnectionHistory(prev => {
      const newHistory = [entry, ...prev.slice(0, 29)];
      saveHistory(newHistory);
      return newHistory;
    });
  };

  const onDeviceDisconnect = async device => {
    log('onDeviceDisconnect =>', device);

    if (!shouldHandleEventForSelected(device)) return;

    const now = new Date();
    const loc = await getLocation({fresh: true});

    setIsConnected(false);
    setConnectionTime(now.toLocaleTimeString());
    setParkedLocation(loc);
    await saveParkedLoc(loc);

    const startLoc = drivingLocationRef.current;
    const dist = distanceMeters(startLoc, loc);

    const entry = {
      type: 'disconnect',
      device: getNiceDeviceName(device),
      time: now.toLocaleTimeString(),
      date: now.toLocaleDateString(),
      location: loc,
      distanceMeters: dist,
      activity: arState,
    };

    setConnectionHistory(prev => {
      const newHistory = [entry, ...prev.slice(0, 29)];
      saveHistory(newHistory);
      return newHistory;
    });
  };

  // ─── UI ACTIONS ───────────────────────────────────────────
  const testLocation = async () => {
    try {
      const loc = await getLocation({fresh: true});
      Alert.alert(
        '📍 GPS Location',
        `Lat/Lng: ${formatLatLng6(loc)}\nAccuracy: ${
          loc.accuracy ? Math.round(loc.accuracy) + 'm' : 'N/A'
        }\nSource: ${loc.source || 'N/A'}`,
        [{text: 'OK'}, {text: 'Open Maps', onPress: () => openMaps(loc)}],
      );
    } catch (e) {
      Alert.alert('Error', 'Could not get location');
    }
  };

  const selectDevice = async device => {
    setSelectedDevice(device);
    setShowDeviceModal(false);
    try {
      await AsyncStorage.setItem('selectedDevice', JSON.stringify(device));
    } catch (e) {}
    Alert.alert('✅ Selected', device?.name || 'Device');
  };

  const clearDevice = async () => {
    Alert.alert('Remove Device?', 'Selected device ko remove karein?', [
      {text: 'No'},
      {
        text: 'Yes',
        onPress: async () => {
          setSelectedDevice(null);
          setIsConnected(false);
          try {
            await AsyncStorage.removeItem('selectedDevice');
          } catch (e) {}
        },
      },
    ]);
  };

  const clearHistory = () => {
    Alert.alert('Clear All?', 'Puri history delete ho jayegi.', [
      {text: 'No'},
      {
        text: 'Yes',
        style: 'destructive',
        onPress: async () => {
          setConnectionHistory([]);
          setParkedLocation(null);
          setDrivingLocation(null);
          try {
            await AsyncStorage.multiRemove(['history', 'parkedLoc', 'drivingLoc']);
          } catch (e) {}
        },
      },
    ]);
  };

  // ─── DERIVED VALUES ───────────────────────────────────────
  const lastDistance =
    !isConnected && parkedLocation && drivingLocation
      ? distanceMeters(drivingLocation, parkedLocation)
      : null;

  const arModuleAvailable = !!ActivityRecognitionModule;

  const arBadgeText = arModuleAvailable
    ? arEnabled
      ? `${activityIcon(arState)} ${niceActivityLabel(arState)}`
      : 'AR OFF'
    : 'AR N/A';

  const arCardColor = () => {
    switch (arState) {
      case 'in_vehicle':
        return '#1565C0';
      case 'walking':
        return '#2E7D32';
      case 'running':
        return '#E65100';
      case 'on_bicycle':
        return '#6A1B9A';
      case 'still':
        return '#37474F';
      default:
        return '#455A64';
    }
  };

  // ─── LOADING SCREEN ───────────────────────────────────────
  if (bootLoading) {
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator size="large" color="#FFF" />
        <Text style={styles.loadingText}>Starting ParkIt...</Text>
      </SafeAreaView>
    );
  }

  // ─── MAIN RENDER ──────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={isConnected ? '#2E7D32' : '#D84315'}
      />

      {/* ── Header ── */}
      <View
        style={[
          styles.header,
          {backgroundColor: isConnected ? '#2E7D32' : '#D84315'},
        ]}>
        <Text style={styles.title}>🅿 ParkIt</Text>
        <Text style={styles.subtitle}>Smart Parking Detection</Text>

        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {bluetoothEnabled ? '🔵 BT ON' : '⚫ BT OFF'}
            </Text>
          </View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {isGettingLocation ? '📡 GPS...' : locationStatus}
            </Text>
          </View>

          <View style={[styles.badge, !arModuleAvailable && styles.badgeWarning]}>
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
        {/* ── Activity Recognition Card ── */}
        <View style={[styles.card, styles.arCard]}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>🏃 Activity Recognition</Text>
            <View style={{flexDirection: 'row', gap: 8}}>
              <TouchableOpacity
                style={[styles.btn, {backgroundColor: '#455A64'}]}
                onPress={readLastAr}>
                <Text style={styles.btnText}>↻</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.btn,
                  {backgroundColor: arEnabled ? '#D32F2F' : '#1976D2'},
                ]}
                onPress={arEnabled ? stopAr : startAr}>
                <Text style={styles.btnText}>{arEnabled ? '⏹' : '▶'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Status */}
          <Text style={styles.arInfoText}>
            Permission: {arPermission ? '✅' : '❌'} | Status:{' '}
            {arEnabled ? '🟢 ON' : '🔴 OFF'}
          </Text>

          {/* Big Activity Display */}
          <View style={[styles.activityBig, {backgroundColor: arCardColor()}]}>
            <Text style={styles.activityIcon}>{activityIcon(arState)}</Text>
            <Text style={styles.activityLabel}>{niceActivityLabel(arState)}</Text>
            <Text style={styles.activityConf}>
              {Math.round(arConfidence)}% confidence
            </Text>
          </View>

          {/* Last Updated */}
          <Text style={styles.arInfoText}>
            Last: {arUpdatedAt ? new Date(arUpdatedAt).toLocaleTimeString() : 'Never'}
          </Text>
        </View>

        {/* ── Device Card ── */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>🎧 Tracking Device</Text>
            <TouchableOpacity
              style={styles.btn}
              onPress={() => {
                startBluetoothListening();
                setShowDeviceModal(true);
              }}>
              <Text style={styles.btnText}>
                {selectedDevice ? '✏️ Change' : '+ Select'}
              </Text>
            </TouchableOpacity>
          </View>

          {selectedDevice ? (
            <View style={styles.deviceBox}>
              <Text style={styles.deviceIcon}>🎧</Text>
              <View style={{flex: 1}}>
                <Text style={styles.deviceName}>{selectedDevice.name}</Text>
                <Text style={styles.deviceAddr}>{selectedDevice.address}</Text>
              </View>
              <TouchableOpacity onPress={clearDevice}>
                <Text style={styles.x}>✕</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <Text style={styles.muted}>
              Koi device select nahi hai.{'\n'}
              "Select" tap karke device choose karein.
            </Text>
          )}
        </View>

        {/* ── Status Card ── */}
        <View
          style={[
            styles.statusCard,
            {backgroundColor: isConnected ? '#43A047' : '#FF5722'},
          ]}>
          <Animated.View
            style={[styles.dot, {transform: [{scale: pulseAnim}]}]}
          />
          <Text style={styles.statusTitle}>
            {isConnected ? '🚗 DRIVING' : '🅿 PARKED'}
          </Text>
          <Text style={styles.statusSub}>
            {isConnected
              ? connectedDevice?.name || 'Connected'
              : selectedDevice?.name || 'Select a device'}
          </Text>

          {connectionTime && (
            <Text style={styles.statusTime}>⏰ {connectionTime}</Text>
          )}

          {arEnabled && arState !== 'unknown' && (
            <View style={styles.arStatusBadge}>
              <Text style={styles.arStatusText}>
                {activityIcon(arState)} {niceActivityLabel(arState)}
              </Text>
            </View>
          )}

          {isConnected && drivingLocation && (
            <Text style={styles.smallWhite}>
              📍 Start: {formatLatLng6(drivingLocation)}
            </Text>
          )}

          {!isConnected && parkedLocation && (
            <>
              <TouchableOpacity
                style={styles.locBtn}
                onPress={() => openMaps(parkedLocation)}>
                <Text style={styles.locBtnText}>📍 View Parking Spot</Text>
              </TouchableOpacity>

              {Number.isFinite(lastDistance) && (
                <Text style={styles.smallWhite}>
                  📏 Distance: {Math.round(lastDistance)} m
                </Text>
              )}
            </>
          )}
        </View>

        {/* ── Parked Location Card ── */}
        {!isConnected && parkedLocation && (
          <View style={styles.parkedCard}>
            <Text style={styles.parkedTitle}>🅿 Parked Location</Text>
            <Text style={styles.parkedBig}>{formatLatLng6(parkedLocation)}</Text>

            <Text style={styles.parkedSource}>
              Source: {parkedLocation.source || 'N/A'} | Accuracy:{' '}
              {parkedLocation.accuracy
                ? Math.round(parkedLocation.accuracy) + 'm'
                : 'N/A'}
            </Text>

            {Number.isFinite(lastDistance) && (
              <Text style={styles.parkedSource}>
                📏 Distance: {Math.round(lastDistance)} m
              </Text>
            )}

            <TouchableOpacity
              style={styles.mapsBtn}
              onPress={() => openMaps(parkedLocation)}>
              <Text style={styles.mapsBtnText}>🗺 Open Google Maps</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Location Test Card ── */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>📡 Location</Text>
          <Text style={styles.locStatus}>Status: {locationStatus}</Text>
          <TouchableOpacity style={styles.testBtn} onPress={testLocation}>
            <Text style={styles.testBtnText}>📍 Test GPS</Text>
          </TouchableOpacity>
        </View>

        {/* ── History Card ── */}
        <View style={styles.card}>
          <View style={styles.row}>
            <Text style={styles.cardTitle}>📋 History</Text>
            {connectionHistory.length > 0 && (
              <TouchableOpacity onPress={clearHistory}>
                <Text style={styles.clearBtn}>🗑 Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {connectionHistory.length > 0 ? (
            connectionHistory.slice(0, 10).map((item, i) => (
              <View key={i} style={styles.historyItem}>
                <Text style={styles.historyIcon}>
                  {item.type === 'connect' ? '🟢' : '🔴'}
                </Text>

                <View style={{flex: 1}}>
                  <Text style={styles.historyDevice}>{item.device}</Text>

                  <Text style={styles.historyTime}>
                    ⏰ {item.time} | 📅 {item.date}
                  </Text>

                  {item.activity && item.activity !== 'unknown' && (
                    <Text style={styles.historyActivity}>
                      {activityIcon(item.activity)} {niceActivityLabel(item.activity)}
                    </Text>
                  )}

                  {item.location && (
                    <TouchableOpacity onPress={() => openMaps(item.location)}>
                      <Text style={styles.historyLoc}>
                        📍 {formatLatLng6(item.location)}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {item.type === 'disconnect' &&
                    Number.isFinite(item.distanceMeters) && (
                      <Text style={styles.historyDistance}>
                        📏 Distance: {Math.round(item.distanceMeters)} m
                      </Text>
                    )}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.muted}>No history yet.</Text>
          )}
        </View>

        {/* ── Refresh BT Button ── */}
        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={startBluetoothListening}>
          <Text style={styles.refreshText}>🔄 Refresh Bluetooth</Text>
        </TouchableOpacity>

        <View style={{height: 50}} />
      </ScrollView>

      {/* ── Device Select Modal ── */}
      <Modal visible={showDeviceModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={styles.modalBox}>
            <View style={styles.row}>
              <Text style={styles.modalTitle}>Select Device</Text>
              <TouchableOpacity onPress={() => setShowDeviceModal(false)}>
                <Text style={styles.modalX}>✕</Text>
              </TouchableOpacity>
            </View>

            {pairedDevices.length > 0 ? (
              <FlatList
                data={pairedDevices}
                keyExtractor={d => d.address}
                renderItem={({item}) => (
                  <TouchableOpacity
                    style={[
                      styles.modalDevice,
                      selectedDevice?.address === item.address &&
                        styles.modalDeviceSelected,
                    ]}
                    onPress={() => selectDevice(item)}>
                    <Text style={styles.modalDeviceIcon}>🎧</Text>
                    <View style={{flex: 1}}>
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
              <Text style={styles.muted}>No paired devices found.</Text>
            )}

            <TouchableOpacity
              style={styles.modalRefresh}
              onPress={startBluetoothListening}>
              <Text style={styles.modalRefreshText}>🔄 Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ─── STYLES ─────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#F0F2F5'},

  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A237E',
  },
  loadingText: {color: '#FFF', fontSize: 18, marginTop: 12},

  header: {
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  title: {fontSize: 28, fontWeight: 'bold', color: '#FFF'},
  subtitle: {fontSize: 12, color: '#FFF', opacity: 0.85, marginTop: 2},
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
  badgeWarning: {backgroundColor: 'rgba(255,160,0,0.5)'},
  badgeText: {color: '#FFF', fontSize: 12, fontWeight: '600'},

  scroll: {flex: 1, padding: 12},

  card: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    elevation: 2,
  },
  arCard: {borderLeftWidth: 4, borderLeftColor: '#1976D2'},

  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: {fontSize: 16, fontWeight: 'bold', color: '#222'},

  btn: {
    backgroundColor: '#1976D2',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
  },
  btnText: {color: '#FFF', fontWeight: '600', fontSize: 13},

  activityBig: {
    borderRadius: 14,
    padding: 20,
    alignItems: 'center',
    marginVertical: 10,
  },
  activityIcon: {fontSize: 42},
  activityLabel: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFF',
    marginTop: 6,
  },
  activityConf: {fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 4},

  arInfoText: {fontSize: 13, color: '#555', marginBottom: 4},

  deviceBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E3F2FD',
    padding: 14,
    borderRadius: 12,
  },
  deviceIcon: {fontSize: 28, marginRight: 12},
  deviceName: {fontSize: 15, fontWeight: 'bold', color: '#1565C0'},
  deviceAddr: {fontSize: 11, color: '#64B5F6', marginTop: 2},
  x: {fontSize: 22, color: '#F44336', paddingHorizontal: 8},
  muted: {
    color: '#888',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 10,
  },

  statusCard: {
    borderRadius: 18,
    padding: 28,
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
  statusTitle: {fontSize: 26, fontWeight: 'bold', color: '#FFF'},
  statusSub: {fontSize: 14, color: '#FFF', opacity: 0.9, marginTop: 4},
  statusTime: {fontSize: 13, color: '#FFF', opacity: 0.8, marginTop: 6},
  smallWhite: {fontSize: 12, color: '#FFF', opacity: 0.95, marginTop: 10},

  arStatusBadge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    marginTop: 10,
  },
  arStatusText: {color: '#FFF', fontWeight: '700', fontSize: 14},

  locBtn: {
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  locBtnText: {color: '#FFF', fontWeight: 'bold', fontSize: 14},

  parkedCard: {
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: '#FF5722',
    elevation: 2,
  },
  parkedTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 6,
  },
  parkedBig: {fontSize: 20, fontWeight: '700', color: '#222', marginTop: 4},
  parkedSource: {fontSize: 11, color: '#888', marginTop: 6},
  mapsBtn: {
    backgroundColor: '#4285F4',
    marginTop: 12,
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  mapsBtnText: {color: '#FFF', fontWeight: 'bold', fontSize: 14},

  locStatus: {fontSize: 13, color: '#555', marginBottom: 10},
  testBtn: {
    backgroundColor: '#9C27B0',
    padding: 13,
    borderRadius: 10,
    alignItems: 'center',
  },
  testBtnText: {color: '#FFF', fontWeight: 'bold', fontSize: 14},

  clearBtn: {fontSize: 13, color: '#F44336', fontWeight: '600'},

  historyItem: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    alignItems: 'flex-start',
  },
  historyIcon: {fontSize: 18, marginRight: 10, marginTop: 2},
  historyDevice: {fontSize: 14, fontWeight: '600', color: '#222'},
  historyTime: {fontSize: 11, color: '#666', marginTop: 2},
  historyActivity: {
    fontSize: 11,
    color: '#1976D2',
    marginTop: 2,
    fontWeight: '600',
  },
  historyLoc: {fontSize: 11, color: '#1976D2', marginTop: 3},
  historyDistance: {fontSize: 11, color: '#444', marginTop: 4, fontWeight: '600'},

  refreshBtn: {
    backgroundColor: '#1976D2',
    padding: 15,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 2,
  },
  refreshText: {color: '#FFF', fontSize: 15, fontWeight: 'bold'},

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
  modalTitle: {fontSize: 18, fontWeight: 'bold', color: '#222'},
  modalX: {fontSize: 26, color: '#999'},
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
  modalDeviceIcon: {fontSize: 26, marginRight: 12},
  modalDeviceName: {fontSize: 15, fontWeight: '600', color: '#222'},
  modalDeviceAddr: {fontSize: 11, color: '#888', marginTop: 2},
  check: {fontSize: 22, color: '#4CAF50', fontWeight: 'bold'},
  modalRefresh: {
    backgroundColor: '#E3F2FD',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  modalRefreshText: {color: '#1976D2', fontWeight: 'bold', fontSize: 14},
});

export default BluetoothDemoScreen;