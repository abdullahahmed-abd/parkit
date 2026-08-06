// src/context/AppContext.js
import React, { createContext, useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const AppContext = createContext();

export const AppProvider = ({ children }) => {
  const [userData, setUserData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // ✅ Load user data on app start
  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      setIsLoading(true);
      
      // Try to load userData
      const storedUserData = await AsyncStorage.getItem('userData');
      const storedUserId = await AsyncStorage.getItem('userId');
      const isLoggedIn = await AsyncStorage.getItem('isLoggedIn');
      
      if (storedUserData) {
        const parsed = JSON.parse(storedUserData);
        setUserData(parsed);
        console.log('✅ User data loaded from storage:', parsed);
      } else if (storedUserId && isLoggedIn === 'true') {
        // Fallback: create userData from userId
        const newUserData = { userId: storedUserId, isLoggedIn: true };
        setUserData(newUserData);
        await AsyncStorage.setItem('userData', JSON.stringify(newUserData));
        console.log('✅ User data created from userId:', newUserData);
      } else {
        console.log('ℹ️ No user data found, user needs to login');
        setUserData(null);
      }
    } catch (error) {
      console.error('❌ Error loading user data:', error);
      setUserData(null);
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ Save user data
  const saveUserData = async (data) => {
    try {
      setUserData(data);
      await AsyncStorage.setItem('userData', JSON.stringify(data));
      if (data?.userId) {
        await AsyncStorage.setItem('userId', data.userId);
        await AsyncStorage.setItem('isLoggedIn', 'true');
      }
      console.log('✅ User data saved:', data);
    } catch (error) {
      console.error('❌ Error saving user data:', error);
    }
  };

  // ✅ Logout function
  const logout = async () => {
    try {
      await AsyncStorage.multiRemove(['userData', 'userId', 'isLoggedIn']);
      setUserData(null);
      console.log('✅ User logged out');
      return true;
    } catch (error) {
      console.error('❌ Logout error:', error);
      return false;
    }
  };

  // ✅ Check if user is logged in
  const isLoggedIn = () => {
    return !!(userData && userData.userId);
  };

  const value = {
    userData,
    setUserData: saveUserData,
    logout,
    isLoading,
    isLoggedIn,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export default AppContext;