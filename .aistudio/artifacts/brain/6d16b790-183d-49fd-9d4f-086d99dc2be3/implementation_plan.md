# Syndik — B2B Syndic-Centric Authentication & Credential Provisioning Architecture

Replaces public self-registration with a secure, enterprise-grade B2B2C property management authentication model where **Syndics onboard by selecting a subscription plan on the Landing Page**, the **public Login screen is strictly for Sign-In**, and **Residents (`Copropriétaires` / `Locataires`) and Service Providers (`Prestataires Agréés`) receive official login credentials generated and managed exclusively by their Syndic**.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural decisions incorporate your confirmed choices and establish a strict chain of trust across all four roles (`Admin`, `Syndic`, `Résident`, `Prestataire`).

- **Confirmed Decision 1 — Sign-In Only on `/login` & Plan-Driven Syndic Onboarding**:
  - The public `/login` screen is dedicated strictly to **Sign-In** (Authentication) for existing accounts (plus quick Demo Role Sandboxes for testing). Public self-registration tabs for Residents and Prestataires are completely removed.
  - Selecting a subscription tier on the Landing Page (*Essentiel — 200 MAD/mois*, *Pro — 350 MAD/mois*, or *Entreprise — 500 MAD/mois*) launches the dedicated **Syndic Account & Cabinet Registration** flow pre-configured with the chosen plan.
- **Confirmed Decision 2 — Printable PDF Access Sheet & Copyable Credentials Modal**:
  - When the Syndic creates or manages a **Resident** or **Prestataire** from the Syndic Dashboard, the platform generates a unique login email + temporary password (`Syn-XXXX-MA`) and presents a **Fiche d'Accès Officielle** modal with one-click copy and a downloadable, formatted **PDF Access Sheet (Fiche d'Identifiants de Connexion)** ready to print or hand over.
- **Confirmed Decision 3 — Mandatory First-Login Password Update**:
  - Accounts provisioned by the Syndic carry a `mustChangePassword: true` security flag. Upon their very first sign-in, the Resident or Prestataire is prompted by a dedicated security screen to set their personal password before entering their portal.

---

## 1. Overview & Core Concept

- **What It Does**: Establishes the Syndic as the single administrative authority for every building they manage. Only a Syndic can subscribe to a SaaS plan and provision access for the co-owners, tenants, and approved maintenance vendors of their buildings.
- **Target Audience / Persona**:
  - **Syndics Professionnels & Bénévoles**: Subscribe to a plan on the Landing Page, set up their cabinet and first residence, and issue official access credentials to residents and vendors.
  - **Copropriétaires & Locataires**: Sign in using the official credentials issued by their Syndic, customize their password on first login, and access their personal Resident Portal (`/my-portal`).
  - **Prestataires Agréés**: Sign in using the vendor credentials issued by the Syndic, update their password on first login, and manage assigned work orders in the Provider Portal (`/provider`).
- **Key Value**: Eliminates unauthorized self-signups, guarantees every Resident is accurately linked to a verified apartment lot (`tantièmes`) and building, and ensures every Prestataire in the directory is vetted by the Syndic.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Flow A — Syndic Plan Selection & Account Creation (Landing Page $\rightarrow$ Syndic Workspace)**:
   - On the public Landing Page, the visitor reviews the 3 subscription plans (*Essentiel 200 MAD*, *Pro 350 MAD*, *Entreprise 500 MAD*).
   - Clicking **« Choisir ce plan »** navigates to the **Syndic Onboarding Flow** with the selected plan badge, price, and building limit pre-selected.
   - The Syndic enters their full name, cabinet/agency name, professional email, phone, password, and initial residence details (or default setup).
   - Upon submission, the Syndic account and subscription tier are persisted, and the user is redirected straight into the **Syndic Dashboard (`/dashboard`)**.

2. **Flow B — Clean Sign-In Screen (`/login`)**:
   - Displays a streamlined, single-purpose **Connexion à votre espace** interface (French & Arabic RTL support) with email/password authentication and role-aware redirection.
   - Includes a subtle footer link for new property managers (*« Vous êtes un syndic ? Découvrez nos offres et créez votre cabinet »* $\rightarrow$ scrolls to Landing Page pricing tiers).
   - Retains the 1-click Demo Sandbox bar (*Admin*, *Syndic*, *Copropriétaire*, *Prestataire*) for instant evaluation.

