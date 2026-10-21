import { clsx } from "clsx";
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

// Pre-filled in the allowed links of a new session (the teacher can remove
// them): UA's login and elearning. The exam image's proxy allows each entry
// and everything under it (whitelist.py), so "https://elearning.ua.pt"
// opens all of elearning, not one exam's page.
export const DEFAULT_ALLOWED_LINKS = ["https://idp.ua.pt", "https://elearning.ua.pt"];
