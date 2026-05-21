import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "./providers";
import { TopNav } from "@/components/top-nav";

export const metadata: Metadata = {
  title: "Odoo Migration Tool",
  description: "Extract, clean, and import data between Odoo databases",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans">
        <QueryProvider>
          <TopNav />
          <main className="container py-8">{children}</main>
        </QueryProvider>
      </body>
    </html>
  );
}
