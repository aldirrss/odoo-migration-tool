import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { stagingDb, schema } from "@/lib/db/staging";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await stagingDb
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.users);
  const userCount = rows[0]?.count ?? 0;
  return NextResponse.json({ hasUsers: userCount > 0 });
}
