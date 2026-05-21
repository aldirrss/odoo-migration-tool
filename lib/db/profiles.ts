/**
 * Connection profiles management.
 * Stores PostgreSQL connection details (source / target / staging) in
 * config/connections.json, with passwords encrypted using AES-256-GCM.
 */

import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { z } from "zod";

const CONFIG_DIR = path.join(process.cwd(), "config");
const CONFIG_FILE = path.join(CONFIG_DIR, "connections.json");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY environment variable must be set to a 64-char hex string. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decrypt(payload: string): string {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted payload");
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const data = Buffer.from(dataHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

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

interface StoredProfile extends Omit<ConnectionProfile, "password"> {
  passwordEncrypted: string;
}

async function ensureConfigDir(): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
}

async function readStore(): Promise<StoredProfile[]> {
  try {
    const text = await fs.readFile(CONFIG_FILE, "utf8");
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeStore(profiles: StoredProfile[]): Promise<void> {
  await ensureConfigDir();
  await fs.writeFile(CONFIG_FILE, JSON.stringify(profiles, null, 2), "utf8");
}

export async function listProfiles(): Promise<ConnectionProfile[]> {
  const stored = await readStore();
  return stored.map((s) => ({
    ...s,
    password: decrypt(s.passwordEncrypted),
  }));
}

export async function getProfile(id: string): Promise<ConnectionProfile | null> {
  const profiles = await listProfiles();
  return profiles.find((p) => p.id === id) ?? null;
}

export async function saveProfile(
  input: Omit<ConnectionProfile, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): Promise<ConnectionProfile> {
  const stored = await readStore();
  const now = new Date().toISOString();
  const id = input.id || crypto.randomUUID();
  const idx = stored.findIndex((s) => s.id === id);

  const profile: ConnectionProfile = {
    id,
    name: input.name,
    role: input.role,
    host: input.host,
    port: input.port ?? 5432,
    database: input.database,
    user: input.user,
    password: input.password,
    ssl: input.ssl ?? false,
    odooVersion: input.odooVersion,
    createdAt: idx >= 0 ? stored[idx]!.createdAt : now,
    updatedAt: now,
  };

  const { password: _pw, ...withoutPassword } = profile;
  const toStore: StoredProfile = {
    ...withoutPassword,
    passwordEncrypted: encrypt(profile.password),
  };

  if (idx >= 0) {
    stored[idx] = toStore;
  } else {
    stored.push(toStore);
  }
  await writeStore(stored);
  return profile;
}

export async function deleteProfile(id: string): Promise<boolean> {
  const stored = await readStore();
  const next = stored.filter((s) => s.id !== id);
  if (next.length === stored.length) return false;
  await writeStore(next);
  return true;
}
