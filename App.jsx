// import React, { useEffect, useState, useRef, useContext } from "react";
// import {
//   View,
//   Text,
//   Image,
//   Dimensions,
//   StatusBar,
//   Keyboard,
//   Alert,
//   ActivityIndicator,
//   StyleSheet,
// } from "react-native";
// import { NavigationContainer } from "@react-navigation/native";
// import { createNativeStackNavigator } from "@react-navigation/native-stack";
// import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
// import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
// import { GestureHandlerRootView } from "react-native-gesture-handler";
// import { scale, moderateScale, verticalScale } from "react-native-size-matters";
// import AsyncStorage from "@react-native-async-storage/async-storage";
// import messaging from "@react-native-firebase/messaging";

// // Screens
// import Home from "./Allcomponents/More";
// import Addpot from "./Allcomponents/Potsection/Addpot";
// import PotsDetails from "./Allcomponents/Potsection/PotsDetails";
// import Pot from "./Allcomponents/Potsection/Pot";
// import HomeScreen from "./Allcomponents/Dashboardmodal/HomeScreen";
// import Login from "./Allcomponents/Logininterface/Login";
// import TransactionsHistory from "./Allcomponents/TransactionsHistory";
// import CurrencyConverter from "./Allcomponents/CurrencyConvertor";
// import Paytomobile from "./Allcomponents/Paytomobile";
// import ContactList from "./Allcomponents/ContactList";
// import QRScannerScreen from "./Allcomponents/QRscanner";
// import UserDetailsScreen from "./Allcomponents/UserDetailsScreen";
// import { navigationRef } from "./Allcomponents/RootNavigation";
// import PhoneTransactionHistory from "./Allcomponents/PhoneTransactioHistory";
// import ChatTransactionScreen from "./Allcomponents/ChatTransactionScreen";
// import UserProfile from "./Allcomponents/UserProfile/userProfile";
// import PersonalInfo from "./Allcomponents/UserProfile/PersonalInfo";
// import TransactionDetailsScreenUser from "./Allcomponents/TransactionDetail/TransactionDetailsScreenUser";
// import RiskLevel from "./Allcomponents/RiskLevel";
// import InvestmentTransactionDetails from "./Allcomponents/TransactionDetail/InvestmentTransactionDetails";

// import SplashScreen from "./Allcomponents/Logininterface/SplashScreen";
// import PotTransactionHistory from "./Allcomponents/PotTransactionHistory";
// import TransactionDetailsScreen from "./Allcomponents/TransactionDetail/TransactionDetailsScreen";
// import FilterScreen from "./Allcomponents/FilterScreen";
// import ChatTransactionHistory from "./Allcomponents/ChatTransactionHistory";
// import Reminderpage from "./Allcomponents/Reminderpage";
// import ManageReminderScreen from "./Allcomponents/ManageReminderScreen";
// import NewPayToMobile from "./Allcomponents/NewPayToMobile";
// import CreateMPINScreen from "./Allcomponents/Mpinscreens/MPINScreen";
// import AuthMPINScreen from "./Allcomponents/Mpinscreens/AuthMPIN";
// import ExternalAuthMPIN from "./Allcomponents/Mpinscreens/ExternalAuthScreen";
// import ForgotMpinScreen from "./Allcomponents/Mpinscreens/ForgotMpinScreen";
// import VerifyOtpScreen from "./Allcomponents/Mpinscreens/VerifyOtpScreen";
// import ChangeMPINScreen from "./Allcomponents/Mpinscreens/ChangeMPINScreen";
// import ResetMpinScreen from "./Allcomponents/Mpinscreens/ResetMpinScreen";
// import PotInvestScreen from "./Allcomponents/Investmentsscreen/PotInvestScreen";
// import Testimonial from "./Allcomponents/Testimonials/Testimonial";
// import AllTestimonial from "./Allcomponents/Testimonials/AllTestimonials";
// import FAQs from "./Allcomponents/FAQs/FAQs";
// import Documents from "./Allcomponents/GlobalPots/Documents";

// import PrivacyPolicyPage from "./Allcomponents/PrivacyPolicyPage";
// import TermsAndConditions from "./Allcomponents/TermsAndConditions";
// import FAQ from "./Allcomponents/FAQ";
// import InvestDashBoard from "./Allcomponents/Investmentsscreen/InvestDashBoard";
// import Firsttimeinvtcreen from "./Allcomponents/Investmentsscreen/Firsttimeinvtscreen";
// import TechnologyPvt from "./Allcomponents/TechnologyPvt";
// import ShariaFunds from "./Allcomponents/ShariaFunds";
// import PotInvestmentTransactionHistory from "./Allcomponents/Investmentsscreen/PotInvestmentTransactionHistory";
// import GlobalPotChatTransactionScreen from "./Allcomponents/GlobalPotChatTransactionScreen";

