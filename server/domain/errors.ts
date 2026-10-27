export class OperationError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code = 'OPERATION_REJECTED',
  ) {
    super(message);
  }
}
export interface Actor {
  uid: string;
  role: string;
  email?: string;
  syndicId?: string;
  buildingId?: string;
  residentId?: string;
  prestataireId?: string;
}
