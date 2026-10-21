import { getApps, initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dependencyFailure } from './dependencyErrors';

// Staging can use the production adapter; production never falls back to local disk.
const cloud = () => process.env.NODE_ENV === 'production' || process.env.SYNDIK_UPLOAD_BACKEND === 'gcs';
function bucket() {
  return getStorage(getApps()[0] || initializeApp()).bucket(process.env.SYNDIK_UPLOAD_BUCKET);
}

export async function savePrivateFile(directory: string, id: string, key: string, bytes: Buffer, mime: string) {
  try {
    if (cloud()) await bucket().file(key).save(bytes, {
      resumable: false,
      contentType: mime,
      metadata: { cacheControl: 'private, no-store' },
    });
    else {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, id), bytes, { mode: 0o600 });
    }
  } catch (error) { throw dependencyFailure('storage', error); }
}

export async function readPrivateFile(directory: string, id: string, key: string): Promise<Buffer> {
  try {
    return cloud() ? (await bucket().file(key).download())[0] : await readFile(path.join(directory, id));
  } catch (error) { throw dependencyFailure('storage', error); }
}
