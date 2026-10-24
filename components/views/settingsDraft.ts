import type { Syndic } from '../../types';

export const SETTINGS_FIELDS = ['name', 'logoUrl', 'ice', 'taxId', 'rc', 'patente'] as const;
export type SettingsField = typeof SETTINGS_FIELDS[number];
export type SettingsValues = Record<SettingsField, string>;
export const settingsValues = (cabinet: Partial<Syndic>): SettingsValues =>
  Object.fromEntries(SETTINGS_FIELDS.map(field => [field, String(cabinet[field] ?? '')])) as SettingsValues;

interface SettingsDraft {
  values: SettingsValues;
  remote: SettingsValues;
  conflicts: SettingsField[];
  pending?: { submitted: SettingsValues; local: SettingsValues; remote: SettingsValues };
}
type Action =
  | { type: 'edit'; field: SettingsField; value: string }
  | { type: 'remote'; values: SettingsValues }
  | { type: 'useRemote'; field: SettingsField }
  | { type: 'keepLocal'; field: SettingsField }
  | { type: 'saveStarted'; values: SettingsValues }
  | { type: 'saved'; values: SettingsValues }
  | { type: 'saveFailed' };

export function createSettingsDraft(cabinet: Syndic): SettingsDraft {
  const values = settingsValues(cabinet);
  return { values, remote: values, conflicts: [] };
}

/** Compare fields against the last server values; outer cabinet references carry no draft identity. */
export function settingsDraftReducer(state: SettingsDraft, action: Action): SettingsDraft {
  const conflicts = new Set(state.conflicts);
  if (action.type === 'edit') {
    if (action.value === state.remote[action.field]) conflicts.delete(action.field);
    return { ...state, values: { ...state.values, [action.field]: action.value }, conflicts: [...conflicts] };
  }
  if (action.type === 'useRemote' || action.type === 'keepLocal') {
    conflicts.delete(action.field);
    return { ...state, values: action.type === 'useRemote'
      ? { ...state.values, [action.field]: state.remote[action.field] } : state.values, conflicts: [...conflicts] };
  }
  if (action.type === 'saveStarted') return { ...state,
    pending: { submitted: action.values, local: state.values, remote: state.remote } };
  if (action.type === 'saveFailed') return { ...state, pending: undefined };
  const values = { ...state.values };
  if (action.type === 'remote') {
    for (const field of SETTINGS_FIELDS) {
      const dirty = values[field] !== state.remote[field];
      if (!dirty) values[field] = action.values[field];
      const ownAcknowledgement = state.pending?.submitted[field] === action.values[field];
      if (!dirty || values[field] === action.values[field] || ownAcknowledgement) conflicts.delete(field);
      else if (action.values[field] !== state.remote[field]) conflicts.add(field);
    }
    return { ...state, values, remote: action.values, conflicts: [...conflicts] };
  }
  if (!state.pending) return state;
  const remote = { ...state.remote };
  for (const field of SETTINGS_FIELDS) {
    const changedRemotely = remote[field] !== state.pending.remote[field] &&
      remote[field] !== state.pending.submitted[field] && remote[field] !== action.values[field];
    // A newer live value must not be rolled back by an older save completion.
    if (changedRemotely) {
      if (values[field] !== remote[field]) conflicts.add(field);
      continue;
    }
    remote[field] = action.values[field];
    if (values[field] === state.pending.local[field]) values[field] = action.values[field];
    conflicts.delete(field);
  }
  return { values, remote, conflicts: [...conflicts], pending: undefined };
}
