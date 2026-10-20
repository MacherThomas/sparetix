import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import LogoutButton from "./LogoutButton";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href={user ? "/app" : "/"} className="brand">
          SpareTix
        </Link>
        <nav className="header-nav">
          {user ? (
            <>
              <span className="header-email">{user.email}</span>
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