3. **Flow C — Resident Account & Credential Provisioning (Syndic Dashboard $\rightarrow$ Résidents)**:
   - In **Résidents & Copropriétaires (`/residents`)**, when the Syndic clicks **« Ajouter un résident »**, the modal includes the toggle **« Générer un compte d'accès Résident (Email + Mot de passe temporaire) »** (enabled by default).
   - Saving the resident creates their directory record, links their apartment lot, registers their login credentials in the authentication store with `mustChangePassword: true`, and immediately opens the **Fiche d'Accès Résident** modal.
   - From this modal (or anytime from the Resident table via **« Identifiants » / « Régénérer »**), the Syndic can:
     - Copy the formatted login summary to clipboard.
     - Download an official **PDF Access Sheet (`Fiche_Acces_Resident.pdf`)** bearing the Syndic's header, building name, apartment number, login URL, email, and temporary password.

4. **Flow D — Prestataire Account & Credential Provisioning (Syndic Dashboard $\rightarrow$ Prestataires)**:
   - In **Annuaire des Prestataires (`/prestataires`)**, the **« Ajouter un prestataire »** modal is upgraded with a matching **« Créer un compte Portail Prestataire & générer les identifiants »** toggle (enabled by default) and status badges in the vendor cards showing whether portal access is active (`Accès Portail Actif` vs `Sans compte`).
   - Saving the provider creates their vendor record, provisions their `/provider` login credentials (`mustChangePassword: true`), and opens the **Fiche d'Accès Prestataire** modal with **Copy Credentials** and **Download Official PDF Access Sheet (`Fiche_Acces_Prestataire.pdf`)**.
   - Existing providers without credentials can have their portal account generated or reset in one click via **« Générer / Réinitialiser l'accès »**.

5. **Flow E — Mandatory First-Login Password Change (Resident & Prestataire)**:
   - When a Resident or Prestataire logs in with a Syndic-generated temporary password (`mustChangePassword === true`), an intercepting **Sécurisation de votre compte (Changement de mot de passe obligatoire)** view prompts them to enter and confirm a new personal password.
   - Once confirmed, `mustChangePassword` is cleared in both their profile and persistent credential store, and they proceed to `/my-portal` or `/provider`.

### Visual Identity & Theme
- **Aesthetic Direction**: Authoritative Moroccan PropTech SaaS — crisp corporate slate surfaces, deep emerald/teal institutional accents (`--primary`: `#0F766E`), and tabular monospace credential blocks.
- **Color Palette & Mood**:
  - **60% Neutral Canvas**: Cool alabaster (`bg-slate-50`) and crisp white (`bg-white`) workspace containers.
  - **30% Structural Surfaces**: Deep slate (`bg-slate-900`) auth side-panel and hairline borders (`border-slate-200`).
  - **10% Accent Budget**: Emerald teal (`bg-teal-600`, `text-teal-700`) for primary CTAs and verified access states; amber (`text-amber-700`) for temporary password notices.
- **Typography & Hierarchy**:
  - Clean geometric headings paired with high-legibility body copy and full Arabic RTL support (`dir="rtl"`).
  - All generated passwords, CIN codes, ICE numbers, and MAD prices use `font-mono tabular-nums` for unmistakable character clarity.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Removing Public Self-Registration for Residents & Vendors**:
  - *Chosen Approach*: Restrict public sign-up exclusively to Syndics subscribing via a pricing plan; all Resident and Prestataire accounts are provisioned inside the Syndic's authenticated workspace.
  - *Why*: Prevents unauthorized users from joining arbitrary buildings, eliminates duplicate/unlinked resident records, and mirrors real-world Moroccan co-ownership governance (Loi 18-00).
  - *Alternatives Considered*: Public registration with Syndic approval queues — rejected because it still exposes the building list publicly and creates unnecessary administrative friction compared to direct credential issuance by the Syndic.

- **Decision 2 — Dual-Format Credential Handover (Copyable Modal + Official Printable PDF)**:
  - *Chosen Approach*: Provide both an instant copyable summary and a formal `jsPDF`-generated **Fiche d'Accès Individuelle** for both Residents and Prestataires.
  - *Why*: In Morocco, Syndics frequently distribute access notices either as printed letters slipped under apartment doors / handed over at General Meetings (AG) or pasted into digital messages.

- **Decision 3 — First-Login Password Enforcement (`mustChangePassword`)**:
  - *Chosen Approach*: Automatically flag Syndic-generated credentials with `mustChangePassword: true` and require the Resident or Prestataire to choose a personal password on first sign-in.
  - *Why*: Ensures privacy so that once the Resident or Prestataire activates their account, their personal password is known only to them, while still allowing the Syndic to issue a fresh temporary password if the user ever forgets theirs.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        PUBLIC MARKETING & AUTH LAYER                       │
