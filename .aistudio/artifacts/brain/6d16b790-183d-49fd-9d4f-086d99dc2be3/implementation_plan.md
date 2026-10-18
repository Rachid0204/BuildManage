# Syndik Maroc — Production Mode & Zero Mock Data Migration

Transition Syndik Maroc from a demo-seeded environment into a clean, production-grade SaaS platform where all collections start completely empty, demo login shortcuts are removed, and all existing test data is wiped for a fresh start.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following production readiness decisions were confirmed and govern this transition:

- **Confirmed Decision 1 — Zero Mock Data Defaults**: All data services (`syndics`, `buildings`, `apartments`, `residents`, `charges`, `payment_proofs`, `quittances`, `assemblees_generales`, `prestataires`, `maintenance`, `chat`, `marketplace`, `notifications`) will initialize with empty arrays (`[]`) instead of falling back to pre-populated Moroccan demo records.
- **Confirmed Decision 2 — Clean Production Login Screen**: All quick-access demo account buttons ("Comptes de démonstration") and demo credential shortcuts (`syndic@demo.com`, `resident@demo.com`, `prestataire@demo.com`, `admin@demo.com`) will be removed from the public `/login` screen and authentication context.
- **Confirmed Decision 3 — Complete Test Data Wipe**: Existing test records stored in the shared backend store, browser storage keys, and Cloud Firestore collections will be purged via a production storage version bump and server store reset so the platform starts completely fresh.

---

### 1. Overview & Core Concept

- **What It Does**: Converts Syndik Maroc into a strictly real-data production environment. Only real Syndic cabinets created via the pricing plan signup flow or by the SaaS Super Admin exist in the system, and only buildings, lots, residents, and service providers explicitly created by a Syndic appear in their respective portals.
- **Target Audience / Persona**:
  - **SaaS Super Admin (`wahbi.rachid@gmail.com`)**: Monitors real subscribed Syndic cabinets, MRR, and active buildings starting from a clean 0-cabinet state, with an administrative option to reset/purge data if needed.
  - **Syndic Cabinets**: Sign up from the landing page pricing plans, land on an onboarding empty state prompting them to create their first building, and progressively add lots, residents, and providers.
  - **Residents & Service Providers**: Log in exclusively using credentials generated and shared by their Syndic, required to set a personal password on first login.
- **Key Value**: Eliminates any confusion between sample data and real accounting/legal copropriété records (Law 18-00 / 106-12), ensuring financial ledgers, quittances, and audit trails reflect 100% authentic operations.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Public Landing & Production Login**:
     - Visitors browse the landing page and select a subscription plan (`Starter`, `Pro`, `Enterprise`) to register a new Syndic cabinet, or click **Se connecter** to access the clean sign-in form.
     - The `/login` screen displays only the official email/CIN & password form and Google Sign-In for Syndic/Admin—no demo account cards or auto-fill pills.
  2. **Syndic First-Time Onboarding (Zero-Building State)**:
     - When a newly registered Syndic logs in with 0 buildings, the workspace automatically routes to the **Immeubles** view with a clear onboarding empty state card and a primary **+ Ajouter un immeuble** CTA.
     - If a Syndic signs in via Google for the first time without a cabinet record, the system automatically provisions their clean Syndic cabinet profile with `buildings: []` so the dashboard never crashes on null references.
  3. **Empty-to-Populated Module Progression**:
     - Once a building is created, its financial balance starts at `0,00 MAD`, with zero fake transactions, zero fake maintenance tickets, zero fake AG convocations, and zero fake providers—each view presenting a tailored empty state with a direct creation button.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Utilitarian, high-trust Moroccan PropTech & financial ledger interface compliant with Law 18-00.
  - *Color Palette & Mood*: Crisp light canvas (`bg-slate-50`, `#F8FAFC`), structural white surfaces (`bg-white` with `1px solid` `border-slate-200`), deep slate navigation headers (`#0F172A`), and Moroccan Emerald/Teal primary accents (`#0F766E` / `#0D9488`). Semantic status colors (`#16A34A` nominal, `#D97706` pending, `#DC2626` overdue).
  - *Typography & Hierarchy*: Clean neo-grotesque sans headings paired with `font-mono tabular-nums` for all MAD currency amounts, tantièmes (`1000/1000`), ICE/RC numbers, and audit timestamps.
  - *Component Styling & Layout*: Single-elevation flat cards with 1px borders, responsive sidebar + top header workspace, and structured zero-state panels that guide new Syndics through step-by-step setup.
