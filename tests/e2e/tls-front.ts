import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:https";
import { connect } from "node:net";

// https for a firm's own domain in the browser tests, standing in for Caddy (deploy/Caddyfile):
// it takes https on 127.0.0.1:<listen>, with a certificate made here for the made-up domain
// (self-signed, two days, in the git-ignored .dev/; the browser is told to accept it), and passes
// each request to the e2e web app on <target> with its Host unchanged, as Caddy does, plus the
// X-Forwarded headers Caddy adds. (X-Real-IP is passed through: each test sets its own, see
// fixtures.ts.) The browser maps the domain's https port here (playwright.config.ts).
// Over plain http a browser refuses the session cookie (Secure, __Host-) on any name but
// localhost, so logging in on a firm's own domain needs https, as in production.
//
//   node --import tsx tests/e2e/tls-front.ts <domain> <listen port> <target port>

const [domain, listen, target] = process.argv.slice(2);
if (!domain || !/^[a-z0-9.-]+\.test$/.test(domain) || !listen || !target) {
  throw new Error("usage: tls-front.ts <a .test domain> <listen port> <target port>");
}

mkdirSync(".dev", { recursive: true });
const key = ".dev/e2e-tls.key";
const cert = ".dev/e2e-tls.crt";
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "2",
    "-subj",
    `/CN=${domain}`,
    "-addext",
    `subjectAltName=DNS:${domain}`,
    "-keyout",
    key,
    "-out",
    cert,
  ],
  { stdio: "ignore" },
);

const forwarded = (host: string | undefined) => ({
  "x-forwarded-proto": "https",
  ...(host ? { "x-forwarded-host": host } : {}),
});

const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  const upstream = request(
    {
      host: "127.0.0.1",
      port: Number(target),
      method: req.method,
      path: req.url,
      headers: { ...req.headers, ...forwarded(req.headers.host) },
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

// WebSockets (the dev server's live connection): the raw request, then bytes both ways.
server.on("upgrade", (req, socket, head) => {
  const upstream = connect(Number(target), "127.0.0.1", () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    }
    for (const [name, value] of Object.entries(forwarded(req.headers.host))) {
      lines.push(`${name}: ${value}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head.length > 0) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(Number(listen), "127.0.0.1", () => {
  console.log(`[tls-front] https for ${domain} on 127.0.0.1:${listen}`);
});
