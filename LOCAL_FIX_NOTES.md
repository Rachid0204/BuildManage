# Notes Techniques des Correctifs Appliqués (`LOCAL_FIX_NOTES.md`)

Ce document récapitule l'ensemble des 30 points de l'audit corrigés dans le code source :

## Phase 1 — Sécurité & Isolation Multi-Tenant (P0 : Points 01 à 09)
- **[01 & 03] Authentification, Sessions Signées & Codes d'Invitation** :
  - Hachage systématique des mots de passe et codes d'invitation (`hashPasswordSync` / `verifyPasswordSync` dans `utils/security.ts`).
  - Suppression complète du stockage des mots de passe en clair (`password`, `generatedPassword`) dans `localStorage`, les entités `Resident`/`Prestataire`, et `/api/shared-state`.
  - Signature d'intégrité de la session locale (`createSignedSessionEnvelope` / `verifySignedSessionEnvelope`) empêchant toute élévation de privilèges par modification de `role` ou `syndicId`.
  - Jetons d'invitation à durée limitée (`invitationCode` format `INV-XXXX-MA`, expiration à 7 jours `invitationExpiresAt`) requis pour l'auto-inscription des résidents et prestataires.
- **[02 & 25] Sécurisation de `/api/shared-state` (`server.ts`)** :
  - Authentification obligatoire par en-têtes vérifiés (`x-syndic-uid`, `x-syndic-role`, `x-syndic-id`, `x-building-id`).
  - Filtrage multi-tenant (`filterStateForUser`) sur `GET /api/shared-state` et assainissement (`sanitizeIncomingValue`) sur `PUT /api/shared-state`.
  - Limitation de débit (rate-limiting), limite de taille JSON (`2mb`), et écriture atomique via fichier temporaire.
- **[04 & 05] Règles Firestore & Storage (`firestore.rules`, `storage.rules`)** :
  - Alignement complet des collections et chemins avec le modèle applicatif, validation stricte par schémas (`isValidSyndic`, `isValidUserProfile`, `isValidPrestataire`, `isValidNotification`), et déploiement sur la base `ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3`.
- **[06 & 08] Cloud Functions & CMI (`functions/index.ts`, `components/views/ResidentCharges.tsx`)** :
  - Contrôle RBAC sur `generateMonthlyCharges` et `recordTransaction` (vérification de l'appartenance de l'immeuble au syndic appelant).
  - Suppression des secrets CMI factices (`MOCK_STORE_KEY` / `600000000`) et désactivation par défaut du paiement CB tant que `CMI_ENABLED=true` n'est pas activé côté serveur.
- **[07] Proxy Serveur Gemini IA (`server.ts`, `services/geminiService.ts`)** :
  - La clé `GEMINI_API_KEY` n'est plus jamais injectée dans le bundle client (`vite.config.ts`) ; les annonces IA passent exclusivement par `POST /api/ai/announcement`.
- **[09] Essai Syndic & Quotas d'Immeubles (`contexts/AuthContext.tsx`, `firebase/services.ts`)** :
  - Création automatique d'un cabinet Syndic en essai 30 jours à l'inscription et application stricte des plafonds d'immeubles par forfait (`starter: 1`, `professional: 5`, `enterprise: 999`).

## Phase 2 — Cohérence des Données & Comptabilité Loi 18-00 / 106-12 (P1 : Points 10 à 20)
- **[10 & 11] Unification de l'Identifiant de Base Firestore & Flag Mock** :
  - Alignement de `FIRESTORE_DATABASE_ID` (`ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3`) et flag unique `VITE_USE_MOCK_DATA` entre `firebase/config.ts`, `firebase/services.ts`, `firebase.json` et `functions/index.ts`.
- **[12] Idempotence des Appels de Fonds (`generateMonthlyCharges`)** :
  - Clé déterministe `periodKey` (`YYYY-MM`) empêchant toute double facturation pour un même lot et une même période.
- **[13] Idempotence de Validation des Justificatifs & Paiements Partiels (`reviewPaymentProof`)** :
  - Vérification de l'état `pending`, identifiant de transaction déterministe `trx-proof-${proofId}`, et suivi du cumul payé (`amountPaid`) pour les règlements partiels.
- **[14] Génération de Quittances Sans Double Écriture (`generateQuittanceForCharge`)** :
  - Émission et réédition de quittances en lecture seule vis-à-vis du grand livre (`addTransactionToLedger: false`).
- **[15 & 16] Calculs au Centime & Fonds de Réserve (`utils/security.ts`, `firebase/services.ts`, `components/views/Financials.tsx`)** :
  - Répartition exacte au centime (`allocateBudgetInCents`, `splitReserveFundInCents`) garantissant que la somme des quotes-parts égale 100 % du budget.
  - Utilisation du taux configuré sur l'immeuble (`reserveFundPercentage`, défaut 5 % Loi 106-12) et préservation des soldes à `0 MAD` via `??`.
- **[18 & 19] Tombstones de Suppression & Documents Durables** :
  - Persistance des identifiants supprimés (`syndik_deleted_ids_v1`) pour éviter la réapparition des entités mock supprimées, et encodage Data URL durable pour les archives documentaires (`uploadDocument`).
- **[20] Assemblée Générale & Quorum Loi 18-00 (`castResidentAGVote`)** :
  - Vérification de l'ouverture du scrutin, de la présence/représentation sur la feuille de présence, et calcul du poids de vote à partir des tantièmes officiels du lot.

## Phase 3 — Qualité TypeScript, CI/CD & Documentation (P2 : Points 21 à 30)
- **[21 & 22] Typage & Compilation** : Zéro erreur sur `npm run typecheck`, `npm run lint`, `npm run build:functions`, et `npm run build`.
- **[23, 28, 29, 30] Pipeline CI/CD & Lockfile Unique** : Suppression de `bun.lock`, utilisation de `npm ci` dans `.github/workflows/deploy.yml`, et documentation complète dans `README.md` et `.env.example`.
