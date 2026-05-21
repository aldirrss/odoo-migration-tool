"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Project {
  id: number;
  name: string;
  ownerId: number;
  sourceProfileId: string | null;
  targetProfileId: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: async () => {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error(await r.text());
      return ((await r.json()) as { projects: Project[] }).projects;
    },
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const r = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) throw new Error(await r.text());
      return await r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setCreating(false);
      setNewName("");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Each project holds its own source/target pairing and migration state.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New project
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projectsQuery.data?.map((p) => (
          <Card key={p.id}>
            <CardHeader>
              <CardTitle className="text-base">{p.name}</CardTitle>
              <CardDescription className="text-xs">
                Created {new Date(p.createdAt).toLocaleDateString()}
              </CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              Source: {p.sourceProfileId ?? "—"}
              <br />
              Target: {p.targetProfileId ?? "—"}
            </CardContent>
            <CardFooter className="gap-2">
              <Button asChild size="sm">
                <Link href={`/projects/${p.id}`}>Open</Link>
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (confirm(`Delete project "${p.name}"? This will remove all extraction data.`)) {
                    deleteMutation.mutate(p.id);
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </CardFooter>
          </Card>
        ))}
        {projectsQuery.data?.length === 0 && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No projects yet. Click &ldquo;New project&rdquo; to begin.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Acme Migration"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => createMutation.mutate(newName)}
              disabled={!newName.trim() || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
