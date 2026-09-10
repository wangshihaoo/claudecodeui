import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { useAuth } from '@/modules/auth';
import { sendLocalRealtimeMessage, subscribeToLocalEvents } from '@/shared/api';
import type { RealtimeConnection, ServerEvent } from '@/shared/types';


type ServerEventListener = (event: ServerEvent) => void;

type WebSocketContextType = {
  ws: RealtimeConnection | null;
  sendMessage: (message: unknown) => void;
  /**
   * Subscribes to every websocket frame. Returns an unsubscribe function.
   *
   * This is the primary consumption API: events are dispatched synchronously
   * to every listener, so rapid back-to-back frames cannot be coalesced or
   * dropped. Frames are deliberately not copied into React state; each
   * listener updates only the state owned by the feature that handles it.
   */
  subscribe: (listener: ServerEventListener) => () => void;
  isConnected: boolean;
};

const WebSocketContext = createContext<WebSocketContextType | null>(null);

const LOCAL_CONNECTION: RealtimeConnection = { transport: 'local-runtime' };

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

const useWebSocketProviderState = (): WebSocketContextType => {
  /**
   * Listener registry for the subscribe API. A ref (not state) because the
   * set must be readable synchronously inside the event dispatcher and never trigger
   * re-renders of the provider tree.
   */
  const listenersRef = useRef(new Set<ServerEventListener>());
  const [isConnected, setIsConnected] = useState(false);
  const { isLoading: isAuthLoading, user } = useAuth();

  const dispatch = useCallback((event: ServerEvent) => {
    for (const listener of listenersRef.current) {
      try {
        listener(event);
      } catch (error) {
        console.error('WebSocket listener error:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (isAuthLoading || !user) {
      setIsConnected(false);
      return;
    }

    const unsubscribe = subscribeToLocalEvents(dispatch);
    setIsConnected(true);

    return () => {
      unsubscribe();
      setIsConnected(false);
    };
  }, [dispatch, isAuthLoading, user]);

  const sendMessage = useCallback((message: unknown) => {
    sendLocalRealtimeMessage(message);
  }, []);

  const subscribe = useCallback((listener: ServerEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const value: WebSocketContextType = useMemo(() =>
  ({
    ws: isConnected ? LOCAL_CONNECTION : null,
    sendMessage,
    subscribe,
    isConnected
  }), [sendMessage, subscribe, isConnected]);

  return value;
};

/** Mounted once by App; owns the single chat websocket that the chat, project-workspace and task-master modules subscribe to. */
export const WebSocketProvider = ({ children }: { children: React.ReactNode }) => {
  const webSocketData = useWebSocketProviderState();

  return (
    <WebSocketContext.Provider value={webSocketData}>
      {children}
    </WebSocketContext.Provider>
  );
};

export default WebSocketContext;
