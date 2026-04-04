import { BarChart3, Home, Image, type LucideIcon } from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
}

export const navItems: NavItem[] = [
  { icon: Home, label: "Home", href: "/" },
  { icon: BarChart3, label: "Meta", href: "/meta" },
  { icon: Image, label: "Player Cards", href: "/cards" },
];
