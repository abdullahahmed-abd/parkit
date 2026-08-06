// ContextApi.js
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
      const stored = await AsyncStorage.getItem('userData');
      if (stored) {
        const parsed = JSON.parse(stored);
        setUserData(parsed);
        console.log('✅ User data loaded from storage:', parsed);
      }
    } catch (error) {
      console.error('❌ Error loading user data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // ✅ Logout function
  const logout = async () => {
    try {
      await AsyncStorage.multiRemove(['userData', 'userId', 'isLoggedIn']);
      setUserData(null);
      console.log('✅ User logged out');
    } catch (error) {
      console.error('❌ Logout error:', error);
    }
  };

  const value = {
    userData,
    setUserData,
    logout,
    isLoading,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};