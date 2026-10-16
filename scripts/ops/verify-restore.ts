// Restore drill check: compares a restored database with the source and
// proves the security layer came back with the data.
//
//   npm run ops:verify-restore -- <restored-database> [source-database]
//
// Uses DATABASE_OWNER_URL (with the database name swapped) and DATABASE_URL
// for the app-role check. Exits non-zero on any mismatch.
import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

const restored = process.argv[2];
if (!restored || !/^[a-z][a-z0-9_]{1,40}$/.test(restored)) {
  console.error("Usage: npm run ops:verify-restore -- <restored-database> [source-database]");
  process.exit(2);
}

function urlFor(base: string, database: string) {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

const ownerBase = process.env.DATABASE_OWNER_URL!;
const source = process.argv[3] ?? new URL(ownerBase).pathname.slice(1);
const problems: string[] = [];
const ok = (message: string) => console.log(`  ✓ ${message}`);
const fail = (message: string) => {
  problems.push(message);
  console.log(`  ✗ ${message}`);
};

async function tableCounts(sql: postgres.Sql) {
  const tables = await sql<{ schema: string; name: string }[]>`
    select table_schema as schema, table_name as name from information_schema.tables
    where table_schema in ('app', 'platform', 'sys') and table_type = 'BASE TABLE' order by 1, 2`;
  const counts = new Map<string, number>();
  for (const t of tables) {
    const [row] = await sql.unsafe(`select count(*)::int as n from "${t.schema}"."${t.name}"`);
    counts.set(`${t.schema}.${t.name}`, row.n as number);
  }
  return counts;
}

async function main() {
  const src = postgres(urlFor(ownerBase, source), { max: 1, onnotice: () => {} });
  const dst = postgres(urlFor(ownerBase, restored), { max: 1, onnotice: () => {} });
  try {
    console.log(`Comparing ${restored} with ${source}`);

    const [a, b] = [await tableCounts(src), await tableCounts(dst)];
    let mismatched = 0;
    for (const [table, n] of a) {
      if (b.get(table) !== n) {
        mismatched += 1;
        fail(`${table}: ${n} rows in source, ${b.get(table) ?? "missing"} restored`);
      }
    }
    if (mismatched === 0) ok(`${a.size} tables, identical row counts (${[...a.values()].reduce((s, n) => s + n, 0)} rows)`);

    const [migrations] = await dst`select count(*)::int as n from drizzle.__drizzle_migrations`;
    const [srcMigrations] = await src`select count(*)::int as n from drizzle.__drizzle_migrations`;
    if (migrations.n === srcMigrations.n) ok(`${migrations.n} schema migrations recorded`);
    else fail(`migrations: ${srcMigrations.n} in source, ${migrations.n} restored`);

    const noRls = await dst`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'app' and c.relkind = 'r' and not c.relrowsecurity`;
    if (noRls.length === 0) ok("row-level security enabled on every clinic table");
    else fail(`row-level security missing on: ${noRls.map((r) => r.relname).join(", ")}`);

    const triggers = async (sql: postgres.Sql) =>
      (await sql`select count(*)::int as n from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where not t.tgisinternal and n.nspname in ('app', 'platform')`)[0].n as number;
    const [ta, tb] = [await triggers(src), await triggers(dst)];
    if (ta === tb) ok(`${tb} guard triggers (audit, immutability, ledger) present`);
    else fail(`triggers: ${ta} in source, ${tb} restored`);

    // The audit trail is still append-only after the restore.
    const [someAudit] = await dst`select id from app.audit_events limit 1`;
    if (someAudit) {
      try {
        await dst`update app.audit_events set action = action where id = ${someAudit.id}`;
        fail("audit trail accepted an update after restore");
      } catch {
        ok("audit trail is append-only");
      }
    }

    // The app role sees nothing without a clinic context: isolation intact.
    const app = postgres(urlFor(process.env.DATABASE_URL!, restored), { max: 1, onnotice: () => {} });
    try {
      const [visible] = await app`select count(*)::int as n from app.patients`;
      if (visible.n === 0) ok("app role sees no patient rows without a clinic context");
      else fail(`app role sees ${visible.n} patient rows without a clinic context`);
    } finally {
      await app.end();
    }
  } finally {
    await src.end();
    await dst.end();
  }
  if (problems.length) {
    console.log(`\nRestore drill FAILED: ${problems.length} problem(s).`);
    process.exit(1);
  }
  console.log("\nRestore drill passed.");
}

main().catch((error) => {
  console.error("Restore check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
