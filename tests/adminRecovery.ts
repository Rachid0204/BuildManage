import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { hashPasswordSync } from "../utils/security";
import { verifyPassword } from "../server/passwords";
const directory = mkdtempSync(join(tmpdir(), "buildmanage-backup-")),
  file = join(directory, "shared-state.json"),
  backup = join(directory, "backup.enc.json"),
  account = {
    uid: "fixture",
    email: "synthetic@audit.invalid",
    passwordHash: hashPasswordSync(
      "Synthetic-Password-42!",
      "synthetic@audit.invalid",
    ),
    profile: { uid: "fixture", role: "syndic" },
  };
const seed = {
  syndik_prod_registered_users_v1: [account],
  syndik_prod_syndics_v1: [],
  __identityActions: { old: {} },
  __outbox: { old: {} },
  __operations: { old: {} },
};
writeFileSync(file, JSON.stringify(seed));
const run = (
  args: string[],
  key = "separate-synthetic-backup-key-1234567890",
) =>
  spawnSync(
    process.execPath,
    [
      "--import",
      "./tests/helpers/networkGuard.mjs",
      "--import",
      "tsx",
      "scripts/stateAdmin.ts",
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_ENV: "test",
        SYNDIK_STATE_BACKEND: "file",
        SYNDIK_DATA_DIR: directory,
        SYNDIK_BACKUP_KEY: key,
      },
    },
  );
try {
  let result = run(["export", "--out", backup]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!readFileSync(backup, "utf8").includes(account.email));
  result = run(["import", "--in", backup]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), seed);
  assert.notEqual(run(["import", "--in", backup, "--apply"]).status, 0);
  assert.notEqual(
    run(["import", "--in", backup], "wrong-synthetic-backup-key-1234567890")
      .status,
    0,
  );
  result = run(["import", "--in", backup, "--apply", "--replace"]);
  assert.equal(result.status, 0, result.stderr);
  const restored = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(
    restored.syndik_prod_registered_users_v1[0].passwordHash.startsWith(
      "scrypt$legacy-v1$",
    ),
  );
  assert.ok(
    verifyPassword(
      "Synthetic-Password-42!",
      restored.syndik_prod_registered_users_v1[0].passwordHash,
    ),
  );
  assert.equal(
    verifyPassword(
      account.passwordHash,
      restored.syndik_prod_registered_users_v1[0].passwordHash,
    ),
    false,
  );
  assert.equal(restored.__sessionVersions.fixture, 1);
  assert.deepEqual(restored.__outbox, {});
  assert.deepEqual(restored.__identityActions, {});
  assert.deepEqual(restored.__operations, {});
  console.log(
    "PASS: encrypted backup, dry run, replacement guard, wrong-key rejection, legacy credential protection and restore session revocation.",
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
