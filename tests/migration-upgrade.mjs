import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = ["--yes", "supabase@2.122.1"];

function runSupabase(args) {
  const result = spawnSync("npx", [...cli, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Supabase CLI exited with status ${result.status}: ${args.join(" ")}`);
  }
}

let failure;
let localResetStarted = false;
try {
  localResetStarted = true;
  runSupabase([
    "db", "reset", "--local", "--version", "20261116000100", "--no-seed", "--yes",
  ]);
  runSupabase([
    "db", "query", "--local", "--file", "tests/fx_migration_upgrade_setup.sql",
  ]);
  runSupabase(["migration", "up", "--local"]);
  runSupabase(["test", "db", "--local", "tests/fx_migration_upgrade_test.sql"]);
} catch (error) {
  failure = error;
}

if (localResetStarted) {
  try {
    runSupabase(["db", "reset", "--local", "--no-seed", "--yes"]);
  } catch (error) {
    if (!failure) failure = error;
    else console.error("Failed to restore a clean local schema after the upgrade test:", error);
  }
}

if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
