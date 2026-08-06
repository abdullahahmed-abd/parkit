// src/utils/GoogleAuthHandler.js
import { Alert, Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { jwtDecode } from 'jwt-decode';

// ✅ Your Backend URL
const BACKEND_URL = 'https://parkit.sundukpay.com';
const GOOGLE_AUTH_ENDPOINT = `${BACKEND_URL}/parkit-api/google`;
const REFRESH_TOKEN_ENDPOINT = `${BACKEND_URL}/parkit-api/refresh`;
const DEEP_LINK_SCHEME = 'parkit://login-success';

const STORAGE_KEYS = {
  ACCESS_TOKEN: 'accessToken',
  REFRESH_TOKEN: 'refreshToken',
  USER_ID: 'userId',
  IS_LOGGED_IN: 'isLoggedIn',
  USER_DATA: 'userData',
};

// ✅ Track refresh attempts to prevent infinite loops
let isRefreshing = false;
let refreshPromise = null;

/**
 * 🔹 Google Login Flow
 */
export const initiateGoogleLogin = async () => {
  const loginUrl = GOOGLE_AUTH_ENDPOINT;
  const redirectUrl = DEEP_LINK_SCHEME;

  console.log('🔐 Starting Google Login...');

  try {
    const isAvailable = await InAppBrowser.isAvailable();

    if (isAvailable) {
      const result = await InAppBrowser.openAuth(loginUrl, redirectUrl, {
        dismissButtonStyle: 'cancel',
        preferredBarTintColor: '#4285F4',
        preferredControlTintColor: 'white',
        readerMode: false,
        animated: true,
        modalPresentationStyle: 'fullScreen',
        modalTransitionStyle: 'coverVertical',
        modalEnabled: true,
        enableBarCollapsing: false,
        showTitle: true,
        toolbarColor: '#4285F4',
        secondaryToolbarColor: 'black',
        navigationBarColor: 'black',
        navigationBarDividerColor: 'white',
        enableUrlBarHiding: true,
        enableDefaultShare: false,
        forceCloseOnRedirection: true,
        showInRecents: true,
        hasBackButton: true,
        browserPackage: null,
        shouldCloseOnLoad: false,
      });

      console.log('🔹 InAppBrowser Result:', result);

      if (result.type === 'success' && result.url) {
        InAppBrowser.close();
        return await handleGoogleAuthDeepLink(result.url);
      } else if (result.type === 'cancel') {
        return { success: false, error: 'Login cancelled by user' };
      } else {
        return { success: false, error: 'Login failed' };
      }
    } else {
      console.log('📱 Using external browser');
      await Linking.openURL(loginUrl);
      return { success: false, error: 'Using external browser' };
    }
  } catch (error) {
    console.error('❌ Google Login Error:', error);
    Alert.alert('Login Failed', error.message || 'Something went wrong.');
    return { success: false, error: error.message };
  }
};

/**
 * 🔹 Deep Link Handler
 */
export const handleGoogleAuthDeepLink = async (url) => {
  try {
    console.log('📩 Received Deep Link:', url);

    if (!url || !url.includes('?')) {
      throw new Error('No query parameters in deep link');
    }

    const queryString = url.split('?')[1];
    const params = new URLSearchParams(queryString);

    const accessToken = params.get('accessToken');
    const refreshToken = params.get('refreshToken');

    if (!accessToken || !refreshToken) {
      throw new Error('Tokens not found in deep link');
    }

    const decodedToken = jwtDecode(accessToken);
    const userId = decodedToken.sub;

    console.log('✅ userId:', userId);

    const userData = {
      userId,
      isLoggedIn: true,
      loginTime: new Date().toISOString(),
    };

    await AsyncStorage.multiSet([
      [STORAGE_KEYS.ACCESS_TOKEN, accessToken],
      [STORAGE_KEYS.REFRESH_TOKEN, refreshToken],
      [STORAGE_KEYS.USER_ID, userId],
      [STORAGE_KEYS.IS_LOGGED_IN, 'true'],
      [STORAGE_KEYS.USER_DATA, JSON.stringify(userData)],
    ]);

    console.log('✅ Tokens saved');

    return {
      success: true,
      userId,
      accessToken,
      refreshToken,
      userData,
      message: 'Login successful',
    };
  } catch (error) {
    console.error('❌ Deep Link Error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * 🔹 Get Access Token
 */
export const getAccessToken = async () => {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN);
  } catch (error) {
    console.error('❌ Error getting access token:', error);
    return null;
  }
};

/**
 * 🔹 Get Refresh Token
 */
export const getRefreshToken = async () => {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);
  } catch (error) {
    console.error('❌ Error getting refresh token:', error);
    return null;
  }
};

