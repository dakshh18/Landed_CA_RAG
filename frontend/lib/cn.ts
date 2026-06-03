// Small helper that merges Tailwind classes safely (later utilities win over earlier ones).
// Lets us write `cn("text-sm text-landed-muted", isActive && "text-landed-navy")` without
// worrying about conflicting Tailwind rules.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
