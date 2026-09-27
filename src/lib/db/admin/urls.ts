import { parse } from "pg-connection-string";

// Connection-string helpers for the admin scripts and the test setup.

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

// Where pg will really connect, read by pg's own parser (pg-connection-string). Query
// parameters override the URL's parts (postgres://u:p@localhost/db?host=prod.example.com
// connects to prod), and when one is repeated the last one wins, so no hand-rolled parsing.
export function connectionTarget(url: string): { host: string; user: string; password: string } {
  const config = parse(url);
  return { host: config.host ?? "", user: config.user ?? "", password: config.password ?? "" };
}

export function credentials(url: string): { user: string; password: string } {
  const { user, password } = connectionTarget(url);
  return { user, password };
}

// This machine only: a loopback address or a Unix socket path.
export function isLocalHost(url: string): boolean {
  const { host } = connectionTarget(url);
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) || host.startsWith("/");
}

// Locally the admin URL logs in as the Docker superuser and switches to the non-superuser owner
// with `options=-c role=<owner>`. The owner role name is read from that option.
export function ownerRoleFromAdminUrl(adminUrl: string): string | null {
  const options = new URL(adminUrl).searchParams.get("options") ?? "";
  const match = /(?:^|\s)-c\s*role=([a-z_][a-z0-9_]*)/.exec(options);
  return match?.[1] ?? null;
}

// The same login without the role switch: the local superuser, used only to bootstrap the owner
// role and (re)create local databases. Production never uses this.
export function bootstrapUrl(adminUrl: string): string {
  const u = new URL(adminUrl);
  u.searchParams.delete("options");
  return u.toString();
}
