import { redirect } from "next/navigation";

// Today lives on the office dashboard itself (docs/screens.md).
export default function TodayRedirect() {
  redirect("/office");
}
