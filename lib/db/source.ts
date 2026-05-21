/**
 * Source database connection manager.
 * Manages PostgreSQL connection pools for source Odoo databases.
 * Pools are keyed by profile ID and reused across requests.
 */

import { Pool, type PoolConfig } from "pg";
import type { ConnectionProfile } from "./profiles";

const sourcePools = new Map<string, Pool>();

export function getSourcePool(profile: ConnectionProfile): Pool {
  const existing = sourcePools.get(profile.id);
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
    console.error(`[source-pool:${profile.id}] error`, err);
  });
  sourcePools.set(profile.id, pool);
  return pool;
}

export async function closeSourcePool(profileId: string): Promise<void> {
  const pool = sourcePools.get(profileId);
  if (pool) {
    await pool.end();
    sourcePools.delete(profileId);
  }
}

export async function testSourceConnection(profile: ConnectionProfile): Promise<{
  ok: boolean;
  message: string;
  serverVersion?: string;
}> {
  const config: PoolConfig = {
    host: profile.host,
    port: profile.port,
    database: profile.database,
    user: profile.user,
    password: profile.password,
    ssl: profile.ssl ? { rejectUnauthorized: false } : undefined,
    connectionTimeoutMillis: 5_000,
  };
  const tempPool = new Pool(config);
  try {
    const result = await tempPool.query<{ version: string }>("SELECT version()");
    return { ok: true, message: "Connection successful", serverVersion: result.rows[0]?.version };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  } finally {
    await tempPool.end().catch(() => {});
  }
}
