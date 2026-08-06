// src/components/WsStatusDot.js
// Small dot indicator showing WebSocket connection status

import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { moderateScale } from 'react-native-size-matters';
import { RFValue } from 'react-native-responsive-fontsize';
import { WS_STATUS } from '../hooks/useParkingWebSocket';

const ms = (v) => moderateScale(v, 0.3);
const rf = (v) => RFValue(v);

const STATUS_COLORS = {
  [WS_STATUS.CONNECTED]: '#4CAF50',
  [WS_STATUS.CONNECTING]: '#FF9800',
  [WS_STATUS.RECONNECTING]: '#FF9800',
  [WS_STATUS.DISCONNECTED]: '#9E9E9E',
  [WS_STATUS.ERROR]: '#F44336',
};

const STATUS_LABELS = {
  [WS_STATUS.CONNECTED]: 'Live',
  [WS_STATUS.CONNECTING]: 'Connecting...',
  [WS_STATUS.RECONNECTING]: 'Reconnecting...',
  [WS_STATUS.DISCONNECTED]: 'Offline',
  [WS_STATUS.ERROR]: 'Error',
};

const WsStatusDot = ({ status, onPress, showLabel = false }) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const color = STATUS_COLORS[status] || '#9E9E9E';
  const label = STATUS_LABELS[status] || '';

  // Pulse animation when connected
  useEffect(() => {
    if (status === WS_STATUS.CONNECTED) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.6,
            duration: 900,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            useNativeDriver: true,
          }),
        ]),
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [status]);

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      hitSlop={10}
      activeOpacity={0.7}>

      {/* Pulse ring (only when connected) */}
      {status === WS_STATUS.CONNECTED && (
        <Animated.View
          style={[
            styles.pulse,
            {
              backgroundColor: color,
              transform: [{ scale: pulseAnim }],
              opacity: pulseAnim.interpolate({
                inputRange: [1, 1.6],
                outputRange: [0.4, 0],
              }),
            },
          ]}
        />
      )}

      {/* Main dot */}
      <View style={[styles.dot, { backgroundColor: color }]} />

      {/* Label */}
      {showLabel && (
        <Text style={[styles.label, { color }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ms(5),
    position: 'relative',
  },
  dot: {
    width: ms(9),
    height: ms(9),
    borderRadius: ms(5),
  },
  pulse: {
    position: 'absolute',
    width: ms(9),
    height: ms(9),
    borderRadius: ms(5),
  },
  label: {
    fontSize: rf(9),
    fontWeight: '800',
  },
});

export default WsStatusDot;