import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI (migrate, db pull, studio): use a direct Postgres URL. On Supabase, set DIRECT_URL to the
    // Session pooler or direct connection (port 5432). Transaction pooler :6543 can hang migrations.
    // For a single local URL, omit DIRECT_URL — we fall back to DATABASE_URL.
    url: process.env.DIRECT_URL || env("DATABASE_URL"),
  },
});
