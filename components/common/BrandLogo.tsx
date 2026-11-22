import React, { useId } from 'react';
import { BRAND_LAW_BADGE, BRAND_NAME } from '../../utils/brand';

export interface BrandLogoProps {
  variant?: 'mark' | 'lockup' | 'stacked';
  theme?: 'light' | 'dark' | 'mono';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showBadge?: boolean;
  badgeText?: string;
  suffix?: string;
  className?: string;
}

const MARK_SIZE_CLASS: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'w-7 h-7',
  sm: 'w-8 h-8',
  md: 'w-9 h-9',
  lg: 'w-14 h-14',
};

const WORDMARK_SIZE_CLASS: Record<NonNullable<BrandLogoProps['size']>, string> = {
  xs: 'text-base',
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-3xl',
};

export const BrandMark: React.FC<{
  size?: BrandLogoProps['size'];
  theme?: BrandLogoProps['theme'];
  className?: string;
}> = ({ size = 'md', theme = 'light', className = '' }) => {
  const uid = useId().replace(/:/g, '');
  const bgId = `su-bg-${uid}`;
  const goldId = `su-gold-${uid}`;
  const rimId = `su-rim-${uid}`;

  const isMono = theme === 'mono';

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      role="img"
      aria-label={BRAND_NAME}
      className={`${MARK_SIZE_CLASS[size]} shrink-0 block ${className}`}
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isMono ? '#1e293b' : '#0f766e'} />
          <stop offset="55%" stopColor={isMono ? '#0f172a' : '#0b5550'} />
          <stop offset="100%" stopColor={isMono ? '#020617' : '#042f2e'} />
        </linearGradient>
        <linearGradient id={goldId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={isMono ? '#e2e8f0' : '#fbbf24'} />
          <stop offset="55%" stopColor={isMono ? '#cbd5e1' : '#f59e0b'} />
          <stop offset="100%" stopColor={isMono ? '#94a3b8' : '#d97706'} />
        </linearGradient>
        <linearGradient id={rimId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#5eead4" stopOpacity={isMono ? '0.18' : '0.34'} />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity={isMono ? '0.12' : '0.22'} />
        </linearGradient>
      </defs>

      <rect width="512" height="512" rx="116" fill={`url(#${bgId})`} />
      <rect
        x="20"
        y="20"
        width="472"
        height="472"
        rx="98"
        fill="none"
        stroke={`url(#${rimId})`}
        strokeWidth="6"
      />
      <path
        d="M158 214 C158 152 198 106 256 76 C314 106 354 152 354 214 L322 214 C322 169 294 134 256 112 C218 134 190 169 190 214 Z"
        fill="#ffffff"
      />
      <rect x="108" y="206" width="84" height="24" rx="8" fill="#ffffff" />
      <rect x="320" y="206" width="84" height="24" rx="8" fill="#ffffff" />
      <rect x="122" y="236" width="58" height="10" rx="5" fill={`url(#${goldId})`} />
      <rect x="332" y="236" width="58" height="10" rx="5" fill={`url(#${goldId})`} />
      <path d="M122 254 H152 V384 H164 V412 H108 V384 H122 Z" fill="#ffffff" />
      <path d="M360 254 H390 V384 H404 V412 H348 V384 H360 Z" fill="#ffffff" />
      <path
        d="M170 254 H202 V328 C202 360 226 384 256 384 C286 384 310 360 310 328 V254 H342 V328 C342 378 304 416 256 416 C208 416 170 378 170 328 Z"
        fill="#ffffff"
      />
      <path
        d="M292 192 C282 178 270 174 256 174 C232 174 216 190 216 214 C216 244 230 262 246 275 C262 288 268 298 268 314 C268 329 263 336 254 336 C244 336 237 332 231 325 L220 340 C230 354 242 358 256 358 C280 358 296 342 296 318 C296 288 282 270 266 257 C250 244 244 234 244 218 C244 203 249 196 258 196 C268 196 275 200 281 207 Z"
        fill={`url(#${goldId})`}
      />
    </svg>
  );
};

const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'lockup',
  theme = 'light',
  size = 'md',
  showBadge = false,
  badgeText = BRAND_LAW_BADGE,
  suffix,
  className = '',
}) => {
  if (variant === 'mark') {
    return <BrandMark size={size} theme={theme} className={className} />;
  }

  const primaryWordClass =
    theme === 'dark' ? 'text-white' : 'text-slate-900';
  const accentLetterClass =
    theme === 'dark'
      ? 'text-amber-400'
      : theme === 'mono'
        ? 'text-slate-700'
        : 'text-amber-600';
  const suffixClass =
    theme === 'dark' ? 'text-teal-300' : 'text-teal-700';

  const wordmark = (
    <span
      dir="ltr"
      className={`font-display font-extrabold tracking-tight leading-none whitespace-nowrap ${WORDMARK_SIZE_CLASS[size]} ${primaryWordClass}`}
    >
      Syndic<span className={accentLetterClass}>U</span>nion
      {suffix ? (
        <span className={`ms-1.5 font-semibold text-[0.72em] ${suffixClass}`}>
          {suffix}
        </span>
      ) : null}
    </span>
  );

  if (variant === 'stacked') {
    return (
      <div className={`inline-flex flex-col items-center gap-2.5 ${className}`}>
        <BrandMark size={size} theme={theme} className="shadow-md rounded-[22%]" />
        {wordmark}
      </div>
    );
  }

  return (
    <div className={`inline-flex items-center gap-2.5 min-w-0 ${className}`}>
      <BrandMark size={size} theme={theme} className="shadow-xs rounded-[22%]" />
      <div className="flex items-center gap-2 min-w-0">
        {wordmark}
        {showBadge && (
          <span
            className={`hidden sm:inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border whitespace-nowrap ${
              theme === 'dark'
                ? 'bg-amber-400/10 text-amber-300 border-amber-400/30'
                : 'bg-amber-50 text-amber-900 border-amber-200'
            }`}
          >
            {badgeText}
          </span>
        )}
      </div>
    </div>
  );
};

export default BrandLogo;
