import { parse } from "pg-connection-string";

// In production the database is its own server (the host's managed Postgres): the connection must
// be encrypted and the server's certificate checked, name and all (sslmode=verify-full), against
// the host's CA certificate (sslrootcert=/app/db-ca.pem, mounted read-only by
// deploy/docker-compose.yml). The address is read as pg reads it (a ?host= elsewhere, or a later
// repeated parameter, counts), so nothing slips past. Not needed for a database on the same machine
// (a loopback address or a socket: development and the browser tests' production build; Postgres in
// Compose over a socket, if a host has no managed Postgres, would need its own compose file without
// the CA mount). src/lib/env.ts refuses a production address without it.

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "[::1]"];

// The host pg will connect to. (pg's parser opens the certificate files an address names, which
// needn't exist where the settings are checked: they're left out for this.)
// Taken out of the text, not through a URL parser: pg accepts addresses that the URL standard
// doesn't (a socket: postgres://u:p@/db?host=/var/run/postgresql).
export function databaseHost(url: string): string {
  const withoutFiles = url.replace(
    /([?&])(?:sslrootcert|sslcert|sslkey)=[^&#]*(&?)/g,
    (_, lead: string, next: string) => (next ? lead : ""),
  );
  return parse(withoutFiles).host ?? "";
}

// This machine only: a loopback address or a Unix socket path.
export const isLocalDatabaseHost = (host: string) =>
  LOCAL_HOSTS.includes(host) || host.startsWith("/");

export function databaseTlsOn(url: string): boolean {
  try {
    if (isLocalDatabaseHost(databaseHost(url))) return true;
    const params = new URL(url).searchParams;
    return (
      params.getAll("sslmode").at(-1) === "verify-full" &&
      Boolean(params.getAll("sslrootcert").at(-1))
    );
  } catch {
    return false;
  }
}
