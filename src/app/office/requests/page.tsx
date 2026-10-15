import { redirect } from "next/navigation";

// The old Requests page (until 12D.1): requests made in the app are Enquiries' "Requests from the
// app" view now (docs/screens.md `/office/enquiries`). Old links and bookmarks land there; the page
// checks who may see it.
export default function OfficeRequestsPage(): never {
  redirect("/office/enquiries?view=app");
}
