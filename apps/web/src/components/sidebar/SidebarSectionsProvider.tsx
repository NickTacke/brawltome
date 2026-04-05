'use client'

import { type ReactNode, createContext, useContext, useEffect, useState } from 'react'

export interface SidebarSection {
  id: string
  label: string
}

interface SidebarSectionsContextValue {
  sections: SidebarSection[]
  setSections: (sections: SidebarSection[]) => void
}

const SidebarSectionsContext = createContext<SidebarSectionsContextValue>({
  sections: [],
  setSections: () => {},
})

export function SidebarSectionsProvider({ children }: { children: ReactNode }) {
  const [sections, setSections] = useState<SidebarSection[]>([])
  return <SidebarSectionsContext value={{ sections, setSections }}>{children}</SidebarSectionsContext>
}

export function useSidebarSections() {
  return useContext(SidebarSectionsContext).sections
}

export function useRegisterSidebarSections(sections: SidebarSection[]) {
  const { setSections } = useContext(SidebarSectionsContext)
  useEffect(() => {
    setSections(sections)
    return () => setSections([])
  }, [sections, setSections])
}
