import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

type AppDb = NeonHttpDatabase<typeof schema>;

let _db: AppDb | null = null;

function getDb(): AppDb {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required. Set it in .env.local");
  }
  _db = drizzle(neon(url), { schema, casing: "snake_case" });
  return _db;
}

// Lazy proxy: Next.js loads route modules during `next build` to collect page data
// without actually running queries — reading env at import time crashed those builds
// whenever DATABASE_URL was absent (e.g. Dependabot preview deployments).
export const db = new Proxy({} as AppDb, {
  get(_target, prop) {
    const real = getDb();
    const value = real[prop as keyof AppDb];
    return typeof value === "function" ? value.bind(real) : value;
  },
}) as AppDb;

export type DB = typeof db;
