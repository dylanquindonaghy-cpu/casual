import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { SessionDetailsForm } from "@/app/office/shifts/[id]/details-form";
import { EditShiftForm } from "@/app/office/shifts/[id]/edit-form";
import { ShiftCreateForm } from "@/app/office/shifts/shift-create-form";
import { SiteBlocks } from "@/app/office/casuals/[id]/access-forms";
import { PayQueryForm } from "@/app/pay/query/pay-query-form";
import { AvailabilityForm } from "@/app/profile/availability-form";
import { NotificationForm } from "@/app/profile/notification-form";
import { RequestForm } from "@/app/requests/new/request-form";
import { LogoutButton } from "@/app/logout-button";
import { AskButton } from "@/app/shifts/open/ask-button";
import { TakeShiftButton } from "@/app/shifts/open/take-shift-button";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

// A field whose value lives in React state (`value={state}`, `checked={state}`) is put back to that
// state when React takes over the page (hydration). Anything typed or picked in the browser before
// then is lost: on a slow venue signal that's a worker's typing, and in the browser tests it was the
// event "Date" (back to today) and the worker page's "Site" (back to "Choose a site"). So every such
// field in a client component stays disabled until the page is ready, from `useHydrated()`
// (src/app/use-hydrated.ts; docs/ui-design.md "Forms wait for the page"). The browser can't type
// into a disabled field, and Playwright's fill/selectOption/check wait for it to be enabled.
// The same goes for a field that only reports its changes to React state (`onChange`, like the
// import pages' file pickers): a file chosen before then shows in the field but never reaches the
// state, so "Check the file" says to choose one.
//
// This reads every "use client" file under src/app with the TypeScript parser and fails, with the
// file and line, for such an <input>, <select> or <textarea> that has no `disabled`, or whose
// `disabled` doesn't depend on the useHydrated() flag (`disabled={locked}` alone still loses typing
// when nothing is locked), and for a file with such fields that never calls useHydrated().
//
// Buttons too (Phase 37.7, w1-10): a <button> whose only work is a click handler (`onClick`) does
// nothing when tapped before React takes over the page: no request, no message, no form to fall
// back on. So in the casual app (every "use client" file under src/app but office/, client/ and
// start/, which are parked: docs/plan/parking-lot.md) such a button's `disabled` must depend on
// the useHydrated() flag ("Take shift", "I can do this", "Log out", cancel...). A file's buttons
// that only appear once the page is ready (in a sheet, after an answer, in the tour, or after an
// effect) are counted in SHOWN_AFTER_READY, with why; the count must match, so a new button that
// doesn't wait fails, and so does a stale allowance. Like the field rule, it reads only files with
// the "use client" directive: a component file without it (push-setting-view.tsx, whose parent
// draws nothing until an effect runs; error-body.tsx, given `ready` as a prop) isn't read.

const APP = join(process.cwd(), "src", "app");
const FIELDS = new Set(["input", "select", "textarea"]);
// <input> kinds nobody types into or picks: their value is data or a label, never someone's input
// (and a disabled hidden input would drop out of the form).
const NOT_INPUT = new Set(["hidden", "submit", "button", "reset", "image"]);
// For a tick box or a choice, `value` is what the form sends; only `checked` makes React own it.
const TOGGLES = new Set(["checkbox", "radio"]);

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// "use client" in the directive prologue (the string statements before any code).
function isClient(source: ts.SourceFile): boolean {
  for (const statement of source.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use client") return true;
  }
  return false;
}

function forEachNode(node: ts.Node, visit: (n: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => forEachNode(child, visit));
}

const isHydratedCall = (n: ts.Node) =>
  ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "useHydrated";

const attrName = (a: ts.JsxAttribute) => (ts.isIdentifier(a.name) ? a.name.text : a.name.getText());

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindingNames(e.name)));
}

