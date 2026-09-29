import {
  resolveFirmByDomain,
  resolveFirmBySlug,
  type FirmDirectoryEntry,
  type ResolveFirmByDomain,
  type ResolveFirmBySlug,
} from "../db/directory";
import { parseHost } from "./host";

// The firm a request's Host header belongs to, or null if it isn't a known firm's portal: a
// firm's subdomain (<slug>.<base>) or its own verified domain (Phase 8). The Host header is the
// only input: X-Forwarded-Host is client-controllable when Next is reached directly, so it is
// never read.
export async function firmForHost(
  host: string | null | undefined,
  baseDomain: string,
  resolve: ResolveFirmBySlug = resolveFirmBySlug,
  resolveDomain: ResolveFirmByDomain = resolveFirmByDomain,
): Promise<FirmDirectoryEntry | null> {
  const match = parseHost(host, baseDomain);
  if (match?.kind === "firm") return resolve(match.slug);
  if (match?.kind === "custom") return resolveDomain(match.domain);
  return null;
}