// import Globalpotscreen from "./Allcomponents/GlobalPots/Globalpotsscreen";
// import CommonHeader from "./Allcomponents/Reuseble componenets/CommonHeader";
// import GlobalPotDetailScreen from "./Allcomponents/GlobalPots/GlobalPotDetailScreen";
// import { TextEncoder, TextDecoder } from "text-encoding";
// import GlobalTransactionDetailsScreen from "./Allcomponents/TransactionDetail/GlobalTransactionDetailsScreen";
// import GlobalTransaction from "./Allcomponents/GlobalPots/GlobalTransaction";
// import GlobalMember from "./Allcomponents/GlobalPots/GlobalMemberScreen";
// import CreateGlobalPot from "./Allcomponents/CreateGlobalPot";
// import HelloCard from "./Allcomponents/Demo/HelloCard";
// import Signupscreen from "./Allcomponents/Logininterface/Signupscreen";
// import Loginverifyotp from "./Allcomponents/Logininterface/Loginverifyotp";
// import Signuppassword from "./Allcomponents/Logininterface/Signuppassword";
// import ChangePasswordScreen from "./Allcomponents/Logininterface/ChangePasswordScreen";
// import AdminCreateGlobalPot from "./Allcomponents/Admin-Perspective/AdminCreateGlobalPot";
// import { AppContext } from "./Allcomponents/ContextApi";
// import Loginscreennew from "./Allcomponents/Logininterface/Loginscreennew";

// //  VPS Images for Tab bar icons
// // NOTE: agar path mismatch ho to adjust kar lena (mostly correct if images.js is at src/constants/images.js)
// import { IMAGES } from "./src/utils/constants/images";

// // const Stack = createNativeStackNavigator();
// // const Tab = createBottomTabNavigator();
// // const PotsStackNav = createNativeStackNavigator();

// // if (typeof global.TextEncoder === "undefined") global.TextEncoder = TextEncoder;
// // if (typeof global.TextDecoder === "undefined") global.TextDecoder = TextDecoder;

// // const { width } = Dimensions.get("window");

// // const TAB_ICONS = {
// //   Home: { uri: IMAGES.navigationBar.home },
// //   Pots: { uri: IMAGES.navigationBar.pots },
// //   Payment: { uri: IMAGES.navigationBar.payment },
// //   Invest: { uri: IMAGES.navigationBar.invest },
// //   Community: { uri: IMAGES.navigationBar.community },
// // };

// // function App() {
// //   const { BACKEND_URL } = useContext(AppContext);

// //   const keyboardVisibleRef = useRef(false);

// //   // FCM setup
// //   useEffect(() => {
// //     let unsubscribeOnMessage = null;
// //     let unsubscribeOnOpen = null;

// //     const setupFCM = async () => {
// //       try {
// //         const authStatus = await messaging().requestPermission();
// //         const enabled =
// //           authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
// //           authStatus === messaging.AuthorizationStatus.PROVISIONAL;

// //         if (!enabled) {
// //           console.log("Notification permission not granted");
// //           return;
// //         }

// //         const token = await messaging().getToken();
// //         console.log("FCM TOKEN:", token);
// //         if (!token) return;

// //         await AsyncStorage.setItem("fcmToken", token);

// //         const userDataRaw = await AsyncStorage.getItem("userData");
// //         const userData = userDataRaw ? JSON.parse(userDataRaw) : null;
// //         if (!userData?.uuid) {
// //           console.warn("Missing userData or UUID");
// //           return;
// //         }

// //         const response = await fetch(`${BACKEND_URL}/api/sunduk-service/wallet`, {
// //           method: "POST",
// //           headers: { "Content-Type": "application/json" },
// //           body: JSON.stringify({
// //             uuid: userData.uuid,
// //             fcmToken: token,
// //             requestType: "UPDATE_FCM_TOKEN",
// //           }),
// //         });

// //         console.log("Token sent to backend:", response.status);

// //         unsubscribeOnMessage = messaging().onMessage(async (remoteMessage) => {
// //           Alert.alert(
// //             remoteMessage.notification?.title || "New Notification",
// //             remoteMessage.notification?.body || "You have a new message."
// //           );
// //         });

// //         unsubscribeOnOpen = messaging().onNotificationOpenedApp((remoteMessage) => {
// //           console.log("Notification opened:", remoteMessage);
// //         });

