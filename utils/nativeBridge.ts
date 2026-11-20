// Zero-web-overhead bridge to Capacitor native plugins (Android & iOS).
// On standard web browsers and Node tests, all helpers degrade cleanly to standard
// browser APIs without pulling native plugin bundles into the initial web graph.

export type NativePlatform = 'android' | 'ios' | 'web';

interface CapacitorPluginRegistry {
  Filesystem?: {
    writeFile: (options: {
      path: string;
      data: string;
      directory: string;
      recursive?: boolean;
    }) => Promise<{ uri: string }>;
  };
  Share?: {
    share: (options: {
      title?: string;
      text?: string;
      url?: string;
      files?: string[];
      dialogTitle?: string;
    }) => Promise<{ activityType?: string }>;
  };
  Browser?: {
    open: (options: { url: string; presentationStyle?: 'fullscreen' | 'popover' }) => Promise<void>;
  };
  Camera?: {
    getPhoto: (options: {
      quality?: number;
      allowEditing?: boolean;
      resultType: string;
      source?: string;
      width?: number;
      height?: number;
      correctOrientation?: boolean;
    }) => Promise<{ dataUrl?: string; base64String?: string; format?: string }>;
  };
  App?: {
    addListener: (
      eventName: 'backButton' | 'appUrlOpen',
      listenerFunc: (event: { canGoBack?: boolean; url?: string }) => void,
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
    exitApp?: () => Promise<void>;
  };
  StatusBar?: {
    setStyle?: (options: { style: 'DARK' | 'LIGHT' | 'DEFAULT' }) => Promise<void>;
    setBackgroundColor?: (options: { color: string }) => Promise<void>;
  };
  SplashScreen?: {
    hide?: (options?: { fadeOutDuration?: number }) => Promise<void>;
  };
  PushNotifications?: {
    checkPermissions: () => Promise<{ receive: string }>;
    requestPermissions: () => Promise<{ receive: string }>;
    register: () => Promise<void>;
    addListener: (
      eventName:
        | 'registration'
        | 'registrationError'
        | 'pushNotificationReceived'
        | 'pushNotificationActionPerformed',
      listenerFunc: (payload: any) => void,
    ) => Promise<{ remove: () => Promise<void> }> | { remove: () => Promise<void> };
  };
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  Plugins?: CapacitorPluginRegistry;
}

function getCapacitor(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as Window & { Capacitor?: CapacitorGlobal }).Capacitor;
}

export function getNativePlatform(): NativePlatform {
  const cap = getCapacitor();
  if (!cap?.isNativePlatform?.()) return 'web';
  const platform = String(cap.getPlatform?.() || '').toLowerCase();
  if (platform === 'android' || platform === 'ios') return platform;
  return 'web';
}

export function isNativeApp(): boolean {
  return getNativePlatform() !== 'web';
}

export function isIosNativeApp(): boolean {
  return getNativePlatform() === 'ios';
}

export function isAndroidNativeApp(): boolean {
  return getNativePlatform() === 'android';
}

export function getCapacitorPlugins(): CapacitorPluginRegistry {
  return getCapacitor()?.Plugins || {};
}

function sanitizeFileName(raw: string, fallback = 'document.pdf'): string {
  const cleaned = String(raw || fallback)
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('File read failed'));
    reader.readAsDataURL(blob);
  });
}

function triggerWebBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = sanitizeFileName(fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function shareBase64ViaCapacitor(
  base64Data: string,
  fileName: string,
  dialogTitle?: string,
): Promise<boolean> {
  const { Filesystem, Share } = getCapacitorPlugins();
  if (!Filesystem || !Share) return false;

  const safeName = sanitizeFileName(fileName);
  const written = await Filesystem.writeFile({
    path: `exports/${Date.now()}_${safeName}`,
    data: base64Data,
    directory: 'CACHE',
    recursive: true,
  });

  await Share.share({
    title: dialogTitle || safeName,
    url: written.uri,
    files: [written.uri],
    dialogTitle: dialogTitle || safeName,
  });
  return true;
}

/**
 * Saves a jsPDF document on web or opens the native Android/iOS Share Sheet
 * (WhatsApp, Email, AirDrop, Files) on Capacitor mobile binaries.
 */
export async function saveOrSharePdf(
  doc: {
    save: (filename: string) => unknown;
    output: (type: 'datauristring' | 'blob') => unknown;
  },
  fileName: string,
  dialogTitle?: string,
): Promise<void> {
  const safeName = sanitizeFileName(fileName, 'document.pdf');
  if (!isNativeApp()) {
    doc.save(safeName);
    return;
  }

  try {
    const dataUri = String(doc.output('datauristring') || '');
    const commaIdx = dataUri.indexOf(',');
    const base64 = commaIdx >= 0 ? dataUri.slice(commaIdx + 1) : dataUri;
    if (base64 && (await shareBase64ViaCapacitor(base64, safeName, dialogTitle))) {
      return;
    }
  } catch {
    // Fall back to standard browser save if share is canceled or plugin unavailable
  }
  doc.save(safeName);
}

/**
 * Downloads a Blob on web or shares it via the native Share Sheet on Capacitor.
 */
export async function saveOrShareBlob(
  blob: Blob,
  fileName: string,
  dialogTitle?: string,
): Promise<void> {
  const safeName = sanitizeFileName(fileName, 'export.bin');
  if (!isNativeApp()) {
    triggerWebBlobDownload(blob, safeName);
    return;
  }

  try {
    const base64 = await blobToBase64(blob);
    if (base64 && (await shareBase64ViaCapacitor(base64, safeName, dialogTitle))) {
      return;
    }
  } catch {
    // Fallback below
  }
  triggerWebBlobDownload(blob, safeName);
}

/**
 * Opens an external URL in Chrome Custom Tabs / SFSafariViewController on native
 * Capacitor builds, or in a new browser tab on web.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return;
  if (isNativeApp()) {
    const { Browser } = getCapacitorPlugins();
    if (Browser?.open) {
      await Browser.open({ url, presentationStyle: 'fullscreen' });
      return;
    }
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/**
 * Captures a compressed photo via Capacitor Camera on native devices.
 * Returns null on web so CameraCaptureModal uses its browser camera/file picker.
 */
export async function captureNativePhoto(): Promise<string | null> {
  if (!isNativeApp()) return null;
  const { Camera } = getCapacitorPlugins();
  if (!Camera?.getPhoto) return null;

  const photo = await Camera.getPhoto({
    quality: 82,
    allowEditing: false,
    resultType: 'dataUrl',
    source: 'PROMPT',
    width: 1100,
    height: 1100,
    correctOrientation: true,
  });

  if (photo.dataUrl) return photo.dataUrl;
  if (photo.base64String) {
    const fmt = photo.format || 'jpeg';
    return `data:image/${fmt};base64,${photo.base64String}`;
  }
  return null;
}

/**
 * Initializes native Capacitor shell integrations: StatusBar, SplashScreen hide,
 * Android hardware back button, and syndicunion:// deep-link routing.
 */
export function initNativeShell(navigate: (path: string) => void): () => void {
  if (!isNativeApp()) return () => {};

  const { StatusBar, SplashScreen, App } = getCapacitorPlugins();
  const cleanups: Array<() => void> = [];

  if (StatusBar?.setStyle) {
    void StatusBar.setStyle({ style: 'DARK' }).catch(() => {});
  }
  if (isAndroidNativeApp() && StatusBar?.setBackgroundColor) {
    void StatusBar.setBackgroundColor({ color: '#0f172a' }).catch(() => {});
  }
  if (SplashScreen?.hide) {
    window.setTimeout(() => {
      void SplashScreen.hide?.({ fadeOutDuration: 220 }).catch(() => {});
    }, 150);
  }

  if (App?.addListener) {
    const backHandle = App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack && window.history.length > 1) {
        window.history.back();
      } else {
        void App.exitApp?.();
      }
    });
    cleanups.push(() => {
      void Promise.resolve(backHandle).then((h) => h?.remove?.()).catch(() => {});
    });

    const urlHandle = App.addListener('appUrlOpen', ({ url }) => {
      if (!url) return;
      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'syndicunion:') {
          const routePath = `/${parsed.host}${parsed.pathname}`.replace(/\/+/g, '/');
          navigate(`${routePath}${parsed.search}${parsed.hash}`);
        } else if (parsed.pathname) {
          navigate(`${parsed.pathname}${parsed.search}${parsed.hash}`);
        }
      } catch {
        // ignore malformed deep links
      }
    });
    cleanups.push(() => {
      void Promise.resolve(urlHandle).then((h) => h?.remove?.()).catch(() => {});
    });
  }

  return () => {
    for (const fn of cleanups) fn();
  };
}
