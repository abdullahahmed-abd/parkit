/**
 * @format
 */
import React from 'react';
import { AppRegistry, Alert } from 'react-native';
import App from './App';
import { name as appName } from './app.json';
import './global.css';
// import { AppProvider } from './Allcomponents/ContextApi';
import 'text-encoding-polyfill';
import './GlobalTextOverride.jsx';
// import messaging from '@react-native-firebase/messaging'; // Import FCM

// //   Add polyfill here
// if (!Array.prototype.findLastIndex) {
//   Array.prototype.findLastIndex = function (predicate, thisArg) {
//     for (let i = this.length - 1; i >= 0; i--) {
//       if (predicate.call(thisArg, this[i], i, this)) {
//         return i;
//       }
//     }
//     return -1;
//   };
// }

// //   Handle background messages
// messaging().setBackgroundMessageHandler(async remoteMessage => {
//   console.log('📨 Message handled in the background!', remoteMessage);
// });

// //   Handle notification that opened the app (from quit)
// messaging()
//   .getInitialNotification()
//   .then(remoteMessage => {
//     if (remoteMessage) {
//       console.log('🚀 App opened from quit state via notification:', remoteMessage.notification);
//     }
//   });

// //   Foreground listener
// messaging().onMessage(async remoteMessage => {
//   console.log('📩 Foreground message received:', remoteMessage);
//   Alert.alert(
//     remoteMessage.notification?.title || 'New Message',
//     remoteMessage.notification?.body || 'You have a new notification'
//   );
// });

//   Wrap app in context provider
const RootApp = () => (
  // <AppProvider>
    <App />
  // </AppProvider>
);

AppRegistry.registerComponent(appName, () => RootApp);




