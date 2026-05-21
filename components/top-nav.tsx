"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Database, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

interface Me {
  id: number;
  email: string;
  role: string;
}

export function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const hidden =
    pathname?.startsWith("/login") || pathname?.startsWith("/register");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await fetch("/api/auth/me");
      if (!r.ok) return null;
      return ((await r.json()) as { user: Me }).user;
    },
    retry: false,
  });

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (hidden) return null;

  return (
    <header className="border-b bg-background">
      <div className="container flex h-14 items-center gap-6">
        <Link href="/projects" className="flex items-center gap-2 font-semibold">
          <Database className="h-5 w-5" />
          <span>Odoo Migration Tool</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/projects" className="text-muted-foreground hover:text-foreground">
            Projects
          </Link>
          {meQuery.data?.role === "admin" && (
            <Link
              href="/admin/users"
              className="text-muted-foreground hover:text-foreground"
            >
              Admin
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {meQuery.data ? (
            <>
              <span className="text-muted-foreground">{meQuery.data.email}</span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="mr-1 h-3 w-3" />
                Logout
              </Button>
            </>
          ) : (
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
