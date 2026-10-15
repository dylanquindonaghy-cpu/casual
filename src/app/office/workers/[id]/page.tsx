import { redirect } from "next/navigation";
import { z } from "zod";

// A worker's page became a casual's (docs/office-v2.md 3.7; 12F.1): old links and bookmarks still
// work. Anything that isn't an id goes to the list (the casual's page checks access itself).
export default async function WorkerRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(z.uuid().safeParse(id).success ? `/office/casuals/${id}` : "/office/casuals");
}
