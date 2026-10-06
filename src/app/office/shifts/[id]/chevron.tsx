// The small arrow on a "Cancel …" or "Mark …" opener (a <details> summary that looks like a
// button). It turns over when the step is open. Decorative: the words say what it does.
export function Chevron() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 group-open:rotate-180"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

// A <details> summary styled as a button: the browser's own triangle is hidden (the Chevron
// stands in for it). Add it after a btn.* class.
export const summaryButton = "list-none [&::-webkit-details-marker]:hidden";
