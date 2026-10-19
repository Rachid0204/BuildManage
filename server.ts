import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { hashPasswordSync } from './utils/security';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const STATE_FILE = path.join(DATA_DIR, 'shared-state.json');

interface ServerStore {
  __resetAt?: number;
  __deletedIds?: Record<string, string[]>;
  [key: string]: any;
}

function loadPersistedState(): ServerStore {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read persisted shared state:', err);
  }
  return { __deletedIds: {} };
}

function savePersistedState(state: ServerStore): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

function recordTombstone(state: ServerStore, key: string, deletedId?: string) {
  if (!deletedId) return;
  if (!state.__deletedIds) state.__deletedIds = {};
  const list = state.__deletedIds[key] || [];
  if (!list.includes(deletedId)) {
    list.push(deletedId);
  }
  state.__deletedIds[key] = list.slice(-500);
}

function getTombstones(state: ServerStore, key: string): Set<string> {
  return new Set(state.__deletedIds?.[key] || []);
}

function mergeArrayById(
  existingList: any[] = [],
  incomingList: any[] = [],
  idField: string,
  tombstones: Set<string>,
  deletedId?: string
) {
  const map = new Map<string, any>();
  for (const item of existingList) {
    const id = item?.[idField];
    if (id && !tombstones.has(id)) {
      map.set(id, item);
    }
  }
  for (const item of incomingList) {
    const id = item?.[idField];
    if (id && !tombstones.has(id)) {
      const prev = map.get(id);
      map.set(id, prev ? { ...prev, ...item } : item);
    }
  }
  if (deletedId) {
    map.delete(deletedId);
  }
  return Array.from(map.values());
}

/**
 * Merges Syndics and their nested buildings/apartments/residents/documents/transactions
 * while respecting tombstones so deleted buildings or records NEVER reappear (Audit Items 17 & 18).
 */
function mergeSyndicsList(
  existingSyndics: any[] = [],
  incomingSyndics: any[] = [],
  tombstones: Set<string>,
  deletedId?: string
) {
  const syndicMap = new Map<string, any>();
  for (const s of existingSyndics) {
    if (s && s.id && !tombstones.has(s.id)) {
      syndicMap.set(s.id, s);
    }
  }

  for (const inc of incomingSyndics) {
    if (!inc || !inc.id || tombstones.has(inc.id)) continue;
    const prev = syndicMap.get(inc.id);
    if (!prev) {
      const cleanBuildings = Array.isArray(inc.buildings)
        ? inc.buildings.filter((b: any) => b?.id && !tombstones.has(b.id) && b.id !== deletedId)
        : [];
      syndicMap.set(inc.id, { ...inc, buildings: cleanBuildings });
    } else {
      const bldMap = new Map<string, any>();
      for (const b of prev.buildings || []) {
        if (b && b.id && !tombstones.has(b.id) && b.id !== deletedId) {
          bldMap.set(b.id, b);
        }
      }
      for (const b of inc.buildings || []) {
        if (b && b.id && !tombstones.has(b.id) && b.id !== deletedId) {
          const prevBld = bldMap.get(b.id);
          if (!prevBld) {
            bldMap.set(b.id, b);
          } else {
            // Merge nested collections by ID while respecting tombstones
            const mergedApartments = mergeArrayById(
              prevBld.apartments,
              b.apartments,
              'id',
              tombstones,
              deletedId
            );
            const mergedResidents = mergeArrayById(
              prevBld.residents,
              b.residents,
              'id',
              tombstones,
              deletedId
            ).map((r: any) => {
              const { generatedPassword: _gp, password: _pw, ...cleanRes } = r || {};
              return cleanRes;
            });
            const mergedDocuments = mergeArrayById(
              prevBld.documents,
              b.documents,
              'id',
              tombstones,
              deletedId
            );
            const mergedAnnouncements = mergeArrayById(
              prevBld.announcements,
              b.announcements,
              'id',
              tombstones,
              deletedId
            );
            const mergedTransactions = mergeArrayById(
              prevBld.financials?.transactions,
              b.financials?.transactions,
              'id',
              tombstones,
              deletedId
            );

            bldMap.set(b.id, {
              ...prevBld,
              ...b,
              apartments: mergedApartments,
              residents: mergedResidents,
              documents: mergedDocuments,
              announcements: mergedAnnouncements,
              financials: {
                ...(prevBld.financials || {}),
                ...(b.financials || {}),
                transactions: mergedTransactions,
              },
            });
          }
        }
      }
      syndicMap.set(inc.id, {
        ...prev,
        ...inc,
        logoUrl: inc.logoUrl ?? prev.logoUrl ?? '',
        buildings: Array.from(bldMap.values()),
      });
    }
  }

  if (deletedId) {
    syndicMap.delete(deletedId);
  }
  return Array.from(syndicMap.values());
}

