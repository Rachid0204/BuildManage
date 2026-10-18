import React, { useState } from 'react';
import type { Syndic, UserRole } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import { useI18n } from '../../hooks/useI18n';
import { useAuth } from '../../contexts/AuthContext';
import { BuildingsIcon, ResidentsIcon } from '../icons/IconComponents';

interface LoginScreenProps {
  syndics?: Syndic[];
  onLogin?: (syndic: Syndic) => void;
  onBack?: () => void;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onBack }) => {
  const { t } = useI18n();
  const { loginWithEmail, loginWithGoogle, register } = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('contact@syndicpro.ma');
  const [password, setPassword] = useState('password123');
  const [name, setName] = useState('');
  const [role, setRole] = useState<UserRole>('syndic');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isRegistering) {
        await register(email, password, name, role);
      } else {
        await loginWithEmail(email, password);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Échec de la connexion');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string) => {
    setLoading(true);
    setError('');
    try {
      await loginWithEmail(demoEmail, 'password123');
    } catch (err: any) {
      setError(err.message || 'Connexion démo échouée');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full space-y-6">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-700 text-white shadow-sm mb-3">
            <BuildingsIcon />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Syndik</h1>
          <p className="text-xs text-slate-500 mt-1 uppercase font-semibold tracking-wider">
            Plateforme Marocaine de Gestion de Copropriété (Loi 18-00)
          </p>
        </div>

        {/* Demo Fast Login Pills */}
        <div className="bg-white border border-teal-100 rounded-xl p-3.5 shadow-xs">
          <p className="text-[11px] font-bold text-teal-900 uppercase tracking-wider mb-2 text-center">
            Accès Démo Immédiat en 1 Clic
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('syndic@syndik.ma')}
              className="px-2 py-2 bg-teal-50 hover:bg-teal-100 text-teal-800 font-semibold rounded-lg text-center transition-colors border border-teal-200"
            >
              Syndic Pro
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('resident@syndik.ma')}
              className="px-2 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 font-semibold rounded-lg text-center transition-colors border border-indigo-200"
            >
              Copropriétaire
            </button>
            <button
              type="button"
              onClick={() => handleQuickDemoLogin('admin@syndik.ma')}
              className="px-2 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold rounded-lg text-center transition-colors border border-slate-300"
            >
              Super Admin
            </button>
          </div>
        </div>

        {/* Auth Card */}
        <Card className="p-6 border border-slate-200">
          <h2 className="text-xl font-bold text-slate-900 text-center mb-5">
            {isRegistering ? 'Créer un compte Syndik' : 'Connexion à votre espace'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Nom complet</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Karim Tazi"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Adresse e-mail</label>
              <input
                type="email"
                required
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="votre.email@domaine.ma"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Mot de passe</label>
              <input
                type="password"
                required
                className="w-full px-3 py-2 border border-slate-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {isRegistering && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Je suis un...</label>
                <select
                  className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white"
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                >
                  <option value="syndic">Syndic de Copropriété (Gestionnaire)</option>
                  <option value="resident">Copropriétaire / Résident</option>
                  <option value="provider">Prestataire de Services</option>
                  <option value="admin">Administrateur Système</option>
                </select>
              </div>
            )}

            {error && <p className="text-rose-600 text-xs text-center">{error}</p>}

            <Button type="submit" className="w-full justify-center py-2.5 text-sm" disabled={loading}>
              {loading ? 'Traitement en cours...' : isRegistering ? "S'inscrire" : 'Se connecter'}
            </Button>
          </form>

          <div className="mt-5 text-center">
            <button
              onClick={() => setIsRegistering(!isRegistering)}
              className="text-xs text-teal-700 hover:text-teal-900 font-medium"
            >
              {isRegistering ? 'Déjà un compte ? Se connecter' : "Pas encore de compte ? S'inscrire"}
            </button>
          </div>

          {onBack && (
            <div className="mt-4 pt-3 border-t border-slate-100 text-center">
              <button
                onClick={onBack}
                className="text-xs text-slate-500 hover:text-slate-800"
              >
                ← Retour au site public
              </button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default LoginScreen;