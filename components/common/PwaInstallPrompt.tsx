import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'syndik_pwa_install_dismissed_at';
const DISMISS_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return true;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) {
    return true;
  }
  return false;
}

function isDismissedRecently(): boolean {
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!raw) return false;
    const ts = Number(raw);
    return Number.isFinite(ts) && Date.now() - ts < DISMISS_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function isIosSafariBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent || '';
  const isIos = /iPad|iPhone|iPod/.test(ua);
  const isWebKit = /WebKit/i.test(ua);
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIos && isWebKit && !isOtherIosBrowser;
}

const PwaInstallPrompt: React.FC = () => {
  const { tr, language } = useI18n();
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIosTip, setShowIosTip] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Never intrude during automated browser tests or if already installed / dismissed
    if (window.navigator.webdriver || isStandaloneMode() || isDismissedRecently()) {
      setHidden(true);
      return;
    }

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowIosTip(false);
      setHidden(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    if (isIosSafariBrowser()) {
      setShowIosTip(true);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (hidden || (!deferredPrompt && !showIosTip)) {
    return null;
  }

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, String(Date.now()));
    } catch {
      // ignore storage errors in private mode
    }
    setHidden(true);
    setDeferredPrompt(null);
    setShowIosTip(false);
  };

  const handleInstall = async () => {
    if (!deferredPrompt || installing) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setHidden(true);
      } else {
        handleDismiss();
      }
    } catch {
      handleDismiss();
    } finally {
      setInstalling(false);
      setDeferredPrompt(null);
    }
  };

  return (
    <aside
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      aria-label={tr("Installer l'application Syndik", 'تثبيت تطبيق Syndik')}
      className="print:hidden fixed bottom-20 md:bottom-5 inset-x-3 sm:inset-x-auto sm:end-5 z-40 max-w-sm ms-auto bg-slate-900 text-white rounded-2xl border border-teal-500/40 shadow-2xl p-3.5 sm:p-4 pb-safe"
    >
      <div className="flex items-start gap-3">
        <img
          src="/icons/icon-192.png"
          alt="Syndik"
          className="w-11 h-11 rounded-xl shrink-0 border border-teal-500/30"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-white leading-snug">
              {tr('Installer Syndik sur votre appareil', 'ثبّت Syndik على جهازك')}
            </p>
            <button
              type="button"
              onClick={handleDismiss}
              aria-label={tr('Fermer', 'إغلاق')}
              className="text-slate-400 hover:text-white p-1 -m-1 rounded-lg min-w-[32px] min-h-[32px] flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          {deferredPrompt ? (
            <>
              <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                {tr(
                  'Accès plein écran rapide depuis votre écran d’accueil pour vos charges, quittances et votes AG.',
                  'ولوج سريع بملء الشاشة من الشاشة الرئيسية لمتابعة الواجبات والوصولات والتصويت.'
                )}
              </p>
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleInstall}
                  disabled={installing}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[36px] rounded-lg bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold text-xs transition-colors disabled:opacity-60"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {installing
                      ? tr('Installation...', 'جاري التثبيت...')
                      : tr('Installer', 'تثبيت')}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="px-3 py-2 min-h-[36px] rounded-lg text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  {tr('Plus tard', 'لاحقاً')}
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-300 mt-1 leading-relaxed flex items-center gap-1.5 flex-wrap">
              <Share className="w-3.5 h-3.5 text-teal-300 inline shrink-0" />
              <span>
                {tr(
                  'Sur Safari : appuyez sur Partager puis « Sur l’écran d’accueil ».',
                  'في Safari: اضغط على مشاركة ثم «إضافة إلى الشاشة الرئيسية».'
                )}
              </span>
            </p>
          )}
        </div>
      </div>
    </aside>
  );
};

export default PwaInstallPrompt;
