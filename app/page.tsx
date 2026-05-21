"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
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
import { ArrowRight, Database, FileEdit, ShieldCheck, Upload } from "lucide-react";

interface ProfileSummary {
  id: string;
  name: string;
  role: "source" | "target";
  host: string;
  database: string;
}

interface JobSummary {
  id: number;
  status: string;
  totalRecords: number;
  totalTables: number;
  startedAt: string;
}

export default function DashboardPage() {
  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const res = await fetch("/api/connections");
      const data = (await res.json()) as { profiles: ProfileSummary[] };
      return data.profiles;
    },
  });

  const jobQuery = useQuery({
    queryKey: ["latest-extraction"],
    queryFn: async () => {
      const res = await fetch("/api/extract/latest");
      const data = (await res.json()) as { job: JobSummary | null };
      return data.job;
    },
  });

  const sourceCount = profilesQuery.data?.filter((p) => p.role === "source").length ?? 0;
  const targetCount = profilesQuery.data?.filter((p) => p.role === "target").length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground">
          Migrate data from a source Odoo database into a fresh target database.
        </p>
      </div>

      <ProgressStepper current="connections" />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StepCard
          icon={<Database className="h-5 w-5" />}
          title="1. Connections"
          description={
            profilesQuery.data
              ? `${sourceCount} source · ${targetCount} target`
              : "Loading..."
          }
          href="/connections"
        />
        <StepCard
          icon={<ArrowRight className="h-5 w-5" />}
          title="2. Extract"
          description={
            jobQuery.data
              ? `${jobQuery.data.totalRecords.toLocaleString()} records extracted`
              : "No extraction yet"
          }
          href="/extract"
        />
        <StepCard
          icon={<FileEdit className="h-5 w-5" />}
          title="3. Clean"
          description="Review and edit staged data"
          href="/staging"
        />
        <StepCard
          icon={<ShieldCheck className="h-5 w-5" />}
          title="4. Validate"
          description="Check against target config"
          href="/validate"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest extraction job</CardTitle>
          <CardDescription>
            Most recent extraction run from a source database.
          </CardDescription>
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
                  {jobQuery.data.totalTables} tables · {jobQuery.data.totalRecords.toLocaleString()}{" "}
                  records
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
            <Link href="/extract">
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