// The names that carry "the page is ready": bound to useHydrated(), or built from such a name, in
// a variable (`const off = !ready || pending`), an object a helper hook returns (`{ ready, off:
// !ready || pending }`), or a prop handed to a child (`<Reasons ready={ready} />`). By name, not
// by scope: it's a guard against forgetting the flag, not a type checker.
function readyNames(source: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const sites: { names: string[]; value: ts.Node }[] = [];
  forEachNode(source, (n) => {
    if (ts.isVariableDeclaration(n) && n.initializer) {
      sites.push({ names: bindingNames(n.name), value: n.initializer });
    } else if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name)) {
      sites.push({ names: [n.name.text], value: n.initializer });
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer)) {
      if (n.initializer.expression) {
        sites.push({ names: [attrName(n)], value: n.initializer.expression });
      }
    }
  });
  const mentionsReady = (node: ts.Node) => {
    let found = false;
    forEachNode(node, (n) => {
      if (isHydratedCall(n) || (ts.isIdentifier(n) && names.has(n.text))) found = true;
    });
    return found;
  };
  for (let grew = true; grew;) {
    grew = false;
    for (const site of sites) {
      if (!mentionsReady(site.value)) continue;
      for (const name of site.names) {
        if (!names.has(name)) {
          names.add(name);
          grew = true;
        }
      }
    }
  }
  return names;
}

// Every field React owns in a client component that could lose what was typed before the page was
// ready, as "file:line <tag> why". Not a client component: [] (the server's HTML never changes).
function hydrationProblems(file: string, text: string): string[] {
  const source = parse(file, text);
  if (!isClient(source)) return [];
  const ready = readyNames(source);
  const dependsOnReady = (expr: ts.Expression) => {
    let found = false;
    forEachNode(expr, (n) => {
      if (isHydratedCall(n) || (ts.isIdentifier(n) && ready.has(n.text))) found = true;
    });
    return found;
  };
  let callsUseHydrated = false;
  let owned = 0;
  const problems: string[] = [];
  forEachNode(source, (n) => {
    if (isHydratedCall(n)) callsUseHydrated = true;
    if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
    if (!ts.isIdentifier(n.tagName) || !FIELDS.has(n.tagName.text)) return;
    const tag = n.tagName.text;
    const where = `${file}:${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1} <${tag}>`;
    const props = n.attributes.properties;
    if (props.some(ts.isJsxSpreadAttribute)) {
      problems.push(
        `${where} spreads props ({...x}), so this check can't see whether React owns its value: write value/checked and disabled out`,
      );
      return;
    }
    const attr = (name: string) =>
      props.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && attrName(p) === name);
    const typeInit = attr("type")?.initializer;
    const type = tag === "input" && typeInit && ts.isStringLiteral(typeInit) ? typeInit.text : null;
    if (type && NOT_INPUT.has(type)) return;
    const controlledBy = (type && TOGGLES.has(type) ? ["checked"] : ["value", "checked"]).find(
      attr,
    );
    const reportsTo = ["onChange", "onInput"].find(attr);
    // Neither: the browser keeps what was typed, and the form sends it (the login pages).
    if (!controlledBy && !reportsTo) return;
    owned += 1;
    const what = controlledBy
      ? `takes its ${controlledBy} from React state`
      : `hands its changes to React state (${reportsTo})`;
    const disabled = attr("disabled");
    if (!disabled) {
      problems.push(
        `${where} ${what} but has no disabled: anything typed or picked before the page is ready is lost when React takes over. Add disabled={!ready} with const ready = useHydrated()`,
      );
      return;
    }
    const init = disabled.initializer;
    if (!init) return; // always disabled: nothing can be typed, so nothing is lost
    const expr = ts.isJsxExpression(init) ? init.expression : undefined;
    if (!expr || !dependsOnReady(expr)) {
      problems.push(
        `${where} ${what}, but its ${disabled.getText(source)} doesn't wait for the page: include the useHydrated() flag (e.g. disabled={locked || !ready})`,
      );
    }
  });
  if (owned > 0 && !callsUseHydrated) {
    problems.push(
      `${file} has ${owned} field(s) React owns but never calls useHydrated(), so they can't wait for the page`,
    );
  }
  return problems;
}

