import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HandleForm } from "./HandleForm";

export default async function OnboardingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) redirect("/");

  return <HandleForm />;
}
