import { workerEnv } from "../env";
import { fakeTravelProvider, travelTimeProvider, type TravelProvider } from "./provider";

// The worker's travel provider, from TRAVEL_PROVIDER and TravelTime's keys (src/lib/env.ts: the
// worker's settings, which the web app can't read). Worker only.
export function workerTravelProvider(): TravelProvider {
  const env = workerEnv();
  if (env.TRAVEL_PROVIDER !== "traveltime") return fakeTravelProvider;
  return travelTimeProvider({
    appId: env.TRAVELTIME_APP_ID ?? "",
    apiKey: env.TRAVELTIME_API_KEY ?? "",
  });
}
