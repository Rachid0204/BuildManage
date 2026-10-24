import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../hooks/useI18n';
import Button from './common/Button';

/** Only replaces a protected route when no identity has been verified in this document. */
export default function SessionRecovery() {
  const { sessionRetrying, retrySession, resetSession } = useAuth();
  const { tr } = useI18n();
  const navigate = useNavigate();
  return <div className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
    <div role="alert" className="max-w-md rounded-xl border border-amber-300 bg-white p-6 shadow-sm space-y-4">
      <h1 className="text-lg font-bold">{tr('Connexion au serveur interrompue', 'انقطع الاتصال بالخادم')}</h1>
      <p>{tr('Votre session est conservée. La reconnexion est automatique dès que le serveur est disponible.', 'تم الاحتفاظ بجلستك. ستتم إعادة الاتصال تلقائياً عند توفر الخادم.')}</p>
      <div className="flex flex-wrap gap-3">
        <Button disabled={sessionRetrying} onClick={() => void retrySession()}>
          {sessionRetrying ? tr('Reconnexion…', 'جارٍ إعادة الاتصال…') : tr('Réessayer la connexion', 'إعادة محاولة الاتصال')}
        </Button>
        <Button variant="secondary" onClick={() => { resetSession(); navigate('/login', { replace: true }); }}>
          {tr('Se connecter à nouveau', 'تسجيل الدخول من جديد')}
        </Button>
      </div>
      <p className="text-sm text-slate-600">{tr('La nouvelle connexion efface uniquement la session de ce navigateur. Votre compte et vos données sont conservés.', 'يسمح تسجيل الدخول من جديد بمسح جلسة هذا المتصفح فقط. يبقى حسابك وبياناتك محفوظين.')}</p>
    </div>
  </div>;
}
