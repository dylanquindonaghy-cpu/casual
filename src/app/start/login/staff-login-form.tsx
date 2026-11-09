"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { btn, field, label } from "@/app/ui/classes";
import { Slip } from "@/app/ui/slip";
import { LOGIN_COPY } from "@/lib/demo/start-copy";
import { staffLoginAction, type StaffLoginState } from "../actions";

// The email and password, and "Log in". A wrong pair says so in the same words whichever part was
// wrong; the fields keep what was typed. On success the browser goes to "Choose a view". Paste and
// password managers work (autocomplete), as WCAG's accessible login asks.
export function StaffLoginForm() {
  const router = useRouter();
  const [state, action, pending] = useActionState<StaffLoginState, FormData>(staffLoginAction, {
    status: "idle",
  });
  useEffect(() => {
    if (state.status === "ok") router.replace("/start");
  }, [state.status, router]);

  const problem = loginProblem(state);
  return (
    <form action={action} className="mt-6">
      <label htmlFor="email" className={label}>
        {LOGIN_COPY.email}
      </label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
        aria-invalid={state.status === "wrong"}
        aria-describedby={problem ? "login-problem" : undefined}
        className={`${field} mt-2 w-full`}
      />
      <label htmlFor="password" className={`${label} mt-4`}>
        {LOGIN_COPY.password}
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        aria-invalid={state.status === "wrong"}
        aria-describedby={problem ? "login-problem" : undefined}
        className={`${field} mt-2 w-full`}
      />
      {problem && (
        <Slip tone="urgent" role="alert" className="mt-4">
          <p id="login-problem" className="font-semibold">
            {problem}
          </p>
        </Slip>
      )}
      <button
        type="submit"
        disabled={pending || state.status === "ok"}
        className={`${btn.primary} mt-4 w-full`}
      >
        {pending || state.status === "ok" ? LOGIN_COPY.pending : LOGIN_COPY.button}
      </button>
    </form>
  );
}

export function loginProblem(state: StaffLoginState): string | null {
  switch (state.status) {
    case "wrong":
      return LOGIN_COPY.wrong;
    case "rate_limited":
      return LOGIN_COPY.tooMany;
    case "off":
    case "error":
      return LOGIN_COPY.problem;
    default:
      return null;
  }
}
