import { useEffect } from 'react';
import { apiUrl } from '../utils/apiBase';
import {
  getCapacitorPlugins,
  getNativePlatform,
  isNativeApp,
} from '../utils/nativeBridge';
import { getAuthenticatedRequestHeaders } from '../utils/security';

const PUSH_TOKEN_STORAGE_KEY = 'syndik_native_push_token_v1';

export async function unregisterStoredNativePushToken(): Promise<void> {
  if (typeof window === 'undefined' || !isNativeApp()) return;
  const token = window.sessionStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
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
    window.sessionStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
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
    if (response.ok && typeof window !== 'undefined') {
      window.sessionStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
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
              if (!disposed && onForegroundMessage && (notification?.title || notification?.body)) {
                onForegroundMessage(
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
                navigate(link);
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
  }, [enabled, uid, navigate, onForegroundMessage]);
}
