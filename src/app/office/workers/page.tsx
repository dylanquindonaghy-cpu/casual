import { redirect } from "next/navigation";

// Workers became Casuals (docs/office-v2.md 3.7; 12F.1): old links and bookmarks still work.
export default function WorkersRedirect() {
  redirect("/office/casuals");
}
