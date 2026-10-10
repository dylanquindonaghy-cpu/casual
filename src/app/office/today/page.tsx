import { redirect } from "next/navigation";

// Today's page became the office dashboard (docs/office-v2.md 3.11; docs/screens.md).
export default function TodayRedirect() {
  redirect("/office");
}
