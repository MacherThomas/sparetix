import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./LogoutButton";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unread messages sent to this user (RLS limits the count to their own conversations).
  let unread = 0;
  if (user) {
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .is("read_at", null)
      .neq("sender_id", user.id);
    unread = count ?? 0;
  }

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href={user ? "/app" : "/"} className="brand">
          SpareTix
        </Link>
        <nav className="header-nav" aria-label="Main">
          {user ? (
            <>
              <Link href="/app/messages" className="header-link">
                Messages
                {unread > 0 && (
                  <span className="unread-badge">
                    {unread}
                    <span className="visually-hidden"> unread</span>
                  </span>
                )}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <Link href="/login" className="btn btn-secondary">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
