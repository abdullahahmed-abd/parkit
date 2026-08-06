// src/screens/Login.js
import React, { useEffect, useState, useContext, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Geolocation from '@react-native-community/geolocation';

import { AppContext } from '../context/AppContext';
import {
  initiateGoogleLogin,
  setupGoogleAuthListener,
  removeGoogleAuthListener,
  isUserLoggedIn,
  getStoredUserId,
} from '../utils/GoogleAuthHandler';

//  Pre-fetch location while user is doing Google auth
const prefetchLocation = async () => {
  try {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        {
          title: 'Location Permission',
          message: 'ParkIt needs location access for navigation.',
          buttonPositive: 'Allow',
          buttonNegative: 'Deny',
        },
      );
      if (granted !== PermissionsAndroid.RESULTS.GRANTED) return null;
    }

    const position = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('timeout')), 3000);
      Geolocation.getCurrentPosition(
        (pos) => { clearTimeout(timeout); resolve(pos); },
        (err) => { clearTimeout(timeout); reject(err); },
        { enableHighAccuracy: false, timeout: 3000, maximumAge: 60000 },
      );
    });

    if (position?.coords?.latitude && position?.coords?.longitude) {
      console.log(' Pre-fetched location:', position.coords.latitude.toFixed(4));
      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy || 0,
        prefetched: true,
      };
    }
  } catch (e) {
    console.log(' Pre-fetch failed (ok):', e.message);
  }
  return null;
};

const Login = () => {
  const navigation = useNavigation();
  const { setUserData } = useContext(AppContext);

  const [isLoading, setIsLoading] = useState(false);
  const prefetchedLocationRef = useRef(null);
  const isNavigatingRef = useRef(false);

  //  Check auth + pre-fetch location simultaneously
  useEffect(() => {
    const checkExistingAuth = async () => {
      try {
        //  Start location pre-fetch immediately (don't await - runs in parallel)
        const locationPromise = prefetchLocation();

        const loggedIn = await isUserLoggedIn();

        if (loggedIn) {
          const userId = await getStoredUserId();

          if (userId) {
            //  Wait for location (already running in parallel)
            const location = await locationPromise.catch(() => null);

            setUserData({ userId, isLoggedIn: true });

            if (isNavigatingRef.current) return;
            isNavigatingRef.current = true;

            navigation.reset({
              index: 0,
              routes: [{
                name: 'ParkingMap',
                params: {
                  userId,
                  restored: true,
                  prefetchedLocation: location,
                  skipAuthCheck: true,
                },
              }],
            });
          }
        } else {
          // Not logged in - still save location for after login
          prefetchLocation().then(loc => {
            prefetchedLocationRef.current = loc;
          }).catch(() => {});
        }
      } catch (error) {
        console.error('Auth check failed:', error);
      }
    };

    checkExistingAuth();
  }, []);

  //  Navigate with pre-fetched location
  const navigateToParkingMap = useCallback(
    (result) => {
      if (isNavigatingRef.current) return;
      isNavigatingRef.current = true;

      setUserData({
        userId: result.userId,
        isLoggedIn: true,
        loginTime: new Date().toISOString(),
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      });

      const location = prefetchedLocationRef.current;

      navigation.reset({
        index: 0,
        routes: [
          {
            name: 'ParkingMap',
            params: {
              userId: result.userId,
              fromLogin: true,
              prefetchedLocation: location,
              skipAuthCheck: true,
            },
          },
        ],
      });
    },
    [navigation, setUserData],
  );

  //  Login handler - start location pre-fetch BEFORE auth popup opens
  const handleGoogleLogin = useCallback(async () => {
    if (isLoading) return;

    setIsLoading(true);
    isNavigatingRef.current = false;

    //  Start location pre-fetch NOW (runs while Google popup is open)
    prefetchLocation().then((loc) => {
      prefetchedLocationRef.current = loc;
      console.log(' Location ready:', loc ? `±${loc.accuracy?.toFixed(0)}m` : 'NO');
    }).catch(() => {});

    try {
      const result = await initiateGoogleLogin();

      if (result && result.success) {
        navigateToParkingMap(result);
      } else {
        if (result?.error === 'Using external browser') {
          // Keep loading - deep link listener will handle
        } else {
          setIsLoading(false);
          if (result?.error) {
            Alert.alert('Login Failed', result.error);
          }
        }
      }
    } catch (error) {
      setIsLoading(false);
      Alert.alert('Error', 'Failed to initiate Google login. Please try again.');
    }
  }, [isLoading, navigateToParkingMap]);

  //  Deep link listener
  useEffect(() => {
    const listener = setupGoogleAuthListener((result) => {
      setIsLoading(false);

      if (result.success) {
        navigateToParkingMap(result);
      } else {
        Alert.alert('Login Failed', result.error || 'Unknown error occurred');
      }
    });

    return () => {
      removeGoogleAuthListener(listener);
    };
  }, [navigateToParkingMap]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      <View style={styles.logoSection}>
        <View style={styles.logoPlaceholder}>
          <Text style={styles.logoIcon}>🅿️</Text>
        </View>
        <Text style={styles.title}>Welcome to ParkIt</Text>
        <Text style={styles.subtitle}>Find & book parking spots easily</Text>
      </View>

      <View style={styles.buttonSection}>
        <TouchableOpacity
          style={[styles.googleButton, isLoading && styles.googleButtonDisabled]}
          onPress={handleGoogleLogin}
          disabled={isLoading}
          activeOpacity={0.8}>
          {isLoading ? (
            <View style={styles.loadingButtonContent}>
              <ActivityIndicator color="#E53935" size="small" />
              <Text style={styles.loadingButtonText}>Signing in...</Text>
            </View>
          ) : (
            <>
              <Image
                source={{ uri: 'https://www.google.com/favicon.ico' }}
                style={styles.googleIcon}
              />
              <Text style={styles.googleButtonText}>Continue with Google</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.termsText}>
          By continuing, you agree to our{' '}
          <Text style={styles.link}>Terms of Service</Text> &{' '}
          <Text style={styles.link}>Privacy Policy</Text>
        </Text>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>ParkIt v1.0.0</Text>
      </View>
    </SafeAreaView>
  );
};

// ... your existing styles here (unchanged)

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  logoSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  logoPlaceholder: {
    width: 120,
    height: 120,
    borderRadius: 30,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
    elevation: 5,
    shadowColor: '#E53935',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  logoIcon: {
    fontSize: 60,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 22,
  },
  buttonSection: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 24,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  googleButtonDisabled: {
    opacity: 0.7,
  },
  googleIcon: {
    width: 24,
    height: 24,
    marginRight: 12,
  },
  googleButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  loadingButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  loadingButtonText: {
    marginLeft: 12,
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  termsText: {
    marginTop: 20,
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    lineHeight: 18,
  },
  link: {
    color: '#E53935',
    fontWeight: '600',
  },
  footer: {
    paddingBottom: 20,
    alignItems: 'center',
  },
  footerText: {
    fontSize: 12,
    color: '#ccc',
  },
});

export default Login;