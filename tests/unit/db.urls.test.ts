import { describe, expect, it } from "vitest";
import { connectionTarget, credentials, isLocalHost } from "@/lib/db/admin/urls";
import { urlUser } from "@/lib/env";

// The local-only guards (seed, db:reset, tests) must see the host pg will really connect to.

describe("connection targets, read the way pg reads them", () => {
  it.each([
    ["postgres://u:p@localhost:5432/db", true],
    ["postgres://u:p@127.0.0.1:5432/db", true],
    ["postgres://u:p@[::1]:5432/db", true],
    ["postgres://u:p@/db?host=/var/run/postgresql", true],
    ["postgres://u:p@db.example.com:5432/db", false],
    ["postgres://u:p@localhost:5432/db?host=db.example.com", false],
    ["postgres://u:p@localhost:5432/db?host=10.0.0.5", false],
    ["postgres://u:p@localhost:5432/db?host=localhost&host=db.example.com", false],
    ["postgres://u:p@db.example.com:5432/db?host=", false],
  ])("%s is local: %s", (url, local) => {
    expect(isLocalHost(url)).toBe(local);
  });

  it("a ?user= or ?password= parameter wins over the URL's own, as in pg", () => {
    const url = "postgres://shiftdesk_app:a%2Fb@localhost/db?user=shiftdesk&password=other";
    expect(connectionTarget(url)).toEqual({
      host: "localhost",
      user: "shiftdesk",
      password: "other",
    });
    expect(credentials("postgres://u:a%2Fb%40c@localhost/db").password).toBe("a/b@c");
    expect(urlUser(url)).toBe("shiftdesk"); // so the env check sees the real role
  });

  it("the env check agrees with pg when ?user= is repeated or empty", () => {
    for (const url of [
      "postgres://shiftdesk_app:p@localhost/db?user=shiftdesk_app&user=shiftdesk",
      "postgres://shiftdesk_app:p@localhost/db?user=",
      "postgres://u:p@localhost/db?user=a&user=",
    ]) {
      expect(urlUser(url)).toBe(connectionTarget(url).user);
    }
  });
});
