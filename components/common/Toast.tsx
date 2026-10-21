import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import Modal from './Modal';
import Button from './Button';
import { useI18n } from '../../hooks/useI18n';
import { operationSuccess, readableError, type FormFeedbackEvent } from '../../utils/formFeedback';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, title?: string) => void;
  confirmAction: (options: ConfirmOptions) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { tr, isAr } = useI18n();
  const lastToast = useRef({ message: '', at: 0 });
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [confirmState, setConfirmState] = useState<{
    isOpen: boolean;
    options: ConfirmOptions;
    resolve: ((result: boolean) => void) | null;
  }>({
    isOpen: false,
    options: { title: '', message: '' },
    resolve: null,
  });

  const showToast = useCallback((message: string, type: ToastType = 'info', title?: string) => {
    const now = Date.now();
    if (lastToast.current.message === message && now - lastToast.current.at < 1000) return;
    lastToast.current = { message, at: now };
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => {
      const retained = type === 'error' || type === 'success' ? prev.filter(toast => toast.type !== 'error') : prev;
      return [...retained.slice(-2), { id, type, title, message }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, type === 'error' || type === 'warning' ? 12000 : 6000);
  }, []);

  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const feedback = (event: Event) => {
      const { operation, error } = (event as CustomEvent<FormFeedbackEvent>).detail;
      const previous = lastToast.current;
      // Existing forms can supply a more specific toast in their completion handler.
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!error && lastToast.current !== previous) return;
        const message = error ? readableError(error, isAr) : operationSuccess(operation, isAr);
        if (message) showToast(message, error ? 'error' : 'success');
      }, 0);
      timers.add(timer);
    };
    window.addEventListener('syndik-operation-feedback', feedback);
    return () => {
      window.removeEventListener('syndik-operation-feedback', feedback);
      timers.forEach(clearTimeout);
    };
  }, [isAr, showToast]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const confirmAction = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setConfirmState({
        isOpen: true,
        options,
        resolve,
      });
    });
  }, []);

  const handleConfirmClose = (result: boolean) => {
    if (confirmState.resolve) {
      confirmState.resolve(result);
    }
    setConfirmState((prev) => ({ ...prev, isOpen: false, resolve: null }));
  };

  return (
    <ToastContext.Provider value={{ showToast, confirmAction }}>
      {children}

      {/* Floating Toast Container */}
      <div
        aria-live="polite"
        className="fixed top-4 end-4 z-[100] flex flex-col gap-2.5 w-[calc(100%-2rem)] max-w-sm pointer-events-none"
      >
        {toasts.map((toast) => {
          const styles: Record<ToastType, { bg: string; border: string; text: string; badge: string }> = {
            success: {
              bg: 'bg-emerald-950/95 text-white',
              border: 'border-emerald-700',
              text: 'text-emerald-100',
              badge: '✓',
            },
            error: {
              bg: 'bg-rose-950/95 text-white',
              border: 'border-rose-700',
              text: 'text-rose-100',
              badge: '!',
            },
            warning: {
              bg: 'bg-amber-950/95 text-white',
              border: 'border-amber-700',
              text: 'text-amber-100',
              badge: '⚠',
            },
            info: {
              bg: 'bg-slate-900/95 text-white',
              border: 'border-slate-700',
              text: 'text-slate-200',
              badge: 'i',
            },
          };
          const st = styles[toast.type];

          return (
            <div
              key={toast.id}
              role={toast.type === 'error' ? 'alert' : 'status'}
              className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-xs transition-all ${st.bg} ${st.border}`}
            >
              <span className="w-5 h-5 rounded-md bg-white/15 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                {st.badge}
              </span>
              <div className="flex-1 min-w-0">
                {toast.title && <p className="text-xs font-bold text-white mb-0.5">{toast.title}</p>}
                <p className={`text-sm leading-relaxed whitespace-pre-line ${st.text}`}>{toast.message}</p>
              </div>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="text-white/60 hover:text-white text-xs px-1.5 py-0.5 rounded"
                aria-label={tr('Fermer le message', 'إغلاق الرسالة')}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* Accessible Confirmation Dialog */}
      {confirmState.isOpen && (
        <Modal
          isOpen={confirmState.isOpen}
          onClose={() => handleConfirmClose(false)}
          title={confirmState.options.title}
          footer={
            <>
              <Button variant="secondary" onClick={() => handleConfirmClose(false)}>
                {confirmState.options.cancelLabel || tr('Annuler', 'إلغاء')}
              </Button>
              <Button
                variant={confirmState.options.variant === 'danger' ? 'danger' : 'primary'}
                onClick={() => handleConfirmClose(true)}
              >
                {confirmState.options.confirmLabel || tr('Confirmer', 'تأكيد')}
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-700 leading-relaxed">{confirmState.options.message}</p>
        </Modal>
      )}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      showToast: (msg: string) => console.info('[Toast]', msg),
      confirmAction: async (opts: ConfirmOptions) => window.confirm(opts.message),
    };
  }
  return ctx;
};
