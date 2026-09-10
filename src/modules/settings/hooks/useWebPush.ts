import { useCallback } from 'react';

type WebPushState = {
  permission: NotificationPermission | 'unsupported';
  isSubscribed: boolean;
  isLoading: boolean;
  subscribe: () => Promise<void>;
  unsubscribe: () => Promise<void>;
};

export function useWebPush(): WebPushState {
  const subscribe = useCallback(async () => undefined, []);
  const unsubscribe = useCallback(async () => undefined, []);

  // Push notifications require a service worker and a remote subscription
  // endpoint, both intentionally disabled in the local browser runtime.
  return {
    permission: 'unsupported',
    isSubscribed: false,
    isLoading: false,
    subscribe,
    unsubscribe,
  };
}
