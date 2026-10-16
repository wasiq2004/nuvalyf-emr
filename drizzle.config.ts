import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config({ path: [".env.local", ".env"], quiet: true });

// `npm run db:generate` diffs lib/db/schema against db/migrations.
// Row-level security, roles and grants live in db/sql/security.sql.
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./db/migrations",
  schemaFilter: ["app", "platform", "sys"],
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? "",
  },
});
