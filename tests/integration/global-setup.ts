// Creates a fresh medflow_test database and migrates it once per test run.
import { TEST_DB_NAME, adminUrl, connect, testUrls } from "./test-db";

export default async function setup() {
  const admin = connect(adminUrl());
  try {
    await admin.unsafe(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }

  const urls = testUrls();
  process.env.DATABASE_OWNER_URL = urls.owner;
  process.env.DATABASE_URL = urls.app;
  process.env.PLATFORM_DATABASE_URL = urls.platform;
  process.env.PROVISIONER_DATABASE_URL = urls.provisioner;

  const { ensureRoles, runMigrations } = await import("../../scripts/db/tasks");
  const owner = connect(urls.owner);
  try {
    await ensureRoles(owner);
    await runMigrations(owner);
  } finally {
    await owner.end();
  }
}
