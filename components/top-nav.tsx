"use client";

import Link from "next/link";
import { Database } from "lucide-react";

export function TopNav() {
  return (
    <header className="border-b bg-background">
      <div className="container flex h-14 items-center gap-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <Database className="h-5 w-5" />
          <span>Odoo Migration Tool</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/connections" className="text-muted-foreground hover:text-foreground">
            Connections
          </Link>
          <Link href="/extract" className="text-muted-foreground hover:text-foreground">
            Extract
          </Link>
          <Link href="/staging" className="text-muted-foreground hover:text-foreground">
            Clean
          </Link>
          <Link href="/validate" className="text-muted-foreground hover:text-foreground">
            Validate
          </Link>
          <Link href="/import" className="text-muted-foreground hover:text-foreground">
            Import
          </Link>
        </nav>
      </div>
    </header>
  );
}