// //         const initialMessage = await messaging().getInitialNotification();
// //         if (initialMessage) {
// //           console.log("App opened by notification:", initialMessage);
// //         }
// //       } catch (err) {
// //         console.error("setupFCM error:", err);
// //       }
// //     };

// //     setupFCM();

// //     return () => {
// //       if (unsubscribeOnMessage) unsubscribeOnMessage();
// //       if (unsubscribeOnOpen) unsubscribeOnOpen();
// //     };
// //   }, [BACKEND_URL]);

// //   // Keyboard listener (for tab indicator line)
// //   useEffect(() => {
// //     const showSub = Keyboard.addListener("keyboardDidShow", () => {
// //       keyboardVisibleRef.current = true;
// //     });
// //     const hideSub = Keyboard.addListener("keyboardDidHide", () => {
// //       keyboardVisibleRef.current = false;
// //     });

// //     return () => {
// //       showSub.remove();
// //       hideSub.remove();
// //     };
// //   }, []);

// //   function PotsStack() {
// //     return (
// //       <>
// //         <StatusBar barStyle="dark-content" backgroundColor="#fff" />
// //         <PotsStackNav.Navigator screenOptions={{ headerShown: false }}>
// //           <PotsStackNav.Screen name="PotsMain" component={Pot} />
// //           <PotsStackNav.Screen name="PotsDetails" component={PotsDetails} />
// //           <PotsStackNav.Screen name="Addpot" component={Addpot} />
// //           <PotsStackNav.Screen name="TransactionsHistory" component={TransactionsHistory} />
// //           <PotsStackNav.Screen name="TransactionDetailsScreen" component={TransactionDetailsScreen} />
// //           <PotsStackNav.Screen name="FilterScreen" component={FilterScreen} />
// //           <PotsStackNav.Screen name="PotTransactionHistory" component={PotTransactionHistory} />
// //         </PotsStackNav.Navigator>
// //       </>
// //     );
// //   }

// //   function HomescreenStack() {
// //     return (
// //       <>
// //         <StatusBar barStyle="dark-content" backgroundColor="#fff" />
// //         <PotsStackNav.Navigator screenOptions={{ headerShown: false }}>
// //           <PotsStackNav.Screen name="Home" component={HomeScreen} />
// //           <PotsStackNav.Screen name="Addpot" component={Addpot} />
// //           <PotsStackNav.Screen name="TransactionsHistory" component={TransactionsHistory} />
// //           <PotsStackNav.Screen name="TransactionDetailsScreen" component={TransactionDetailsScreen} />
// //           <PotsStackNav.Screen name="FilterScreen" component={FilterScreen} />
// //           <PotsStackNav.Screen name="PotsDetails" component={PotsDetails} />
// //           <PotsStackNav.Screen name="PotTransactionHistory" component={PotTransactionHistory} />
// //           <PotsStackNav.Screen name="Currency" component={CurrencyConverter} />
// //         </PotsStackNav.Navigator>
// //       </>
// //     );
// //   }

// //   function Investscreen() {
// //     const [loading, setLoading] = useState(true);
// //     const [isInvested, setIsInvested] = useState(false);

// //     useEffect(() => {
// //       const checkInvestment = async () => {
// //         try {
// //           const storedUser = await AsyncStorage.getItem("userData");
// //           const userData = storedUser ? JSON.parse(storedUser) : null;
// //           const uuid = userData?.uuid;
// //           if (!uuid) return;

// //           const res = await fetch(`${BACKEND_URL}/api/sunduk-service/wallet`, {
// //             method: "POST",
// //             headers: { "Content-Type": "application/json" },
// //             body: JSON.stringify({
// //               requestType: "FETCH_WALLET",
// //               uuid,
// //             }),
// //           });

// //           const data = await res.json();

// //           if (res.ok && data?.subWallets) {
// //             const invested = data.subWallets.some((w) => w.isInvested);
// //             setIsInvested(invested);
// //           }
// //         } catch (e) {
// //           console.log(e);
// //         } finally {
// //           setLoading(false);
// //         }
// //       };

// //       checkInvestment();
// //     }, []);

// //     if (loading) return <ActivityIndicator style={{ flex: 1 }} />;

// //     return isInvested ? <InvestDashBoard /> : <Firsttimeinvtcreen />;
// //   }

// //   function PaymentStack() {
// //     return (
// //       <>
// //         <StatusBar barStyle="dark-content" backgroundColor="#fff" />
// //         <PotsStackNav.Navigator screenOptions={{ headerShown: false }}>
// //           <PotsStackNav.Screen name="Payment" component={Home} />
// //           <PotsStackNav.Screen name="TransactionsHistory" component={TransactionsHistory} />
// //         </PotsStackNav.Navigator>
// //       </>
// //     );
// //   }