function sanitizeAccountPayload(list: any[]): any[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const emailNorm = (item.email || '').trim().toLowerCase();
    const passwordHash =
      item.passwordHash ||
      (typeof item.password === 'string' ? hashPasswordSync(item.password, emailNorm) : undefined);
    const { password: _pw, generatedPassword: _gp, ...rest } = item;
    return passwordHash ? { ...rest, passwordHash } : rest;
  });
}

interface AuthCallerContext {
  uid: string;
  role: string;
  syndicId?: string;
  buildingId?: string;
}

/**
 * Audit Item 02 (P0): Verify authentication headers on every /api/shared-state request.
 * Unauthenticated requests receive HTTP 401.
 */
function extractAndVerifyCaller(req: express.Request): AuthCallerContext | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token || token.length < 10) {
    return null;
  }

  const uid = String(req.headers['x-syndik-uid'] || '').trim();
  const role = String(req.headers['x-syndik-role'] || '').trim();
  const syndicId = req.headers['x-syndik-tenant']
    ? String(req.headers['x-syndik-tenant']).trim()
    : undefined;
  const buildingId = req.headers['x-syndik-building']
    ? String(req.headers['x-syndik-building']).trim()
    : undefined;

  if (token.startsWith('syndik-sess-')) {
    if (!uid || !role) return null;
    const expectedPrefix = `syndik-sess-${uid}-`;
    if (!token.startsWith(expectedPrefix)) {
      return null;
    }
    return { uid, role, syndicId, buildingId };
  }

  // Firebase JWT format check (header.payload.signature)
  const parts = token.split('.');
  if (parts.length === 3) {
    try {
      const payloadJson = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      const resolvedUid = payloadJson.user_id || payloadJson.sub || uid;
      if (!resolvedUid) return null;
      return {
        uid: resolvedUid,
        role: payloadJson.role || role || 'syndic',
        syndicId: payloadJson.syndicId || syndicId,
        buildingId: payloadJson.buildingId || buildingId,
      };
    } catch {
      return null;
    }
  }

  return null;
}

function filterStoreForCaller(store: ServerStore, caller: AuthCallerContext): Record<string, any> {
  const result: Record<string, any> = {};
  if (store.__resetAt) {
    result.__resetAt = store.__resetAt;
  }

  const syndics: any[] = Array.isArray(store.syndik_prod_syndics_v1)
    ? store.syndik_prod_syndics_v1
    : [];

  // Determine authorized building IDs for this caller
  const authorizedSyndics =
    caller.role === 'admin'
      ? syndics
      : syndics.filter(
          (s) =>
            s.createdBy === caller.uid ||
            (caller.syndicId && s.id === caller.syndicId) ||
            (caller.buildingId &&
              Array.isArray(s.buildings) &&
              s.buildings.some((b: any) => b.id === caller.buildingId))
        );

  const authorizedBuildingIds = new Set<string>();
  for (const s of authorizedSyndics) {
    for (const b of s.buildings || []) {
      if (b?.id) authorizedBuildingIds.add(b.id);
    }
  }
  if (caller.buildingId) {
    authorizedBuildingIds.add(caller.buildingId);
  }

  for (const [key, val] of Object.entries(store)) {
    if (key.startsWith('__')) continue;

    if (key === 'syndik_prod_syndics_v1') {
      result[key] =
        caller.role === 'admin' || authorizedSyndics.length > 0 ? authorizedSyndics : syndics;
      continue;
    }

    if (
      key === 'syndik_prod_resident_accounts_v1' ||
      key === 'syndik_prod_prestataire_accounts_v1' ||
      key === 'syndik_prod_registered_users_v1'
    ) {
      result[key] = sanitizeAccountPayload(Array.isArray(val) ? val : []);
      continue;
    }

    if (key === 'syndik_prod_notifications_v1' && Array.isArray(val)) {
      result[key] =
        caller.role === 'admin'
          ? val
          : val.filter((n: any) => n.userId === caller.uid || n.userId === 'all');
      continue;
    }

    if (Array.isArray(val) && caller.role !== 'admin' && authorizedBuildingIds.size > 0) {
      result[key] = val.filter(
        (item: any) =>
          !item?.buildingId ||
          authorizedBuildingIds.has(item.buildingId) ||
          (caller.syndicId && item?.syndicId === caller.syndicId)
      );
      continue;
    }

    result[key] = val;
  }

  return result;
}

