import React, { useEffect, useMemo, useState } from 'react';
import { BookOpen, ExternalLink, Search, X } from 'lucide-react';
import { useI18n } from '../../hooks/useI18n';
import {
  getGuidesByRole,
  resolveContextualGuides,
  searchGuides,
} from '../../data/userGuides/index';
import type { GuideRole } from '../../data/userGuides/types';
import HelpGuideReader from './HelpGuideReader';

interface HelpDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  role: GuideRole;
  contextKey?: string;
  initialArticleId?: string;
  onOpenFullCenter?: (articleId?: string) => void;
}

const HelpDrawer: React.FC<HelpDrawerProps> = ({
  isOpen,
  onClose,
  role,
  contextKey,
  initialArticleId,
  onOpenFullCenter,
}) => {
  const { language, tr } = useI18n();
  const isAr = language === 'ar';

  const roleGuides = useMemo(() => getGuidesByRole(role), [role]);
  const contextualGuides = useMemo(
    () => resolveContextualGuides(role, contextKey),
    [role, contextKey],
  );

  const [mode, setMode] = useState<'context' | 'browse'>('context');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(
    initialArticleId || contextualGuides[0]?.id || roleGuides[0]?.id || '',
  );

  useEffect(() => {
    if (!isOpen) return;
    setMode('context');
    setSearchQuery('');
    if (initialArticleId && roleGuides.some((g) => g.id === initialArticleId)) {
      setSelectedId(initialArticleId);
    } else if (contextualGuides[0]) {
      setSelectedId(contextualGuides[0].id);
    }
  }, [isOpen, contextKey, initialArticleId, contextualGuides, roleGuides]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const filteredGuides = useMemo(
    () => searchGuides(searchQuery, role),
    [searchQuery, role],
  );

  const activeArticle =
    roleGuides.find((g) => g.id === selectedId) ||
    contextualGuides[0] ||
    roleGuides[0];

  const activeIdx = roleGuides.findIndex((g) => g.id === activeArticle?.id);
  const previousArticle = activeIdx > 0 ? roleGuides[activeIdx - 1] : undefined;
  const nextArticle =
    activeIdx >= 0 && activeIdx < roleGuides.length - 1
      ? roleGuides[activeIdx + 1]
      : undefined;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-[1px]"
      dir={isAr ? 'rtl' : 'ltr'}
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={tr('Guide pas à pas', 'دليل الاستخدام خطوة بخطوة')}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl h-full bg-slate-50 shadow-2xl border-s border-slate-200 flex flex-col overflow-hidden"
      >
        {/* Top Drawer Bar */}
        <div className="bg-slate-900 text-white px-5 py-4 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-extrabold truncate">
                {tr('Guide d’utilisation pas à pas', 'دليل الاستخدام خطوة بخطوة')}
              </div>
              <div className="text-[11px] text-slate-300 truncate">
                {tr(
                  'Aide contextuelle avec captures d’écran',
                  'مساعدة فورية بالصور حسب الشاشة الحالية',
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onOpenFullCenter && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullCenter(activeArticle?.id);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold border border-slate-700"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">
                  {tr('Centre d’aide', 'مركز المساعدة')}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label={tr('Fermer le guide', 'إغلاق الدليل')}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Mode Switcher + Contextual Pills */}
        <div className="bg-white border-b border-slate-200 px-5 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMode('context')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                mode === 'context'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tr('Guide de cet écran', 'دليل هذه الشاشة')}
            </button>
            <button
              type="button"
              onClick={() => setMode('browse')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                mode === 'browse'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {tr(`Tous les guides (${roleGuides.length})`, `كل الأدلة (${roleGuides.length})`)}
            </button>
          </div>

          {mode === 'context' && contextualGuides.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {contextualGuides.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setSelectedId(g.id)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                    activeArticle?.id === g.id
                      ? 'bg-teal-50 border-teal-500 text-teal-900'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {(isAr ? g.titleAr : g.titleFr).split('—')[0].slice(0, 36)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Drawer Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {mode === 'browse' ? (
            <div className="space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3.5" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={tr(
                    'Rechercher un module, une action (ex. CMI, RIB, AG, quittance)...',
                    'ابحث عن وحدة أو إجراء (مثل: CMI، RIB، الجمع العام، توصيل)...',
                  )}
                  className="w-full ps-10 pe-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {filteredGuides.length === 0 ? (
                <div className="py-10 text-center text-xs text-slate-500">
                  {tr(
                    'Aucun guide ne correspond à votre recherche.',
                    'لم يتم العثور على دليل مطابق لبحثك.',
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredGuides.map((guide) => (
                    <button
                      key={guide.id}
                      type="button"
                      onClick={() => {
                        setSelectedId(guide.id);
                        setMode('context');
                      }}
                      className={`w-full text-start p-3.5 rounded-xl border transition-colors ${
                        activeArticle?.id === guide.id
                          ? 'bg-teal-50/70 border-teal-400'
                          : 'bg-white border-slate-200 hover:border-teal-300'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-teal-800">
                        <span>
                          {isAr ? guide.categoryAr : guide.categoryFr}
                        </span>
                        <span className="text-slate-400 font-mono">
                          ~{guide.estimatedMinutes} min
                        </span>
                      </div>
                      <div className="font-bold text-slate-900 text-sm mt-0.5">
                        {isAr ? guide.titleAr : guide.titleFr}
                      </div>
                      <div className="text-xs text-slate-600 mt-0.5 line-clamp-2">
                        {isAr ? guide.summaryAr : guide.summaryFr}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : activeArticle ? (
            <HelpGuideReader
              article={activeArticle}
              previousArticle={previousArticle}
              nextArticle={nextArticle}
              onSelectArticle={(id) => setSelectedId(id)}
              compact
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
};

export default HelpDrawer;
