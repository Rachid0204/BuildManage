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

export function lifecycleStorage(directory:string):import('./lifecycle').LifecycleStorage {
 return {
  async list(cursor){
   if(cloud()){
    const [files,next]=await bucket().getFiles({prefix:'private/',maxResults:50,autoPaginate:false,...(cursor?{pageToken:cursor}:{})});
    return {files:files.map(file=>({id:file.name.split('/').at(-1)!,key:file.name,createdAt:file.metadata.updated||file.metadata.timeCreated||'',generation:file.metadata.generation === undefined ? undefined : String(file.metadata.generation)})),cursor:next?.pageToken};
   }
   const {readdir,stat}=await import('node:fs/promises');let names:string[];
   try{names=await readdir(directory);}catch(error:any){if(error.code==='ENOENT')return {files:[]};throw error;}
   const page=names.filter(name=>/^[a-f0-9]{64}$/.test(name)&&name>(cursor||'')).sort().slice(0,50),files=[];
   for(const id of page){try{const meta=await stat(path.join(directory,id));files.push({id,key:`private/local/${id}`,createdAt:meta.mtime.toISOString(),generation:String(meta.mtimeMs)});}catch(error:any){if(error.code!=='ENOENT')throw error;}}
   return {files,cursor:page.length===50?page.at(-1):undefined};
  },
  async remove(file){try{
   if(cloud()){if(!file.generation)return false;await bucket().file(file.key).delete({ifGenerationMatch:file.generation});}
   else{const {stat,unlink}=await import('node:fs/promises');const target=path.join(directory,file.id),meta=await stat(target);if(file.generation&&String(meta.mtimeMs)!==file.generation)return false;await unlink(target);}
   return true;
  }catch(error:any){if(error.code===404||error.code==='ENOENT')return true;if(error.code===412)return false;throw dependencyFailure('storage',error);}}
 };
}

