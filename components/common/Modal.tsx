import React, { useEffect, useId, useRef } from 'react';
import { useI18n } from '../../hooks/useI18n';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidthClass?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidthClass = 'max-w-lg',
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const { tr } = useI18n();

  useEffect(() => {
    if (!isOpen) return;

    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusTimer = window.setTimeout(() => {
      const container = modalRef.current;
      if (!container) return;
      const focusable = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusable.length > 0) {
        focusable[0].focus();
      } else {
        container.focus();
      }
    }, 10);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key === 'Tab') {
        const container = modalRef.current;
        if (!container) return;
        const focusable = Array.from(
          container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null);

        if (focusable.length === 0) {
          event.preventDefault();
          container.focus();
          return;
        }

        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        const activeEl = document.activeElement as HTMLElement | null;

        if (event.shiftKey) {
          if (!activeEl || activeEl === firstEl || !container.contains(activeEl)) {
            event.preventDefault();
            lastEl.focus();
          }
        } else {
          if (!activeEl || activeEl === lastEl || !container.contains(activeEl)) {
            event.preventDefault();
            firstEl.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      if (
        previousActiveElementRef.current &&
        typeof previousActiveElementRef.current.focus === 'function'
      ) {
        previousActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/50 backdrop-blur-[1px] z-50 flex justify-center items-center p-4 transition-opacity"
      aria-labelledby={titleId}
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        ref={modalRef}
        className={`bg-white rounded-lg border border-slate-200 shadow-xl w-full ${maxWidthClass} max-h-[90vh] flex flex-col overflow-hidden focus:outline-none`}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-slate-200 bg-slate-50/60">
          <h3 id={titleId} className="text-base font-bold text-slate-900 tracking-tight">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 p-1 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500"
            aria-label={tr('Fermer la boîte de dialogue', 'إغلاق النافذة')}
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto text-sm text-slate-700">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex justify-end items-center px-6 py-3.5 bg-slate-50 border-t border-slate-200 gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;