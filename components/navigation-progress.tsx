"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thin top-of-page progress bar that activates whenever a same-origin link is
 * clicked, and completes once the App Router commits the new pathname or query.
 * Plays well with Next.js 14/15 navigation without depending on `useLinkStatus`
 * at every call site.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [width, setWidth] = useState(0);
  const [visible, setVisible] = useState(false);
  const trickleRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const finishRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigatingRef = useRef(false);

  const start = () => {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    if (finishRef.current) clearTimeout(finishRef.current);
    setVisible(true);
    setWidth(15);
    // Trickle up to 80% so the bar feels alive while we wait for the segment.
    trickleRef.current = setInterval(() => {
      setWidth((w) => (w < 80 ? w + (80 - w) * 0.15 : w));
    }, 200);
  };

  const finish = () => {
    if (!navigatingRef.current) return;
    if (trickleRef.current) clearInterval(trickleRef.current);
    trickleRef.current = null;
    setWidth(100);
    finishRef.current = setTimeout(() => {
      setVisible(false);
      setWidth(0);
      navigatingRef.current = false;
    }, 250);
  };

  // Detect navigation start by listening to clicks on internal links + form submits.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      if (
        href.startsWith("http://") ||
        href.startsWith("https://") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:") ||
        href.startsWith("#")
      ) {
        return;
      }
      // Skip if we're already at this URL.
      const targetUrl = new URL(href, window.location.origin);
      if (
        targetUrl.pathname === window.location.pathname &&
        targetUrl.search === window.location.search
      ) {
        return;
      }
      start();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Detect navigation completion: pathname or search string committed.
  useEffect(() => {
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams?.toString()]);

  // Safety: if nothing completes within 8s, force-finish to avoid a stuck bar.
  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => finish(), 8000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 top-0 z-[60] h-0.5"
    >
      <div
        className="h-full bg-primary shadow-[0_0_10px_rgba(0,0,0,0.2)] transition-[width] duration-200 ease-out"
        style={{ width: `${width}%` }}
      />
    </div>
  );
}
