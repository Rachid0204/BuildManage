// Read-only deployment check. Optional manager token is read from the environment.
const index = process.argv.indexOf('--url');
if (index < 0 || !process.argv[index + 1]) throw new Error('Usage: npm run diagnose -- --url https://YOUR-CLOUD-RUN-URL');
const origin = new URL(process.argv[index + 1]);
if (origin.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(origin.hostname)) throw new Error('Use HTTPS or a local test service.');
if (origin.username || origin.password) throw new Error('Do not put credentials in the URL.');
const paths = ['/api/health', '/api/ready'];
if (process.env.SYNDIK_DIAGNOSTIC_TOKEN) paths.push('/api/diagnostics');
let failed = false;
for (const path of paths) {
  try {
    const response = await fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(15_000),
      headers: path === '/api/diagnostics' ? { Authorization: `Bearer ${process.env.SYNDIK_DIAGNOSTIC_TOKEN}` } : {} });
    const json = (response.headers.get('content-type') || '').includes('application/json');
    const result = json ? await response.json() : { error: 'Expected a JSON API response. Check the service URL and /api routing.' };
    console.log(JSON.stringify({ path, status: response.status, requestId: response.headers.get('x-request-id'), result }, null, 2));
    if (!response.ok || !json) failed = true;
  } catch (error) { failed = true; console.log(JSON.stringify({ path, error: error.message })); }
}
console.log('Storage write access requires an authenticated attachment submission; a ready response checks database reads only.');
process.exitCode = failed ? 1 : 0;
