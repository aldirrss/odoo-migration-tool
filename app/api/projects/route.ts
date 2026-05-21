import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";
import { stagingDb, schema } from "@/lib/db/staging";
import { requireSession, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().min(1),
  sourceProfileId: z.string().nullable().optional(),
  targetProfileId: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const { user } = await requireSession(req);
    const query = stagingDb
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.createdAt));
    const rows =
      user.role === "admin"
        ? await query
        : await stagingDb
            .select()
            .from(schema.projects)
            .where(eq(schema.projects.ownerId, user.id))
            .orderBy(desc(schema.projects.createdAt));
    return NextResponse.json({ projects: rows });
  } catch (err) {
    return httpErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const { user } = await requireSession(req);
    const body = createSchema.parse(await req.json());
    const [project] = await stagingDb
      .insert(schema.projects)
      .values({
        ownerId: user.id,
        name: body.name,
        sourceProfileId: body.sourceProfileId ?? null,
        targetProfileId: body.targetProfileId ?? null,
      })
      .returning();
    if (!project) throw new Error("Failed to create project");
    await stagingDb
      .insert(schema.projectConfigs)
      .values({ projectId: project.id })
      .onConflictDoNothing();
    return NextResponse.json({ project });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
