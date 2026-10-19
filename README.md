# ImmoGest / Syndik Maroc — Plateforme de Gestion de Copropriété (Loi 18-00 & 106-12)

Application complète de gestion de copropriété adaptée au cadre juridique et comptable marocain (**Loi n° 18-00** modifiée et complétée par la **Loi n° 106-12**), avec support bilingue **Français / Arabe (RTL)**.

---

## 1. Prérequis & Environnement (Windows / macOS / Linux)

- **Node.js** : version `20.x LTS` (ou supérieure compatible)
- **Gestionnaire de paquets** : `npm` (utilisez uniquement `package-lock.json`)
- **Firebase CLI** (optionnel pour les émulateurs et le déploiement) : `npm install -g firebase-tools`

---

## 2. Installation & Démarrage Rapide (Windows PowerShell / CMD / Bash)

```bash
# 1. Installer les dépendances à partir du lockfile
npm ci

# 2. Copier le modèle de variables d'environnement
cp .env.example .env.local
# Sous Windows CMD :
# copy .env.example .env.local

# 3. Lancer le serveur de développement (Express + Vite sur le port 3000)
npm run dev
```

L'application est accessible sur `http://localhost:3000`.

---

## 3. Commandes de Vérification & Qualité (Release Gates)

Toutes ces commandes sont exécutées automatiquement dans le pipeline CI (`.github/workflows/deploy.yml`) :

```bash
# Vérification stricte du typage TypeScript (Frontend + Cloud Functions)
npm run typecheck

# Audit statique des règles de sécurité Firestore
npm run lint

# Exécution de la suite de tests de non-régression (Auth, Finances, Quittances, AG, Isolation)
npm run test:verify

# Compilation des Cloud Functions Firebase
npm run build:functions

# Construction du bundle de production Frontend
npm run build
```

---

## 4. Architecture & Modèle de Données

- **Base de données canonique** : Cloud Firestore (base nommée configurée via `VITE_FIRESTORE_DATABASE_ID` / `FIRESTORE_DATABASE_ID`).
- **Authentification & Rôles** :
  - `admin` : Super-administrateur plateforme.
  - `syndic` : Gestionnaire de cabinet de syndic (essai initial de 30 jours créé côté serveur / inscription, limites d'immeubles par forfait vérifiées).
  - `resident` : Copropriétaire ou locataire rattaché via code d'invitation sécurisé à expiration (`INV-XXXX-MA`).
  - `provider` : Prestataire agréé rattaché à un immeuble.
- **Sécurité & Isolation Multi-Tenant** :
  - Aucune donnée de mot de passe en clair n'est stockée dans `localStorage`, dans les entités métiers ou sur le serveur.
  - Les routes `/api/shared-state` exigent des en-têtes d'authentification vérifiés et filtrent les données par `syndicId` / `buildingId`.
  - La génération d'annonces IA passe exclusivement par le proxy serveur authentifié `POST /api/ai/announcement` (la clé `GEMINI_API_KEY` reste côté serveur).

---

## 5. Règles Comptables & Financières (Loi 18-00 & 106-12)

- **Calculs au centime** : Toutes les répartitions budgétaires aux tantièmes et ventilations entre **Charges Courantes** et **Fonds de Réserve** utilisent des calculs exacts au centime (`utils/security.ts`) garantissant que la somme des quotes-parts égale exactement le budget.
- **Unicité des appels de fonds** : `generateMonthlyCharges` utilise une clé de période déterministe (`YYYY-MM`) empêchant toute double facturation lors d'appels répétés ou concurrents.
- **Validation des justificatifs & Quittances** :
  - `reviewPaymentProof` vérifie l'état `pending` et utilise un identifiant d'écriture déterministe pour empêcher les doubles encaissements et gérer les paiements partiels.
  - `generateQuittanceForCharge` émet ou réédite le reçu officiel en lecture seule pour la comptabilité (`addTransactionToLedger: false`), sans jamais gonfler la trésorerie.
