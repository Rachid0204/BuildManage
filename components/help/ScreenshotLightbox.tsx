import React, { useEffect, useState } from 'react';
import { Maximize2, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import type { GuideScreenshot } from '../../data/userGuides/types';

interface GuideScreenshotCardProps {
  screenshot: GuideScreenshot;
}

export const GuideScreenshotCard: React.FC<GuideScreenshotCardProps> = ({
  screenshot,
}) => {
  const { language, tr } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  const [failed, setFailed] = useState(false);

  const alt = language === 'ar' ? screenshot.altAr : screenshot.altFr;
  const caption =
    language === 'ar'
      ? screenshot.captionAr || screenshot.captionFr
      : screenshot.captionFr || screenshot.captionAr;

  useEffect(() => {
    if (!zoomed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [zoomed]);

  if (failed) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500 text-center">
        {alt}
      </div>
    );
  }

  return (
    <>
      <figure className="mt-3 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden shadow-2xs group">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          className="relative block w-full text-start focus:outline-none focus:ring-2 focus:ring-teal-500"
          aria-label={tr(`Agrandir la capture : ${alt}`, `تكبير الصورة: ${alt}`)}
        >
          <img
            src={screenshot.src}
            alt={alt}
            loading="lazy"
            onError={() => setFailed(true)}
            className="w-full h-auto block bg-white transition-transform duration-200 group-hover:scale-[1.005]"
          />
          <span className="print:hidden absolute bottom-2.5 end-2.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900/80 text-white text-[11px] font-semibold shadow backdrop-blur-xs opacity-90 group-hover:opacity-100">
            <Maximize2 className="w-3.5 h-3.5" />
            {tr('Agrandir', 'تكبير')}
          </span>
        </button>
        {caption && (
          <figcaption className="px-3.5 py-2 text-[11px] text-slate-600 bg-white border-t border-slate-200 leading-relaxed">
            {caption}
          </figcaption>
        )}
      </figure>

      {zoomed && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          onClick={() => setZoomed(false)}
          className="fixed inset-0 z-[90] bg-slate-950/85 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-6xl w-full max-h-[92vh] flex flex-col bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-950 text-white border-b border-slate-800">
              <span className="text-xs sm:text-sm font-semibold truncate">
                {alt}
              </span>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                aria-label={tr('Fermer l’aperçu', 'إغلاق المعاينة')}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-auto p-3 sm:p-4 bg-slate-900 flex-1 flex items-center justify-center">
              <img
                src={screenshot.src}
                alt={alt}
                className="max-w-full max-h-[78vh] w-auto h-auto rounded-lg shadow-lg bg-white"
              />
            </div>
            {caption && (
              <div className="px-4 py-2.5 bg-slate-950 border-t border-slate-800 text-xs text-slate-300">
                {caption}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default GuideScreenshotCard;
