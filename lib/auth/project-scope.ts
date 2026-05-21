import { and, eq } from "drizzle-orm";
import { stagingDb, schema } from "../db/staging";
import { HttpError } from "./guards";

export async function assertExtractionJobBelongsToProject(
  jobId: number,
  projectId: number,
): Promise<void> {
  const rows = await stagingDb
    .select({ id: schema.extractionJobs.id })
    .from(schema.extractionJobs)
    .where(
      and(
        eq(schema.extractionJobs.id, jobId),
        eq(schema.extractionJobs.projectId, projectId),
      ),
    )
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "Job not found for this project");
}

export async function assertStagedRecordBelongsToProject(
  recordId: number,
  projectId: number,
): Promise<typeof schema.stagedRecords.$inferSelect> {
  const rows = await stagingDb
    .select({
      record: schema.stagedRecords,
      jobProjectId: schema.extractionJobs.projectId,
    })
    .from(schema.stagedRecords)
    .innerJoin(
      schema.extractionJobs,
      eq(schema.extractionJobs.id, schema.stagedRecords.extractionJobId),
    )
    .where(eq(schema.stagedRecords.id, recordId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, "Record not found");
  if (row.jobProjectId !== projectId) throw new HttpError(403, "Forbidden");
  return row.record;
}
