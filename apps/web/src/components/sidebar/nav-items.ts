import { PieChart } from "@solar-icons/react";
import type { ComponentType, SVGProps } from "react";

import { HouseOutline } from "./icons";

type NavIcon = ComponentType<SVGProps<SVGSVGElement> & { weight?: string }>;

export interface NavItem {
  icon: NavIcon;
  label: string;
  href: string;
  iconWeight?: string;
}

export const navItems: NavItem[] = [
  { icon: HouseOutline, label: "Home", href: "/" },
  { icon: PieChart as NavIcon, label: "Statistics", href: "/stats" },
];
