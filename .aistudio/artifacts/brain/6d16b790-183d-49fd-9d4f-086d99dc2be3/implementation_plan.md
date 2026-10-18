# Syndik - Moroccan Syndic (Trustee) SaaS Platform Enhancement Roadmap

A production-grade, multi-tenant SaaS platform tailored specifically to Moroccan co-ownership regulations (**Loi 18-00** modifiée par la **Loi 106-12** régissant la copropriété des immeubles bâtis), designed to provide professional property managers (*syndics professionnels*) and volunteer trustees (*syndics bénévoles*) with an end-to-end management suite.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The roadmap below is structured strictly by business impact and legal urgency under Moroccan co-ownership law. Review the prioritized initiatives below and confirm or adjust the execution order.

- **Priority 1 (Immediate)**: Moroccan Legal Compliance & Core Financial Engine (Tantièmes/millièmes calculation, official Quittances de paiement with ICE/IF, Appels de fonds, and Law 18-00 Mise en demeure for impayés).
- **Priority 2**: Assemblée Générale (AG) Management (Convocations, tantième-weighted quorum calculator, resolution voting, and official PV generation).
- **Priority 3**: Resident Self-Service Portal & Payment Proof Validation (Bank transfer slip upload, syndic approval queue, instant quittance issuance).
- **Priority 4**: Service Provider & Maintenance Interventions (Directory of prestataires with ICE/RC, work orders, quotes, and invoice linkage).
- **Priority 5**: Reactive Mock Persistence & Design System Elevation (Full state persistence in demo mode, tabular figures for MAD currency, seamless Arabic RTL / French localization).

---

## 1. Overview & Business Logic Context

In Morocco, co-ownership management is governed strictly by **Dahir n° 1-02-298 portant promulgation de la loi n° 18-00** (and Law 106-12). Key operational realities of a Moroccan syndic include:

1. **Quote-Part & Tantièmes**: Operating fees cannot simply be flat charges; they must be apportioned according to each co-owner's fraction of common ownership (*tantièmes* or *millièmes*), typically calculated from apartment surface area and lot accessories.
2. **Quittance de Syndic**: A legally recognized receipt proving a co-owner has cleared dues, essential for notary procedures during property sales (*attestation de non-dette / quittance*).
3. **Appels de Fonds & Budget Séparé**: Distinction between *charges courantes* (operating budget: cleaning, concierge, elevator maintenance, common electricity) and *fonds de réserve / travaux exceptionnels* (mandatory reserve fund under Law 106-12).
4. **Recouvrement & Impayés**: Escalation protocol for arrears: friendly reminder $\rightarrow$ formal notice (*mise en demeure avec accusé de réception*) $\rightarrow$ summary payment order (*injonction de payer*).
5. **Assemblée Générale**: Annual legal obligation requiring strict quorum verification based on total copropriété voting shares, secret/open voting on resolutions, and signed minutes (*procès-verbal*).

---

