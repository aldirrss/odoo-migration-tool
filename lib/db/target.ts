/**
 * Target database connection manager.
 * Manages PostgreSQL connection pools for target (fresh) Odoo databases.
 */

import { Pool, type PoolConfig } from "pg";
import type { ConnectionProfile } from "./profiles";

const targetPools = new Map<string, Pool>();

export function getTargetPool(profile: ConnectionProfile): Pool {
  const existing = targetPools.get(profile.id);
  if (existing) return existing;

  const config: PoolConfig = {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: profile.password,
    ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  };

  const pool = new Pool(config);
  pool.on("error", (err) => {
    console.error(`[target-pool:${profile.id}] error`, err);
  });
  targetPools.set(profile.id, pool);
  return pool;
}

export async function closeTargetPool(profileId: string): Promise<void> {
  const pool = targetPools.get(profileId);
  if (pool) {
    await pool.end();
    targetPools.delete(profileId);
  }
}
