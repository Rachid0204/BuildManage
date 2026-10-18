import { z } from 'zod';

export const ResidentSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(6, "Phone number must be at least 6 digits"),
  isOwner: z.boolean(),
  syndicId: z.string(),
  buildingId: z.string(),
  apartmentId: z.string().nullable().optional(),
  cin: z.string().optional(),
  hasAccount: z.boolean().optional(),
  generatedPassword: z.string().optional(),
  credentialsCreatedAt: z.string().optional(),
  credentialsSharedAt: z.string().optional(),
  credentialsLastSharedMethod: z.enum(['pdf', 'copy']).optional(),
  credentialsAuditLog: z
    .array(
      z.object({
        action: z.enum(['generated', 'regenerated', 'shared_pdf', 'shared_copy']),
        timestamp: z.string(),
      })
    )
    .optional(),
  mustChangePassword: z.boolean().optional(),
});

export const ApartmentSchema = z.object({
  id: z.string().optional(),
  number: z.string().min(1, "Apartment number is required"),
  floor: z.number().int().min(-5, "Invalid floor (must be -5 or higher)"),
  area: z.number().nonnegative("Area must be non-negative"),
  buildingId: z.string(),
  monthlyFees: z.number().nonnegative("Fees cannot be negative"),
  tantiemes: z.number().nonnegative().optional().default(100),
  coproType: z.enum(['apartment', 'duplex', 'commercial', 'parking', 'box']).optional().default('apartment'),
  ownerId: z.string().nullable().optional(),
  tenantId: z.string().nullable().optional(),
});

export const BuildingSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Building name is required"),
  address: z.string().min(3, "Address is required"),
  city: z.string().min(2, "City is required"),
  monthlySyndicFees: z.number().nonnegative(),
  totalTantiemes: z.number().optional().default(1000),
  reserveFundRate: z.number().optional().default(5),
  bankName: z.string().optional(),
  bankRib: z.string().optional(),
  managerName: z.string().optional(),
  managerPhone: z.string().optional(),
  syndicId: z.string(),
});

export const SyndicSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2, "Company name is required"),
  logoUrl: z.string().url().optional().or(z.literal('')),
  syndicType: z.enum(['professionnel', 'benevole']).optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  ice: z.string().optional(),
  taxId: z.string().optional(),
  rc: z.string().optional(),
  patente: z.string().optional(),
  bankName: z.string().optional(),
  rib: z.string().optional(),
});

export const TransactionSchema = z.object({
  id: z.string().optional(),
  description: z.string().min(3, "Le libellé de l'opération est obligatoire (min 3 caractères)"),
  amount: z.number().positive("Le montant doit être supérieur à 0"),
  type: z.enum(['income', 'expense']),
  category: z
    .enum([
      'maintenance',
      'fees',
      'salary',
      'utility',
      'reserve',
      'insurance',
      'bank_fees',
      'legal',
      'cleaning',
      'elevator',
      'reimbursement',
      'other',
    ])
    .optional(),
  fundType: z.enum(['courant', 'reserve']).default('courant'),
  paymentMethod: z.enum(['virement', 'cmi', 'versement', 'cheque', 'especes']).optional(),
  date: z.string(),
  reference: z.string().optional(),
  documentType: z.enum(['facture', 'quittance', 'recu', 'devis', 'releve', 'autre']).optional(),
  invoiceNumber: z.string().optional(),
  thirdPartyName: z.string().optional(),
  thirdPartyIce: z.string().optional(),
  bankName: z.string().optional(),
  lotNumber: z.string().optional(),
  notes: z.string().optional(),
});

export type ValidResident = z.infer<typeof ResidentSchema>;
export type ValidApartment = z.infer<typeof ApartmentSchema>;
export type ValidBuilding = z.infer<typeof BuildingSchema>;
export type ValidSyndic = z.infer<typeof SyndicSchema>;
export type ValidTransaction = z.infer<typeof TransactionSchema>;
