import React, { useEffect, useRef } from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, footer }) => {
    const modalRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleKeyDown);
            modalRef.current?.focus();
        }

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
            aria-labelledby="modal-title"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div 
                ref={modalRef}
                className="relative bg-white rounded-t-2xl sm:rounded-xl shadow-2xl transform transition-all w-full sm:max-w-lg max-h-[92vh] sm:max-h-[88vh] flex flex-col outline-none overflow-hidden" 
                onClick={(e) => e.stopPropagation()}
                tabIndex={-1}
            >
                <div className="flex items-center justify-between px-4 py-3.5 sm:px-6 sm:py-4 border-b border-slate-100 shrink-0">
                    <h3 className="text-base sm:text-lg leading-6 font-bold text-slate-900 pe-8" id="modal-title">
                        {title}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label="Close"
                        className="text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-primary-500 rounded-lg p-1.5 min-w-[36px] min-h-[36px] flex items-center justify-center"
                    >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="px-4 py-4 sm:p-6 overflow-y-auto overscroll-contain flex-1">
                    {children}
                </div>

                {footer && (
                    <div className="bg-slate-50 px-4 py-3 sm:px-6 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 shrink-0 pb-safe">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Modal;