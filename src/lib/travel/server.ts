import { appEnv } from "../env";
import { geocoderFor, type Geocoder } from "./geocoder";

// The server's geocoder, from TRAVEL_PROVIDER (src/lib/env.ts). Server only.
export function serverGeocoder(): Geocoder {
  return geocoderFor(appEnv().TRAVEL_PROVIDER);
}
