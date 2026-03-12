
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
// App.js or Navigation file
import ParkingMapScreen from './src/screens/ParkingMapScreen';

// In your Stack Navigator:

import BluetoothDemoScreen from './src/screens/BluetoothDemoScreen';
// Aapke baaki screens
// import HomeScreen from './src/screens/HomeScreen';
// import LoginScreen from './src/screens/LoginScreen';

const Stack = createNativeStackNavigator();

const App = () => {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="BluetoothDemo">
        <Stack.Screen 
          name="BluetoothDemo" 
          component={BluetoothDemoScreen}
          options={{ headerShown: false }}
        />
        <Stack.Screen 
  name="ParkingMap" 
  component={ParkingMapScreen}
  options={{ headerShown: false }}
/>
        {/* Aapke baaki screens */}
        {/* <Stack.Screen name="Home" component={HomeScreen} /> */}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;