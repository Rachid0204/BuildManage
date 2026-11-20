import { chromium, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { hashPasswordSync } from '../utils/security';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_ROOT = join(ROOT, 'public', 'guides', 'screenshots');
const DEMO_PASSWORD = 'Guide-Demo-Password-2026!';

function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  for (const candidate of ['/usr/bin/chromium', '/usr/bin/google-chrome']) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

async function allocatePort(): Promise<number> {
  return new Promise<number>((done, reject) => {
    const listener = createServer();
    listener.on('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const p = (listener.address() as { port: number }).port;
      listener.close(() => done(p));
    });
  });
}

function buildMoroccanDemoSeed() {
  const nowIso = new Date().toISOString();
  const nextYearIso = new Date(Date.now() + 240 * 86_400_000).toISOString();
  const soonIso = new Date(Date.now() + 9 * 86_400_000).toISOString();
  const monthPeriod = nowIso.slice(0, 7);

  const profiles = [
    {
      uid: 'demo-syndic-1',
      email: 'contact@atlascopro.ma',
      displayName: 'Karim Bennani',
      role: 'syndic',
      syndicId: 'syndic-atlas',
      emailVerified: true,
    },
    {
      uid: 'demo-res-1',
      email: 'nadia.elidrissi@example.ma',
      displayName: 'Nadia El Idrissi',
      role: 'resident',
      residentId: 'res-a1',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      apartmentId: 'apt-a1',
      isOwner: true,
      emailVerified: true,
    },
    {
      uid: 'demo-prov-1',
      email: 'atelier@maghrebplomberie.ma',
      displayName: 'Maghreb Plomberie Services',
      role: 'provider',
      prestataireId: 'prest-1',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      prestataireCategory: 'plumbing',
      emailVerified: true,
    },
    {
      uid: 'demo-admin-1',
      email: 'admin@syndik.ma',
      displayName: 'Direction Plateforme Syndik',
      role: 'admin',
      emailVerified: true,
    },
  ];

  const residents = [
    {
      id: 'res-a1',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Nadia El Idrissi',
      email: 'nadia.elidrissi@example.ma',
      phone: '0661-24-58-90',
      cin: 'BK482910',
      isOwner: true,
      hasAccount: true,
      apartmentId: 'apt-a1',
      mustChangePassword: false,
    },
    {
      id: 'res-a2',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Youssef Benjelloun',
      email: 'youssef.benjelloun@example.ma',
      phone: '0662-11-39-44',
      cin: 'BE719204',
      isOwner: true,
      hasAccount: true,
      apartmentId: 'apt-a2',
      mustChangePassword: false,
    },
    {
      id: 'res-b1',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Salma Tazi',
      email: 'salma.tazi@example.ma',
      phone: '0663-88-12-09',
      cin: 'BH310455',
      isOwner: true,
      hasAccount: true,
      apartmentId: 'apt-b1',
      mustChangePassword: false,
    },
    {
      id: 'res-b2',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Omar Chraibi',
      email: 'omar.chraibi@example.ma',
      phone: '0664-55-73-20',
      cin: 'BK901233',
      isOwner: true,
      hasAccount: true,
      apartmentId: 'apt-b2',
      mustChangePassword: false,
    },
    {
      id: 'res-c1',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Hicham Alaoui',
      email: 'hicham.alaoui@example.ma',
      phone: '0665-30-91-18',
      cin: 'BJ662100',
      isOwner: false,
      hasAccount: true,
      apartmentId: 'apt-a2',
      mustChangePassword: false,
    },
  ];

  const apartments = [
    {
      id: 'apt-a1',
      buildingId: 'bld-yasmin',
      number: 'A1',
      floor: 1,
      area: 110,
      tantiemes: 220,
      monthlyFees: 350,
      ownerId: 'res-a1',
      tenantId: null,
    },
    {
      id: 'apt-a2',
      buildingId: 'bld-yasmin',
      number: 'A2',
      floor: 1,
      area: 95,
      tantiemes: 180,
      monthlyFees: 300,
      ownerId: 'res-a2',
      tenantId: 'res-c1',
    },
    {
      id: 'apt-b1',
      buildingId: 'bld-yasmin',
      number: 'B1',
      floor: 2,
      area: 120,
      tantiemes: 240,
      monthlyFees: 400,
      ownerId: 'res-b1',
      tenantId: null,
    },
    {
      id: 'apt-b2',
      buildingId: 'bld-yasmin',
      number: 'B2',
      floor: 2,
      area: 90,
      tantiemes: 160,
      monthlyFees: 300,
      ownerId: 'res-b2',
      tenantId: null,
    },
    {
      id: 'apt-c1',
      buildingId: 'bld-yasmin',
      number: 'C1',
      floor: 3,
      area: 100,
      tantiemes: 200,
      monthlyFees: 350,
      ownerId: 'res-a1',
      tenantId: null,
    },
  ];

  const transactions = [
    {
      id: 'tx-1',
      buildingId: 'bld-yasmin',
      date: `${monthPeriod}-03`,
      type: 'income',
      category: 'Cotisations Syndic',
      description: 'Cotisation mensuelle Lot B1 — Salma Tazi (Virement)',
      amount: 400,
      fund: 'courant',
      paymentMethod: 'virement',
      reference: 'VIR-B1-2026',
    },
    {
      id: 'tx-2',
      buildingId: 'bld-yasmin',
      date: `${monthPeriod}-05`,
      type: 'income',
      category: 'Cotisations Syndic',
      description: 'Cotisation mensuelle Lot B2 — Omar Chraibi (Virement)',
      amount: 300,
      fund: 'courant',
      paymentMethod: 'virement',
      reference: 'VIR-B2-2026',
    },
    {
      id: 'tx-3',
      buildingId: 'bld-yasmin',
      date: `${monthPeriod}-08`,
      type: 'expense',
      category: 'Électricité Parties Communes',
      description: 'Facture LYDEC Éclairage & Ascenseur',
      amount: 1450,
      fund: 'courant',
      paymentMethod: 'virement',
      reference: 'LYD-2026-041',
    },
    {
      id: 'tx-4',
      buildingId: 'bld-yasmin',
      date: `${monthPeriod}-10`,
      type: 'expense',
      category: 'Maintenance Ascenseur',
      description: 'Contrat entretien mensuel OTIS Maroc',
      amount: 1800,
      fund: 'courant',
      paymentMethod: 'virement',
      reference: 'OTIS-2026-10',
    },
    {
      id: 'tx-5',
      buildingId: 'bld-yasmin',
      date: `${monthPeriod}-12`,
      type: 'income',
      category: 'Dotation Fonds de Réserve',
      description: 'Provision trimestrielle gros travaux (Loi 18-00)',
      amount: 4500,
      fund: 'reserve',
      paymentMethod: 'virement',
      reference: 'RES-2026-Q4',
    },
  ];

  const buildings = [
    {
      id: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Résidence Al Yasmin',
      address: '42 Boulevard d’Anfa, Quartier Racine',
      city: 'Casablanca',
      monthlySyndicFees: 350,
      reserveFundRate: 10,
      totalTantiemes: 1000,
      bankName: 'Attijariwafa Bank',
      bankRib: '007 780 0001234567890123 45',
      managerName: 'Karim Bennani',
      residents,
      apartments,
      announcements: [
        {
          id: 'ann-1',
          buildingId: 'bld-yasmin',
          title: 'Entretien semestriel des ascenseurs — Jeudi 09h à 11h',
          content:
            'Le prestataire agréé interviendra jeudi matin pour le contrôle de sécurité réglementaire. Merci de votre compréhension.',
          priority: 'urgent',
          createdAt: nowIso,
          authorName: 'Cabinet Atlas Copro Gestion',
        },
        {
          id: 'ann-2',
          buildingId: 'bld-yasmin',
          title: 'Ouverture du vote en ligne — AGO Annuelle 2026',
          content:
            'Les copropriétaires peuvent dès à présent consulter les 3 résolutions et voter en ligne depuis leur espace Copropriétaire.',
          priority: 'normal',
          createdAt: nowIso,
          authorName: 'Cabinet Atlas Copro Gestion',
        },
      ],
      documents: [
        {
          id: 'doc-1',
          buildingId: 'bld-yasmin',
          name: 'Règlement_de_Copropriété_Al_Yasmin.pdf',
          category: 'legal',
          visibility: 'all',
          uploadedAt: nowIso,
          uploadedBy: 'Karim Bennani',
          size: '1.2 Mo',
          url: '/api/uploads/demo-doc-1',
        },
        {
          id: 'doc-2',
          buildingId: 'bld-yasmin',
          name: 'PV_AGO_Exercice_Precedent.pdf',
          category: 'ag',
          visibility: 'owners_only',
          uploadedAt: nowIso,
          uploadedBy: 'Karim Bennani',
          size: '840 Ko',
          url: '/api/uploads/demo-doc-2',
        },
        {
          id: 'doc-3',
          buildingId: 'bld-yasmin',
          name: 'Police_Assurance_Multirisque_Immeuble.pdf',
          category: 'insurance',
          visibility: 'syndic_only',
          uploadedAt: nowIso,
          uploadedBy: 'Karim Bennani',
          size: '615 Ko',
          url: '/api/uploads/demo-doc-3',
        },
      ],
      financials: {
        balance: 38450,
        reserveFundBalance: 24500,
        transactions,
        openingBalancesRecordedAt: nowIso,
      },
    },
    {
      id: 'bld-palmeraie',
      syndicId: 'syndic-atlas',
      name: 'Résidence Les Jardins de l’Atlas',
      address: '18 Avenue Mohammed VI',
      city: 'Rabat',
      monthlySyndicFees: 400,
      reserveFundRate: 10,
      totalTantiemes: 1000,
      bankName: 'CIH Bank',
      bankRib: '230 810 0009876543210987 12',
      managerName: 'Karim Bennani',
      residents: [],
      apartments: [],
      announcements: [],
      documents: [],
      financials: {
        balance: 19200,
        reserveFundBalance: 11000,
        transactions: [],
        openingBalancesRecordedAt: nowIso,
      },
    },
  ];

  const syndics = [
    {
      id: 'syndic-atlas',
      name: 'Cabinet Atlas Copro Gestion',
      email: 'contact@atlascopro.ma',
      phone: '0522-48-19-20',
      city: 'Casablanca',
      address: '14 Rue Jean Jaurès, Gautier',
      ice: '002489123000045',
      rc: 'RC 418920',
      taxId: '40291834',
      patente: '34819201',
      createdBy: 'demo-syndic-1',
      subscriptionPlan: 'professional',
      subscriptionStatus: 'active',
      subscriptionExpiry: nextYearIso,
      buildings,
    },
    {
      id: 'syndic-marrakech',
      name: 'Syndic Majorelle Patrimoine',
      email: 'direction@majorellecopro.ma',
      phone: '0524-31-70-12',
      city: 'Marrakech',
      address: 'Avenue Mohammed V, Guéliz',
      ice: '001928374000081',
      rc: 'RC 98214',
      createdBy: 'demo-other',
      subscriptionPlan: 'starter',
      subscriptionStatus: 'active',
      subscriptionExpiry: soonIso,
      buildings: [],
    },
  ];

  const charges = [
    {
      id: 'chg-a1-cur',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      residentId: 'res-a1',
      apartmentId: 'apt-a1',
      description: `Cotisation Syndic — ${monthPeriod} (Lot A1)`,
      amount: 350,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: `${monthPeriod}-28`,
      period: monthPeriod,
      createdAt: nowIso,
    },
    {
      id: 'chg-c1-cur',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      residentId: 'res-a1',
      apartmentId: 'apt-c1',
      description: `Cotisation Syndic — ${monthPeriod} (Lot C1)`,
      amount: 350,
      paidAmount: 350,
      status: 'paid',
      dueDate: `${monthPeriod}-28`,
      period: monthPeriod,
      createdAt: nowIso,
    },
    {
      id: 'chg-a2-cur',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      residentId: 'res-a2',
      apartmentId: 'apt-a2',
      description: `Cotisation Syndic — ${monthPeriod} (Lot A2)`,
      amount: 300,
      paidAmount: 150,
      status: 'partial',
      dueDate: `${monthPeriod}-28`,
      period: monthPeriod,
      createdAt: nowIso,
    },
    {
      id: 'chg-b1-cur',
      syndicId: 'syndic-atlas',
      buildingId: 'bld-yasmin',
      residentId: 'res-b1',
      apartmentId: 'apt-b1',
      description: `Cotisation Syndic — ${monthPeriod} (Lot B1)`,
      amount: 400,
      paidAmount: 400,
      status: 'paid',
      dueDate: `${monthPeriod}-28`,
      period: monthPeriod,
      createdAt: nowIso,
    },
  ];

  const quittances = [
    {
      id: 'quit-1',
      quittanceNumber: 'QUIT-2026-0042',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      residentId: 'res-a1',
      residentName: 'Nadia El Idrissi',
      apartmentId: 'apt-c1',
      apartmentNumber: 'C1',
      chargeId: 'chg-c1-cur',
      amount: 350,
      paymentMethod: 'virement',
      referenceNumber: 'VIR-ATW-88241',
      bankName: 'Attijariwafa Bank',
      period: monthPeriod,
      paymentDate: `${monthPeriod}-04`,
      createdAt: nowIso,
    },
    {
      id: 'quit-2',
      quittanceNumber: 'QUIT-2026-0043',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      residentId: 'res-b1',
      residentName: 'Salma Tazi',
      apartmentId: 'apt-b1',
      apartmentNumber: 'B1',
      chargeId: 'chg-b1-cur',
      amount: 400,
      paymentMethod: 'virement',
      referenceNumber: 'VIR-CIH-55190',
      bankName: 'CIH Bank',
      period: monthPeriod,
      paymentDate: `${monthPeriod}-03`,
      createdAt: nowIso,
    },
  ];

  const proofs = [
    {
      id: 'proof-pending-1',
      chargeId: 'chg-a2-cur',
      buildingId: 'bld-yasmin',
      residentId: 'res-a2',
      residentName: 'Youssef Benjelloun',
      apartmentId: 'apt-a2',
      apartmentNumber: 'A2',
      amount: 150,
      status: 'pending',
      bankName: 'Banque Populaire (BCP)',
      referenceNumber: 'VIR-BCP-2026-7712',
      submissionDate: nowIso,
    },
  ];

  const agList = [
    {
      id: 'ag-2026-ago',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      title: 'Assemblée Générale Ordinaire Annuelle 2026',
      type: 'AGO',
      convocationNumber: 1,
      date: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
      time: '18:30',
      location: 'Hall principal — Résidence Al Yasmin (Casablanca)',
      status: 'in_progress',
      isVotingOpen: true,
      totalTantiemes: 1000,
      quorumReached: true,
      presentTantiemes: 820,
      createdAt: nowIso,
      attendees: [
        {
          residentId: 'res-a1',
          residentName: 'Nadia El Idrissi',
          apartmentNumber: 'A1, C1',
          tantiemes: 420,
          status: 'present',
        },
        {
          residentId: 'res-b1',
          residentName: 'Salma Tazi',
          apartmentNumber: 'B1',
          tantiemes: 240,
          status: 'present',
        },
        {
          residentId: 'res-b2',
          residentName: 'Omar Chraibi',
          apartmentNumber: 'B2',
          tantiemes: 160,
          status: 'represented',
          proxyHolderName: 'Salma Tazi',
        },
      ],
      resolutions: [
        {
          id: 'res-1',
          number: 1,
          title: 'Approbation des comptes de l’exercice écoulé et quitus au Syndic',
          description:
            'Validation du bilan financier courant (38 450 MAD) et du fonds de réserve (24 500 MAD).',
          majorityType: 'simple',
          status: 'pending',
          votesFor: 240,
          votesAgainst: 0,
          votesAbstain: 0,
          votes: [
            {
              residentId: 'res-b1',
              residentName: 'Salma Tazi',
              apartmentId: 'apt-b1',
              apartmentNumber: 'B1',
              tantiemesWeight: 240,
              vote: 'for',
              timestamp: nowIso,
            },
          ],
        },
        {
          id: 'res-2',
          number: 2,
          title: 'Travaux d’étanchéité de la terrasse commune (Budget 45 000 MAD)',
          description:
            'Réfection complète de l’étanchéité avec garantie décennale. Financement 50% Fonds de réserve + 50% appel travaux aux tantièmes.',
          majorityType: 'three_quarters',
          budgetAmount: 45000,
          status: 'pending',
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          votes: [],
        },
        {
          id: 'res-3',
          number: 3,
          title: 'Installation de caméras de vidéosurveillance à l’entrée du parking',
          description:
            'Devis retenu : 12 800 MAD TTC par Sécurité Atlas Agréée.',
          majorityType: 'absolute',
          budgetAmount: 12800,
          status: 'pending',
          votesFor: 0,
          votesAgainst: 0,
          votesAbstain: 0,
          votes: [],
        },
      ],
    },
  ];

  const prestataires = [
    {
      id: 'prest-1',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Maghreb Plomberie Services',
      contactPerson: 'Mustapha Rami',
      phone: '0661-90-14-22',
      email: 'atelier@maghrebplomberie.ma',
      category: 'plumbing',
      ice: '001845209000017',
      rc: 'RC 302811',
      active: true,
      hasAccount: true,
      rating: 4.8,
      reviews: [
        {
          id: 'rev-1',
          residentId: 'res-b1',
          residentName: 'Salma Tazi',
          rating: 5,
          comment: 'Intervention rapide sur la colonne montante, travail propre.',
          date: nowIso,
        },
      ],
    },
    {
      id: 'prest-2',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Électro-Casablanca Maintenance',
      contactPerson: 'Rachid Fassi',
      phone: '0662-45-80-11',
      email: 'sav@electrocasablanca.ma',
      category: 'electrical',
      ice: '002190345000062',
      rc: 'RC 289410',
      active: true,
      hasAccount: false,
      rating: 4.6,
      reviews: [],
    },
    {
      id: 'prest-3',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      name: 'Ascenseurs Atlas Express',
      contactPerson: 'Driss Kettani',
      phone: '0522-94-11-30',
      email: 'astreinte@atlasascenseurs.ma',
      category: 'elevator',
      ice: '001532018000094',
      rc: 'RC 190422',
      active: true,
      hasAccount: false,
      rating: 4.9,
      reviews: [],
    },
  ];

  const maintenance = [
    {
      id: 'maint-1',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      residentId: 'res-a1',
      residentName: 'Nadia El Idrissi',
      apartmentId: 'apt-a1',
      apartmentNumber: 'A1',
      title: 'Fuite sur la vanne principale du sous-sol',
      description:
        'Léger suintement observé près du compteur général au niveau du parking sous-sol B.',
      category: 'plumbing',
      priority: 'high',
      status: 'in_progress',
      assignedTo: 'prest-1',
      prestataireId: 'prest-1',
      createdAt: nowIso,
      history: [
        {
          title: 'Incident déclaré par Nadia El Idrissi',
          note: 'Signalement transmis avec localisation sous-sol B.',
          updatedBy: 'Nadia El Idrissi',
          updatedByRole: 'resident',
          date: nowIso,
        },
        {
          title: 'Affecté à Maghreb Plomberie Services',
          note: 'Intervention programmée dans la journée.',
          updatedBy: 'Karim Bennani',
          updatedByRole: 'syndic',
          date: nowIso,
        },
      ],
    },
    {
      id: 'maint-2',
      buildingId: 'bld-yasmin',
      syndicId: 'syndic-atlas',
      residentId: 'res-b1',
      residentName: 'Salma Tazi',
      apartmentNumber: 'Parties Communes',
      title: 'Minuterie d’éclairage palier 2ème étage défectueuse',
      description: 'La lumière reste allumée en continu sur le palier du 2ème.',
      category: 'electrical',
      priority: 'medium',
      status: 'pending',
      createdAt: nowIso,
      history: [],
    },
  ];

  const chat = [
    {
      id: 'chat-1',
      buildingId: 'bld-yasmin',
      channelId: 'general',
      senderId: 'demo-syndic-1',
      senderName: 'Karim Bennani (Syndic)',
      senderRole: 'syndic',
      content:
        'Bonjour à tous ! L’ordre du jour de l’AGO 2026 est en ligne. N’hésitez pas à voter avant jeudi soir.',
      createdAt: nowIso,
      likes: ['demo-res-1'],
    },
    {
      id: 'chat-2',
      buildingId: 'bld-yasmin',
      channelId: 'general',
      senderId: 'demo-res-1',
      senderName: 'Nadia El Idrissi (Lot A1)',
      senderRole: 'resident',
      content:
        'Merci Karim, le dossier financier est très clair. Je viens de consulter les devis d’étanchéité.',
      createdAt: nowIso,
      likes: ['demo-syndic-1'],
    },
  ];

  const marketplace = [
    {
      id: 'mkt-1',
      buildingId: 'bld-yasmin',
      sellerId: 'demo-res-1',
      sellerName: 'Nadia El Idrissi',
      apartmentNumber: 'A1',
      title: 'Vélo enfant B’Twin 20 pouces (Très bon état)',
      description:
        'Utilisé 6 mois, freins révisés. Visible dans le hall sur rendez-vous.',
      category: 'items',
      price: 450,
      status: 'available',
      createdAt: nowIso,
    },
    {
      id: 'mkt-2',
      buildingId: 'bld-yasmin',
      sellerId: 'res-b1',
      sellerName: 'Salma Tazi',
      apartmentNumber: 'B1',
      title: 'Don de livres scolaires Collège & Lycée',
      description:
        'Manuels de maths et physique en excellent état, don gratuit pour un voisin.',
      category: 'free',
      price: 0,
      status: 'available',
      createdAt: nowIso,
    },
  ];

  const subscriptionPayments = [
    {
      id: 'subpay-1',
      syndicId: 'syndic-atlas',
      syndicName: 'Cabinet Atlas Copro Gestion',
      syndicEmail: 'contact@atlascopro.ma',
      plan: 'professional',
      months: 6,
      reference: 'CMI-2026-88412',
      invoiceNumber: 'FAC-2026-0014',
      amount: 2106,
      subtotalMad: 2340,
      discountMad: 234,
      multiMonthDiscountPct: 10,
      vatRate: 20,
      totalHtMad: 1755,
      vatAmountMad: 351,
      method: 'cmi',
      currency: 'MAD',
      recordedBy: 'cmi-webhook',
      createdAt: nowIso,
      subscriptionExpiry: nextYearIso,
      subscriptionStatus: 'active',
    },
    {
      id: 'subpay-2',
      syndicId: 'syndic-marrakech',
      syndicName: 'Syndic Majorelle Patrimoine',
      syndicEmail: 'direction@majorellecopro.ma',
      plan: 'starter',
      months: 3,
      reference: 'WFC-2026-5401',
      invoiceNumber: 'FAC-2026-0015',
      receiptNumber: 'REC-2026-0008',
      amount: 541.5,
      subtotalMad: 570,
      discountMad: 28.5,
      multiMonthDiscountPct: 5,
      vatRate: 20,
      totalHtMad: 451.25,
      vatAmountMad: 90.25,
      method: 'wafacash',
      cashChannel: 'wafacash',
      agencyLocation: 'Agence Guéliz Marrakech',
      currency: 'MAD',
      recordedBy: 'demo-admin-1',
      createdAt: nowIso,
      subscriptionExpiry: soonIso,
      subscriptionStatus: 'active',
    },
  ];

  const subscriptionRequests = [
    {
      id: 'subreq-1',
      syndicId: 'syndic-marrakech',
      syndicName: 'Syndic Majorelle Patrimoine',
      syndicEmail: 'direction@majorellecopro.ma',
      plan: 'professional',
      months: 6,
      amount: 2106,
      subtotalMad: 2340,
      discountMad: 234,
      requestType: 'cash',
      cashChannel: 'wafacash',
      agencyLocation: 'Wafacash Marrakech Guéliz',
      transferReference: 'WFC-2026-90812',
      bankName: 'Wafacash',
      transferDate: nowIso.slice(0, 10),
      status: 'pending',
      submittedBy: 'demo-other',
      createdAt: nowIso,
    },
  ];

  return {
    syndik_prod_registered_users_v1: profiles.map((profile) => ({
      uid: profile.uid,
      email: profile.email,
      profile,
      passwordHash: hashPasswordSync(DEMO_PASSWORD, profile.email),
    })),
    syndik_prod_syndics_v1: syndics,
    syndik_prod_charges_v1: charges,
    syndik_prod_quittances_v1: quittances,
    syndik_prod_proofs_v1: proofs,
    syndik_prod_ag_v1: agList,
    syndik_prod_prestataires_v1: prestataires,
    syndik_prod_maintenance_v1: maintenance,
    syndik_prod_chat_v1: chat,
    syndik_prod_marketplace_v1: marketplace,
    syndik_prod_subscription_payments_v1: subscriptionPayments,
    syndik_prod_subscription_requests_v1: subscriptionRequests,
    syndik_prod_notifications_v1: [],
    syndik_prod_audit_v1: [
      {
        id: 'aud-1',
        actorUid: 'demo-admin-1',
        actorRole: 'admin',
        syndicId: 'syndic-atlas',
        operation: 'updatePlatformBillingConfig',
        detail: { cmiEnabled: true, cashEnabled: true },
        createdAt: nowIso,
      },
      {
        id: 'aud-2',
        actorUid: 'demo-admin-1',
        actorRole: 'admin',
        syndicId: 'syndic-marrakech',
        operation: 'recordSubscriptionPayment',
        detail: { amount: 541.5, method: 'wafacash', reference: 'WFC-2026-5401' },
        createdAt: nowIso,
      },
    ],
  };
}