/**
 * 🔹 Check if Token is Expired
 */
export const isTokenExpired = (token) => {
  try {
    if (!token) return true;

    const decoded = jwtDecode(token);
    const currentTime = Date.now() / 1000;

    // 60 seconds buffer
    return decoded.exp < (currentTime + 60);
  } catch (error) {
    console.error('❌ Token decode error:', error);
    return true;
  }
};

/**
 * ✅ FIXED: Refresh Access Token
 * - Does NOT clear auth data on failure
 * - Prevents multiple simultaneous refresh calls
 * - Only clears data if refresh token itself is rejected (401)
 */
export const refreshAccessToken = async () => {
  // ✅ If already refreshing, wait for that to finish
  if (isRefreshing && refreshPromise) {
    console.log('🔄 Already refreshing, waiting...');
    return refreshPromise;
  }

  isRefreshing = true;

  refreshPromise = (async () => {
    try {
      console.log('🔄 Refreshing access token...');

      const refreshToken = await getRefreshToken();

      if (!refreshToken) {
        console.warn('⚠️ No refresh token available');
        return null; // ✅ Don't clear data - just return null
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(REFRESH_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.error('❌ Refresh response:', response.status);

        // ✅ ONLY clear auth if server says refresh token is invalid (401)
        if (response.status === 401 || response.status === 403) {
          console.error('❌ Refresh token rejected by server - clearing auth');
          await clearAuthData();
          return null;
        }

        // ✅ Server error (500, 502, etc) - DON'T clear, try again later
        console.warn('⚠️ Server error during refresh, will retry later');
        return null;
      }

      const data = await response.json();

      // ✅ Handle different response formats
      const newAccessToken = data.accessToken || data.access_token || data.token;
      const newRefreshToken = data.refreshToken || data.refresh_token;

      if (!newAccessToken) {
        console.error('❌ No access token in refresh response');
        return null; // ✅ Don't clear data
      }

      // ✅ Save new tokens
      await AsyncStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, newAccessToken);

      // ✅ If server sends new refresh token, save it too
      if (newRefreshToken) {
        await AsyncStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, newRefreshToken);
      }

      console.log('✅ Token refreshed successfully');
      return newAccessToken;
    } catch (error) {
      if (error.name === 'AbortError') {
        console.error('❌ Refresh request timeout');
      } else {
        console.error('❌ Refresh error:', error.message);
      }

      // ✅ DON'T clear auth data on network errors
      // User might be offline - try again when online
      return null;
    } finally {
      isRefreshing = false;
      refreshPromise = null;
    }
  })();

  return refreshPromise;
};

/**
 * ✅ FIXED: Get Valid Access Token
 * - Silently refreshes expired tokens
 * - Never throws errors that would trigger login screen
 */
