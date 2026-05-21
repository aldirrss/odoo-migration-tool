"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MigrationState {
  currentProjectId: number | null;
  sourceProfileId: string | null;
  targetProfileId: string | null;
  activeJobId: number | null;
  setCurrentProject: (id: number | null) => void;
  setSourceProfile: (id: string | null) => void;
  setTargetProfile: (id: string | null) => void;
  setActiveJob: (id: number | null) => void;
  reset: () => void;
}

export const useMigrationStore = create<MigrationState>()(
  persist(
    (set) => ({
      currentProjectId: null,
      sourceProfileId: null,
      targetProfileId: null,
      activeJobId: null,
      setCurrentProject: (id) => set({ currentProjectId: id }),
      setSourceProfile: (id) => set({ sourceProfileId: id }),
      setTargetProfile: (id) => set({ targetProfileId: id }),
      setActiveJob: (id) => set({ activeJobId: id }),
      reset: () =>
        set({
          currentProjectId: null,
          sourceProfileId: null,
          targetProfileId: null,
          activeJobId: null,
        }),
    }),
    { name: "odoo-migration-session" },
  ),
);
