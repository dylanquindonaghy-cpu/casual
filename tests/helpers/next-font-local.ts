// Vitest stands in for next/font/local (vitest.config.ts): Next compiles the font loader while
// building, and tests aren't built. Each font gives its CSS variable's name as its classes; no file
// is read.
export default function localFont(options: { variable?: string }) {
  const name = (options.variable ?? "--font").replace(/^--/, "");
  return { className: name, variable: name, style: { fontFamily: name } };
}