// Every <button> with an onClick in a client component whose disabled doesn't wait for the page,
// as "file:line <button> why". Not a client component: [].
function buttonProblems(file: string, text: string): string[] {
  const source = parse(file, text);
  if (!isClient(source)) return [];
  const ready = readyNames(source);
  const dependsOnReady = (expr: ts.Expression) => {
    let found = false;
    forEachNode(expr, (n) => {
      if (isHydratedCall(n) || (ts.isIdentifier(n) && ready.has(n.text))) found = true;
    });
    return found;
  };
  const problems: string[] = [];
  const fix = "add disabled={!ready || pending} with const ready = useHydrated()";
  forEachNode(source, (n) => {
    if (!ts.isJsxOpeningElement(n) && !ts.isJsxSelfClosingElement(n)) return;
    if (!ts.isIdentifier(n.tagName) || n.tagName.text !== "button") return;
    const where = `${file}:${source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1} <button>`;
    const props = n.attributes.properties;
    if (props.some(ts.isJsxSpreadAttribute)) {
      problems.push(
        `${where} spreads props ({...x}), so this check can't see its onClick or disabled`,
      );
      return;
    }
    const attr = (name: string) =>
      props.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && attrName(p) === name);
    if (!attr("onClick")) return; // a form's submit button works without the page's scripts
    const disabled = attr("disabled");
    if (!disabled) {
      problems.push(`${where} runs only from onClick but has no disabled: ${fix}`);
      return;
    }
    const init = disabled.initializer;
    if (!init) return; // always disabled
    const expr = ts.isJsxExpression(init) ? init.expression : undefined;
    if (!expr || !dependsOnReady(expr)) {
      problems.push(
        `${where} runs only from onClick but its ${disabled.getText(source)} doesn't wait for the page: ${fix}`,
      );
    }
  });
  return problems;
}

// The casual app's buttons that only appear once the page is ready, per file (under src/app).
const SHOWN_AFTER_READY: Record<string, { count: number; why: string }> = {
  "confirm-email/confirm-email.tsx": { count: 1, why: "drawn only after an effect reads the link" },
  "home-screen-hint.tsx": { count: 1, why: "null until an effect has run" },
  "l/link-login.tsx": { count: 1, why: "drawn only after an effect reads the link" },
  "offered-to-you.tsx": { count: 1, why: "in its sheet, opened by a tap" },
  "profile/travel/travel-form.tsx": { count: 1, why: "in its sheet, opened by a tap" },
  "requests/requests-list.tsx": { count: 1, why: "in its sheet, opened by a tap" },
  "shifts/[id]/review-form.tsx": { count: 1, why: "after an answer" },
  "shifts/cancel-shift.tsx": { count: 5, why: "in its sheet, opened by a tap" },
  "tour/tour.tsx": { count: 3, why: "in the tour, opened from state" },
  "tour/welcome.tsx": { count: 4, why: "in the tour's welcome, opened from state" },
};
const OUT_OF_SCOPE = ["src/app/office/", "src/app/client/", "src/app/start/"];

const rel = (path: string) => relative(process.cwd(), path).replace(/\\/g, "/");
const clientFiles = tsxFiles(APP)
  .map((path) => ({ file: rel(path), text: readFileSync(path, "utf8") }))
  .filter(({ file, text }) => isClient(parse(file, text)));
