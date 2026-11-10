// The casual app's actions answer "logged_out" when the session has gone; the page then sends the
// browser here (Phase 34). /login reads `again` only to pass it on: on the staffing demo it goes to
// the staffing login (src/lib/auth/login-page.ts), everywhere else it's the plain login page. Its
// own module: client components import it, and login-page.ts reads the request's host.
export const LOGIN_AGAIN = "/login?again=1";
