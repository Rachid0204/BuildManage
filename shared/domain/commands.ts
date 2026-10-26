import type { Apartment, Building, Quittance, Transaction } from '../../types';

export interface SetOpeningBalancesCommand {
  buildingId: string;
  working: number;
  reserve: number;
  reason: string;
}
export interface PostIncomeCommand {
  buildingId: string;
  amount: number;
  paymentId: string;
  details: Partial<Transaction>;
}
export type CreateQuittanceCommand = Omit<Quittance, 'id' | 'quittanceNumber' | 'createdAt'> & {
  quittanceNumber?: string;
  addTransactionToLedger?: boolean;
};
export interface AddBuildingCommand {
  syndicId: string;
  building: Omit<Building, 'id' | 'residents' | 'apartments' | 'announcements' | 'documents' | 'financials' | 'syndicId'> & {
    apartments?: Omit<Apartment, 'id' | 'buildingId'>[];
  };
}
export interface ToggleAGVotingCommand { agId: string; isOpen: boolean }
