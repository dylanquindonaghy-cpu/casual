// The web import's file limit (Next's server-action body limit is 1 MB, with room left for the
// upload's own framing). No imports: the upload form checks it in the browser too.
export const WEB_IMPORT_MAX_BYTES = 1_000_000 - 50_000;
