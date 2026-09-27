// Every message to staff ends with the firm's sign-off, "[Firm name] Shift Team" unless the
// firm set its own (golden rule 8). Never a person's name.
export function signOffFor(firmName: string, configured: unknown): string {
  return typeof configured === "string" && configured.trim()
    ? configured.trim()
    : `${firmName} Shift Team`;
}
