import { createRepository } from '../server/repository';
import { reencryptDurableState } from '../server/mailer';

const repository = createRepository();
const updated = await repository.transaction(async state => reencryptDurableState(state));
console.log(JSON.stringify({ reencrypted: updated, activeKid: process.env.SYNDIK_ENCRYPTION_KEYS
  ? JSON.parse(process.env.SYNDIK_ENCRYPTION_KEYS).primary.kid
  : 'legacy-server' }));
