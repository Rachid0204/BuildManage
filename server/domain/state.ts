import { hashPasswordSync,isAlreadyHashedPassword } from '../../utils/security';
import type { State } from '../repository';
import { STORAGE_KEYS } from './records';
function stripPlaintextCredentialsForStorage<T>(key: string, val: T): T {
  if (!val) return val;
  if (key === STORAGE_KEYS.SYNDICS && Array.isArray(val)) {
    return val.map((syndic: any) => ({
      ...syndic,
      buildings: Array.isArray(syndic.buildings)
        ? syndic.buildings.map((bld: any) => ({
            ...bld,
            residents: Array.isArray(bld.residents)
              ? bld.residents.map((res: any) => {
                  const { generatedPassword: _gp, password: _pw, ...cleanRes } = res || {};
                  return cleanRes;
                })
              : [],
          }))
        : [],
    })) as unknown as T;
  }
  if (key === STORAGE_KEYS.PRESTATAIRES && Array.isArray(val)) {
    return val.map((prest: any) => {
      const { generatedPassword: _gp, password: _pw, ...cleanPrest } = prest || {};
      return cleanPrest;
    }) as unknown as T;
  }
  if (
    (key === STORAGE_KEYS.RESIDENT_ACCOUNTS ||
      key === STORAGE_KEYS.PRESTATAIRE_ACCOUNTS ||
      key === STORAGE_KEYS.REGISTERED_USERS) &&
    Array.isArray(val)
  ) {
    return val.map((acc: any) => {
      const emailNorm = (acc?.email || '').trim().toLowerCase();
      const passwordHash =
        acc?.passwordHash ||
        (typeof acc?.password === 'string'
          ? isAlreadyHashedPassword(acc.password)
            ? acc.password
            : hashPasswordSync(acc.password, emailNorm)
          : '');
      const { password: _pw, generatedPassword: _gp, ...cleanAcc } = acc || {};
      return { ...cleanAcc, passwordHash };
    }) as unknown as T;
  }
  return val;
}
/** Detached values preserve existing copy-on-write semantics within the injected transaction. */
export function transactionRecords(state: State) {
 const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
 return {
  read<T>(key: string, fallback: T): T {
   if (state[key] === undefined) { const clean=stripPlaintextCredentialsForStorage(key,fallback); state[key]=clone(clean); return clean; }
   return clone(state[key]);
  },
  write<T>(key: string, value: T, deletedId?: string): void {
   if(deletedId) { const ids=state.syndik_deleted_building_ids_v1 ??= []; if(!ids.includes(deletedId))ids.push(deletedId); }
   state[key]=clone(stripPlaintextCredentialsForStorage(key,value));
  }
 };
}
