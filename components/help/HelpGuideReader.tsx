import React from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  HelpCircle,
  Lightbulb,
  Scale,
} from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import { GUIDE_ROLES } from '../../data/userGuides/index';
import type { UserGuideArticle } from '../../data/userGuides/types';
import GuideScreenshotCard from './ScreenshotLightbox';

interface HelpGuideReaderProps {
  article: UserGuideArticle;
  previousArticle?: UserGuideArticle;
  nextArticle?: UserGuideArticle;
  onSelectArticle?: (articleId: string) => void;
  compact?: boolean;
}

export const HelpGuideReader: React.FC<HelpGuideReaderProps> = ({
  article,
  previousArticle,
  nextArticle,
  onSelectArticle,
  compact = false,
}) => {
  const { language, tr } = useI18n();
  const isAr = language === 'ar';
  const roleMeta = GUIDE_ROLES.find((r) => r.id === article.role);

  const title = isAr ? article.titleAr : article.titleFr;
  const category = isAr ? article.categoryAr : article.categoryFr;
  const summary = isAr ? article.summaryAr : article.summaryFr;
  const prerequisites = isAr
    ? article.prerequisitesAr || article.prerequisitesFr
    : article.prerequisitesFr;
  const legalNote = isAr
    ? article.legalNoteAr || article.legalNoteFr
    : article.legalNoteFr;

  return (
    <article className="space-y-5">
      {/* Article Header */}
      <header className="space-y-2.5 pb-4 border-b border-slate-200">
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold">
          {roleMeta && (
            <span
              className={`px-2.5 py-0.5 rounded-full border ${roleMeta.badgeClass}`}
            >
              {isAr ? roleMeta.labelAr : roleMeta.labelFr}
            </span>
          )}
          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
            {category}
          </span>
          <span className="inline-flex items-center gap-1 text-slate-500 font-semibold">
            <Clock className="w-3.5 h-3.5" />
            ~{article.estimatedMinutes} min
          </span>
        </div>

        <h2
          className={`${
            compact ? 'text-lg sm:text-xl' : 'text-xl sm:text-2xl'
          } font-extrabold text-slate-900 leading-snug`}
        >
          {title}
        </h2>
        <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
          {summary}
        </p>
      </header>

      {/* Prerequisites */}
      {prerequisites && prerequisites.length > 0 && (
        <section className="rounded-xl bg-sky-50/80 border border-sky-200 p-3.5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-900">
            <CheckCircle2 className="w-4 h-4 text-sky-700" />
            <span>{tr('Prérequis avant de commencer', 'المتطلبات قبل البدء')}</span>
          </div>
          <ul className="space-y-1 text-xs text-sky-950 ps-5 list-disc">
            {prerequisites.map((pre, i) => (
              <li key={i}>{pre}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Numbered Step Cards */}
      <ol className="space-y-4">
        {article.steps.map((step, idx) => {
          const stepTitle = isAr ? step.titleAr : step.titleFr;
          const stepBody = isAr ? step.bodyAr : step.bodyFr;
          const stepTip = isAr ? step.tipAr || step.tipFr : step.tipFr;

          return (
            <li
              key={idx}
              className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 shadow-2xs space-y-2.5"
            >
              <div className="flex items-start gap-3">
                <span className="w-7 h-7 rounded-full bg-teal-700 text-white font-mono font-extrabold text-xs flex items-center justify-center shrink-0 mt-0.5">
                  {idx + 1}
                </span>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {stepTitle}
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
                    {stepBody}
                  </p>
                </div>
              </div>

              {stepTip && (
                <div className="flex items-start gap-2 rounded-xl bg-teal-50 border border-teal-200 px-3.5 py-2.5 text-xs text-teal-950">
                  <Lightbulb className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">
                      {tr('Astuce : ', 'نصيحة: ')}
                    </span>
                    {stepTip}
                  </div>
                </div>
              )}

              {step.screenshot && (
                <GuideScreenshotCard screenshot={step.screenshot} />
              )}
            </li>
          );
        })}
      </ol>

      {/* Moroccan Legal / Compliance Note */}
      {legalNote && (
        <aside className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 p-4 text-xs text-amber-950 leading-relaxed">
          <Scale className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-amber-900 mb-0.5">
              {tr(
                'Cadre réglementaire marocain de la copropriété',
                'الإطار القانوني المغربي للملكية المشتركة',
              )}
            </div>
            <p>{legalNote}</p>
          </div>
        </aside>
      )}

      {/* FAQ Accordion */}
      {article.faq && article.faq.length > 0 && (
        <section className="space-y-2 pt-2">
          <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-600">
            <HelpCircle className="w-4 h-4 text-teal-700" />
            <span>{tr('Questions fréquentes', 'أسئلة شائعة')}</span>
          </h3>
          <div className="space-y-2">
            {article.faq.map((item, idx) => (
              <details
                key={idx}
                className="group rounded-xl border border-slate-200 bg-slate-50/70 open:bg-white transition-colors"
              >
                <summary className="cursor-pointer px-4 py-3 text-xs sm:text-sm font-bold text-slate-900 list-none flex items-center justify-between gap-2">
                  <span>{isAr ? item.qAr : item.qFr}</span>
                  <span className="text-slate-400 group-open:rotate-180 transition-transform text-xs">
                    ▾
                  </span>
                </summary>
                <div className="px-4 pb-3.5 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100 pt-2.5">
                  {isAr ? item.aAr : item.aFr}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* Prev / Next Navigation */}
      {onSelectArticle && (previousArticle || nextArticle) && (
        <nav
          aria-label={tr('Navigation entre guides', 'التنقل بين الأدلة')}
          className="print:hidden pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3"
        >
          {previousArticle ? (
            <button
              type="button"
              onClick={() => onSelectArticle(previousArticle.id)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 max-w-[48%] text-start"
            >
              <ChevronLeft className="w-4 h-4 shrink-0 rtl:rotate-180" />
              <span className="truncate">
                {isAr ? previousArticle.titleAr : previousArticle.titleFr}
              </span>
            </button>
          ) : (
            <span />
          )}
          {nextArticle && (
            <button
              type="button"
              onClick={() => onSelectArticle(nextArticle.id)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-teal-200 bg-teal-50/70 hover:bg-teal-100 text-xs font-bold text-teal-900 max-w-[48%] text-end"
            >
              <span className="truncate">
                {isAr ? nextArticle.titleAr : nextArticle.titleFr}
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 rtl:rotate-180" />
            </button>
          )}
        </nav>
      )}
    </article>
  );
};

export default HelpGuideReader;