## 2. Prioritized Improvement & Feature Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        PRIORITY ROADMAP OVERVIEW                       │
├─────────────┬──────────────────────────────────────────────────────────┤
│ Priority 1  │ Moroccan Legal Financials: Tantièmes, Quittances & Relance│
├─────────────┼──────────────────────────────────────────────────────────┤
│ Priority 2  │ Assemblée Générale (AG) & Quorum Voting Engine           │
├─────────────┼──────────────────────────────────────────────────────────┤
│ Priority 3  │ Resident Portal & Payment Proof Verification Flow        │
├─────────────┼──────────────────────────────────────────────────────────┤
│ Priority 4  │ Prestataires / Service Providers & Work Order Tracking  │
├─────────────┼──────────────────────────────────────────────────────────┤
│ Priority 5  │ Reactive Persistence & Modern FinTech SaaS Interface     │
└─────────────┴──────────────────────────────────────────────────────────┘
```

### Priority 1: Moroccan Legal Financials & Compliance Engine

#### Existing Gaps
- Currently, monthly charges are generated with a flat fee per apartment (`monthlySyndicFees`), which does not comply with co-ownership agreements based on surface or tantièmes.
- Invoices are generic and lack Moroccan legal identifiers (ICE, IF, RC, Patente).
- No formal **Quittance de paiement** (with official legal mentions and syndic stamp) is delivered to the co-owner upon payment.
- Overdue tracking lacks structured recovery letters (*relance amiable* and legal *mise en demeure*).

#### Planned Enhancements
1. **Tantième / Surface-Based Fee Allocation**:
   - Calculate each apartment's share: $\text{Fee}_i = \text{Total Annual Budget} \times \frac{\text{Tantièmes}_i}{1000}$ (or proportional square meter ratio).
   - Support both fixed per-apartment and tantième-based apportionment schemes.
2. **Official Quittances de Paiement (PDF & Printable)**:
   - Generate bilingual (FR/AR) official receipts bearing the Syndic's name, ICE, IF, apartment number, co-owner name, payment method (virement, chèque, versement, CMI), date, and remaining balance.
3. **Appels de Fonds (Budget Call Notices)**:
   - Automated quarterly or monthly call notices breaking down *Budget de fonctionnement* vs *Fonds de réserve travaux*.
4. **Moroccan Law 18-00 Debt Recovery (Gestion des Impayés)**:
   - Dashboard widget showing aging debt (30 days, 60 days, 90+ days).
   - 1-click generation of the formal **Mise en Demeure** notice complying with Article 25 of Law 18-00.

---

### Priority 2: Assemblée Générale (AG) Management Module

#### Existing Gaps
- No module exists for managing annual or extraordinary general meetings, which are the cornerstone of Moroccan syndic governance.

#### Planned Enhancements
1. **AG Scheduler & Convocations**:
   - Create AG sessions (Ordinaire AGO / Extraordinaire AGE) with date, location, and Agenda (*Ordre du jour*).
   - Export printable/downloadable formal Convocation notices with statutory notice period tracking (15 days minimum).
2. **Live Quorum Calculator**:
   - Interactive attendee register (*Feuille de présence*).
   - Dynamic real-time calculation of present/represented co-owners in tantièmes. Displays statutory status: *Quorum atteint* (> 500/1000 for 1st assembly, or Law 106-12 second convocation rules).
3. **Resolution Voting**:
   - Agenda resolutions (e.g., *Approbation des comptes*, *Quitus au syndic*, *Vote du budget prévisionnel*, *Élection du conseil syndical*).
   - Voting mechanisms: Pour, Contre, Abstention with automatic vote tallying weighted by tantièmes.
4. **Certified Procès-Verbal (PV) Generator**:
   - Export official AG minutes in French and Arabic, ready for archiving and distribution to all co-owners.

---

### Priority 3: Resident Portal & Payment Proof Validation Workflow

#### Existing Gaps
- Co-owners cannot upload payment receipts (e.g. CIH, Attijariwafa, BMCE bank transfer slips or ATM deposit receipts).
- Syndic has no verification inbox to inspect proofs before validating charges.

#### Planned Enhancements
1. **Resident Self-Service Payment Proof Submission**:
   - Resident dashboard allows selecting pending charges and submitting proof of payment: transaction reference, date, payment channel (Virement bancaire, Versement en agence, Chèque), and file/receipt attachment.
2. **Syndic Verification & Approval Queue**:
   - Dedicated "Pending Verifications" tab in Financials.
   - Syndic can review the receipt preview, verify with bank statement, and click **Approuver** or **Rejeter** with a reason.
   - Upon approval: charge is marked as paid, income transaction is automatically logged in the building ledger, and a Quittance PDF is issued immediately to the resident's account.

---

### Priority 4: Service Providers (Prestataires) & Maintenance Tracking

#### Existing Gaps
- `provider` role exists in types but has no UI or workflow.
- Maintenance requests have a simple text photo URL and no quote/contract tracking.

#### Planned Enhancements
1. **Prestataire Directory**:
   - Management of vendors: Plumber, Electrician, Elevator maintenance (*Ascensoriste*), Cleaning company, Concierge/Security, Insurance company.
   - Tracking contracts, contact details, ICE, and expiry dates.
2. **Structured Work Orders (Bons d'intervention)**:
   - Assign maintenance tickets to specific providers with estimated cost, approved quote (*Devis*), and final invoice (*Facture*).
   - Expense automatically bridges into building financial expenses once marked as completed.

---

### Priority 5: Reactive Persistence & Modern FinTech SaaS Interface

#### Existing Gaps
- Demo mode loses custom additions when refreshing if not stored in localStorage.
- Visuals use generic cards and inconsistent fonts; some dialogs have hardcoded English text.

#### Planned Enhancements
1. **Reactive Local Storage Persistence Layer**:
   - Full reactive CRUD in mock mode so that newly created buildings, apartments, residents, transactions, payment proofs, and AG sessions persist seamlessly in the browser.
2. **FinTech Visual System & Anti-Slop Discipline**:
   - High-density data tables ($36\text{px}$–$44\text{px}$ row heights), subtle 1px dividers, tabular monospace figures for MAD currency (`font-variant-numeric: tabular-nums`).
   - Clean unboxed metadata with typographic separators (`·`).
   - Cohesive emerald (`#0F766E`), slate (`#0F172A`), and neutral palette.