async function apiLogin(base: string, email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: email, password: DEMO_PASSWORD }),
  });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.token;
}

async function waitUiQuiet(page: Page, ms = 750) {
  await page.waitForLoadState('load').catch(() => {});
  await page
    .locator('.animate-spin')
    .first()
    .waitFor({ state: 'hidden', timeout: 4_000 })
    .catch(() => {});
  await page.waitForTimeout(ms);
}

async function snap(
  page: Page,
  roleDir: 'syndic' | 'resident' | 'provider' | 'admin',
  filename: string,
) {
  const dir = join(OUT_ROOT, roleDir);
  mkdirSync(dir, { recursive: true });
  const target = join(dir, filename);
  await page.screenshot({
    path: target,
    type: 'jpeg',
    quality: 82,
    fullPage: false,
  });
  const sizeKb = (statSync(target).size / 1024).toFixed(1);
  console.log(`  ✓ ${roleDir}/${filename} (${sizeKb} KB)`);
}

async function main() {
  if (!existsSync(join(ROOT, 'dist-server', 'server.js')) || !existsSync(join(ROOT, 'dist', 'index.html'))) {
    throw new Error('Built app missing. Run `npm run build` before `npm run docs:screenshots`.');
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'buildmanage-guides-'));
  writeFileSync(
    join(tempDir, 'shared-state.json'),
    JSON.stringify(buildMoroccanDemoSeed()),
    'utf8',
  );

  const port = await allocatePort();
  const base = `http://127.0.0.1:${port}`;
  let serverLogs = '';
  const server: ChildProcess = spawn(
    process.execPath,
    ['dist-server/server.js'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(port),
        SYNDIK_STATE_BACKEND: 'file',
        SYNDIK_UPLOAD_BACKEND: 'file',
        SYNDIK_DATA_DIR: tempDir,
        SYNDIK_SERVER_SECRET: 'guide-capture-synthetic-server-secret-32c',
        SENDGRID_API_KEY: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  server.stdout?.on('data', (d) => (serverLogs += String(d)));
  server.stderr?.on('data', (d) => (serverLogs += String(d)));

  const pageErrors: string[] = [];

  try {
    // Wait for server health
    const deadline = Date.now() + 20_000;
    let healthy = false;
    while (Date.now() < deadline) {
      if (server.exitCode !== null) {
        throw new Error(`Demo server exited early:\n${serverLogs}`);
      }
      try {
        const r = await fetch(`${base}/api/health`);
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch {
        // retry
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!healthy) throw new Error(`Demo server health check timed out:\n${serverLogs}`);

    // Seed billing config & promo via official Admin API so encrypted secrets & gateway events are realistic
    const adminToken = await apiLogin(base, 'admin@syndik.ma');
    const syndicToken = await apiLogin(base, 'contact@atlascopro.ma');
    const residentToken = await apiLogin(base, 'nadia.elidrissi@example.ma');
    const providerToken = await apiLogin(base, 'atelier@maghrebplomberie.ma');

    const cfgRes = await fetch(`${base}/api/admin/billing-config`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        paypal: {
          enabled: false,
          env: 'sandbox',
          checkoutMode: 'standard',
          clientId: '',
          currency: 'EUR',
          madPerUnit: 10,
        },
        cmi: {
          enabled: true,
          env: 'production',
          clientId: '600004812',
          storeKey: 'DemoCmiStoreKeyMoroccan2026!',
          currencyCode: '504',
          lang: 'fr',
        },
        bankTransfer: {
          enabled: true,
          bankName: 'Attijariwafa Bank',
          accountHolder: 'Syndik Maroc SARL',
          rib: '007780000123456789012345',
          iban: 'MA64007780000123456789012345',
          swift: 'BCMAMAMC',
          ice: '002489123000045',
        },
        cashPayment: {
          enabled: true,
          acceptedChannels: ['wafacash', 'cashplus', 'baridcash', 'office', 'check'],
          beneficiaryName: 'Syndik Maroc SARL',
          officeAddress: '14 Rue Jean Jaurès, Quartier Gautier, Casablanca',
          officeHours: 'Lun–Ven 09h00–17h30',
          contactPhone: '0522-48-19-20',
          whatsapp: '+212 661-00-19-20',
          maxCashAmountMad: 5000,
          requireProofUpload: true,
        },
        issuerProfile: {
          companyName: 'Syndik Maroc',
          legalForm: 'SARL',
          ice: '002489123000045',
          rc: 'RC 418920',
          ifNumber: '40291834',
          patente: '34819201',
          address: '14 Rue Jean Jaurès, Quartier Gautier',
          city: 'Casablanca',
          email: 'facturation@syndik.ma',
          phone: '0522-48-19-20',
          vatRate: 20,
          invoicePrefix: 'FAC',
          receiptPrefix: 'REC',
        },
        commercialPolicy: {
          gracePeriodDays: 7,
          multiMonthDiscounts: { m3: 5, m6: 10, m12: 20 },
        },
      }),
    });
    if (!cfgRes.ok) {
      throw new Error(`Failed to seed billing config: ${await cfgRes.text()}`);
    }

    await fetch(`${base}/api/admin/promos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        code: 'BIENVENUE20',
        discountType: 'percent',
        discountValue: 20,
        minMonths: 3,
        maxUses: 100,
        description: 'Offre lancement cabinets Maroc (-20%)',
      }),
    });

    const executablePath = resolveChromiumPath();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
    });

    try {
      const openRolePage = async (token?: string) => {
        const ctx = await browser.newContext({
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 1.5,
          locale: 'fr-MA',
        });
        const page = await ctx.newPage();
        page.on('pageerror', (err) => pageErrors.push(err.message));
        await page.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) {
            return route.continue();
          }
          return route.abort();
        });
        await page.addInitScript(
          ({ authToken }) => {
            localStorage.setItem('syndik_lang', 'fr');
            if (authToken) {
              localStorage.setItem(
                'syndik_auth_session_v1',
                JSON.stringify({ serverToken: authToken }),
              );
            }
          },
          { authToken: token || '' },
        );
        return { ctx, page };
      };

      console.log('Capturing Public / Resident Login screenshot...');
      {
        const { ctx, page } = await openRolePage();
        await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 600);
        await snap(page, 'resident', 'login.jpg');
        await ctx.close();
      }

      console.log('Capturing Syndic Portal screenshots (16 screens)...');
      {
        const { ctx, page } = await openRolePage(syndicToken);
        const syndicRoutes: Array<[string, string]> = [
          ['/dashboard', 'dashboard.jpg'],
          ['/buildings', 'buildings.jpg'],
          ['/apartments', 'apartments.jpg'],
          ['/residents', 'residents.jpg'],
          ['/ag', 'ag.jpg'],
          ['/maintenance', 'maintenance.jpg'],
          ['/prestataires', 'prestataires.jpg'],
          ['/documents', 'documents.jpg'],
          ['/announcements', 'announcements.jpg'],
          ['/chat', 'chat.jpg'],
          ['/marketplace', 'marketplace.jpg'],
          ['/settings', 'settings.jpg'],
        ];
        for (const [route, file] of syndicRoutes) {
          await page.goto(`${base}${route}`, { waitUntil: 'domcontentloaded' });
          await waitUiQuiet(page, 700);
          await snap(page, 'syndic', file);
        }

        // Financials sub-tabs
        await page.goto(`${base}/financials`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 800);
        await snap(page, 'syndic', 'financials-expenses.jpg');

        await page.getByRole('button', { name: /Appels de Charges/i }).click();
        await waitUiQuiet(page, 500);
        await snap(page, 'syndic', 'financials-charges.jpg');

        await page.getByRole('button', { name: /Vérification des Virements/i }).click();
        await waitUiQuiet(page, 500);
        await snap(page, 'syndic', 'financials-bank.jpg');

        // Syndic SaaS Renewal Modal (CMI + Cash + Promo + Facture PDF)
        await page.goto(`${base}/dashboard`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 500);
        await page.getByRole('button', { name: /Renouveler \/ Payer/i }).first().click();
        await waitUiQuiet(page, 700);
        await snap(page, 'syndic', 'renewal-modal.jpg');
        await ctx.close();
      }

      console.log('Capturing Resident Portal screenshots (7 screens)...');
      {
        const { ctx, page } = await openRolePage(residentToken);
        await page.goto(`${base}/resident`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 900);
        await snap(page, 'resident', 'overview-charges.jpg');

        // Payment proof modal
        const payBtn = page
          .getByRole('button', {
            name: /Transmettre Justificatif|Déposer un reçu|Payer|Envoyer justificatif/i,
          })
          .first();
        if (await payBtn.isVisible().catch(() => false)) {
          await payBtn.click();
          await waitUiQuiet(page, 600);
          await snap(page, 'resident', 'payment-modal.jpg');
          await page.keyboard.press('Escape');
          await waitUiQuiet(page, 300);
        } else {
          await snap(page, 'resident', 'payment-modal.jpg');
        }

        const residentTabs: Array<[RegExp, string]> = [
          [/AG & Vote Digital|Vote AG|Assemblées/i, 'ag-voting.jpg'],
          [/Incidents & Suivi|Maintenance/i, 'maintenance.jpg'],
          [/Prestataires & Artisans|Prestataires/i, 'providers.jpg'],
          [/Chat Résidence|Messagerie/i, 'chat.jpg'],
          [/Souk Voisins|Souk/i, 'marketplace.jpg'],
        ];
        for (const [pattern, file] of residentTabs) {
          const btn = page.getByRole('button', { name: pattern }).first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await waitUiQuiet(page, 650);
          }
          await snap(page, 'resident', file);
        }
        await ctx.close();
      }

      console.log('Capturing Provider Portal screenshots (2 screens)...');
      {
        const { ctx, page } = await openRolePage(providerToken);
        await page.goto(`${base}/provider`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 900);
        await snap(page, 'provider', 'portal-overview.jpg');

        const updateTicketBtn = page
          .getByRole('button', { name: /Mettre à jour|Intervenir|Compte-rendu|Rapport/i })
          .first();
        if (await updateTicketBtn.isVisible().catch(() => false)) {
          await updateTicketBtn.click();
          await waitUiQuiet(page, 500);
        }
        await snap(page, 'provider', 'ticket-update.jpg');
        await ctx.close();
      }

      console.log('Capturing Super-Admin Console screenshots (6 screens)...');
      {
        const { ctx, page } = await openRolePage(adminToken);
        await page.goto(`${base}/admin`, { waitUntil: 'domcontentloaded' });
        await waitUiQuiet(page, 900);
        await snap(page, 'admin', 'cabinets.jpg');

        // Manage cabinet modal
        const manageBtn = page.getByRole('button', { name: /Gérer l'abonnement/i }).first();
        await manageBtn.click();
        await waitUiQuiet(page, 600);
        await snap(page, 'admin', 'manage-cabinet.jpg');
        await page.keyboard.press('Escape');
        await waitUiQuiet(page, 300);

        const adminTabs: Array<[RegExp, string]> = [
          [/Paiements & Rapports SaaS/i, 'reports.jpg'],
          [/Passerelles & Paiements/i, 'gateways.jpg'],
          [/Facturation & Offres/i, 'commercial.jpg'],
          [/Audit & Webhooks/i, 'audit-webhooks.jpg'],
        ];
        for (const [pattern, file] of adminTabs) {
          await page.getByRole('tab', { name: pattern }).click();
          await waitUiQuiet(page, 650);
          await snap(page, 'admin', file);
        }
        await ctx.close();
      }
    } finally {
      await browser.close();
    }

    if (pageErrors.length > 0) {
      throw new Error(`Uncaught page errors during capture:\n${pageErrors.join('\n')}`);
    }
    console.log('\nAll user guide screenshots captured cleanly with 0 page errors!');
  } finally {
    server.kill('SIGTERM');
    rmSync(tempDir, { recursive: true, force: true });
  }
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