│                                                                            │
│  ┌───────────────────────────────┐      ┌───────────────────────────────┐  │
│  │         Landing Page          │      │      Sign-In Screen (/login)  │  │
│  │  • Essentiel (200 MAD/mois)   │─────▶│  • Email + Password Sign-In   │  │
│  │  • Pro (350 MAD/mois)         │ Plan │  • Syndic Plan Onboarding     │  │
│  │  • Entreprise (500 MAD/mois)  │ Flow │    (when ?plan= selected)     │  │
│  └───────────────────────────────┘      └───────────────┬───────────────┘  │
└─────────────────────────────────────────────────────────┼──────────────────┘
                                                          │
                                                          ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   AUTHENTICATION & FIRST-LOGIN SECURITY GATE               │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  AuthContext (Session + Credential Registry + Role Router)           │  │
│  │  • Checks mustChangePassword flag on Resident / Prestataire login    │  │
│  │  • Enforces First-Login Password Update Modal before portal access   │  │
│  └──────────┬───────────────────────────┬───────────────────────┬───────┘  │
└─────────────┼───────────────────────────┼───────────────────────┼──────────┘
              │                           │                       │
              ▼                           ▼                       ▼
┌──────────────────────────┐ ┌─────────────────────────┐ ┌───────────────────┐
│    SYNDIC WORKSPACE      │ │    RESIDENT PORTAL      │ │  PROVIDER PORTAL  │
│      (/dashboard)        │ │      (/my-portal)       │ │    (/provider)    │
│                          │ │                         │ │                   │
│  ┌────────────────────┐  │ │  • Lot & Tantièmes      │ │  • Assigned Work  │
│  │ Residents Module   │  │ │  • Unpaid Charges &     │ │    Orders         │
│  │ • Create Resident  │  │ │    Payment Proofs       │ │  • Status Updates │
│  │ • Generate/Reset   │  │ │  • Official Quittances  │ │    & Tech Notes   │
│  │   Login & PDF Card │  │ │  • AG Digital Voting    │ │  • Building Info  │
│  └────────────────────┘  │ │  • Claims & Community   │ └───────────────────┘
│  ┌────────────────────┐  │ └─────────────────────────┘
│  │ Prestataires Mod.  │  │
│  │ • Create Vendor    │  │
│  │ • Generate/Reset   │  │
│  │   Login & PDF Card │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### Data Model & State
- **`Syndic` & Plan Onboarding**:
  - Maps selected pricing tier (`starter` = Essentiel 200 MAD / 4 buildings, `professional` = Pro 350 MAD / 8 buildings, `enterprise` = Entreprise 500 MAD / Unlimited) directly into `Syndic.subscriptionPlan` during Syndic registration.
- **`Resident` Credential Fields**:
  - `hasAccount?: boolean`, `generatedPassword?: string`, `credentialsCreatedAt?: string`, `mustChangePassword?: boolean`.
- **`Prestataire` Credential Fields**:
  - Extended with `hasAccount?: boolean`, `generatedPassword?: string`, `credentialsCreatedAt?: string`, `mustChangePassword?: boolean` so service providers have full parity with residents for account generation, viewing, and password regeneration.
- **Persistent Credential Store (`syndik_registered_users_v1` & Firestore sync)**:
  - Stores provisioned credentials keyed by normalized email (`email`, `password`, `profile` including `role`, `syndicId`, `buildingId`, `apartmentId`, `mustChangePassword`).
  - Updating or regenerating credentials from the Syndic Dashboard immediately synchronizes with the credential registry so the Resident or Prestataire can log in right away.

### Interactive Component & State Mapping
1. **Landing Page Pricing Selection $\rightarrow$ Syndic Registration**:
   - Clicking any of the 3 pricing buttons passes the selected tier (`starter`, `professional`, `enterprise`) to `/login?mode=syndic-signup&plan=<tier>`.
   - When `mode=syndic-signup` is active, the screen renders the **Création de Cabinet Syndic** wizard displaying the chosen plan summary (with option to switch tiers), cabinet details, and initial building configuration.
2. **Sign-In Only Default on `/login`**:
   - Navigating to `/login` directly renders only the **Connexion** form (no public Resident or Prestataire registration tabs).
3. **Syndic Credential Provisioning for Residents & Prestataires**:
   - Adding or regenerating credentials for a Resident or Prestataire invokes a unified credential generator (`Syn-XXXX-MA`), updates the entity and auth registry, and opens the **Credential Access Modal** with:
     - Copyable credentials block
     - **Télécharger la Fiche d'Accès PDF** (powered by `jsPDF` with official Moroccan Syndic layout, instructions for first login, and security notice).
4. **First-Login Password Update Gate**:
   - When `userProfile.mustChangePassword === true`, a dedicated modal/screen intercepts navigation and validates the new password (minimum 6 characters, confirmation match, different from temporary password). Submitting updates the stored password, sets `mustChangePassword: false`, and unlocks the user's portal.
