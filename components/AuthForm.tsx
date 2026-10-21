"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function AuthForm({ mode }: { mode: "signup" | "login" }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignup = mode === "signup";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setLoading(true);
    const supabase = createClient();

    if (isSignup) {
      // The first name is saved to the user's profile by a database trigger.
      const name = firstName.trim().slice(0, 40);
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: name ? { data: { first_name: name } } : undefined,
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (!data.session) {
        // Happens only if "Confirm email" is still enabled in Supabase.
        setNotice("Account created. Please check your email to confirm it, then log in.");
        setLoading(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
    }

    router.replace("/app");
    router.refresh();
  }

  return (
    <div className="auth-card">
      <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
      <p className="lead">
        {isSignup ? "Start buying and selling spare tickets." : "Log in to see the latest tickets."}
      </p>
      <form onSubmit={handleSubmit} className="stack">
        {/* Optional on purpose: sign-up must work with only email and password (see CLAUDE.md). */}
        {isSignup && (
          <div className="field">
            <label htmlFor="signup-first-name" className="label">
              First name
            </label>
            <input
              id="signup-first-name"
              type="text"
              maxLength={40}
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              aria-describedby="first-name-hint"
            />
            <span className="hint" id="first-name-hint">
              Optional. Shown to everyone logged in to SpareTix, next to your tickets, requests and messages.
            </span>
          </div>
        )}
        <label className="field">
          <span className="label">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid={isSignup ? "signup-email" : "login-email"}
          />
        </label>
        <label className="field">
          <span className="label">Password</span>
          <input
            type="password"
            required
            minLength={6}
            autoComplete={isSignup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid={isSignup ? "signup-password" : "login-password"}
          />
          {isSignup && <span className="hint">At least 6 characters.</span>}
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert" role="status">
            {notice}
          </p>
        )}
        <button
          type="submit"
          className="btn btn-primary btn-block"
          disabled={loading}
          data-testid={isSignup ? "signup-submit" : "login-submit"}
        >
          {loading ? "Please wait…" : isSignup ? "Sign up" : "Log in"}
        </button>
      </form>
      <p className="auth-switch">
        {isSignup ? (
          <>
            Already have an account? <Link href="/login">Log in</Link>
          </>
        ) : (
          <>
            New here? <Link href="/signup">Sign up</Link>
          </>
        )}
      </p>
    </div>
  );
}
