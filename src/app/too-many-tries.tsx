import { Slip } from "@/app/ui/slip";

// Shown when a rate limit stops a login or code request. Says how long to wait, in words a
// worker reads at a glance: minutes under an hour, hours after that.
export function waitText(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

// A red slip (Phase 28.16: the office's notice, 8px round with a 1px edge in place of its own 2px
// frame), in the casual app and the office's login alike.
export function TooManyTries({ minutes }: { minutes: number }) {
  return (
    <Slip tone="urgent" role="alert" className="mt-4">
      <p className="font-semibold">Too many tries. Try again in {waitText(minutes)}.</p>
    </Slip>
  );
}