// //   function MainTabs() {
// //     const insets = useSafeAreaInsets();

// //     return (
// //       <Tab.Navigator
// //         initialRouteName="Pots"
// //         screenOptions={({ route }) => ({
// //           headerShown: false,
// //           tabBarStyle: {
// //             borderTopWidth: scale(2),
// //             elevation: 5,
// //             height: verticalScale(65) + insets.bottom,
// //             paddingBottom: insets.bottom > 0 ? insets.bottom - 4 : verticalScale(6),
// //             borderTopColor: "#C199454D",
// //             backgroundColor: "#fff",
// //           },
// //           tabBarIcon: ({ focused }) => {
// //             const Logo = TAB_ICONS[route.name] || TAB_ICONS.Home;

// //             return (
// //               <View style={{ flex: 1, alignItems: "center", justifyContent: "flex-start" }}>
// //                 {focused && !keyboardVisibleRef.current && (
// //                   <View
// //                     style={{
// //                       position: "absolute",
// //                       top: -verticalScale(6),
// //                       width: scale(45),
// //                       height: verticalScale(3),
// //                       backgroundColor: "#C7A348",
// //                       borderRadius: scale(2),
// //                     }}
// //                   />
// //                 )}

// //                 <View
// //                   style={[
// //                     {
// //                       backgroundColor: focused ? "rgba(193, 153, 69, 0.3)" : "transparent",
// //                       borderWidth: focused ? 1 : 0,
// //                     },
// //                     styles.option,
// //                   ]}
// //                 >
// //                   <Image source={Logo} style={styles.Image} />
// //                 </View>

// //                 <Text
// //                   style={{
// //                     fontSize: moderateScale(12),
// //                     fontWeight: focused ? "600" : "400",
// //                     color: focused ? "#C7A348" : "gray",
// //                     marginTop: verticalScale(4),
// //                     textAlign: "center",
// //                     includeFontPadding: false,
// //                     width: "100%",
// //                   }}
// //                   numberOfLines={1}
// //                 >
// //                   {route.name}
// //                 </Text>
// //               </View>
// //             );
// //           },
// //           tabBarLabel: () => null,
// //           tabBarHideOnKeyboard: true,
// //         })}
// //       >
// //         <Tab.Screen name="Home" component={HomescreenStack} />
// //         <Tab.Screen name="Payment" component={PaymentStack} />
// //         <Tab.Screen
// //           name="Pots"
// //           component={PotsStack}
// //           listeners={({ navigation }) => ({
// //             tabPress: (e) => {
// //               e.preventDefault();
// //               navigation.reset({ index: 0, routes: [{ name: "PotsMain" }] });
// //               navigation.navigate("Pots", { screen: "PotsMain" });
// //             },
// //           })}
// //         />
// //         <Tab.Screen name="Invest" component={Investscreen} />
// //         <Tab.Screen name="Community" component={Globalpotscreen} />
// //       </Tab.Navigator>
// //     );
// //   }

//   return (
//     <GestureHandlerRootView style={{ flex: 1 }}>
//       <SafeAreaProvider>
//         <NavigationContainer ref={navigationRef}>
//           {/* <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="SplashScreen"> */}
//             {/* <Stack.Screen name="SplashScreen" component={SplashScreen} />
//             <Stack.Screen name="Login" component={Login} />
//             <Stack.Screen name="MainTabs" component={MainTabs} />

//             <Stack.Screen name="UserProfile" component={UserProfile} />
//             <Stack.Screen name="PersonalInfo" component={PersonalInfo} />
//             <Stack.Screen name="RiskLevel" component={RiskLevel} />
//             <Stack.Screen name="Addpot" component={Addpot} />