const withControlledFields = clientFiles.filter(({ text }) =>
  /\b(value|checked)=\{/.test(text.replace(/<option\b[^>]*>/g, "")),
);

describe("fields React controls wait for the page before taking input", () => {
  it("finds the client components and the ones with controlled fields", () => {
    expect(clientFiles.length).toBeGreaterThanOrEqual(20);
    // The two the browser tests caught, so a broken scan can't pass by finding nothing.
    const files = withControlledFields.map((f) => f.file);
    expect(files).toEqual(
      expect.arrayContaining([
        "src/app/office/shifts/shift-create-form.tsx",
        "src/app/office/casuals/[id]/access-forms.tsx",
      ]),
    );
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it.each(clientFiles.map((f) => f.file))(
    "%s keeps controlled fields disabled until ready",
    (file) => {
      const text = clientFiles.find((f) => f.file === file)?.text ?? "";
      expect(hydrationProblems(file, text)).toEqual([]);
    },
  );

  it("would catch a controlled field that doesn't wait, and pass one that does", () => {
    const client = (body: string) =>
      `"use client";\nimport { useHydrated } from "@/app/use-hydrated";\n${body}`;
    // No disabled at all.
    expect(
      hydrationProblems(
        "a.tsx",
        client(`export function A() { const [v, setV] = useState(""); const ready = useHydrated();
          return <input value={v} onChange={(e) => setV(e.target.value)} />; }`),
      ),
    ).toEqual([expect.stringMatching(/^a\.tsx:4 <input> takes its value .* has no disabled/)]);
    // disabled, but not tied to the page being ready (the edit form's locked fields).
    expect(
      hydrationProblems(
        "b.tsx",
        client(`export function B({ locked }: { locked: boolean }) { const ready = useHydrated();
          return <select value="x" disabled={locked} onChange={() => {}} />; }`),
      ),
    ).toEqual([expect.stringMatching(/<select> .* disabled=\{locked\} doesn't wait for the page/)]);
    // A chosen radio is controlled by `checked`; the file never calls useHydrated().
    expect(
      hydrationProblems(
        "c.tsx",
        `"use client";\nexport function C() { return <input type="radio" value="a" checked={true} disabled={false} />; }`,
      ),
    ).toEqual([
      expect.stringMatching(/<input> takes its checked .* disabled=\{false\} doesn't wait/),
      expect.stringMatching(/^c\.tsx has 1 field\(s\) .* never calls useHydrated/),
    ]);
    // Waiting for the page, directly or through a helper hook's flag or a prop: fine.
    expect(
      hydrationProblems(
        "d.tsx",
        client(`function useChange() { const ready = useHydrated(); return { off: !ready || p }; }
          function Reasons({ off }: { off: boolean }) { return <select value="" disabled={off} />; }
          export function D() { const { off } = useChange(); const ready = useHydrated();
            return <><input value="" disabled={locked || !ready} /><Reasons off={off} />
              <textarea value="" disabled /></>; }`),
      ),
    ).toEqual([]);
    // A file picker that only hands its file to React state (onChange): the same rule.
    expect(
      hydrationProblems(
        "g.tsx",
        client(`export function G() { const hydrated = useHydrated();
          return <><input type="file" onChange={(e) => setFile(e.target.files?.[0])} />
            <input type="file" onChange={pick} disabled={!hydrated} /></>; }`),
      ),
    ).toEqual([
      expect.stringMatching(/^g\.tsx:4 <input> hands its changes to React state \(onChange\) .*/),
    ]);
    // Not React's (the browser keeps the value), not typed into, or not a client component.
    expect(
      hydrationProblems(
        "e.tsx",
        client(`export function E() { return <><input type="checkbox" value="yes" />
          <input type="hidden" value={id} /><input defaultValue="x" /><option value={id} /></>; }`),
      ),
    ).toEqual([]);
    expect(
      hydrationProblems("f.tsx", `export function F() { return <input value={v} />; }`),
    ).toEqual([]);
  });
});

describe("buttons that act on a tap wait for the page (Phase 37.7)", () => {
  const casual = clientFiles.filter(({ file }) => !OUT_OF_SCOPE.some((d) => file.startsWith(d)));
  const key = (file: string) => file.replace(/^src\/app\//, "");

  it("finds the casual app's tap buttons (a broken scan fails)", () => {
    const withButtons = casual
      .filter(({ text }) => /<button\b[^>]*onClick/s.test(text))
      .map(({ file }) => key(file));
    expect(withButtons).toEqual(
      expect.arrayContaining([
        "shifts/open/take-shift-button.tsx",
        "shifts/open/ask-button.tsx",
        "shifts/cancel-shift.tsx",
        "offered-to-you.tsx",
        "logout-button.tsx",
      ]),
    );
    // Every allowance is for a file the scan reads.
    for (const file of Object.keys(SHOWN_AFTER_READY)) {
      expect(casual.map(({ file: f }) => key(f))).toContain(file);
    }
  });

  it.each(casual.map((f) => f.file))(
    "%s keeps its onClick buttons disabled until ready",
    (file) => {
      const text = casual.find((f) => f.file === file)?.text ?? "";
      const problems = buttonProblems(file, text);
      const allowed = SHOWN_AFTER_READY[key(file)]?.count ?? 0;
      if (allowed === 0) expect(problems).toEqual([]);
      else expect(problems, problems.join("\n")).toHaveLength(allowed);
    },
  );

  it("would catch a tap button that doesn't wait, and pass one that does", () => {
    const client = (body: string) =>
      `"use client";\nimport { useHydrated } from "@/app/use-hydrated";\n${body}`;
    expect(
      buttonProblems(
        "a.tsx",
        client(
          `export function A() { return <button type="button" onClick={take}>Take shift</button>; }`,
        ),
      ),
    ).toEqual([
      expect.stringMatching(/^a\.tsx:3 <button> runs only from onClick but has no disabled/),
    ]);
    expect(
      buttonProblems(
        "b.tsx",
        client(`export function B() { const [pending] = useTransition();
          return <button type="button" disabled={pending} onClick={take}>Take shift</button>; }`),
      ),
    ).toEqual([expect.stringMatching(/disabled=\{pending\} doesn't wait for the page/)]);
    expect(
      buttonProblems(
        "c.tsx",
        client(`export function C(p: object) { return <button {...p} onClick={go} />; }`),
      ),
    ).toEqual([expect.stringMatching(/spreads props/)]);
    expect(
      buttonProblems(
        "d.tsx",
        client(`export function D() { const ready = useHydrated(); const off = !ready || pending;
          return <><button type="button" disabled={!ready || pending} onClick={a}>A</button>
            <button type="button" disabled={off} onClick={b}>B</button>
            <button type="submit">Send</button><button type="button" disabled onClick={c} /></>; }`),
      ),
    ).toEqual([]);
    expect(
      buttonProblems("e.tsx", `export function E() { return <button onClick={go}>Go</button>; }`),
    ).toEqual([]);
    expect(OUT_OF_SCOPE).toContain("src/app/office/");
  });

  it("an allowance above or below what the file has fails", () => {
    const text = `"use client";\nexport function F() { return <button onClick={go}>Go</button>; }`;
    const problems = buttonProblems("f.tsx", text);
    expect(problems).toHaveLength(1);
    expect(problems).not.toHaveLength(2); // an allowance of 2 would fail
    expect(problems).not.toHaveLength(0); // and so would none
  });
});

// The buttons a casual taps, in the HTML the server sends: disabled until the page is ready.
describe("in the server's HTML, the buttons a casual taps are disabled", () => {
  it.each([
    ["Take shift", createElement(TakeShiftButton, { shiftId: "s1" })],
    ["Take shift", createElement(TakeShiftButton, { shiftId: "s1", onShiftPage: true })],
    ["I can do this", createElement(AskButton, { shiftId: "s1" })],
    [
      "Log out",
      createElement(LogoutButton, { kind: "worker", after: "/login?out=1", className: "w" }),
    ],
  ] as [string, ReactElement][])("%s", (words, element) => {
    const html = renderToStaticMarkup(element);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toContain('disabled=""');
    expect(html).toContain(`>${words}</button>`);
  });
});

// The same rule, seen in the HTML the server sends: it's what the browser shows until React takes
// over, so every field in it is disabled. (After that, useHydrated() turns true and they enable.)
describe("in the server's HTML, before the page is ready, the fields are disabled", () => {
  const sites = [{ id: "site-1", name: "Demo Arena" }];
  const qualifications = [
    { code: "FIRST_AID", name: "first aid at work certificate" },
    { code: "SIA_DS", name: "SIA door supervisor licence" },
  ];
  const eventForm = createElement(ShiftCreateForm, {
    mode: "event",
    sites,
    roles: ["steward"],
    qualifications,
    today: "2026-11-02",
  });
  const forms: [string, ReactElement, number][] = [
    [
      "Sessions for an event (the name, the date, the site, 4 lines with their details and 2 requirements each, the meeting point, the uniform, the instructions)",
      eventForm,
      38,
    ],
    [
      "Session details (pay rate, post, meeting point, uniform, 2 requirements)",
      createElement(SessionDetailsForm, {
        shiftId: "shift-1",
        defaults: { payRate: "", post: "", meetingPoint: "", uniform: "", requirements: [] },
        qualifications,
        requirementsLocked: false,
      }),
      6,
    ],
    [
      "Edit this shift, nobody booked (nothing locked)",
      createElement(EditShiftForm, {
        shiftId: "shift-1",
        defaults: {
          date: "2026-11-07",
          start: "08:00",
          end: "16:00",
          role: "steward",
          siteId: "",
          headcount: "2",
          instructions: "",
        },
        sites,
        booked: 0,
      }),
      7,
    ],
    [
      "A worker's sites (unblock reason, site, block reason)",
      createElement(SiteBlocks, {
        workerId: "worker-1",
        blocks: [{ siteId: "site-2", site: "Racecourse", line: "Blocked on 1 Nov" }],
        otherSites: sites,
      }),
      3,
    ],
    [
      "Raise a pay query",
      createElement(PayQueryForm, {
        shifts: [{ shiftId: "shift-1", label: "Sat 7 Nov" }],
        today: "2026-11-02",
        earliest: "2026-08-04",
      }),
      3,
    ],
    [
      "New request",
      createElement(RequestForm, {
        shifts: [
          { shiftId: "shift-1", label: "Sat 7 Nov" },
          { shiftId: "shift-2", label: "Sun 8 Nov" },
        ],
        preselected: null,
      }),
      3,
    ],
    [
      "Notification settings",
      createElement(NotificationForm, {
        channel: "sms",
        offerAlerts: true,
        textsOff: false,
        loginWay: "message",
        // An address held, so both ways to choose show (Phase 26.9): a text and an email.
        email: "sam@example.test",
        signOff: "Acme Events Shift Team",
      }),
      3,
    ],
    [
      "Days I can't work",
      createElement(AvailabilityForm, {
        days: [],
        min: "2026-11-02",
        max: "2027-05-01",
        signOff: "Acme Events Shift Team",
      }),
      1,
    ],
  ];

  it.each(forms)("%s", (_name, element, atLeast) => {
    const tags = renderToStaticMarkup(element).match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(atLeast);
    expect(tags.filter((tag) => !tag.includes('disabled=""'))).toEqual([]);
  });

  it("sends the event's date (today) disabled, so nothing can be typed over it too early", () => {
    const html = renderToStaticMarkup(eventForm);
    const date = html.match(/<input[^>]*type="date"[^>]*>/)?.[0] ?? "";
    expect(date).toContain('value="2026-11-02"');
    expect(date).toContain('disabled=""');
  });
});
