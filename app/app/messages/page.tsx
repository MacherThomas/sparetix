import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import MessagesBoard from "@/components/MessagesBoard";

export const metadata = { title: "Messages — SpareTix" };

export default async function MessagesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <Suspense fallback={<p className="status-text">Loading messages…</p>}>
      <MessagesBoard userId={user.id} />
    </Suspense>
  );
}
