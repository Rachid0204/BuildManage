import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (!process.env.FIRESTORE_EMULATOR_HOST?.startsWith('127.0.0.1:')) {
  throw new Error('Cloud UI simulation requires the local demo Firestore emulator.');
}
const cli = fileURLToPath(new URL('../../node_modules/@playwright/test/cli.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  env: { ...process.env, UI_TEST_BACKEND: 'firestore' }, stdio: 'inherit',
});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
