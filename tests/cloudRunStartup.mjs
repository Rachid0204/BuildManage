import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const guard = resolve(root, "tests/helpers/networkGuard.mjs");
const secret = "synthetic-startup-secret-never-use-in-production";
const baseEnv = {
  PATH: process.env.PATH,
  NODE_ENV: "production",
  PORT: "3000",
  SYNDIK_SERVER_SECRET: secret,
  SYNDIK_UPLOAD_BUCKET: "demo-startup.invalid",
  PUBLIC_APP_URL: "https://startup.invalid",
  GOOGLE_CLOUD_PROJECT: "demo-buildmanage",
  FIRESTORE_DATABASE_ID: "(default)",
  FIRESTORE_EMULATOR_HOST: "127.0.0.1:1",
  GCE_METADATA_DISABLED: "true",
};

async function withServer(overrides, check) {
  const env = { ...baseEnv, ...overrides };
  for (const name of Object.keys(env))
    if (env[name] === undefined) delete env[name];
  const child = spawn(
    process.execPath,
    ["--import", guard, "dist-server/server.js"],
    {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let logs = "";
  child.stdout.on("data", (data) => {
    logs += data;
  });
  child.stderr.on("data", (data) => {
    logs += data;
  });
  const exited = once(child, "exit");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  try {
    await check(child, exited, () => logs);
    assert.ok(
      !logs.includes(secret),
      "Startup logs must not expose the secret",
    );
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await exited;
  }
}

async function rejected(overrides, names) {
  await withServer(overrides, async (_child, exited, logs) => {
    const [code] = await exited;
    assert.equal(code, 1, logs());
    assert.match(logs(), /\[startup\] Server failed before listening/);
    assert.match(logs(), /Production configuration is incomplete/);
    for (const name of names) assert.ok(logs().includes(name), logs());
    assert.ok(
      !logs().includes("Server running"),
      "Invalid config must never listen",
    );
  });
}

await rejected(
  {
    SYNDIK_SERVER_SECRET: undefined,
    SYNDIK_UPLOAD_BUCKET: undefined,
    PUBLIC_APP_URL: undefined,
  },
  ["SYNDIK_SERVER_SECRET", "SYNDIK_UPLOAD_BUCKET", "PUBLIC_APP_URL"],
);
await rejected({ SYNDIK_SERVER_SECRET: "short" }, ["SYNDIK_SERVER_SECRET"]);
await rejected({ SYNDIK_UPLOAD_BUCKET: " " }, ["SYNDIK_UPLOAD_BUCKET"]);
for (const PUBLIC_APP_URL of ["", "not-a-url", "http://startup.invalid"])
  await rejected({ PUBLIC_APP_URL }, ["PUBLIC_APP_URL"]);
await rejected({ SYNDIK_STATE_BACKEND: "file" }, ["SYNDIK_STATE_BACKEND"]);

const port = await new Promise((resolvePort, reject) => {
  const server = createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolvePort(port));
  });
});
for (const PORT of ["3000", String(port)]) {
  await withServer({ PORT }, async (child, _exited, logs) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      assert.equal(child.exitCode, null, logs());
      if (logs().includes("Server running")) break;
      await new Promise((done) => setTimeout(done, 50));
    }
    assert.ok(logs().includes("Server running"), logs());
    const health = await fetch(`http://127.0.0.1:${PORT}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ok");
    const page = await fetch(`http://127.0.0.1:${PORT}/`, {
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /<html/i);
  });
}
console.log(
  "PASS: compiled production server rejects invalid configuration, serves health/frontend on PORT=3000 and honors a custom PORT without live credentials.",
);