3. **Trilingual Moroccan Localization (FR, AR, EN)**:
   - Complete French & Arabic translations across all views, forms, and PDF templates.
   - Flawless RTL layout mirroring when Arabic is selected.

---

## 3. System Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SYSTEM ARCHITECTURE                             │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  ┌────────────────────┐   ┌────────────────────┐   ┌────────────────┐  │
│  │   Syndic Admin     │   │   Resident Portal  │   │  Super Admin   │  │
│  │  (Property Mgr)    │   │  (Copropriétaire)  │   │  (SaaS Owner)  │  │
│  └─────────┬──────────┘   └─────────┬──────────┘   └────────┬───────┘  │
│            │                        │                       │          │
│  ──────────┼────────────────────────┼───────────────────────┼────────  │
│            ▼                        ▼                       ▼          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      APPLICATION CORE                            │  │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │  │
│  │  │ Financials &    │  │ Assemblée        │  │ Maintenance &   │  │  │
│  │  │ Tantièmes Engine│  │ Générale (AG)    │  │ Prestataires    │  │  │
│  │  └─────────────────┘  └──────────────────┘  └─────────────────┘  │  │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────────┐  │  │
│  │  │ Proof Approval  │  │ PDF Generator    │  │ Gemini AI       │  │  │
│  │  │ Queue           │  │ (Quittances/PVs) │  │ Announcements   │  │  │
│  │  └─────────────────┘  └──────────────────┘  └─────────────────┘  │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     │                                  │
│  ───────────────────────────────────┼────────────────────────────────  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     DATA & PERSISTENCE LAYER                     │  │
│  │   • Reactive LocalStorage Store (Demo / Zero-Setup Mode)         │  │
│  │   • Firebase Firestore & Storage (Production Mode)               │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Verification & Testing Strategy

- **Compilation Verification**: Run `compile_applet` after each cohesive change set to guarantee clean TypeScript builds.
- **Workflow Testing**:
  - Test tantième calculation: generate monthly charges and verify amounts match surface/tantième ratios.
  - Test payment flow: resident submits transfer slip $\rightarrow$ syndic verifies in queue $\rightarrow$ quittance PDF downloads with correct ICE/IF/amount.
  - Test AG module: create agenda items, mark attendees, verify quorum computation, record votes, and export PV.
  - Test language toggle: verify French, English, and Arabic RTL transitions.