//             <Stack.Screen name="QRscreen" component={QRScannerScreen} />
//             <Stack.Screen name="UserDetails" component={UserDetailsScreen} />
//             <Stack.Screen name="Paytomobile" component={Paytomobile} />
//             <Stack.Screen name="PhoneTransactionHistory" component={PhoneTransactionHistory} />
//             <Stack.Screen name="TransactionDetailsScreen" component={TransactionDetailsScreen} />
//             <Stack.Screen name="InvestmentTransactionDetails" component={InvestmentTransactionDetails} />
//             <Stack.Screen name="ChatTransactionScreen" component={ChatTransactionScreen} />
//             <Stack.Screen name="GlobalTransactionDetailsScreen" component={GlobalTransactionDetailsScreen} />
//             <Stack.Screen name="TransactionDetailsScreenUser" component={TransactionDetailsScreenUser} />
//             <Stack.Screen name="ChatTransactionHistory" component={ChatTransactionHistory} />
//             <Stack.Screen name="ManageReminderScreen" component={ManageReminderScreen} />
//             <Stack.Screen name="Reminderpage" component={Reminderpage} />
//             <Stack.Screen name="NewPayment" component={NewPayToMobile} />
//             <Stack.Screen name="CreateMPINScreen" component={CreateMPINScreen} />
//             <Stack.Screen name="AuthMPIN" component={AuthMPINScreen} />
//             <Stack.Screen name="ExternalAuthScreen" component={ExternalAuthMPIN} />
//             <Stack.Screen name="ChangeMPINScreen" component={ChangeMPINScreen} />
//             <Stack.Screen name="ForgotMpinScreen" component={ForgotMpinScreen} />
//             <Stack.Screen name="VerifyOtpScreen" component={VerifyOtpScreen} />
//             <Stack.Screen name="ResetMpinScreen" component={ResetMpinScreen} />
//             <Stack.Screen name="PotsDetails" component={PotsDetails} />
//             <Stack.Screen name="PotInvestScreen" component={PotInvestScreen} />
//             <Stack.Screen name="PotInvestmentTransactionHistory" component={PotInvestmentTransactionHistory} />
//             <Stack.Screen name="TermsAndConditions" component={TermsAndConditions} />
//             <Stack.Screen name="PrivacyPolicyPage" component={PrivacyPolicyPage} />
//             <Stack.Screen name="Firsttimeinvtcreen" component={Firsttimeinvtcreen} />
//             <Stack.Screen name="FAQ" component={FAQ} />
//             <Stack.Screen name="TechnologyPvt" component={TechnologyPvt} />
//             <Stack.Screen name="ShariaFunds" component={ShariaFunds} />
//             <Stack.Screen name="Globalpotscreen" component={Globalpotscreen} />
//             <Stack.Screen name="CommonHeader" component={CommonHeader} />
//             <Stack.Screen name="GlobalPotChatTransactionScreen" component={GlobalPotChatTransactionScreen} />
//             <Stack.Screen name="GlobalPotDetailScreen" component={GlobalPotDetailScreen} />
//             <Stack.Screen name="CreateGlobalPot" component={CreateGlobalPot} />

//             <Stack.Screen name="Testimonial" component={Testimonial} />
//             <Stack.Screen name="AllTestimonials" component={AllTestimonial} />
//             <Stack.Screen name="FAQs" component={FAQs} />
//             <Stack.Screen name="Documents" component={Documents} />
//             <Stack.Screen name="HelloCard" component={HelloCard} />

//             <Stack.Screen name="AdminCreateGlobalPot" component={AdminCreateGlobalPot} />

//             <Stack.Screen name="GlobalTransaction" component={GlobalTransaction} options={{ headerShown: false }} />
//             <Stack.Screen name="GlobalMember" component={GlobalMember} options={{ headerShown: false }} />

//             <Stack.Screen name="Signupscreen" component={Signupscreen} /> */}
//             {/* <Stack.Screen name="Loginverifyotp" component={Loginverifyotp} /> */}
//             {/* <Stack.Screen name="Signuppassword" component={Signuppassword} /> */}
//             <Stack.Screen name="Loginscreennew" component={Loginscreennew} />
//             <Stack.Screen name="ChangePasswordScreen" component={ChangePasswordScreen} />
//           {/* </Stack.Navigator> */}
//         </NavigationContainer>
//       </SafeAreaProvider>
//     </GestureHandlerRootView>
//   );
// // }

// export default App;

// const styles = StyleSheet.create({
//   option: {
//     alignItems: "center",
//     justifyContent: "center",
//     padding: moderateScale(10),
//     borderColor: "rgba(199, 163, 72, 0.5)",
//     borderRadius: 50,
//     maxWidth: scale(34),
//     maxHeight: scale(34),
//   },
//   Image: {
//     width: scale(30),
//     height: scale(30),
//     resizeMode: "contain",
//   },
// });

// import React from "react";
// import { SafeAreaView, StyleSheet } from "react-native";
// import Parkit from "./Allcomponents/Parkit";

// export default function App() {
//   return (
//     <SafeAreaView style={styles.container}>
//       <Parkit />
//     </SafeAreaView>
//   );
// }

// const styles = StyleSheet.create({
//   container: {
//     flex: 1,
//   },
// });
// App.jsx
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

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
        {/* Aapke baaki screens */}
        {/* <Stack.Screen name="Home" component={HomeScreen} /> */}
      </Stack.Navigator>
    </NavigationContainer>
  );
};

export default App;