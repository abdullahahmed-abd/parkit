// src/hooks/useParkingWebSocket.js

import { useEffect, useRef, useCallback, useState } from 'react';
import { AppState } from 'react-native';

// ─────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────

const WS_CONFIG = {
  // ✅ Use direct server WS in dev (works now), domain WSS in production (needs SSL/SNI fixed)
  url: __DEV__
    ? 'ws://147.93.28.239:8083/parkit-api/ws/parking'
    : 'wss://parkit.sundukpay.com/parkit-api/ws/parking',

  reconnectBaseDelay: 2000,
  reconnectMaxDelay: 30000,
  reconnectMaxAttempts: 10,
  reconnectBackoffFactor: 1.5,

  messageTypes: {
    SLOT_FREE: 'SLOT_FREE',
  },
};

// ─────────────────────────────────────────────
// WEBSOCKET STATES
// ─────────────────────────────────────────────

export const WS_STATUS = {
  CONNECTING: 'CONNECTING',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  RECONNECTING: 'RECONNECTING',
  ERROR: 'ERROR',
};

// ─────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────

const useParkingWebSocket = ({
  onSlotFree,
  onConnected,
  onDisconnected,
  enabled = true,
}) => {
  const [status, setStatus] = useState(WS_STATUS.DISCONNECTED);
  const [lastMessage, setLastMessage] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const isMountedRef = useRef(true);
  const isConnectingRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const enabledRef = useRef(enabled);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const disconnect = useCallback(() => {
    clearTimers();
    isConnectingRef.current = false;

    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;

      try {
        ws.close(1000, 'Intentional close');
      } catch {}
      wsRef.current = null;
    }

    if (isMountedRef.current) setStatus(WS_STATUS.DISCONNECTED);
    console.log('🔌 WebSocket disconnected');
  }, [clearTimers]);

  const getReconnectDelay = useCallback((attempt) => {
    return Math.min(
      WS_CONFIG.reconnectBaseDelay *
        Math.pow(WS_CONFIG.reconnectBackoffFactor, attempt),
      WS_CONFIG.reconnectMaxDelay,
    );
  }, []);

  const connect = useCallback(async () => {
    if (!isMountedRef.current) return;
    if (!enabledRef.current) return;
    if (isConnectingRef.current) return;

    const existing = wsRef.current;
    if (existing?.readyState === WebSocket.OPEN) return;
    if (existing?.readyState === WebSocket.CONNECTING) return;

    isConnectingRef.current = true;

    console.log(
      `🔗 Connecting... attempt ${reconnectAttemptRef.current + 1} (${WS_CONFIG.url})`,
    );

    if (isMountedRef.current) {
      setStatus(
        reconnectAttemptRef.current > 0 ? WS_STATUS.RECONNECTING : WS_STATUS.CONNECTING,
      );
    }

    try {
      const ws = new WebSocket(WS_CONFIG.url);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('✅ WebSocket connected');
        isConnectingRef.current = false;
        reconnectAttemptRef.current = 0;
        setReconnectAttempt(0);
        setStatus(WS_STATUS.CONNECTED);
        onConnected?.();
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          setLastMessage(data);

          if (data?.type === WS_CONFIG.messageTypes.SLOT_FREE) {
            onSlotFree?.(data);
          }
        } catch (e) {
          console.log('❌ WS JSON parse failed', e);
        }
      };

      ws.onerror = (event) => {
        // Keep as log to avoid noisy red LogBox; onclose will handle reconnect.
        console.log('❌ WebSocket error', event?.type || event);
        isConnectingRef.current = false;
      };

      ws.onclose = (event) => {
        console.log('⚠️ WebSocket closed', {
          code: event?.code,
          reason: event?.reason,
          wasClean: event?.wasClean,
        });

        isConnectingRef.current = false;
        clearTimers();
        wsRef.current = null;

        onDisconnected?.();

        if (!enabledRef.current) {
          setStatus(WS_STATUS.DISCONNECTED);
          return;
        }

        if (event?.code === 1000) {
          setStatus(WS_STATUS.DISCONNECTED);
          return;
        }

        if (reconnectAttemptRef.current < WS_CONFIG.reconnectMaxAttempts) {
          reconnectAttemptRef.current += 1;

          const delay = getReconnectDelay(reconnectAttemptRef.current);

          setReconnectAttempt(reconnectAttemptRef.current);
          setStatus(WS_STATUS.RECONNECTING);

          console.log(`🔄 Reconnecting in ${delay / 1000}s...`);

          reconnectTimerRef.current = setTimeout(() => {
            if (isMountedRef.current && enabledRef.current) connect();
          }, delay);
        } else {
          console.log('❌ Max reconnect attempts reached');
          setStatus(WS_STATUS.ERROR);
        }
      };
    } catch (e) {
      console.log('❌ Failed to create websocket', e);
      isConnectingRef.current = false;
      setStatus(WS_STATUS.ERROR);
    }
  }, [clearTimers, getReconnectDelay, onConnected, onDisconnected, onSlotFree]);

  const reconnect = useCallback(() => {
    reconnectAttemptRef.current = 0;
    disconnect();
    setTimeout(() => {
      if (isMountedRef.current && enabledRef.current) connect();
    }, 500);
  }, [connect, disconnect]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextState === 'active';

      if (wasBackground && isNowActive && enabledRef.current) {
        setTimeout(() => {
          const ws = wsRef.current;
          if (!ws || ws.readyState !== WebSocket.OPEN) {
            reconnectAttemptRef.current = 0;
            connect();
          }
        }, 1000);
      }

      appStateRef.current = nextState;
    });

    return () => sub.remove();
  }, [connect]);

  useEffect(() => {
    isMountedRef.current = true;

    const timer = setTimeout(() => {
      if (isMountedRef.current && enabledRef.current) connect();
    }, 1000);

    return () => {
      clearTimeout(timer);
      isMountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!enabled) disconnect();
    else {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) connect();
    }
  }, [enabled, connect, disconnect]);

  return {
    status,
    lastMessage,
    reconnectAttempt,
    reconnect,
    disconnect,
    isConnected: status === WS_STATUS.CONNECTED,
    isReconnecting: status === WS_STATUS.RECONNECTING,
  };
};

export default useParkingWebSocket;