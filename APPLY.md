# Guide d'Application & Vérification des Correctifs d'Audit (`BuildManage` / `ImmoGest`)

Tous les **30 correctifs de l'audit technique (P0, P1, P2)** ont été directement appliqués et vérifiés dans ce dépôt.

---

## 1. Commandes de Vérification (Release Gates)

Exécutez les commandes suivantes à la racine du projet (Windows PowerShell / CMD / macOS / Linux) :

```bash
# 1. Installation déterministe à partir du lockfile unique (package-lock.json)
npm ci

# 2. Vérification stricte TypeScript (Frontend + Cloud Functions)
npm run typecheck

# 3. Audit statique des règles de sécurité Firestore
npm run lint

# 4. Suite de tests de non-régression (Sécurité, Comptabilité au centime, Quittances, AG, Isolation)
npm run test:verify

# 5. Compilation des Cloud Functions Firebase (Node 20)
npm run build:functions

# 6. Build de production Frontend (Vite)
npm run build
```

---

## 2. Configuration `.env.local` & GitHub Actions Secrets

Copiez `.env.example` vers `.env.local` :

```bash
cp .env.example .env.local
```

Valeurs configurées pour votre projet Firebase (`immogest-7faaf`) :

```env
VITE_FIREBASE_API_KEY=AIzaSyC9RcLD9nFizqRXKdPr6ubFlSDqS4pXF6s
VITE_FIREBASE_AUTH_DOMAIN=immogest-7faaf.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=immogest-7faaf
VITE_FIREBASE_STORAGE_BUCKET=immogest-7faaf.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=174234637104
VITE_FIREBASE_APP_ID=1:174234637104:web:9611f6009cb754d7222ef5
VITE_FIREBASE_MEASUREMENT_ID=G-TF6SCSL1X0
VITE_FIRESTORE_DATABASE_ID=ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3
FIRESTORE_DATABASE_ID=ai-studio-immogest-6d16b790-183d-49fd-9d4f-086d99dc2be3
```
