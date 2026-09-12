import type { InboxListing } from "./inbox-model";
import type { SearchProfile } from "../../lib/search-profile";

export const formatRent = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);

export function rentComparison(rent: number, profile: SearchProfile | null) {
  if (!Number.isFinite(rent) || rent <= 0 || !profile) return null;
  const min = profile.budget_min;
  const max = profile.budget_max;
  if (min !== null && Number.isFinite(min) && rent < min)
    return { label: `${formatRent(min - rent)} below your minimum`, detail: `Your minimum is ${formatRent(min)}/mo.`, outside: true };
  if (max === null || !Number.isFinite(max)) return null;
  const difference = Math.round((max - rent) * 100) / 100;
  return {
    label: difference === 0 ? "At your rent limit" : `${formatRent(Math.abs(difference))} ${difference > 0 ? "under" : "over"} your limit`,
    detail: `Compared with your ${formatRent(max)}/mo maximum.`,
    outside: difference < 0,
  };
}

export function tourQuestions(item: InboxListing, profile: SearchProfile | null) {
  return [...new Set([
    ...item.unknowns,
    "What is the available move-in date and lease length?",
    "What fees, deposit, and utilities are extra?",
    "What are the square footage, laundry, and pet policy?",
    ...(profile?.must_haves.map((value) => `Confirm must-have: ${value}.`) ?? []),
    ...(profile?.dealbreakers.map((value) => `Check dealbreaker: ${value}.`) ?? []),
  ])];
}
