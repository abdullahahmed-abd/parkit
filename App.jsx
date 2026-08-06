// App.js
import React, { useEffect, useRef, useContext } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Linking, StatusBar, ActivityIndicator, View, Text, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════
// 📱 Import Context
// ═══════════════════════════════════════
import { AppProvider, AppContext } from './src/context/AppContext';

// ═══════════════════════════════════════
// 📱 Import Screens
// ═══════════════════════════════════════
import Login from './src/screens/Login';
import ParkingMapScreen from './src/screens/ParkingMapScreen';
import BluetoothDemoScreen from './src/screens/BluetoothDemoScreen';
import BottomNavBar from './src/screens/BottomNavBar'
import SlotFreeNotification from './src/components/SlotFreeNotification'
import WsStatusDot from "./src/components/WsStatusDot"
import useParkingWebSocket from "./src/hooks/useParkingWebSocket"


const Stack = createNativeStackNavigator();

// ═══════════════════════════════════════
// 🔄 Loading Screen Component
// ═══════════════════════════════════════
const LoadingScreen = () => (
  <View style={styles.loadingContainer}>
    <ActivityIndicator size="large" color="#E53935" />
    <Text style={styles.loadingText}>Loading ParkIt...</Text>
  </View>
);

// ═══════════════════════════════════════
// 🧭 Navigation Component
// ═══════════════════════════════════════
const AppNavigator = () => {
  const navigationRef = useRef(null);
  const { userData, setUserData, isLoading } = useContext(AppContext);

  // ═══════════════════════════════════════
  // 🔗 Deep Link Handler
  // ═══════════════════════════════════════
  useEffect(() => {
    const handleDeepLink = async ({ url }) => {
      console.log('📩 Deep Link Received:', url);

      if (!url) return;

      try {
        // ✅ ParkIt Login Success
        if (url.startsWith('parkit://login-success')) {
          const queryString = url.split('?')[1];
          if (queryString) {
            const params = new URLSearchParams(queryString);
            const userId = params.get('userId');

            if (userId) {
              console.log('✅ Login successful, userId:', userId);

              // Save to AsyncStorage
              await AsyncStorage.setItem('userId', userId);
              await AsyncStorage.setItem('isLoggedIn', 'true');

              // Update context
              const newUserData = { userId, isLoggedIn: true };
              await AsyncStorage.setItem('userData', JSON.stringify(newUserData));
              setUserData(newUserData);

              // Navigate to ParkingMap
              if (navigationRef.current) {
                navigationRef.current.reset({
                  index: 0,
                  routes: [{ name: 'ParkingMap', params: { userId, fromLogin: true } }],
                });
              }
            }
          }
        }

        // ✅ ParkIt OAuth Redirect
        else if (url.startsWith('parkit://oauth2redirect')) {
          console.log('🔄 OAuth Redirect detected');
        }

        // ✅ ParkIt Booking Success
        else if (url.startsWith('parkit://booking-success')) {
          const queryString = url.split('?')[1];
          if (queryString && navigationRef.current) {
            const params = new URLSearchParams(queryString);
            const bookingId = params.get('bookingId');
            navigationRef.current.navigate('BookingConfirmation', { bookingId });
          }
        }

        // ✅ Payment Success/Failed
        else if (url.startsWith('parkit://payment-success') || 
                 url.startsWith('parkit://payment-failed')) {
          const queryString = url.split('?')[1];
          if (queryString && navigationRef.current) {
            const params = new URLSearchParams(queryString);
            const paymentId = params.get('paymentId');
            const status = url.includes('success') ? 'success' : 'failed';
            navigationRef.current.navigate('PaymentStatus', { paymentId, status });
          }
        }

      } catch (error) {
        console.error('❌ Error handling deep link:', error);
      }
    };

    // Listen for deep links
    const subscription = Linking.addEventListener('url', handleDeepLink);

    // Check initial URL (cold start)
    Linking.getInitialURL().then((url) => {
      if (url) {
        console.log('📩 Initial URL:', url);
        handleDeepLink({ url });
      }
    });

    return () => {
      subscription.remove();
    };
  }, [setUserData]);

  // ═══════════════════════════════════════
  // 🎨 Linking Configuration
  // ═══════════════════════════════════════
  const linking = {
    prefixes: ['parkit://', 'https://parkit.app'],
    config: {
      screens: {
        Login: 'login',
        ParkingMap: 'parking-map',
        BluetoothDemo: 'bluetooth-demo',
      },
    },
  };

  // Show loading while checking auth status
  if (isLoading) {
    return <LoadingScreen />;
  }

  // Determine initial route based on login status
  const initialRoute = userData?.userId ? 'ParkingMap' : 'Login';

  return (
    <>
      <StatusBar 
        barStyle="dark-content" 
        backgroundColor="#ffffff" 
        translucent={false}
      />
      
      <NavigationContainer 
        ref={navigationRef}
        linking={linking}
        fallback={<LoadingScreen />}
        onReady={() => {
          console.log('✅ Navigation Container Ready');
          console.log('📱 Initial Route:', initialRoute);
          console.log('👤 User Data:', userData);
        }}
      >
        <Stack.Navigator 
          initialRouteName={initialRoute}
          screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
          }}
        >
          {/* 🔐 Authentication Screens */}
          <Stack.Screen 
            name="Login" 
            component={Login}
            options={{ 
              headerShown: false,
              gestureEnabled: false,
            }}
          />

          {/* 🏠 Main App Screens */}
          <Stack.Screen 
            name="ParkingMap" 
            component={ParkingMapScreen}
            options={{ 
              headerShown: false,
              title: 'Find Parking',
            }}
          />

          <Stack.Screen 
            name="BluetoothDemo" 
            component={BluetoothDemoScreen}
            options={{ 
              headerShown: false,
              title: 'Bluetooth Demo',
            }}
          />
               <Stack.Screen 
            name="BottomNavBar" 
            component={BottomNavBar}
            options={{ 
              headerShown: false,
            }}
          />
           <Stack.Screen 
            name="SlotFreeNotification" 
            component={SlotFreeNotification}
            options={{ 
              headerShown: false,
            }}
          />
          <Stack.Screen 
            name="WsStatusDot" 
            component={WsStatusDot}
            options={{ 
              headerShown: false,
            }}
          />
          <Stack.Screen 
            name="useParkingWebSocket" 
            component={useParkingWebSocket}
            options={{ 
              headerShown: false,
            }}
          />

         
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
};

// ═══════════════════════════════════════
// 🚀 Main App Component with Provider
// ═══════════════════════════════════════
const App = () => {
  return (
    <AppProvider>
      <AppNavigator />
    </AppProvider>
  );
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#666',
  },
});

export default App;