import net from 'node:net';
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const options = typeof args[0] === 'object' ? args[0] : { port: args[0], host: args[1] };
  if (!['127.0.0.1', 'localhost', '::1'].includes(options.host || 'localhost')) {
    throw new Error('External network blocked by local regression guard');
  }
  return connect.apply(this, args);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const value = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  // Preserve native relative-URL behavior used by the current Node service test adapter.
  if (value.startsWith('/')) return originalFetch(input, options);
  const url = new URL(value);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('External network blocked by local regression guard');
  return originalFetch(input, options);
};