- **Interactive Feedback & Motion**:
  - Immediate optimistic/invalidated React Query updates across tabs and sessions, clear validation messages on forms, and guarded empty states when no building is selected yet.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Versioned Production Storage Keys + Server Reset Endpoint**
  - *Chosen Approach*: Bump client storage namespace to production keys (`syndik_prod_*`), wipe the server's `.data/syndik-shared-store.json` on startup/reset, and clear any test documents in Cloud Firestore.
  - *Why*: Ensures that even browsers that previously visited the app during testing will not re-upload stale cached mock data back to the server or Firestore.
  - *Alternatives Considered*: Only deleting the server file without renaming client keys—rejected because an open browser tab would immediately re-sync its old `localStorage` mock data back to the server.
- **Decision 2: Auto-Provisioning Clean Syndic Profile on First Authenticated Login**
  - *Chosen Approach*: When an authenticated Syndic logs in and no matching `Syndic` entity exists yet in the database, automatically create and persist a clean `Syndic` cabinet record (`buildings: []`) tied to their `uid` and `email`.
  - *Why*: Previously, `SyndicDataProvider` fell back to `syndics[0]` from `mockSyndics`. With zero mock data, `syndics` is empty until the first cabinet is created; auto-provisioning guarantees the Syndic always has a valid cabinet object with `buildings: []`.
  - *Alternatives Considered*: Showing an error screen when `syndic` is null—rejected because it breaks the onboarding flow for Google Sign-In users.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                        AUTHENTICATION & ENTRY LAYER                        │
│                                                                            │
│  ┌──────────────────────────┐             ┌─────────────────────────────┐  │
│  │   Public Landing Page    │───Plan─────▶│   Production Login Screen   │  │
│  │  (Plan Selection Flow)   │             │  (No Demo Buttons / Clean)  │  │
│  └──────────────────────────┘             └──────────────┬──────────────┘  │
└──────────────────────────────────────────────────────────┼─────────────────┘
                                                           │
                                                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                   PRODUCTION AUTH & STATE SYNCHRONIZATION                  │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ AuthContext (Production Mode)                                        │  │
│  │ • Super Admin recognition (wahbi.rachid@gmail.com)                   │  │
│  │ • Syndic Signup & Google OAuth -> Auto-creates empty Syndic cabinet  │  │
│  │ • Resident & Provider Login -> Verified against Syndic-issued creds  │  │
│  └──────────────────────────────────┬───────────────────────────────────┘  │
│                                     │                                      │
│                                     ▼                                      │
│  ┌──────────────────────┐   ┌──────────────────────┐   ┌────────────────┐  │
│  │   Cloud Firestore    │◀─▶│ Shared Express Store │◀─▶│ Client Cache   │  │
│  │ (Empty Collections)  │   │ (/api/shared-state)  │   │ (syndik_prod*) │  │
│  └──────────────────────┘   └──────────────────────┘   └────────────────┘  │
└─────────────────────────────────────┬──────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          ▼                           ▼                           ▼
┌───────────────────┐       ┌───────────────────┐       ┌───────────────────┐
│  SaaS Super Admin │       │  Syndic Workspace │       │ Resident/Provider │
│     Dashboard     │       │   (Zero-Building  │       │      Portals      │
│ (Real KPIs & Reset│       │  Onboarding Guard │       │ (1st-Login Gate & │
│   Data Control)   │       │  & Real Ledgers)  │       │  Bound Building)  │
└───────────────────┘       └───────────────────┘       └───────────────────┘
```

- **Data Model & State**:
  - All service functions initialize with `[]` instead of `mockSyndics`, `mockCharges`, `mockPaymentProofs`, `mockQuittances`, `mockAssembleesGenerales`, `mockPrestataires`, `mockChatMessages`, and `mockMarketplaceItems`.
  - New buildings created by a Syndic start with `financials: { balance: 0, transactions: [] }`, `announcements: []`, `documents: []`, `residents: []`, and only the apartment lots generated by the creation wizard.
- **Interactive Component & State Mapping**:
  - **Login Screen**: Removes `handleQuickDemo` and the demo account grid. Preserves Syndic signup via pricing plan, standard email/CIN sign-in, and Google Sign-In.
  - **Auth Context**: Removes hardcoded demo credential checks (`admin@demo.com`, `syndic@demo.com`, `resident@demo.com`, `prestataire@demo.com`). Preserves Super Admin recognition for `wahbi.rachid@gmail.com`, registered Syndics, and Syndic-generated Resident/Provider credentials.
  - **Syndic Data Provider & Buildings View**: Safely handles `syndics = []` and `syndic = null` while loading or provisioning a new Syndic cabinet, rendering a clean onboarding empty state when `syndic.buildings.length === 0`.
  - **Server Shared Store & Admin Reset**: Wipes `.data/syndik-shared-store.json` and adds a `POST /api/shared-state/reset` endpoint so the SaaS Super Admin can purge all state if ever needed.
