"use client";

import { createContext, useContext, type ReactNode } from "react";

export interface SidebarSection {
  id: string;
  label: string;
}

const SidebarSectionsContext = createContext<SidebarSection[]>([]);

export function SidebarSectionsProvider({
  sections,
  children,
}: {
  sections: SidebarSection[];
  children: ReactNode;
}) {
  return (
    <SidebarSectionsContext value={sections}>
      {children}
    </SidebarSectionsContext>
  );
}

export function useSidebarSections() {
  return useContext(SidebarSectionsContext);
}
