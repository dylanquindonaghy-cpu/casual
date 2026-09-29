import Link from "next/link";
import type { Profile } from "@/lib/portal/profile";
import { MAX_UNAVAILABLE_DAYS, UNAVAILABLE_AHEAD_DAYS } from "@/lib/portal/profile-kinds";
import { shortDate } from "@/lib/rules/reasons";
import { addDays } from "@/lib/time/zoned";
import { AvailabilityForm } from "./availability-form";
import { NotificationForm } from "./notification-form";
import { PushSetting } from "./push-setting";

// Me (docs/screens.md, `/profile`): contact details and credentials as the office holds them
// (read-only), days I can't work, and how we reach me.

const STATUS_WORDS = {
  valid: "Valid",
  expired: "Expired",
  applied: "Applied for",
  suspended: "Suspended",
} as const;

// "07700 900123" from "+447700900123"; other numbers as stored.
export const ukMobile = (e164: string) =>
  /^\+44\d{10}$/.test(e164) ? `0${e164.slice(3, 7)} ${e164.slice(7)}` : e164;

// Credential names are stored as workers say them mid-sentence ("first aid at work certificate");
// as a heading they start with a capital.
const title = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);

export function ProfileView({
  profile,
  signOff,
  push = null,
}: {
  profile: Profile;
  signOff: string;
  push?: { publicKey: string | null; firmName: string } | null;
}) {
  const year = Number(profile.today.slice(0, 4));
  return (
    <>
      <h1 className="text-3xl font-bold">
        {profile.firstName} {profile.lastName}
      </h1>

      <section aria-labelledby="contact-heading" className="mt-6">
        <h2 id="contact-heading" className="text-xl font-semibold">
          Your details
        </h2>
        <p className="mt-2">Mobile: {ukMobile(profile.mobile)}</p>
        <p>Email: {profile.email ?? "none"}</p>
        <p className="mt-1 text-base text-slate-600">To change these, ask the office.</p>
      </section>

      <section aria-labelledby="credentials-heading" className="mt-6">
        <h2 id="credentials-heading" className="text-xl font-semibold">
          Licences and cards
        </h2>
        {profile.credentials.length === 0 ? (
          <p className="mt-2">None on file. Send yours to the office to be checked.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {profile.credentials.map((c, i) => (
              <li
                key={`${c.type}:${i}`}
                className={`rounded-xl border-2 p-3 ${c.expired || c.status === "suspended" ? "border-red-700 bg-red-50 text-red-900" : "border-slate-300"}`}
              >
                <p className="font-semibold">{title(c.name)}</p>
                <p className="text-base">
                  {c.expired ? "Expired" : STATUS_WORDS[c.status]}
                  {c.expiresOn
                    ? ` · ${c.expired ? "expired" : "expires"} ${shortDate(c.expiresOn, year)}`
                    : c.status === "valid"
                      ? " · no expiry date"
                      : ""}
                </p>
                {c.expired ? (
                  <p className="mt-1 text-base">
                    You can&apos;t take shifts that need it. Renew it and send the new details to
                    the office.
                  </p>
                ) : c.status === "suspended" ? (
                  <p className="mt-1 text-base">
                    You can&apos;t take shifts that need it. Contact the office.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="days-heading" className="mt-6">
        <h2 id="days-heading" className="text-xl font-semibold">
          Days you can&apos;t work
        </h2>
        <p className="mt-1 text-base text-slate-600">
          We won&apos;t offer you shifts on these days. Up to {MAX_UNAVAILABLE_DAYS} days, in the
          next 6 months.
        </p>
        <AvailabilityForm
          signOff={signOff}
          days={profile.unavailable}
          min={profile.today}
          max={addDays(profile.today, UNAVAILABLE_AHEAD_DAYS)}
        />
      </section>

      <section aria-labelledby="notify-heading" className="mt-6">
        <h2 id="notify-heading" className="text-xl font-semibold">
          How we reach you
        </h2>
        <NotificationForm
          channel={profile.notifyChannel}
          offerAlerts={profile.offerAlerts}
          signOff={signOff}
        />
        {push && <PushSetting publicKey={push.publicKey} firmName={push.firmName} />}
      </section>

      <Link
        href="/"
        className="mt-8 block w-full rounded-xl border-2 border-slate-900 px-4 py-3 text-center text-lg font-semibold"
      >
        Back to my shifts
      </Link>
    </>
  );
}
