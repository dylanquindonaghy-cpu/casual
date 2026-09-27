// Shown when a rate limit stops a login or code request. Says how long to wait, in words a
// worker reads at a glance: minutes under an hour, hours after that.
export function waitText(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

export function TooManyTries({ minutes }: { minutes: number }) {
  return (
    <p role="alert" className="mt-4 text-red-700">
      Too many tries. Try again in {waitText(minutes)}.
    </p>
  );
}