export const getValidAccessToken = async () => {
  try {
    const accessToken = await getAccessToken();

    // ✅ Token valid - return it
    if (accessToken && !isTokenExpired(accessToken)) {
      return accessToken;
    }

    // ✅ Token expired or missing - try silent refresh
    console.log('🔄 Token expired/missing, trying silent refresh...');

    const newToken = await refreshAccessToken();

    if (newToken) {
      console.log('✅ Silent refresh successful');
      return newToken;
    }

    // ✅ Refresh failed - return old token anyway (might still work)
    // Let the API call fail and handle 401 there
    if (accessToken) {
      console.warn('⚠️ Using potentially expired token');
      return accessToken;
    }

    console.warn('⚠️ No token available at all');
    return null;
  } catch (error) {
    console.error('❌ getValidAccessToken error:', error);

    // ✅ Try to return whatever token we have
    try {
      return await getAccessToken();
    } catch (e) {
      return null;
    }
  }
};

/**
 * 🔹 Authenticated API Call with auto-retry
 */
export const makeAuthenticatedRequest = async (url, options = {}) => {
  try {
    const accessToken = await getValidAccessToken();

    if (!accessToken) {
      throw new Error('No valid access token available');
    }

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    };

    const response = await fetch(url, { ...options, headers });

    // ✅ If 401, try refresh once
    if (response.status === 401) {
      console.log('🔄 Got 401, refreshing token...');

      const newAccessToken = await refreshAccessToken();

      if (newAccessToken) {
        headers.Authorization = `Bearer ${newAccessToken}`;
        return await fetch(url, { ...options, headers });
      }
    }

    return response;
  } catch (error) {
    console.error('❌ Auth request error:', error);
    throw error;
  }
};

/**
 * 🔹 Deep Link Listener
 */
export const setupGoogleAuthListener = (callback) => {
  console.log('🎧 Setting up Auth Listener...');

  const listener = Linking.addEventListener('url', async (event) => {
    if (event.url && event.url.startsWith('parkit://login-success')) {
      const result = await handleGoogleAuthDeepLink(event.url);
      if (callback) callback(result);
    }
  });

  Linking.getInitialURL().then(async (url) => {
    if (url && url.startsWith('parkit://login-success')) {
      const result = await handleGoogleAuthDeepLink(url);
      if (callback) callback(result);
    }
  });

  return listener;
};

/**
 * 🔹 Remove Listener
 */
export const removeGoogleAuthListener = (listener) => {
  if (listener) {
    listener.remove();
  }
};

/**
 * 🔹 Get Stored UserId
 */
export const getStoredUserId = async () => {
  try {
    return await AsyncStorage.getItem(STORAGE_KEYS.USER_ID);
  } catch (error) {
    console.error('❌ Error getting userId:', error);
    return null;
  }
};

/**
 * ✅ FIXED: Check if user is logged in
 * - Only checks if tokens EXIST, not if they're valid
 * - Valid/expired check happens in getValidAccessToken
 */
export const isUserLoggedIn = async () => {
  try {
    const isLoggedIn = await AsyncStorage.getItem(STORAGE_KEYS.IS_LOGGED_IN);
    const refreshToken = await AsyncStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN);

    // ✅ User is logged in if we have refresh token
    // Access token can be refreshed silently
    return isLoggedIn === 'true' && !!refreshToken;
  } catch (error) {
    console.error('❌ Error checking login:', error);
    return false;
  }
};

/**
 * 🔹 Clear Auth Data (Logout)
 */
export const clearAuthData = async () => {
  try {
    await AsyncStorage.multiRemove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.USER_ID,
      STORAGE_KEYS.IS_LOGGED_IN,
      STORAGE_KEYS.USER_DATA,
    ]);
    console.log('✅ Auth data cleared');
    return true;
  } catch (error) {
    console.error('❌ Error clearing auth data:', error);
    return false;
  }
};

export default {
  initiateGoogleLogin,
  handleGoogleAuthDeepLink,
  setupGoogleAuthListener,
  removeGoogleAuthListener,
  getStoredUserId,
  isUserLoggedIn,
  clearAuthData,
  getAccessToken,
  getRefreshToken,
  getValidAccessToken,
  refreshAccessToken,
  makeAuthenticatedRequest,
  isTokenExpired,
};