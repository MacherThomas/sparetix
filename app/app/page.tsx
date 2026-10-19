import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import TicketBoard from "@/components/TicketBoard";

export const metadata = { title: "Tickets — SpareTix" };

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return <TicketBoard userId={user.id} />;
}
