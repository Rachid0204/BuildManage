import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const targetConfig = JSON.parse(
  readFileSync(path.join(ROOT, 'deploy', 'target.json'), 'utf8'),
) as { publicAppUrl?: string };

const rawApiBase = (process.env.VITE_API_BASE_URL || targetConfig.publicAppUrl || '').trim();
const allowLocal = process.env.ALLOW_LOCAL_API === 'true';

let parsed: URL;
try {
  parsed = new URL(rawApiBase);
} catch {
  console.error(`Invalid VITE_API_BASE_URL: "${rawApiBase}". Provide a full https:// backend URL.`);
  process.exit(1);
}

if (parsed.protocol !== 'https:' && !allowLocal) {
  console.error(
    `Refusing non-HTTPS VITE_API_BASE_URL "${rawApiBase}" for mobile build. Set ALLOW_LOCAL_API=true only for local testing.`,
  );
  process.exit(1);
}

const platformArg = process.argv.find((arg) => arg === '--android' || arg === '--ios');
const capTarget = platformArg ? [platformArg.slice(2)] : [];
const normalizedBase = `${parsed.origin}${parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '')}`;

console.log(`Building SyndicUnion mobile web bundle with VITE_API_BASE_URL=${normalizedBase}`);

const env = {
  ...process.env,
  VITE_API_BASE_URL: normalizedBase,
};

execFileSync('npx', ['vite', 'build'], { cwd: ROOT, env, stdio: 'inherit' });
execFileSync('npx', ['cap', 'sync', ...capTarget], { cwd: ROOT, env, stdio: 'inherit' });

console.log(
  `SyndicUnion mobile bundle synced (${capTarget.length ? capTarget[0] : 'android + ios'}).`,
);
