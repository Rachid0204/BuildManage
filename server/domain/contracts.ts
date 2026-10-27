import { z } from 'zod';
import type { AddBuildingCommand,CreateQuittanceCommand,PostIncomeCommand,SetOpeningBalancesCommand,ToggleAGVotingCommand } from '../../shared/domain/commands';
import { ApartmentSchema,BuildingSchema } from '../../utils/validation';

export const SetOpeningBalancesSchema = z.object({
 buildingId:z.string().min(1), working:z.number().finite(), reserve:z.number().finite(), reason:z.string().min(1),
}) as z.ZodType<SetOpeningBalancesCommand>;
export const PostIncomeSchema = z.object({
 buildingId:z.string().min(1), amount:z.number().finite().nonnegative(), paymentId:z.string().min(1), details:z.object({}).passthrough(),
}) as z.ZodType<PostIncomeCommand>;
export const ToggleAGVotingSchema = z.object({agId:z.string().min(1),isOpen:z.boolean()}) as z.ZodType<ToggleAGVotingCommand>;
export const AddBuildingSchema = z.object({
 syndicId:z.string().min(1), building:BuildingSchema.omit({id:true,syndicId:true}).extend({apartments:z.array(ApartmentSchema.omit({id:true,buildingId:true})).optional()}),
}) as z.ZodType<AddBuildingCommand>;
export const CreateQuittanceSchema = z.object({
 chargeId:z.string().min(1), buildingId:z.string().min(1), syndicId:z.string().min(1), residentId:z.string().min(1),
 buildingName:z.string(), syndicName:z.string(), residentName:z.string(), apartmentNumber:z.string(),
 amount:z.number().finite(), periodCovered:z.string(), paymentDate:z.string(), paymentMethod:z.string(),
 addTransactionToLedger:z.boolean().optional(),
}).passthrough() as z.ZodType<CreateQuittanceCommand>;
