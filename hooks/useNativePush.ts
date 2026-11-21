import { useEffect, useRef } from 'react';
import { apiUrl } from '../utils/apiBase';
import {
  getCapacitorPlugins,
  getNativePlatform,
  isNativeApp,
} from '../utils/nativeBridge';
import { getAuthenticatedRequestHeaders } from '../utils/security';

const PUSH_TOKEN_STORAGE_KEY = 'syndik_native_push_token_v1';

function readStoredPushToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return (
      window.localStorage.getItem(PUSH_TOKEN_STORAGE_KEY) ||
      window.sessionStorage.getItem(PUSH_TOKEN_STORAGE_KEY)
    );
  } catch {
    return null;
  }
}

function writeStoredPushToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    window.sessionStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage quota / private mode failures
  }
}

function clearStoredPushToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
}

export async function unregisterStoredNativePushToken(): Promise<void> {
  if (typeof window === 'undefined' || !isNativeApp()) return;
  const token = readStoredPushToken();
  if (!token) return;
  try {
    await fetch(apiUrl('/api/devices/push-token'), {
      method: 'DELETE',
      headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Non-blocking cleanup on logout
  } finally {
    clearStoredPushToken();
  }
}

async function syncDeviceTokenToServer(token: string): Promise<void> {
  const platform = getNativePlatform();
  if (platform === 'web' || !token) return;
  try {
    const response = await fetch(apiUrl('/api/devices/push-token'), {
      method: 'POST',
      headers: getAuthenticatedRequestHeaders(),
      body: JSON.stringify({
        token,
        platform,
        deviceLabel: `${platform === 'ios' ? 'iPhone/iPad' : 'Android'} SyndicUnion`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) {
      writeStoredPushToken(token);
    }
  } catch {
    // Retry on next app launch / session restore
  }
}

/**
 * Registers Android/iOS native FCM/APNs push notifications when authenticated
 * inside Capacitor, displays foreground toasts, and handles tap-to-navigate deep links.
 */
export function useNativePush(options: {
  enabled: boolean;
  uid?: string;
  navigate: (path: string) => void;
  onForegroundMessage?: (title: string, body: string) => void;
}): void {
  const { enabled, uid, navigate, onForegroundMessage } = options;
  const navigateRef = useRef(navigate);
  const onForegroundRef = useRef(onForegroundMessage);

  useEffect(() => {
    navigateRef.current = navigate;
    onForegroundRef.current = onForegroundMessage;
  }, [navigate, onForegroundMessage]);

  useEffect(() => {
    if (!enabled || !uid || !isNativeApp()) return;
    const { PushNotifications } = getCapacitorPlugins();
    if (!PushNotifications) return;

    let disposed = false;
    const handles: Array<Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> }> = [];

    const setup = async () => {
      try {
        let perm = await PushNotifications.checkPermissions();
        if (perm.receive === 'prompt') {
          perm = await PushNotifications.requestPermissions();
        }
        if (disposed || perm.receive !== 'granted') return;

        handles.push(
          PushNotifications.addListener('registration', (tokenData: { value?: string }) => {
            if (!disposed && tokenData?.value) {
              void syncDeviceTokenToServer(tokenData.value);
            }
          }),
        );

        handles.push(
          PushNotifications.addListener(
            'pushNotificationReceived',
            (notification: { title?: string; body?: string }) => {
              const handler = onForegroundRef.current;
              if (!disposed && handler && (notification?.title || notification?.body)) {
                handler(
                  notification.title || 'SyndicUnion',
                  notification.body || '',
                );
              }
            },
          ),
        );

        handles.push(
          PushNotifications.addListener(
            'pushNotificationActionPerformed',
            (action: { notification?: { data?: { link?: string } } }) => {
              if (disposed) return;
              const link = action?.notification?.data?.link;
              if (typeof link === 'string' && link.startsWith('/')) {
                navigateRef.current(link);
              }
            },
          ),
        );

        await PushNotifications.register();
      } catch {
        // Ignore if native push plugin is unavailable or denied by OS
      }
    };

    void setup();

    return () => {
      disposed = true;
      for (const h of handles) {
        void Promise.resolve(h).then((item) => item?.remove?.()).catch(() => {});
      }
    };
  }, [enabled, uid]);
}
