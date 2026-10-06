import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { EditShiftForm } from "@/app/office/shifts/[id]/edit-form";
import { ShiftCreateForm } from "@/app/office/shifts/shift-create-form";
import { SiteBlocks } from "@/app/office/workers/[id]/access-forms";
import { PayQueryForm } from "@/app/pay/query/pay-query-form";
import { AvailabilityForm } from "@/app/profile/availability-form";
import { NotificationForm } from "@/app/profile/notification-form";
import { RequestForm } from "@/app/requests/new/request-form";

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
        "src/app/office/workers/[id]/access-forms.tsx",
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

// The same rule, seen in the HTML the server sends: it's what the browser shows until React takes
// over, so every field in it is disabled. (After that, useHydrated() turns true and they enable.)
describe("in the server's HTML, before the page is ready, the fields are disabled", () => {
  const sites = [{ id: "site-1", name: "Demo Arena" }];
  const eventForm = createElement(ShiftCreateForm, {
    mode: "event",
    sites,
    roles: ["steward"],
    today: "2026-11-02",
  });
  const forms: [string, ReactElement, number][] = [
    ["Shifts for an event (the date, the site, 4 lines, the instructions)", eventForm, 19],
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
        channel: "whatsapp",
        offerAlerts: true,
        textsOff: false,
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
