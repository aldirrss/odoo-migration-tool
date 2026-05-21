/**
 * Connection profiles management — DB-backed.
 * Profile passwords are AES-256-GCM encrypted via ENCRYPTION_KEY.
 */

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "./staging";
import { encrypt, decrypt } from "../auth/crypto";

export { encrypt, decrypt };

export const connectionProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.enum(["source", "target"]),
  host: z.string().min(1),
  port: z.number().int().positive().default(5432),
  database: z.string().min(1),
  user: z.string().min(1),
  password: z.string().min(1),
  ssl: z.boolean().default(false),
  odooVersion: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ConnectionProfile = z.infer<typeof connectionProfileSchema>;

function rowToProfile(row: typeof schema.connectionProfiles.$inferSelect): ConnectionProfile {
  return {
    id: row.id,
    name: row.name,
    role: row.role as "source" | "target",
    host: row.host,
    port: row.port,
    database: row.database,
    user: row.user,
    password: decrypt(row.encryptedPassword),
    ssl: row.ssl,
    odooVersion: row.odooVersion ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listProfiles(): Promise<ConnectionProfile[]> {
  const rows = await stagingDb.select().from(schema.connectionProfiles);
  return rows.map(rowToProfile);
}

export async function getProfile(id: string): Promise<ConnectionProfile | null> {
  const rows = await stagingDb
    .select()
    .from(schema.connectionProfiles)
    .where(eq(schema.connectionProfiles.id, id))
    .limit(1);
  const row = rows[0];
  return row ? rowToProfile(row) : null;
}

export async function saveProfile(
  input: Omit<ConnectionProfile, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<ConnectionProfile> {
  const id = input.id || crypto.randomUUID();
  const now = new Date();
  const existing = await stagingDb
    .select()
    .from(schema.connectionProfiles)
    .where(eq(schema.connectionProfiles.id, id))
    .limit(1);

  const encryptedPassword = encrypt(input.password);

  if (existing[0]) {
    const [updated] = await stagingDb
      .update(schema.connectionProfiles)
      .set({
        name: input.name,
        role: input.role,
        host: input.host,
        port: input.port ?? 5432,
        database: input.database,
        user: input.user,
        encryptedPassword,
        ssl: input.ssl ?? false,
        odooVersion: input.odooVersion,
        updatedAt: now,
      })
      .where(eq(schema.connectionProfiles.id, id))
      .returning();
    return rowToProfile(updated!);
  }

  const [inserted] = await stagingDb
    .insert(schema.connectionProfiles)
    .values({
      id,
      name: input.name,
      role: input.role,
      host: input.host,
      port: input.port ?? 5432,
      database: input.database,
      user: input.user,
      encryptedPassword,
      ssl: input.ssl ?? false,
      odooVersion: input.odooVersion,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return rowToProfile(inserted!);
}

export async function createProfile(
  input: Omit<ConnectionProfile, "id" | "createdAt" | "updatedAt">,
): Promise<ConnectionProfile> {
  return saveProfile(input);
}

export async function updateProfile(
  id: string,
  input: Partial<Omit<ConnectionProfile, "id" | "createdAt" | "updatedAt">>,
): Promise<ConnectionProfile | null> {
  const existing = await getProfile(id);
  if (!existing) return null;
  return saveProfile({ ...existing, ...input, id });
}

export async function deleteProfile(id: string): Promise<boolean> {
  const result = await stagingDb
    .delete(schema.connectionProfiles)
    .where(eq(schema.connectionProfiles.id, id))
    .returning({ id: schema.connectionProfiles.id });
  return result.length > 0;
}
