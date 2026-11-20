import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  BookOpen,
  Printer,
  Search,
  Sparkles,
} from 'lucide-react';
import LanguageToggle from '../common/LanguageToggle';
import { useI18n } from '../../hooks/useI18n';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import {
  ALL_USER_GUIDES,
  GUIDE_ROLES,
  getGuideById,
  getGuidesByRole,
  searchGuides,
} from '../../data/userGuides/index';
import type { GuideRole } from '../../data/userGuides/types';
import HelpGuideReader from '../help/HelpGuideReader';

interface HelpCenterProps {
  mode: 'public' | 'portal';
  defaultRole?: GuideRole;
}

const VALID_ROLES = new Set<GuideRole>(['syndic', 'resident', 'provider', 'admin']);

const HelpCenter: React.FC<HelpCenterProps> = ({
  mode,
  defaultRole = 'syndic',
}) => {
  const { language, tr } = useI18n();
  const { currentUser, userProfile } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const isAr = language === 'ar';

  const paramRole = searchParams.get('role') as GuideRole | null;
  const paramArticle = searchParams.get('article');

  const initialRole: GuideRole =
    paramRole && VALID_ROLES.has(paramRole)
      ? paramRole
      : paramArticle && getGuideById(paramArticle)
        ? getGuideById(paramArticle)!.role
        : defaultRole;

  const [selectedRole, setSelectedRole] = useState<GuideRole>(initialRole);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState<string>(
    paramArticle && getGuideById(paramArticle)
      ? paramArticle
      : getGuidesByRole(initialRole)[0]?.id || ALL_USER_GUIDES[0].id,
  );

  useEffect(() => {
    if (paramArticle) {
      const found = getGuideById(paramArticle);
      if (found) {
        setSelectedRole(found.role);
        setSelectedArticleId(found.id);
        return;
      }
    }
    if (paramRole && VALID_ROLES.has(paramRole)) {
      setSelectedRole(paramRole);
      const first = getGuidesByRole(paramRole)[0];
      if (first) setSelectedArticleId(first.id);
    }
  }, [paramArticle, paramRole]);

  const visibleGuides = useMemo(
    () =>
      searchQuery.trim()
        ? searchGuides(
            searchQuery,
            mode === 'public' ? 'all' : selectedRole,
          )
        : getGuidesByRole(selectedRole),
    [searchQuery, selectedRole, mode],
  );

  const activeArticle =
    getGuideById(selectedArticleId) ||
    visibleGuides[0] ||
    getGuidesByRole(selectedRole)[0] ||
    ALL_USER_GUIDES[0];

  const roleGuides = useMemo(
    () => getGuidesByRole(activeArticle.role),
    [activeArticle.role],
  );
  const activeIdx = roleGuides.findIndex((g) => g.id === activeArticle.id);
  const previousArticle = activeIdx > 0 ? roleGuides[activeIdx - 1] : undefined;
  const nextArticle =
    activeIdx >= 0 && activeIdx < roleGuides.length - 1
      ? roleGuides[activeIdx + 1]
      : undefined;

  const groupedGuides = useMemo(() => {
    const groups = new Map<string, typeof visibleGuides>();
    for (const g of visibleGuides) {
      const cat = isAr ? g.categoryAr : g.categoryFr;
      const list = groups.get(cat) || [];
      list.push(g);
      groups.set(cat, list);
    }
    return Array.from(groups.entries());
  }, [visibleGuides, isAr]);

  const handleSelectArticle = (articleId: string) => {
    const found = getGuideById(articleId);
    if (!found) return;
    setSelectedArticleId(found.id);
    setSelectedRole(found.role);
    setSearchParams(
      { role: found.role, article: found.id },
      { replace: true },
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSelectRole = (role: GuideRole) => {
    setSelectedRole(role);
    setSearchQuery('');
    const first = getGuidesByRole(role)[0];
    if (first) {
      setSelectedArticleId(first.id);
      setSearchParams({ role, article: first.id }, { replace: true });
    }
  };

  const quickStartGuides = useMemo(
    () =>
      [
        'syndic-quickstart',
        'syndic-financials-charges',
        'syndic-ag',
        'resident-charges',
        'admin-gateways',
      ]
        .map((id) => getGuideById(id))
        .filter((g): g is NonNullable<typeof g> => Boolean(g)),
    [],
  );

  return (
    <div
      className={mode === 'public' ? 'min-h-screen bg-slate-50' : 'space-y-6'}
      dir={isAr ? 'rtl' : 'ltr'}
    >
      {/* Public Top Navbar */}
      {mode === 'public' && (
        <header className="print:hidden sticky top-0 z-30 bg-slate-950 text-white border-b border-slate-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                onClick={() =>
                  navigate(
                    currentUser && userProfile
                      ? getHomeRouteForRole(userProfile.role)
                      : '/welcome',
                  )
                }
                className="inline-flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white"
              >
                <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                <span className="hidden sm:inline">
                  {currentUser
                    ? tr('Retour à mon portail', 'العودة إلى بوابتك')
                    : tr('Accueil Syndik', 'الرئيسية')}
                </span>
              </button>
              <span className="text-slate-700">|</span>
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center font-bold text-white text-sm shrink-0">
                  S
                </div>
                <span className="font-extrabold text-sm sm:text-base truncate">
                  {tr('Centre d’Aide & Guides Syndik', 'مركز المساعدة وأدلة Syndik')}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => window.print()}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
              >
                <Printer className="w-3.5 h-3.5" />
                {tr('Imprimer / PDF', 'طباعة / PDF')}
              </button>
              <LanguageToggle variant="dark" />
              {!currentUser && (
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  className="px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
                >
                  {tr('Se connecter', 'تسجيل الدخول')}
                </button>
              )}
            </div>
          </div>
        </header>
      )}

      <div
        className={
          mode === 'public'
            ? 'max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6'
            : 'space-y-6'
        }
      >
        {/* Hero / Search Banner */}
        <section className="rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950 text-white p-5 sm:p-7 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-1.5 max-w-2xl">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-teal-500/20 border border-teal-400/30 text-teal-200 text-[11px] font-bold">
                <BookOpen className="w-3.5 h-3.5" />
                {tr(
                  `${ALL_USER_GUIDES.length} guides pas à pas avec captures d’écran`,
                  `${ALL_USER_GUIDES.length} دليلاً خطوة بخطوة بالصور`,
                )}
              </span>
              <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                {tr(
                  'Guide Complet d’Utilisation — Syndik Maroc',
                  'الدليل الشامل لاستخدام منصة Syndik المغرب',
                )}
              </h1>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                {tr(
                  'Apprenez à maîtriser chaque module pas à pas : comptabilité Loi 18-00, Assemblées Générales, portail résidents, prestataires et paiements CMI / Espèces.',
                  'تعلّم استخدام كل وحدة خطوة بخطوة: المحاسبة القانونية 18-00، الجموع العامة، بوابة السكان، مقدمو الخدمات وبوابات الدفع المغربية.',
                )}
              </p>
            </div>
            {mode === 'portal' && (
              <button
                type="button"
                onClick={() => window.print()}
                className="print:hidden inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold border border-white/15"
              >
                <Printer className="w-4 h-4" />
                {tr('Imprimer ce guide', 'طباعة الدليل')}
              </button>
            )}
          </div>

          {/* Search Input */}
          <div className="relative max-w-2xl print:hidden">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-4" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tr(
                'Rechercher un guide (ex. tantièmes, CMI, Wafacash, vote AG, quittance PDF, CSV)...',
                'ابحث عن دليل (مثل: الأنصبة، CMI، وفاكاش، الجمع العام، توصيل PDF)...',
              )}
              aria-label={tr('Rechercher dans les guides', 'البحث في الأدلة')}
              className="w-full ps-11 pe-4 py-3 rounded-xl bg-white text-slate-900 placeholder:text-slate-400 text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>

          {/* Role Switcher Pills */}
          <div className="flex flex-wrap gap-2 print:hidden" role="tablist">
            {GUIDE_ROLES.map((r) => {
              const active = selectedRole === r.id && !searchQuery.trim();
              const count = getGuidesByRole(r.id).length;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => handleSelectRole(r.id)}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors border ${
                    active
                      ? 'bg-teal-600 text-white border-teal-500 shadow-xs'
                      : 'bg-slate-800/80 text-slate-200 border-slate-700 hover:bg-slate-800'
                  }`}
                >
                  {isAr ? r.labelAr : r.labelFr}{' '}
                  <span className="opacity-75 font-mono">({count})</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Quick-Start Shortcuts */}
        {!searchQuery.trim() && (
          <section className="print:hidden flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500 me-1">
              <Sparkles className="w-3.5 h-3.5 text-teal-600" />
              {tr('Guides populaires :', 'أدلة سريعة:')}
            </span>
            {quickStartGuides.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => handleSelectArticle(g.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                  activeArticle.id === g.id
                    ? 'bg-teal-700 text-white border-teal-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-teal-400'
                }`}
              >
                {(isAr ? g.titleAr : g.titleFr).split('(')[0].trim()}
              </button>
            ))}
          </section>
        )}

        {/* Main 2-Column Layout: Sticky TOC + Guide Reader */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Sticky Table of Contents */}
          <aside className="print:hidden lg:col-span-4 lg:sticky lg:top-20 rounded-2xl bg-white border border-slate-200 p-4 space-y-4 shadow-2xs max-h-[calc(100vh-7rem)] overflow-y-auto">
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
              <span>
                {searchQuery.trim()
                  ? tr(
                      `Résultats (${visibleGuides.length})`,
                      `النتائج (${visibleGuides.length})`,
                    )
                  : tr('Sommaire des modules', 'فهرس الوحدات')}
              </span>
            </div>

            {groupedGuides.length === 0 ? (
              <p className="text-xs text-slate-500 py-6 text-center">
                {tr(
                  'Aucun guide ne correspond à cette recherche.',
                  'لا يوجد دليل مطابق لهذا البحث.',
                )}
              </p>
            ) : (
              groupedGuides.map(([category, items]) => (
                <div key={category} className="space-y-1">
                  <div className="px-2 pt-1 text-[11px] font-extrabold uppercase tracking-wider text-teal-800">
                    {category}
                  </div>
                  {items.map((item) => {
                    const selected = activeArticle.id === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectArticle(item.id)}
                        className={`w-full text-start px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                          selected
                            ? 'bg-teal-50 text-teal-950 border border-teal-300 font-bold'
                            : 'text-slate-700 hover:bg-slate-50 border border-transparent'
                        }`}
                      >
                        <div className="leading-snug">
                          {isAr ? item.titleAr : item.titleFr}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </aside>

          {/* Right Reader Panel */}
          <div className="lg:col-span-8 rounded-2xl bg-white border border-slate-200 p-5 sm:p-7 shadow-2xs">
            <HelpGuideReader
              article={activeArticle}
              previousArticle={previousArticle}
              nextArticle={nextArticle}
              onSelectArticle={handleSelectArticle}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpCenter;