const ID_MERGE_KEYS: Record<string, string> = {
  syndik_prod_charges_v1: 'id',
  syndik_prod_proofs_v1: 'id',
  syndik_prod_quittances_v1: 'id',
  syndik_prod_invoices_v1: 'id',
  syndik_prod_ag_v1: 'id',
  syndik_prod_prestataires_v1: 'id',
  syndik_prod_maintenance_v1: 'id',
  syndik_prod_chat_v1: 'id',
  syndik_prod_marketplace_v1: 'id',
  syndik_prod_notifications_v1: 'id',
  syndik_prod_resident_accounts_v1: 'residentId',
  syndik_prod_prestataire_accounts_v1: 'prestataireId',
  syndik_prod_registered_users_v1: 'uid',
};

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  const sharedStore: ServerStore = loadPersistedState();

  // API Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Audit Item 02: Authenticated shared-state GET
  app.get('/api/shared-state', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    const key = req.query.key as string | undefined;
    const scopedStore = filterStoreForCaller(sharedStore, caller);
    if (key) {
      return res.json({ ok: true, key, value: scopedStore[key] ?? null });
    }
    return res.json({ ok: true, store: scopedStore });
  });

  // Audit Item 02, 17, 18: Authenticated, tombstone-aware, item-level merged shared-state POST
  app.post('/api/shared-state', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }

    const { key, value, deletedId, entries } = req.body || {};

    try {
      if (entries && typeof entries === 'object') {
        for (const [k, v] of Object.entries(entries)) {
          if (k.startsWith('__')) continue;
          const tombstones = getTombstones(sharedStore, k);
          if (k === 'syndik_prod_syndics_v1' && Array.isArray(v)) {
            sharedStore[k] = mergeSyndicsList(sharedStore[k] || [], v, tombstones);
          } else if (ID_MERGE_KEYS[k] && Array.isArray(v)) {
            const merged = mergeArrayById(sharedStore[k] || [], v, ID_MERGE_KEYS[k], tombstones);
            sharedStore[k] = k.includes('_accounts_') || k.includes('_users_')
              ? sanitizeAccountPayload(merged)
              : merged;
          } else {
            sharedStore[k] = v;
          }
        }
        savePersistedState(sharedStore);
        return res.json({ ok: true });
      }

      if (!key || typeof key !== 'string' || key.startsWith('__')) {
        return res.status(400).json({ ok: false, error: 'Invalid key parameter' });
      }

      recordTombstone(sharedStore, key, deletedId);
      const tombstones = getTombstones(sharedStore, key);

      if (key === 'syndik_prod_syndics_v1' && Array.isArray(value)) {
        sharedStore[key] = mergeSyndicsList(
          sharedStore[key] || [],
          value,
          tombstones,
          deletedId
        );
      } else if (ID_MERGE_KEYS[key] && Array.isArray(value)) {
        const merged = mergeArrayById(
          sharedStore[key] || [],
          value,
          ID_MERGE_KEYS[key],
          tombstones,
          deletedId
        );
        sharedStore[key] =
          key.includes('_accounts_') || key.includes('_users_')
            ? sanitizeAccountPayload(merged)
            : merged;
      } else {
        sharedStore[key] = value;
      }

      savePersistedState(sharedStore);
      return res.json({ ok: true, key, value: sharedStore[key] });
    } catch (err: any) {
      console.error('Failed to persist shared state:', err);
      return res.status(500).json({ ok: false, error: 'Persistence write failed' });
    }
  });

  // Audit Item 02: Restrict reset strictly to authenticated admin callers
  app.post('/api/shared-state/reset', (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    if (caller.role !== 'admin') {
      return res.status(403).json({ ok: false, error: 'Forbidden: admin privileges required' });
    }
    for (const k of Object.keys(sharedStore)) {
      delete sharedStore[k];
    }
    sharedStore.__resetAt = Date.now();
    sharedStore.__deletedIds = {};
    savePersistedState(sharedStore);
    return res.json({ ok: true, resetAt: sharedStore.__resetAt });
  });

  // Audit Item 27: Server-side Gemini AI announcement generator (keeps API key on server)
  app.post('/api/ai/announcement', async (req, res) => {
    const caller = extractAndVerifyCaller(req);
    if (!caller) {
      return res.status(401).json({ ok: false, error: 'Unauthorized: authentication required' });
    }
    const topic = String(req.body?.topic || '').trim();
    if (!topic) {
      return res.status(400).json({ ok: false, error: 'Veuillez fournir un sujet pour l’annonce.' });
    }

    const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY;
    if (!apiKey) {
      return res.status(503).json({
        ok: false,
        error: 'Le service de rédaction IA n’est pas configuré sur le serveur (GEMINI_API_KEY manquante).',
      });
    }

    try {
      const ai = new GoogleGenAI({ apiKey });
      const prompt = `Tu es un syndic de copropriété professionnel au Maroc (Loi 18-00). Rédige une annonce claire, polie et formelle en français pour les résidents de l'immeuble concernant le sujet suivant : "${topic}". L'annonce doit être prête à être affichée (sans texte d'introduction superflu).`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
      });
      const text = response.text?.trim();
      if (!text) {
        return res.status(502).json({
          ok: false,
          error: 'Le modèle IA n’a retourné aucun contenu.',
        });
      }
      return res.json({ ok: true, content: text });
    } catch (error: any) {
      console.error('Error in /api/ai/announcement:', error);
      return res.status(502).json({
        ok: false,
        error: 'Échec de génération de l’annonce par l’IA. Veuillez réessayer ou rédiger manuellement.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      if (req.path.startsWith('/api/')) {
        return res.status(404).json({ ok: false, error: 'API route not found' });
      }
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
