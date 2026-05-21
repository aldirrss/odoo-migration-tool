"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, CheckCircle2, XCircle, Loader2 } from "lucide-react";

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
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { ProgressStepper } from "@/components/progress-stepper";

interface Profile {
  id: string;
  name: string;
  role: "source" | "target";
  host: string;
  port: number;
  database: string;
  user: string;
  ssl: boolean;
  odooVersion?: string;
  createdAt: string;
  updatedAt: string;
}

interface ProfileFormState {
  id?: string;
  name: string;
  role: "source" | "target";
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  odooVersion: string;
}

const emptyForm: ProfileFormState = {
  name: "",
  role: "source",
  host: "localhost",
  port: 5432,
  database: "",
  user: "odoo",
  password: "",
  ssl: false,
  odooVersion: "16",
};

export default function ConnectionsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProfileFormState | null>(null);
  const [testResult, setTestResult] = useState<
    { ok: boolean; message: string; serverVersion?: string } | null
  >(null);

  const profilesQuery = useQuery({
    queryKey: ["profiles"],
    queryFn: async () => {
      const r = await fetch("/api/connections");
      const data = (await r.json()) as { profiles: Profile[] };
      return data.profiles;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (form: ProfileFormState) => {
      const r = await fetch("/api/connections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error(await r.text());
      return (await r.json()) as Profile;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profiles"] });
      setEditing(null);
      setTestResult(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/connections/${id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profiles"] }),
  });

  const testMutation = useMutation({
    mutationFn: async (form: ProfileFormState) => {
      const r = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      return (await r.json()) as { ok: boolean; message: string; serverVersion?: string };
    },
    onSuccess: (data) => setTestResult(data),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Connection Profiles</h1>
        <p className="text-muted-foreground">
          Manage source and target PostgreSQL connections.
        </p>
      </div>

      <ProgressStepper current="connections" />

      <div className="flex justify-end">
        <Button onClick={() => setEditing({ ...emptyForm })}>
          <Plus className="mr-2 h-4 w-4" />
          New Profile
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {profilesQuery.data?.map((p) => (
          <Card key={p.id}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription className="font-mono text-xs">
                    {p.user}@{p.host}:{p.port}/{p.database}
                  </CardDescription>
                </div>
                <Badge variant={p.role === "source" ? "default" : "secondary"}>
                  {p.role}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pb-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {p.odooVersion && <span>Odoo {p.odooVersion}</span>}
                {p.ssl && <Badge variant="outline">SSL</Badge>}
              </div>
            </CardContent>
            <CardFooter className="gap-2 pt-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setEditing({
                    ...emptyForm,
                    ...p,
                    password: "",
                    odooVersion: p.odooVersion ?? "",
                  })
                }
              >
                <Pencil className="mr-1 h-3 w-3" />
                Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm(`Delete profile "${p.name}"?`)) deleteMutation.mutate(p.id);
                }}
              >
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </CardFooter>
          </Card>
        ))}
        {profilesQuery.data?.length === 0 && (
          <Card className="md:col-span-2">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No connection profiles yet. Create one to get started.
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit profile" : "New profile"}</DialogTitle>
            <DialogDescription>
              PostgreSQL credentials are encrypted before being stored locally.
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="grid gap-3">
              <Field label="Name">
                <Input
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  placeholder="e.g. Production 16"
                />
              </Field>
              <Field label="Role">
                <Select
                  value={editing.role}
                  onValueChange={(v) =>
                    setEditing({ ...editing, role: v as "source" | "target" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="source">Source</SelectItem>
                    <SelectItem value="target">Target</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label="Host">
                  <Input
                    value={editing.host}
                    onChange={(e) => setEditing({ ...editing, host: e.target.value })}
                  />
                </Field>
                <Field label="Port">
                  <Input
                    type="number"
                    value={editing.port}
                    onChange={(e) =>
                      setEditing({ ...editing, port: Number(e.target.value) })
                    }
                  />
                </Field>
              </div>
              <Field label="Database">
                <Input
                  value={editing.database}
                  onChange={(e) => setEditing({ ...editing, database: e.target.value })}
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="User">
                  <Input
                    value={editing.user}
                    onChange={(e) => setEditing({ ...editing, user: e.target.value })}
                  />
                </Field>
                <Field label="Password">
                  <Input
                    type="password"
                    value={editing.password}
                    onChange={(e) => setEditing({ ...editing, password: e.target.value })}
                    placeholder={editing.id ? "(unchanged)" : ""}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Odoo version">
                  <Select
                    value={editing.odooVersion}
                    onValueChange={(v) => setEditing({ ...editing, odooVersion: v })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="16">16</SelectItem>
                      <SelectItem value="17">17</SelectItem>
                      <SelectItem value="18">18</SelectItem>
                      <SelectItem value="19">19</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="SSL">
                  <div className="flex h-10 items-center gap-2">
                    <Checkbox
                      checked={editing.ssl}
                      onCheckedChange={(c) => setEditing({ ...editing, ssl: c })}
                    />
                    <span className="text-sm text-muted-foreground">Enable SSL</span>
                  </div>
                </Field>
              </div>

              {testResult && (
                <div
                  className={`flex items-start gap-2 rounded-md p-2 text-sm ${
                    testResult.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  )}
                  <div className="break-words">
                    <div className="font-medium">{testResult.message}</div>
                    {testResult.serverVersion && (
                      <div className="text-xs opacity-80">{testResult.serverVersion}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => editing && testMutation.mutate(editing)}
              disabled={!editing || testMutation.isPending}
            >
              {testMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Test connection
            </Button>
            <Button
              onClick={() => editing && saveMutation.mutate(editing)}
              disabled={!editing || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
