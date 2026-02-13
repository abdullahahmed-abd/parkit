import React, { useState, useEffect, useRef } from 'react';
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
    PermissionsAndroid,
    Platform,
    Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Geolocation from '@react-native-community/geolocation';
import BluetoothService from '../services/BluetoothService';

const BluetoothDemoScreen = () => {
    const [isConnected, setIsConnected] = useState(false);
    const [connectedDevice, setConnectedDevice] = useState(null);
    const [connectionTime, setConnectionTime] = useState(null);
    const [pairedDevices, setPairedDevices] = useState([]);
    const [connectionHistory, setConnectionHistory] = useState([]);
    const [bluetoothEnabled, setBluetoothEnabled] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    
    // Selected device to track
    const [selectedDevice, setSelectedDevice] = useState(null);
    const [showDeviceModal, setShowDeviceModal] = useState(false);
    
    // 📍 Location states
    const [currentLocation, setCurrentLocation] = useState(null);
    const [parkedLocation, setParkedLocation] = useState(null);
    const [drivingStartLocation, setDrivingStartLocation] = useState(null);

    const pulseAnim = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        requestLocationPermission();
        loadSavedDevice();
        loadSavedHistory();
        initializeBluetooth();
        return () => {
            BluetoothService.stopListening();
        };
    }, []);

    useEffect(() => {
        const pulse = Animated.loop(
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

        if (isConnected) {
            pulse.start();
        } else {
            pulse.stop();
            pulseAnim.setValue(1);
        }

        return () => pulse.stop();
    }, [isConnected]);

    // 📍 Request Location Permission
    const requestLocationPermission = async () => {
        if (Platform.OS === 'android') {
            try {
                const granted = await PermissionsAndroid.request(
                    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
                    {
                        title: 'Location Permission',
                        message: 'ParkIt needs location access to save your parking spot.',
                        buttonNeutral: 'Ask Me Later',
                        buttonNegative: 'Cancel',
                        buttonPositive: 'OK',
                    }
                );
                return granted === PermissionsAndroid.RESULTS.GRANTED;
            } catch (err) {
                console.warn(err);
                return false;
            }
        }
        return true;
    };

    // 📍 Get Current Location
    const getCurrentLocation = () => {
        return new Promise((resolve, reject) => {
            Geolocation.getCurrentPosition(
                (position) => {
                    const location = {
                        latitude: position.coords.latitude,
                        longitude: position.coords.longitude,
                        accuracy: position.coords.accuracy,
                    };
                    setCurrentLocation(location);
                    resolve(location);
                },
                (error) => {
                    console.log('Location error:', error);
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 10000,
                }
            );
        });
    };

    // 📍 Open location in Google Maps
    const openInMaps = (location) => {
        if (!location) {
            Alert.alert('Error', 'No location available');
            return;
        }
        const url = `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
        Linking.openURL(url);
    };

    // 📍 Format location for display
    const formatLocation = (location) => {
        if (!location) return 'Getting location...';
        return `${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`;
    };

    // Load saved selected device
    const loadSavedDevice = async () => {
        try {
            const saved = await AsyncStorage.getItem('selectedBluetoothDevice');
            if (saved) {
                setSelectedDevice(JSON.parse(saved));
            }
        } catch (error) {
            console.log('Error loading saved device:', error);
        }
    };

    // Load saved history
    const loadSavedHistory = async () => {
        try {
            const saved = await AsyncStorage.getItem('connectionHistory');
            if (saved) {
                setConnectionHistory(JSON.parse(saved));
            }
        } catch (error) {
            console.log('Error loading history:', error);
        }
    };

    // Save history
    const saveHistory = async (history) => {
        try {
            await AsyncStorage.setItem('connectionHistory', JSON.stringify(history));
        } catch (error) {
            console.log('Error saving history:', error);
        }
    };

    // Save selected device
    const saveSelectedDevice = async (device) => {
        try {
            await AsyncStorage.setItem('selectedBluetoothDevice', JSON.stringify(device));
            setSelectedDevice(device);
            setShowDeviceModal(false);
            Alert.alert(
                '✅ Device Selected!',
                `Now tracking: ${device.name}\n\nConnect this device via phone's Bluetooth settings to see DRIVING MODE.`
            );
        } catch (error) {
            console.log('Error saving device:', error);
        }
    };

    // Clear selected device
    const clearSelectedDevice = async () => {
        try {
            await AsyncStorage.removeItem('selectedBluetoothDevice');
            setSelectedDevice(null);
            setIsConnected(false);
            setConnectedDevice(null);
        } catch (error) {
            console.log('Error clearing device:', error);
        }
    };

    const initializeBluetooth = async () => {
        try {
            setIsLoading(true);

            const enabled = await BluetoothService.isBluetoothEnabled();
            setBluetoothEnabled(enabled);

            if (!enabled) {
                Alert.alert(
                    'Bluetooth Off',
                    'Please enable Bluetooth to use this feature',
                    [{ text: 'OK' }]
                );
                setIsLoading(false);
                return;
            }

            await loadPairedDevices();

            const started = await BluetoothService.startListening({
                onConnect: handleDeviceConnect,
                onDisconnect: handleDeviceDisconnect,
                onStateChange: handleBluetoothStateChange,
            });

            if (!started) {
                Alert.alert(
                    'Permission Required',
                    'Please grant Bluetooth permissions'
                );
            }
        } catch (error) {
            console.error('Initialization error:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const loadPairedDevices = async () => {
        const devices = await BluetoothService.getPairedDevices();
        setPairedDevices(devices);
    };

    // 🟢 Handle Device Connect
    const handleDeviceConnect = async (device) => {
        console.log('🟢 DEVICE CONNECTED:', device);
        
        // Check if this is our selected device
        if (selectedDevice && device.address !== selectedDevice.address) {
            console.log('⏭️ Ignoring - not selected device');
            return;
        }

        const now = new Date();
        const time = now.toLocaleTimeString();
        const date = now.toLocaleDateString();
        
        // 📍 Get location when connected (driving start)
        let location = null;
        try {
            location = await getCurrentLocation();
            setDrivingStartLocation(location);
        } catch (error) {
            console.log('Could not get location:', error);
        }

        setIsConnected(true);
        setConnectedDevice(device);
        setConnectionTime(time);

        const newEntry = {
            type: 'connect',
            deviceName: device.name || 'Unknown Device',
            time: time,
            date: date,
            timestamp: now.getTime(),
            location: location,
        };

        const newHistory = [newEntry, ...connectionHistory.slice(0, 49)];
        setConnectionHistory(newHistory);
        saveHistory(newHistory);
    };

    // 🔴 Handle Device Disconnect
    const handleDeviceDisconnect = async (device) => {
        console.log('🔴 DEVICE DISCONNECTED:', device);
        
        // Check if this is our selected device
        if (selectedDevice && device.address !== selectedDevice.address) {
            console.log('⏭️ Ignoring - not selected device');
            return;
        }

        const now = new Date();
        const time = now.toLocaleTimeString();
        const date = now.toLocaleDateString();

        // 📍 Get location when disconnected (parked location)
        let location = null;
        try {
            location = await getCurrentLocation();
            setParkedLocation(location);
        } catch (error) {
            console.log('Could not get location:', error);
        }

        setIsConnected(false);
        setConnectionTime(time);

        const newEntry = {
            type: 'disconnect',
            deviceName: device.name || connectedDevice?.name || 'Unknown Device',
            time: time,
            date: date,
            timestamp: now.getTime(),
            location: location,
        };

        const newHistory = [newEntry, ...connectionHistory.slice(0, 49)];
        setConnectionHistory(newHistory);
        saveHistory(newHistory);
    };

    const handleBluetoothStateChange = (state) => {
        setBluetoothEnabled(state.enabled);
        if (!state.enabled) {
            setIsConnected(false);
            setConnectedDevice(null);
        }
    };

    // Clear all history
    const clearHistory = () => {
        Alert.alert(
            'Clear History?',
            'Are you sure you want to delete all history?',
            [
                { text: 'Cancel', style: 'cancel' },
                { 
                    text: 'Clear', 
                    style: 'destructive',
                    onPress: async () => {
                        setConnectionHistory([]);
                        await AsyncStorage.removeItem('connectionHistory');
                    }
                }
            ]
        );
    };

    const renderDeviceItem = ({ item }) => {
        const isSelected = selectedDevice?.address === item.address;
        
        return (
            <TouchableOpacity
                style={[styles.deviceItem, isSelected && styles.deviceItemSelected]}
                onPress={() => saveSelectedDevice(item)}
            >
                <Text style={styles.deviceIcon}>
                    {item.type === 1 ? '📱' : item.type === 2 ? '🎧' : '📟'}
                </Text>
                <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{item.name || 'Unknown'}</Text>
                    <Text style={styles.deviceAddress}>{item.address}</Text>
                </View>
                {isSelected && <Text style={styles.selectedBadge}>✓</Text>}
            </TouchableOpacity>
        );
    };

    // 📜 Render History Item with Location
    const renderHistory = ({ item }) => (
        <View style={styles.historyItem}>
            <View style={styles.historyLeft}>
                <Text style={styles.historyIcon}>
                    {item.type === 'connect' ? '🟢' : '🔴'}
                </Text>
            </View>
            
            <View style={styles.historyCenter}>
                <Text style={styles.historyDevice}>{item.deviceName}</Text>
                <Text style={styles.historyTime}>
                    🕐 {item.time} | 📅 {item.date}
                </Text>
                {item.location && (
                    <TouchableOpacity onPress={() => openInMaps(item.location)}>
                        <Text style={styles.historyLocation}>
                            📍 {formatLocation(item.location)}
                        </Text>
                    </TouchableOpacity>
                )}
            </View>
            
            <View style={styles.historyRight}>
                <Text style={[
                    styles.historyType,
                    { color: item.type === 'connect' ? '#4CAF50' : '#F44336' }
                ]}>
                    {item.type === 'connect' ? 'DRIVING' : 'PARKED'}
                </Text>
                {item.location && (
                    <TouchableOpacity 
                        style={styles.mapBtn}
                        onPress={() => openInMaps(item.location)}
                    >
                        <Text style={styles.mapBtnText}>🗺️</Text>
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    if (isLoading) {
        return (
            <SafeAreaView style={styles.loadingContainer}>
                <Text style={styles.loadingText}>🚗 Loading...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <StatusBar
                barStyle="light-content"
                backgroundColor={isConnected ? '#2E7D32' : '#D84315'}
            />

            {/* Header */}
            <View style={[
                styles.header,
                isConnected ? styles.headerConnected : styles.headerDisconnected
            ]}>
                <Text style={styles.headerTitle}>🚗 ParkIt</Text>
                <Text style={styles.headerSubtitle}>Smart Parking Detection</Text>
                <View style={styles.bluetoothBadge}>
                    <Text style={styles.bluetoothBadgeText}>
                        {bluetoothEnabled ? '📶 Bluetooth ON' : '📵 Bluetooth OFF'}
                    </Text>
                </View>
            </View>

            <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
                
                {/* Selected Device Card */}
                <View style={styles.selectedDeviceCard}>
                    <View style={styles.selectedDeviceHeader}>
                        <Text style={styles.selectedDeviceTitle}>🚗 Tracking Device</Text>
                        <TouchableOpacity
                            style={styles.changeBtn}
                            onPress={() => {
                                loadPairedDevices();
                                setShowDeviceModal(true);
                            }}
                        >
                            <Text style={styles.changeBtnText}>
                                {selectedDevice ? 'Change' : 'Select'}
                            </Text>
                        </TouchableOpacity>
                    </View>
                    
                    {selectedDevice ? (
                        <View style={styles.selectedDeviceBox}>
                            <Text style={styles.selectedDeviceIcon}>🎧</Text>
                            <View style={styles.selectedDeviceInfo}>
                                <Text style={styles.selectedDeviceName}>
                                    {selectedDevice.name}
                                </Text>
                                <Text style={styles.selectedDeviceAddress}>
                                    {selectedDevice.address}
                                </Text>
                            </View>
                            <TouchableOpacity onPress={clearSelectedDevice}>
                                <Text style={styles.clearBtn}>✕</Text>
                            </TouchableOpacity>
                        </View>
                    ) : (
                        <Text style={styles.noDeviceText}>
                            No device selected. Tap "Select" to choose.
                        </Text>
                    )}
                </View>

                {/* Main Status Card */}
                <View style={[
                    styles.statusCard,
                    isConnected ? styles.statusConnected : styles.statusDisconnected
                ]}>
                    <Animated.View style={[
                        styles.statusDot,
                        isConnected ? styles.dotConnected : styles.dotDisconnected,
                        { transform: [{ scale: pulseAnim }] }
                    ]} />

                    <Text style={styles.statusTitle}>
                        {isConnected ? '🚗 DRIVING MODE' : '🅿️ PARKED MODE'}
                    </Text>

                    <Text style={styles.statusDevice}>
                        {isConnected
                            ? `Connected: ${connectedDevice?.name || 'Device'}`
                            : selectedDevice 
                                ? `Waiting for: ${selectedDevice.name}`
                                : 'Select a device to track'
                        }
                    </Text>

                    {connectionTime && (
                        <Text style={styles.statusTime}>
                            🕐 {isConnected ? `Since: ${connectionTime}` : `Parked at: ${connectionTime}`}
                        </Text>
                    )}

                    {/* 📍 Show current/parked location */}
                    {!isConnected && parkedLocation && (
                        <TouchableOpacity 
                            style={styles.locationBtn}
                            onPress={() => openInMaps(parkedLocation)}
                        >
                            <Text style={styles.locationBtnText}>
                                📍 View Parking Location
                            </Text>
                        </TouchableOpacity>
                    )}

                    {isConnected && drivingStartLocation && (
                        <Text style={styles.statusLocation}>
                            📍 Started from: {formatLocation(drivingStartLocation)}
                        </Text>
                    )}
                </View>

                {/* 📍 Parked Location Card */}
                {!isConnected && parkedLocation && (
                    <View style={styles.parkedLocationCard}>
                        <Text style={styles.parkedLocationTitle}>📍 Your Car is Parked Here</Text>
                        <Text style={styles.parkedLocationCoords}>
                            Lat: {parkedLocation.latitude.toFixed(6)}
                        </Text>
                        <Text style={styles.parkedLocationCoords}>
                            Lng: {parkedLocation.longitude.toFixed(6)}
                        </Text>
                        <TouchableOpacity 
                            style={styles.openMapsBtn}
                            onPress={() => openInMaps(parkedLocation)}
                        >
                            <Text style={styles.openMapsBtnText}>🗺️ Open in Google Maps</Text>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Connection History */}
                <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                        <Text style={styles.sectionTitle}>📜 History</Text>
                        {connectionHistory.length > 0 && (
                            <TouchableOpacity onPress={clearHistory}>
                                <Text style={styles.clearHistoryBtn}>🗑️ Clear</Text>
                            </TouchableOpacity>
                        )}
                    </View>

                    {connectionHistory.length > 0 ? (
                        <FlatList
                            data={connectionHistory}
                            renderItem={renderHistory}
                            keyExtractor={(item, index) => `${item.timestamp}-${index}`}
                            scrollEnabled={false}
                        />
                    ) : (
                        <Text style={styles.emptyText}>
                            No history yet. Connect/disconnect device to see.
                        </Text>
                    )}
                </View>

                {/* Refresh Button */}
                <TouchableOpacity
                    style={styles.refreshBtn}
                    onPress={initializeBluetooth}
                >
                    <Text style={styles.refreshBtnText}>🔄 Refresh</Text>
                </TouchableOpacity>

                <View style={{ height: 30 }} />
            </ScrollView>

            {/* Device Selection Modal */}
            <Modal
                visible={showDeviceModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowDeviceModal(false)}
            >
                <View style={styles.modalOverlay}>
                    <View style={styles.modalContent}>
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>📱 Select Device</Text>
                            <TouchableOpacity onPress={() => setShowDeviceModal(false)}>
                                <Text style={styles.modalClose}>✕</Text>
                            </TouchableOpacity>
                        </View>
                        
                        <Text style={styles.modalSubtitle}>
                            Choose your car's Bluetooth device:
                        </Text>

                        {pairedDevices.length > 0 ? (
                            <FlatList
                                data={pairedDevices}
                                renderItem={renderDeviceItem}
                                keyExtractor={(item) => item.address}
                                style={styles.deviceList}
                            />
                        ) : (
                            <Text style={styles.noDevicesText}>
                                No paired devices found.{'\n'}
                                Pair a device in phone settings first.
                            </Text>
                        )}

                        <TouchableOpacity
                            style={styles.refreshDevicesBtn}
                            onPress={loadPairedDevices}
                        >
                            <Text style={styles.refreshDevicesText}>🔄 Refresh</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F5F5F5',
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#1A237E',
    },
    loadingText: {
        fontSize: 24,
        color: '#FFF',
        fontWeight: 'bold',
    },
    header: {
        paddingVertical: 25,
        paddingHorizontal: 20,
        alignItems: 'center',
    },
    headerConnected: {
        backgroundColor: '#2E7D32',
    },
    headerDisconnected: {
        backgroundColor: '#D84315',
    },
    headerTitle: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#FFF',
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#FFF',
        opacity: 0.9,
        marginTop: 3,
    },
    bluetoothBadge: {
        marginTop: 10,
        paddingHorizontal: 12,
        paddingVertical: 5,
        backgroundColor: 'rgba(255,255,255,0.2)',
        borderRadius: 15,
    },
    bluetoothBadgeText: {
        color: '#FFF',
        fontWeight: '600',
        fontSize: 12,
    },
    content: {
        flex: 1,
        marginTop: -15,
    },
    selectedDeviceCard: {
        backgroundColor: '#FFF',
        marginHorizontal: 20,
        marginTop: 20,
        padding: 15,
        borderRadius: 15,
        elevation: 4,
        borderWidth: 2,
        borderColor: '#1976D2',
    },
    selectedDeviceHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    selectedDeviceTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1976D2',
    },
    changeBtn: {
        backgroundColor: '#1976D2',
        paddingHorizontal: 15,
        paddingVertical: 6,
        borderRadius: 15,
    },
    changeBtnText: {
        color: '#FFF',
        fontWeight: '600',
        fontSize: 13,
    },
    selectedDeviceBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#E3F2FD',
        padding: 12,
        borderRadius: 10,
    },
    selectedDeviceIcon: {
        fontSize: 28,
        marginRight: 12,
    },
    selectedDeviceInfo: {
        flex: 1,
    },
    selectedDeviceName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#1565C0',
    },
    selectedDeviceAddress: {
        fontSize: 11,
        color: '#64B5F6',
    },
    clearBtn: {
        fontSize: 20,
        color: '#F44336',
        padding: 5,
    },
    noDeviceText: {
        color: '#666',
        textAlign: 'center',
        fontStyle: 'italic',
    },
    statusCard: {
        marginHorizontal: 20,
        marginTop: 15,
        padding: 30,
        borderRadius: 20,
        alignItems: 'center',
        elevation: 8,
    },
    statusConnected: {
        backgroundColor: '#4CAF50',
    },
    statusDisconnected: {
        backgroundColor: '#FF5722',
    },
    statusDot: {
        width: 25,
        height: 25,
        borderRadius: 12.5,
        marginBottom: 15,
    },
    dotConnected: {
        backgroundColor: '#A5D6A7',
    },
    dotDisconnected: {
        backgroundColor: '#FFAB91',
    },
    statusTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#FFF',
        marginBottom: 8,
    },
    statusDevice: {
        fontSize: 14,
        color: '#FFF',
        opacity: 0.9,
        textAlign: 'center',
    },
    statusTime: {
        fontSize: 13,
        color: '#FFF',
        opacity: 0.85,
        marginTop: 8,
    },
    statusLocation: {
        fontSize: 11,
        color: '#FFF',
        opacity: 0.8,
        marginTop: 5,
    },
    locationBtn: {
        marginTop: 15,
        backgroundColor: 'rgba(255,255,255,0.3)',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 20,
    },
    locationBtnText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
    // Parked Location Card
    parkedLocationCard: {
        backgroundColor: '#FFF',
        marginHorizontal: 20,
        marginTop: 15,
        padding: 20,
        borderRadius: 15,
        elevation: 4,
        borderLeftWidth: 5,
        borderLeftColor: '#FF5722',
    },
    parkedLocationTitle: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#E65100',
        marginBottom: 10,
    },
    parkedLocationCoords: {
        fontSize: 13,
        color: '#666',
        fontFamily: 'monospace',
    },
    openMapsBtn: {
        backgroundColor: '#4285F4',
        marginTop: 15,
        padding: 12,
        borderRadius: 10,
        alignItems: 'center',
    },
    openMapsBtnText: {
        color: '#FFF',
        fontWeight: 'bold',
        fontSize: 14,
    },
    section: {
        backgroundColor: '#FFF',
        marginHorizontal: 20,
        marginTop: 15,
        padding: 15,
        borderRadius: 15,
        elevation: 3,
    },
    sectionHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    clearHistoryBtn: {
        fontSize: 14,
        color: '#F44336',
    },
    historyItem: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#F0F0F0',
    },
    historyLeft: {
        marginRight: 10,
    },
    historyIcon: {
        fontSize: 18,
    },
    historyCenter: {
        flex: 1,
    },
    historyDevice: {
        fontSize: 14,
        fontWeight: '600',
        color: '#333',
    },
    historyTime: {
        fontSize: 12,
        color: '#666',
        marginTop: 3,
    },
    historyLocation: {
        fontSize: 11,
        color: '#1976D2',
        marginTop: 3,
        textDecorationLine: 'underline',
    },
    historyRight: {
        alignItems: 'flex-end',
    },
    historyType: {
        fontSize: 11,
        fontWeight: 'bold',
    },
    mapBtn: {
        marginTop: 5,
        padding: 5,
    },
    mapBtnText: {
        fontSize: 18,
    },
    emptyText: {
        color: '#888',
        textAlign: 'center',
        fontStyle: 'italic',
        paddingVertical: 20,
    },
    refreshBtn: {
        backgroundColor: '#1976D2',
        marginHorizontal: 20,
        marginTop: 15,
        padding: 15,
        borderRadius: 12,
        alignItems: 'center',
    },
    refreshBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold',
    },
    // Modal styles
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
    },
    modalContent: {
        backgroundColor: '#FFF',
        borderTopLeftRadius: 25,
        borderTopRightRadius: 25,
        padding: 20,
        maxHeight: '70%',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: 'bold',
        color: '#333',
    },
    modalClose: {
        fontSize: 24,
        color: '#888',
        padding: 5,
    },
    modalSubtitle: {
        fontSize: 14,
        color: '#666',
        marginBottom: 15,
    },
    deviceList: {
        maxHeight: 300,
    },
    deviceItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 15,
        backgroundColor: '#F5F5F5',
        borderRadius: 12,
        marginBottom: 10,
    },
    deviceItemSelected: {
        backgroundColor: '#E3F2FD',
        borderWidth: 2,
        borderColor: '#1976D2',
    },
    deviceIcon: {
        fontSize: 24,
        marginRight: 12,
    },
    deviceInfo: {
        flex: 1,
    },
    deviceName: {
        fontSize: 16,
        fontWeight: '600',
        color: '#333',
    },
    deviceAddress: {
        fontSize: 11,
        color: '#888',
    },
    selectedBadge: {
        fontSize: 20,
        color: '#4CAF50',
        fontWeight: 'bold',
    },
    noDevicesText: {
        color: '#E65100',
        textAlign: 'center',
        padding: 20,
        lineHeight: 22,
    },
    refreshDevicesBtn: {
        backgroundColor: '#E3F2FD',
        padding: 12,
        borderRadius: 10,
        alignItems: 'center',
        marginTop: 10,
    },
    refreshDevicesText: {
        color: '#1976D2',
        fontWeight: 'bold',
    },
});

export default BluetoothDemoScreen;