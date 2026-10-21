import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

function crc32c(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return result.toString('base64');
}

/** Minimal loopback GCS JSON API double: exercises the real Admin Storage client. */
export async function startStorageEmulator() {
  const objects = new Map<string, { bytes: Buffer; mime: string }>();
  const faults = { status: 0 };
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    requests.push(`${req.method} ${url.pathname}`);
    if (faults.status) {
      res.writeHead(faults.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { code: faults.status, message: 'Synthetic storage dependency failure' } }));
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/upload/storage/v1/b/')) {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const boundary = /boundary="?([^";]+)/.exec(String(req.headers['content-type']))?.[1];
      if (!boundary) { res.writeHead(400).end(); return; }
      const firstBody = body.indexOf('\r\n\r\n') + 4;
      const metadataEnd = body.indexOf(`\r\n--${boundary}`, firstBody);
      const metadata = JSON.parse(body.subarray(firstBody, metadataEnd).toString());
      const dataStart = body.indexOf('\r\n\r\n', metadataEnd) + 4;
      const dataEnd = body.lastIndexOf(`\r\n--${boundary}`);
      const bytes = body.subarray(dataStart, dataEnd);
      const key = url.searchParams.get('name') || metadata.name;
      objects.set(key, { bytes, mime: metadata.contentType || 'application/octet-stream' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: key, size: String(bytes.length), contentType: metadata.contentType, crc32c: crc32c(bytes), md5Hash: createHash('md5').update(bytes).digest('base64') }));
      return;
    }
    const match = url.pathname.match(/\/b\/[^/]+\/o\/(.+)$/);
    const item = match && objects.get(decodeURIComponent(match[1]));
    if (!item) { res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: { code: 404, message: 'Synthetic object missing' } })); return; }
    if (req.method === 'DELETE') { objects.delete(decodeURIComponent(match![1])); res.writeHead(204).end(); return; }
    res.writeHead(200, { 'Content-Type': item.mime, 'x-goog-hash': `crc32c=${crc32c(item.bytes)},md5=${createHash('md5').update(item.bytes).digest('base64')}` });
    res.end(item.bytes);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as { port: number };
  return { url: `http://127.0.0.1:${address.port}`, objects, faults, requests,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) };
}
