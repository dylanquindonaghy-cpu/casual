// A download that writes the log (export.downloaded) must start on the app's own pages. A browser
// says where a request came from in Sec-Fetch-Site: another site, including another firm's
// address on the same domain ("same-site"), mustn't be able to send a logged-in office user to a
// download, which would log it in their name and leave the file on their device. "none" is the
// address typed or opened from a bookmark. A browser that doesn't send the header (Safari before
// 16.4) is let through: the file still goes only to the logged-in user.
export function fromOwnPages(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  return site === null || site === "same-origin" || site === "none";
}
