// A role's name mid-sentence (Phase 26.10, fix-7): "door_supervisor" -> "door supervisor", an
// acronym in capitals ("csas_officer" -> "CSAS officer"), as in "we need a CSAS officer". Pure,
// with no imports: the rules, the templates and the casual app's words all use it.
export function roleWords(role: string): string {
  return role.replace(/_/g, " ").replace(/\b(csas|sia|cctv|pts|cscs)\b/g, (a) => a.toUpperCase());
}
