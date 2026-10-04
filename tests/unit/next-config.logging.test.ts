import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

// Audit L11: Next's own development logging prints each server action with its arguments (a login
// link's token handed to the "Log me in" action, a mobile typed into a search) and each request's
// full address. next.config.ts switches both off. If that line went, the token would reach the
// logs again: the e2e teardown would catch it (tests/e2e/server-output.ts), and so does this.
describe("Next's own request logging", () => {
  it("never prints server actions' arguments or full request addresses", () => {
    expect(nextConfig.logging).toEqual({ serverFunctions: false, incomingRequests: false });
  });
});
