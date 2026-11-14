import React from 'react';
import { useI18n } from '../../hooks/useI18n';

interface SkeletonProps {
  className?: string;
}

export const SkeletonBlock: React.FC<SkeletonProps> = ({ className = 'h-4 w-full' }) => (
  <div className={`animate-pulse rounded-md bg-slate-200/80 ${className}`} />
);

export const DashboardSkeleton: React.FC = () => {
  const { tr } = useI18n();
  return (
    <div className="space-y-6" aria-busy="true" aria-label={tr('Chargement des données...', 'جاري تحميل البيانات...')}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <SkeletonBlock className="h-3 w-28" />
            <SkeletonBlock className="h-7 w-36" />
            <SkeletonBlock className="h-2.5 w-20" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <SkeletonBlock className="h-5 w-48" />
          <SkeletonBlock className="h-52 w-full rounded-lg" />
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-3">
          <SkeletonBlock className="h-5 w-40" />
          {[1, 2, 3, 4].map((r) => (
            <SkeletonBlock key={r} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
};

export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden" aria-busy="true">
      <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
        <SkeletonBlock className="h-4 w-40" />
        <SkeletonBlock className="h-8 w-28 rounded-lg" />
      </div>
      <div className="divide-y divide-slate-100 p-4 space-y-3">
        {Array.from({ length: rows }).map((_, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4 py-2">
            <SkeletonBlock className="h-4 w-1/4" />
            <SkeletonBlock className="h-4 w-1/5" />
            <SkeletonBlock className="h-4 w-1/6" />
            <SkeletonBlock className="h-7 w-20 rounded-md" />
          </div>
        ))}
      </div>
    </div>
  );
};
