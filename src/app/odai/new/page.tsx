import { requireMember } from "@/lib/session";
import { NewOdaiForm } from "./NewOdaiForm";

export default async function NewOdaiPage() {
  await requireMember();
  return <NewOdaiForm />;
}
