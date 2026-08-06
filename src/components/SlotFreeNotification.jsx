// src/components/SlotFreeNotification.js
// ═══════════════════════════════════════════════════════════════
// Animated banner that appears when a parking slot becomes free
// ═══════════════════════════════════════════════════════════════

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  StyleSheet,
  Vibration,
  Platform,
} from 'react-native';
import { scale, moderateScale, verticalScale } from 'react-native-size-matters';
import { RFValue } from 'react-native-responsive-fontsize';

const s = (v) => scale(v);
const ms = (v) => moderateScale(v, 0.3);
const vs = (v) => verticalScale(v);
const rf = (v) => RFValue(v);

const SlotFreeNotification = ({
  visible,
  message,
  latitude,
  longitude,
  distance,       // optional: distance to the free slot in meters
  onNavigate,     // called when user taps "Navigate"
  onDismiss,      // called when user dismisses
  topOffset = 0,  // from safe area
}) => {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const scale_anim = useRef(new Animated.Value(0.95)).current;

  useEffect(() => {
    if (visible) {
      // Vibrate to alert user
      try {
        Vibration.vibrate(
          Platform.OS === 'android' ? [0, 80, 60, 80] : [0, 80],
        );
      } catch (_) {}

      // Slide in
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          tension: 65,
          friction: 10,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.spring(scale_anim, {
          toValue: 1,
          useNativeDriver: true,
          tension: 65,
          friction: 10,
        }),
      ]).start();

      // Auto-dismiss after 8 seconds
      const timer = setTimeout(() => {
        onDismiss?.();
      }, 8000);

      return () => clearTimeout(timer);
    } else {
      // Slide out
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -120,
          duration: 280,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [visible]);

  if (!visible && opacity._value === 0) return null;

  const distanceText = distance
    ? distance < 1000
      ? `${Math.round(distance)} m away`
      : `${(distance / 1000).toFixed(1)} km away`
    : null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: topOffset + vs(10),
          transform: [{ translateY }, { scale: scale_anim }],
          opacity,
        },
      ]}
      pointerEvents="box-none">

      {/* Green accent bar */}
      <View style={styles.accentBar} />

      <View style={styles.content}>

        {/* Icon + Text */}
        <View style={styles.left}>
          <View style={styles.iconBox}>
            <Text style={styles.icon}>🅿️</Text>
          </View>

          <View style={styles.textBox}>
            <Text style={styles.title}>Spot Available!</Text>
            <Text style={styles.subtitle} numberOfLines={2}>
              {message || 'A nearby parking spot just opened up'}
            </Text>
            {!!distanceText && (
              <Text style={styles.distance}>📍 {distanceText}</Text>
            )}
          </View>
        </View>

        {/* Action buttons */}
        <View style={styles.actions}>
          {/* Navigate button */}
          {!!onNavigate && !!latitude && !!longitude && (
            <TouchableOpacity
              onPress={() => onNavigate({ latitude, longitude, message })}
              style={styles.navigateBtn}
              activeOpacity={0.85}>
              <Text style={styles.navigateBtnText}>Go →</Text>
            </TouchableOpacity>
          )}

          {/* Dismiss button */}
          <TouchableOpacity
            onPress={onDismiss}
            style={styles.dismissBtn}
            hitSlop={10}
            activeOpacity={0.7}>
            <Text style={styles.dismissText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: s(14),
    right: s(14),
    zIndex: 999,
    backgroundColor: '#FFFFFF',
    borderRadius: ms(16),
    borderWidth: 1,
    borderColor: '#C8F0D0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 16,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  accentBar: {
    width: ms(5),
    backgroundColor: '#4CAF50',
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: vs(12),
    paddingHorizontal: s(12),
    gap: s(10),
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  iconBox: {
    width: ms(42),
    height: ms(42),
    borderRadius: ms(14),
    backgroundColor: '#EAF7EE',
    borderWidth: 1,
    borderColor: '#C8F0D0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: rf(18),
  },
  textBox: {
    flex: 1,
  },
  title: {
    fontSize: rf(12),
    fontWeight: '900',
    color: '#1F1F1F',
    letterSpacing: 0.1,
  },
  subtitle: {
    fontSize: rf(10),
    fontWeight: '700',
    color: '#6F6F6F',
    marginTop: vs(2),
    lineHeight: rf(13),
  },
  distance: {
    fontSize: rf(9.5),
    fontWeight: '800',
    color: '#4CAF50',
    marginTop: vs(3),
  },
  actions: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: vs(6),
  },
  navigateBtn: {
    backgroundColor: '#4CAF50',
    paddingHorizontal: s(12),
    paddingVertical: vs(6),
    borderRadius: ms(10),
  },
  navigateBtnText: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: rf(10.5),
  },
  dismissBtn: {
    paddingHorizontal: s(4),
  },
  dismissText: {
    color: '#9E9E9E',
    fontWeight: '900',
    fontSize: rf(12),
  },
});

export default SlotFreeNotification;