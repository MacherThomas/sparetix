"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await createClient().auth.signOut();
    router.replace("/");
    router.refresh();
  }

  return (
    <button type="button" className="btn btn-ghost" data-testid="logout" onClick={handleLogout}>
      Log out
    </button>
  );
}
