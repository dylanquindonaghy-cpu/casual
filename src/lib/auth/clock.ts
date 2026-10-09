// Auth code takes the time from a clock and compares against it in SQL (never SQL now()), so
// tests can check expiry exactly at the boundary without sleeping.
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const addMs = (date: Date, ms: number) => new Date(date.getTime() + ms);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
