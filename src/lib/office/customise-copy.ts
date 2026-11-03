import type { ContractChoice, SaveDashboardResult } from "./contracts";
import { dayMonthLabel } from "./dashboard-cards-copy";

// Customise and the person's contracts on the dashboard, in words (Phase 26.3; the spec page's
// "Customise and contracts", cus-1 to cus-5, and dash-7's date choice). Plain constants and
// functions, so the tests read every line.

export const CUSTOMISE = "Customise";
export const CUSTOMISE_TITLE = "Customise your dashboard";
export const YOUR_CONTRACTS = "Your contracts";
export const CONTRACTS_LINE =
  "You see these on the dashboard and in Updates. Everything stays in Events & sessions.";
export const NO_CONTRACTS = "No contracts yet. An admin adds them on Settings, under Contracts.";
export const WHAT_YOU_SEE = "What you see";
export const SAVE_DASHBOARD = "Save my dashboard";
export const SAVING = "Saving…";
export const BACK_TO_DASHBOARD = "Back to the dashboard";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "2 sites · 27 sessions to come".
export const contractLine = (c: Pick<ContractChoice, "sites" | "sessions">) =>
  `${plural(c.sites, "site", "sites")} · ${plural(c.sessions, "session to come", "sessions to come")}`;

export type CustomiseState =
  { status: "idle" } | SaveDashboardResult | { status: "logged_out" } | { status: "error" };

export function customiseResultText(s: CustomiseState): string | null {
  switch (s.status) {
    case "idle":
      return null;
    case "saved":
      return "Saved. Your dashboard shows what you chose.";
    case "invalid":
      return "That didn't save: a contract may have just been removed. Try again.";
    case "not_allowed":
      return "Your role can't change the dashboard.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    case "error":
      return "Something went wrong. Try again.";
  }
}

// The switch beside the track: on, the dashboard shows only the person's contracts.
export const MY_CONTRACTS = "My contracts";

// The date choice (dash-7): every day, or one day with places to fill.
export const ALL_DATES = "All dates";
export const dateChoiceLabel = (day: string | null) =>
  day ? `Date: ${dayMonthLabel(day)}` : "Choose a date";
export const dayChoice = (d: { date: string; places: number }) =>
  `${dayMonthLabel(d.date)} · ${plural(d.places, "place", "places")}`;

// --- Settings: Contracts (cus-1) ---

export const CONTRACTS_TITLE = "Contracts";
export const CONTRACTS_INTRO =
  "Each contract is a client of yours and the venues you staff for it. Resourcers pick the ones they look after under Customise on the dashboard.";
export const NO_CONTRACTS_YET = "No contracts yet.";
export const ADD_CONTRACT = "Add a contract";
export const CONTRACT_NAME = "Name";
export const ITS_VENUES = "Its venues";
export const SAVE_CONTRACT = "Save";
export const REMOVE_CONTRACT = "Remove";
export const REMOVE_CHECK =
  "Its venues stay, without a contract. Anyone looking after it stops seeing it.";
export const YES_REMOVE = "Yes, remove it";
// A venue another contract has: "(Northgate Council's)".
export const otherContract = (name: string) => `(${name}'s)`;

export function contractResultText(s: { status: string }, name?: string): string {
  switch (s.status) {
    case "saved":
      return name ? `Saved ${name}.` : "Saved.";
    case "removed":
      return name ? `Removed ${name}.` : "Removed.";
    case "invalid":
      return "Give it a name of up to 120 characters.";
    case "name_taken":
      return "There's a contract with that name already.";
    case "not_found":
      return "That contract or one of its venues is gone. Reload the page.";
    case "not_allowed":
      return "Only an admin can change contracts.";
    case "logged_out":
      return "Your session has ended. Log in again.";
    default:
      return "Something went wrong. Try again.";
  }
}

// With "My contracts" on but none of the person's contracts has a venue yet (C4 of the 26.3 review):
// the dashboard would be empty, so it says why and the way out.
export const NO_CONTRACT_VENUES =
  "Your contracts have no venues yet, so nothing shows here. An admin adds venues to contracts on Settings.";
export const SHOW_EVERYTHING = "Show everything";
