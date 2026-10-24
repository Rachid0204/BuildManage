// Test-process preload only: redirect the real Gemini HTTP protocol to a loopback fixture.
const fixture = new URL(process.env.AI_TEST_ENDPOINT);
if (process.env.NODE_ENV !== 'test' || fixture.hostname !== '127.0.0.1') throw new Error('Local AI fixture required');
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  return originalFetch(url.hostname === 'generativelanguage.googleapis.com'
    ? new URL(url.pathname + url.search, fixture) : input, options);
};
