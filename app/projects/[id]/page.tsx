"use client";

import React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Database,
  FileEdit,
  ShieldCheck,
  Upload,
  Settings,
  Search,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressStepper } from "@/components/progress-stepper";

interface Project {
  id: number;
  name: string;
  sourceProfileId: string | null;
  targetProfileId: string | null;
}

interface JobSummary {
  id: number;
  status: string;
  totalRecords: number;
  totalTables: number;
  startedAt: string;
}

export default function ProjectDashboard({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = React.use(params);
  const projectId = Number(id);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}`);
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { project: Project }).project;
    },
  });

  const jobQuery = useQuery({
    queryKey: ["project-latest-extraction", projectId],
    queryFn: async () => {
      const r = await fetch(`/api/projects/${projectId}/extract/latest`);
      if (!r.ok) return null;
      return ((await r.json()) as { job: JobSummary | null }).job;
    },
  });

  const base = `/projects/${projectId}`;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/projects">← All projects</Link>
        </Button>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">
          {projectQuery.data?.name ?? "Project"}
        </h1>
        <p className="text-muted-foreground">
          5-step migration pipeline for this project.
        </p>
      </div>

      <ProgressStepper current="connections" projectId={projectId} />

      <div className="flex flex-wrap items-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`${base}/configuration`}>
            <Settings className="mr-2 h-4 w-4" />
            Configuration
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={`${base}/discovery`}>
            <Search className="mr-2 h-4 w-4" />
            Discovery
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StepCard
          icon={<Database className="h-5 w-5" />}
          title="1. Connections"
          description={
            projectQuery.data
              ? `${projectQuery.data.sourceProfileId ? "source set" : "no source"} · ${
                  projectQuery.data.targetProfileId ? "target set" : "no target"
                }`
              : "Loading..."
          }
          href={`${base}/connections`}
        />
        <StepCard
          icon={<ArrowRight className="h-5 w-5" />}
          title="2. Extract"
          description={
            jobQuery.data
              ? `${jobQuery.data.totalRecords.toLocaleString()} records extracted`
              : "No extraction yet"
          }
          href={`${base}/extract`}
        />
        <StepCard
          icon={<FileEdit className="h-5 w-5" />}
          title="3. Clean"
          description="Review and edit staged data"
          href={`${base}/staging`}
        />
        <StepCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="4. Validate"
          description="Check against target config"
          href={`${base}/validate`}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest extraction job</CardTitle>
          <CardDescription>Most recent extraction for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : jobQuery.data ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm">
                  Job <span className="font-mono">#{jobQuery.data.id}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Started: {new Date(jobQuery.data.startedAt).toLocaleString()}
                </p>
                <p className="text-xs text-muted-foreground">
                  {jobQuery.data.totalTables} tables ·{" "}
                  {jobQuery.data.totalRecords.toLocaleString()} records
                </p>
              </div>
              <Badge variant={jobQuery.data.status === "done" ? "success" : "secondary"}>
                {jobQuery.data.status}
              </Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No extraction has been performed yet.
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button asChild>
            <Link href={`${base}/extract`}>
              <Upload className="mr-2 h-4 w-4" />
              Start new extraction
            </Link>
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

function StepCard({
  icon,
  title,
  description,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="space-y-1 pb-3">
          <div className="flex items-center gap-2 text-muted-foreground">{icon}</div>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
