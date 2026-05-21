import { NextResponse } from "next/server";
import { deleteProfile } from "@/lib/db/profiles";
import { requireSession, httpErrorResponse } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession(req);
    const { id } = await context.params;
    const ok = await deleteProfile(id);
    return NextResponse.json({ deleted: ok });
  } catch (err) {
    return httpErrorResponse(err);
  }
}
