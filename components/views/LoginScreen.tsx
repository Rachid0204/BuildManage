import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import type { Syndic, UserRole, UserProfile } from '../../types';
import Card from '../common/Card';
import Button from '../common/Button';
import Modal from '../common/Modal';
import { useI18n } from '../../hooks/useI18n';
import { useAuth, getHomeRouteForRole } from '../../contexts/AuthContext';
import { getSyndics } from '../../firebase/services';
import { BuildingsIcon } from '../icons/IconComponents';

interface LoginScreenProps {
  syndics?: Syndic[];
  onLogin?: (syndic: Syndic) => void;
  onBack?: () => void;
}

interface GeneratedAccountItem {
  residentId: string;
  name: string;
  email: string;
  cin?: string;
  password: string;
  isOwner: boolean;
  buildingName: string;
  apartmentNumber?: string;
}

const LoginScreen: React.FC<LoginScreenProps> = ({ onBack }) => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const { loginWithEmail, loginWithGoogle, register } = useAuth();

  const [isRegistering, setIsRegistering] = useState(false);
  const [identifier, setIdentifier] = useState('contact@syndicpro.ma');
  const [password, setPassword] = useState('password123');
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');
  const [cin, setCin] = useState('');
  const [role, setRole] = useState<UserRole>('syndic');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Forgot password modal
  const [isForgotOpen, setIsForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);

  // Generated resident accounts for 1-click verification
  const [generatedAccounts, setGeneratedAccounts] = useState<GeneratedAccountItem[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadGeneratedAccounts = async () => {
      try {
        const syndics = await getSyndics();
        const items: GeneratedAccountItem[] = [];
        const seenEmails = new Set<string>();

        for (const s of syndics) {
          for (const b of s.buildings) {
            for (const r of b.residents) {
              if (r.hasAccount && r.generatedPassword) {
                const apt = b.apartments.find(
                  (a) =>
                    a.id === r.apartmentId ||
                    a.ownerId === r.id ||
                    a.tenantId === r.id
                );
                items.push({
                  residentId: r.id,
                  name: r.name,
                  email: r.email,
                  cin: r.cin,
                  password: r.generatedPassword,
                  isOwner: r.isOwner,
                  buildingName: b.name,
                  apartmentNumber: apt?.number,
                });
                seenEmails.add(r.email.toLowerCase());
              }
            }
          }
        }

        const rawSaved = localStorage.getItem('syndik_resident_accounts_v1');
        if (rawSaved) {
          const parsed = JSON.parse(rawSaved) as Array<{
            residentId: string;
            name: string;
            email: string;
            password: string;
            isOwner?: boolean;
            buildingId: string;
            apartmentId?: string;
          }>;
          for (const acc of parsed) {
            if (!seenEmails.has(acc.email.toLowerCase())) {
              items.push({
                residentId: acc.residentId,
                name: acc.name,
                email: acc.email,
                password: acc.password,
                isOwner: acc.isOwner ?? true,
                buildingName: 'Résidence Gérée',
              });
              seenEmails.add(acc.email.toLowerCase());
            }
          }
        }

        if (mounted) {
          setGeneratedAccounts(items);
        }
      } catch {
        // ignore
      }
    };
    loadGeneratedAccounts();
    return () => {
      mounted = false;
    };
  }, []);

  const redirectUserToCorrectPage = (profile: UserProfile) => {
    const defaultTarget = getHomeRouteForRole(profile.role);
    const requestedFrom = (location.state as any)?.from?.pathname;

    // Only honor deep-link `from` if user is a syndic and the route belongs to syndic workspace
    if (
      profile.role === 'syndic' &&
      requestedFrom &&
      requestedFrom !== '/login' &&
      requestedFrom !== '/welcome' &&
      !requestedFrom.startsWith('/admin') &&
      !requestedFrom.startsWith('/resident') &&
      !requestedFrom.startsWith('/provider')
    ) {
      navigate(requestedFrom, { replace: true });
      return;
    }

    navigate(defaultTarget, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      let profile: UserProfile;
      if (isRegistering) {
        profile = await register(identifier, password, name, role, {
          phone,
          cin,
          companyName,
        });
      } else {
        profile = await loginWithEmail(identifier, password);
      }
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Échec de la connexion. Vérifiez vos identifiants.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickDemoLogin = async (demoEmail: string, pass = 'password123') => {
    setLoading(true);
    setError('');
    setIdentifier(demoEmail);
    setPassword(pass);
    try {
      const profile = await loginWithEmail(demoEmail, pass);
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      setError(err.message || 'Connexion démo échouée');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      const profile = await loginWithGoogle();
      redirectUserToCorrectPage(profile);
    } catch (err: any) {
      setError(err.message || 'Connexion Google échouée');
    } finally {
      setLoading(false);
    }
  };

  const handleReturnToPublicSite = () => {
    if (onBack) onBack();
    navigate('/welcome');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-lg w-full space-y-5">
        {/* Brand Header */}
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-teal-700 text-white shadow-sm mb-2.5">
            <BuildingsIcon />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
            Syndik
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase font-semibold tracking-wider">
            Plateforme Marocaine de Gestion de Copropriété (Loi 18-00 &amp; 106-12)
          </p>
        </div>

        {/* Role-Based 1-Click Demo Access */}
        <div className="bg-white border border-teal-100 rounded-xl p-4 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-teal-900 uppercase tracking-wider">
              Accès Démo Immédiat par Profil &amp; Redirection Automatique
            </p>
            <span className="text-[10px] font-mono bg-teal-50 text-teal-700 px-2 py-0.5 rounded border border-teal-200">
              5 Rôles Métiers
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemoLogin('contact@syndicpro.ma')}
              className="p-2.5 bg-teal-50 hover:bg-teal-100 text-teal-900 rounded-lg text-start transition-colors border border-teal-200 flex flex-col justify-between"
            >
              <span className="font-bold flex items-center justify-between">
                <span>🏢 Syndic Pro</span>
                <span className="text-[10px] text-teal-600 font-mono">→ /</span>
              </span>
              <span className="text-[10px] text-teal-700 mt-1 truncate">
                Cabinet SyndicPro Maroc
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemoLogin('fatima.zahra@email.com')}
              className="p-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 rounded-lg text-start transition-colors border border-indigo-200 flex flex-col justify-between"
            >
              <span className="font-bold flex items-center justify-between">
                <span>🔑 Copropriétaire</span>
                <span className="text-[10px] text-indigo-600 font-mono">→ /resident</span>
              </span>
              <span className="text-[10px] text-indigo-700 mt-1 truncate">
                Fatima Zahra • Lot A-102
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemoLogin('youssef.benali@email.com')}
              className="p-2.5 bg-sky-50 hover:bg-sky-100 text-sky-900 rounded-lg text-start transition-colors border border-sky-200 flex flex-col justify-between"
            >
              <span className="font-bold flex items-center justify-between">
                <span>🏠 Locataire</span>
                <span className="text-[10px] text-sky-600 font-mono">→ /resident</span>
              </span>
              <span className="text-[10px] text-sky-700 mt-1 truncate">
                Youssef Benali • Lot A-102
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemoLogin('provider@syndik.ma')}
              className="p-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 rounded-lg text-start transition-colors border border-amber-200 flex flex-col justify-between"
            >
              <span className="font-bold flex items-center justify-between">
                <span>🛠️ Prestataire</span>
                <span className="text-[10px] text-amber-700 font-mono">→ /provider</span>
              </span>
              <span className="text-[10px] text-amber-800 mt-1 truncate">
                Artisan / Ascenseurs
              </span>
            </button>

            <button
              type="button"
              disabled={loading}
              onClick={() => handleQuickDemoLogin('admin@syndik.ma')}
              className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-lg text-start transition-colors border border-slate-300 flex flex-col justify-between sm:col-span-2"
            >
              <span className="font-bold flex items-center justify-between">
                <span>🛡️ Super Admin SaaS</span>
                <span className="text-[10px] text-slate-600 font-mono">→ /admin</span>
              </span>
              <span className="text-[10px] text-slate-600 mt-1 truncate">
                Supervision Nationale des Cabinets Syndics &amp; Abonnements
              </span>
            </button>
          </div>

          {/* Generated Resident Credentials Quick Access */}
          {generatedAccounts.length > 0 && (
            <div className="pt-2.5 border-t border-slate-100">
              <p className="text-[11px] font-bold text-emerald-900 uppercase tracking-wider mb-1.5">
                🔑 Comptes Résidents Générés par le Syndic ({generatedAccounts.length})
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {generatedAccounts.map((acc) => (
                  <div
                    key={acc.residentId}
                    className="flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50/70 border border-emerald-200 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900 truncate">
                        {acc.name}{' '}
                        <span className="text-[10px] font-normal text-slate-500">
                          ({acc.isOwner ? 'Copropriétaire' : 'Locataire'}
                          {acc.apartmentNumber ? ` • Lot ${acc.apartmentNumber}` : ''})
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-slate-600 truncate">
                        {acc.email} · MDP:{' '}
                        <span className="font-bold text-emerald-800">{acc.password}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleQuickDemoLogin(acc.email, acc.password)}
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] shrink-0"
                    >
                      Connecter →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Main Auth Card */}
        <Card className="p-6 border border-slate-200">
          <div className="flex rounded-xl bg-slate-100 p-1 mb-5">
            <button
              type="button"
              onClick={() => {
                setIsRegistering(false);
                setError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                !isRegistering
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Connexion à mon espace
            </button>
            <button
              type="button"
              onClick={() => {
                setIsRegistering(true);
                setError('');
              }}
              className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${
                isRegistering
                  ? 'bg-white text-slate-900 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Créer un compte Syndik
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {isRegistering && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Profil utilisateur *
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white font-medium text-slate-900"
                    value={role}
                    onChange={(e) => setRole(e.target.value as UserRole)}
                  >
                    <option value="syndic">
                      🏢 Syndic de Copropriété (Professionnel ou Bénévole)
                    </option>
                    <option value="resident">
                      🏠 Copropriétaire / Résident d&apos;immeuble
                    </option>
                    <option value="provider">
                      🛠️ Prestataire Technique Agréé
                    </option>
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nom complet *
                    </label>
                    <input
                      type="text"
                      required
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ex: Karim Tazi"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Téléphone GSM (Maroc)
                    </label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="06 61 23 45 67"
                    />
                  </div>
                </div>

                {role === 'syndic' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Nom du Cabinet ou Syndicat des Copropriétaires
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Ex: Cabinet Atlas Gestion Immobilier"
                    />
                  </div>
                )}

                {role === 'resident' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Numéro CIN (Carte Nationale d&apos;Identité)
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm uppercase font-mono focus:ring-1 focus:ring-teal-500"
                      value={cin}
                      onChange={(e) => setCin(e.target.value.toUpperCase())}
                      placeholder="Ex: BK124578"
                    />
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {isRegistering
                  ? 'Adresse e-mail professionnelle ou personnelle *'
                  : 'Adresse e-mail ou N° CIN (pour les résidents) *'}
              </label>
              <input
                type={isRegistering ? 'email' : 'text'}
                required
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder={
                  isRegistering
                    ? 'votre.email@domaine.ma'
                    : 'Ex: contact@syndicpro.ma ou CIN BK124578'
                }
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700">
                  Mot de passe *
                </label>
                {!isRegistering && (
                  <button
                    type="button"
                    onClick={() => {
                      setForgotEmail(identifier.includes('@') ? identifier : '');
                      setForgotSent(false);
                      setIsForgotOpen(true);
                    }}
                    className="text-[11px] font-semibold text-teal-700 hover:text-teal-900"
                  >
                    Mot de passe oublié ?
                  </button>
                )}
              </div>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full px-3 py-2 pe-16 border border-slate-300 rounded-lg text-sm focus:ring-1 focus:ring-teal-500 font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3 text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  {showPassword ? 'Masquer' : 'Afficher'}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
                {error}
              </div>
            )}

            <Button
              type="submit"
              className="w-full justify-center py-2.5 text-sm font-bold"
              disabled={loading}
            >
              {loading
                ? 'Authentification et redirection...'
                : isRegistering
                ? 'Créer mon compte et accéder à mon espace'
                : 'Se connecter'}
            </Button>
          </form>

          <div className="mt-4">
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 border border-slate-300 rounded-lg bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition-colors"
            >
              <span>🌐</span>
              <span>Continuer avec Google Workspace (Syndic)</span>
            </button>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={handleReturnToPublicSite}
              className="text-xs font-medium text-slate-500 hover:text-slate-900"
            >
              ← Retour à la page d&apos;accueil publique
            </button>
          </div>
        </Card>
      </div>

      {/* Password Recovery Modal */}
      <Modal
        isOpen={isForgotOpen}
        onClose={() => setIsForgotOpen(false)}
        title="Réinitialisation du mot de passe"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsForgotOpen(false)}>
              Fermer
            </Button>
            {!forgotSent && (
              <Button
                onClick={() => {
                  if (!forgotEmail.trim()) return;
                  setForgotSent(true);
                }}
              >
                Envoyer les instructions
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-3 text-xs sm:text-sm text-slate-700">
          {forgotSent ? (
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-2">
              <p className="font-bold">✓ Instructions envoyées</p>
              <p className="text-xs">
                Si un compte correspond à <strong>{forgotEmail}</strong>, un lien de réinitialisation a été envoyé.
              </p>
              <p className="text-xs text-emerald-800 pt-1 border-t border-emerald-200">
                <strong>Note Copropriétaires / Locataires :</strong> Votre Syndic peut également régénérer votre mot de passe temporaire en 1 clic depuis son module <em>Résidents → Générer Accès</em>.
              </p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-600">
                Saisissez votre adresse e-mail ou numéro CIN. Si vous êtes résident d&apos;un immeuble géré, votre Syndic peut aussi vous transmettre votre fiche d&apos;accès sur WhatsApp.
              </p>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Adresse e-mail ou N° CIN
                </label>
                <input
                  type="text"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="Ex: ahmed.alami@email.com ou BE458921"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm"
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default LoginScreen;