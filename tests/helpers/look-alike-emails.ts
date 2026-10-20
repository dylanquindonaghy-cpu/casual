// Email addresses that only look like real people's, for the tests of demo mode's made-up check
// (src/lib/demo/made-up.ts, 16.1): each must be refused as not made up. Kept here, the one place,
// and listed in tests/unit/repo.made-up-data.test.ts's reviewed allow-list (golden rule 7).
// Nothing is ever sent to them.
export const LOOK_ALIKE_EMAILS = {
  // An ordinary work address, as a real person's would be.
  work: "boss@firm.co.uk",
  // The example name under another ending.
  otherEnding: "a@example.co.uk",
  // Ends in example.com's letters, but isn't it.
  sameLetters: "a@notexample.com",
  // example.com inside someone else's domain.
  inside: "a@example.com.evil.io",
} as const;
