import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '.data');
const STORE_FILE = path.join(DATA_DIR, 'syndik-shared-store.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readStore(): Record<string, any> {
  try {
    ensureDataDir();
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed to read shared store:', err);
  }
  return {};
}

function writeStore(data: Record<string, any>) {
  try {
    ensureDataDir();
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to write shared store:', err);
  }
}

function mergeArrayById(
  existingList: any[],
  incomingList: any[],
  idField: string,
  deletedIds: Set<string>
): any[] {
  if (!Array.isArray(existingList) || existingList.length === 0) {
    return Array.isArray(incomingList)
      ? incomingList.filter((item) => item && !deletedIds.has(String(item[idField])))
      : [];
  }
  if (!Array.isArray(incomingList)) {
    return existingList.filter((item) => item && !deletedIds.has(String(item[idField])));
  }

  const resultMap = new Map<string, any>();

  // First add incoming items in their order (newest first)
  for (const item of incomingList) {
    if (!item || !item[idField]) continue;
    const id = String(item[idField]);
    if (deletedIds.has(id)) continue;
    resultMap.set(id, item);
  }

  // Also preserve any existing items from other users/sessions that weren't in the incoming client's local cache
  for (const existingItem of existingList) {
    if (!existingItem || !existingItem[idField]) continue;
    const id = String(existingItem[idField]);
    if (deletedIds.has(id)) continue;
    if (!resultMap.has(id)) {
      resultMap.set(id, existingItem);
    } else if (idField === 'id' && Array.isArray(existingItem.buildings)) {
      // For Syndic objects, if the existing server record has more buildings or residents created in another session,
      // ensure buildings created by that Syndic are preserved unless explicitly updated
      const incSyndic = resultMap.get(id);
      if (Array.isArray(incSyndic.buildings)) {
        const bldMap = new Map<string, any>();
        for (const b of incSyndic.buildings) {
          if (b && b.id) bldMap.set(String(b.id), b);
        }
        for (const eb of existingItem.buildings) {
          if (eb && eb.id && !bldMap.has(String(eb.id)) && !deletedIds.has(String(eb.id))) {
            bldMap.set(String(eb.id), eb);
          }
        }
        incSyndic.buildings = Array.from(bldMap.values());
      }
    }
  }

  return Array.from(resultMap.values());
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '15mb' }));

  // Shared multi-user state API endpoints
  app.get('/api/shared-state', (_req, res) => {
    const store = readStore();
    res.json({ ok: true, store });
  });

  app.get('/api/shared-state/:key', (req, res) => {
    const store = readStore();
    const key = req.params.key;
    res.json({ ok: true, key, value: store[key] ?? null });
  });

  app.post('/api/shared-state', (req, res) => {
    const { key, value, deletedId } = req.body || {};
    if (!key || typeof key !== 'string') {
      res.status(400).json({ ok: false, error: 'Missing key' });
      return;
    }

    const store = readStore();
    const deletedSet = new Set<string>(Array.isArray(store.__deletedIds) ? store.__deletedIds : []);
    if (deletedId && typeof deletedId === 'string') {
      deletedSet.add(deletedId);
      store.__deletedIds = Array.from(deletedSet);
    }

    if (key === 'syndik_reactive_syndics') {
      store[key] = mergeArrayById(store[key] || [], value, 'id', deletedSet);
    } else if (key === 'syndik_reactive_prestataires_v2') {
      store[key] = mergeArrayById(store[key] || [], value, 'id', deletedSet);
    } else if (key === 'syndik_resident_accounts_v1') {
      store[key] = mergeArrayById(store[key] || [], value, 'residentId', deletedSet);
    } else if (key === 'syndik_prestataire_accounts_v1') {
      store[key] = mergeArrayById(store[key] || [], value, 'prestataireId', deletedSet);
    } else if (key === 'syndik_registered_users_v1') {
      store[key] = mergeArrayById(store[key] || [], value, 'uid', deletedSet);
    } else {
      store[key] = value;
    }

    store.__updatedAt = new Date().toISOString();
    writeStore(store);
    res.json({ ok: true, key, value: store[key], updatedAt: store.__updatedAt });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.use((_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
