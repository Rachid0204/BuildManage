import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../hooks/useI18n';

interface InfoTipProps {
  children: React.ReactNode;
  label?: string;
  className?: string;
}

const InfoTip: React.FC<InfoTipProps> = ({ children, label, className = '' }) => {
  const { tr } = useI18n();
  const tipId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const [coords, setCoords] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 8,
    width: 260,
  });

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn || typeof window === 'undefined') return;
    const rect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const width = Math.min(280, Math.max(180, vw - 16));
    const centeredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.max(8, Math.min(centeredLeft, vw - width - 8));
    const preferBelow = rect.bottom + 96 <= window.innerHeight || rect.top < 110;
    const top = preferBelow ? rect.bottom + 6 : Math.max(8, rect.top - 76);
    setCoords({ top, left, width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !buttonRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      ) {
        setPinned(false);
        setHovered(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPinned(false);
        setHovered(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('touchstart', handlePointerDown, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('touchstart', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [open, updatePosition]);

  return (
    <span className={`inline-flex items-center align-middle ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label || tr('Plus d’informations', 'مزيد من المعلومات')}
        aria-expanded={open}
        aria-describedby={open ? tipId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setPinned((prev) => {
            const next = !prev;
            if (!next) setHovered(false);
            return next;
          });
        }}
        onMouseEnter={() => {
          if (typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches) {
            setHovered(true);
          }
        }}
        onMouseLeave={() => {
          if (typeof window !== 'undefined' && window.matchMedia?.('(hover: hover)').matches) {
            setHovered(false);
          }
        }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-slate-300 bg-white text-slate-500 hover:text-teal-700 hover:border-teal-400 text-[10px] font-bold leading-none transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 shrink-0"
      >
        i
      </button>
      {open && (
        <span
          ref={popRef}
          id={tipId}
          role="tooltip"
          style={{
            position: 'fixed',
            top: `${coords.top}px`,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
          }}
          onClick={(event) => event.stopPropagation()}
          className="z-[70] rounded-lg bg-slate-900 text-white text-[11px] font-normal normal-case tracking-normal leading-relaxed p-2.5 shadow-lg border border-slate-700 text-start"
        >
          {children}
        </span>
      )}
    </span>
  );
};

export default InfoTip;
