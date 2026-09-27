import type { Instrumentation } from "next";

// Runs once when the Next.js server starts (src/instrumentation.ts is a Next file convention).
// Next compiles this file for the Edge runtime too, so Node-only code (the logger writes to
// process.stdout) is imported dynamically, and only in the Node.js runtime.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { routeConsoleThroughMasking } = await import("./lib/log/console");
    routeConsoleThroughMasking();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ log }, { createOnRequestError }] = await Promise.all([
    import("./lib/log"),
    import("./lib/log/next"),
  ]);
  await createOnRequestError(log)(err, request, context);
};
