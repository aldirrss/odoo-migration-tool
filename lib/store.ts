/**
 * Global client-side state for migration session.
 * Tracks selected source/target profiles and the active extraction job.
 */

"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MigrationState {
  sourceProfileId: string | null;
  targetProfileId: string | null;
  activeJobId: number | null;
  setSourceProfile: (id: string | null) => void;
  setTargetProfile: (id: string | null) => void;
  setActiveJob: (id: number | null) => void;
  reset: () => void;
}

export const useMigrationStore = create<MigrationState>()(
  persist(
    (set) => ({
      sourceProfileId: null,
      targetProfileId: null,
      activeJobId: null,
      setSourceProfile: (id) => set({ sourceProfileId: id }),
      setTargetProfile: (id) => set({ targetProfileId: id }),
      setActiveJob: (id) => set({ activeJobId: id }),
      reset: () =>
        set({
          sourceProfileId: null,
          targetProfileId: null,
          activeJobId: null,
        }),
    }),
    { name: "odoo-migration-session" },
  ),
);
