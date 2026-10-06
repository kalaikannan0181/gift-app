import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { supabase } from "../lib/supabase";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (searchParams.get("error") === "unauthorized") {
      setError("This account does not have the required admin role.");
    }
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user.app_metadata?.role === "admin") {
        navigate("/admin", { replace: true });
      } else {
        setLoading(false);
      }
    });
  }, [navigate, searchParams]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "Invalid login credentials. Confirm this admin user exists in the configured Supabase project and that its password is correct."
            : signInError.message,
        );
        return;
      }
      if (data.user.app_metadata?.role !== "admin") {
        await supabase.auth.signOut();
        setError("This account does not have the required admin role.");
        return;
      }
      navigate("/admin", { replace: true });
    } catch {
      setError("Unable to reach Supabase Auth. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <div className="login-atmosphere" />
      <Link to="/" className="login-logo">DJ<span>o</span>z</Link>
      <Link to="/" className="login-back-button" aria-label="Back to the landing page">
        <span aria-hidden="true">←</span>
        Back to experience
      </Link>
      <section className="login-card">
        <div className="login-lock"><span /></div>
        <p>Secure control room</p>
        <h1>Welcome back</h1>
        <span className="login-subtitle">Sign in with your Supabase admin account.</span>
        <form onSubmit={handleSubmit}>
          <label className="admin-field">
            <span>Email address</span>
            <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="admin@example.com" />
          </label>
          <label className="admin-field">
            <span>Password</span>
            <input type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" />
          </label>
          {error && <div className="login-error">{error}</div>}
          <button className="admin-primary-button" type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in to dashboard"}
          </button>
        </form>
        <small>Create the admin user in Supabase Authentication before signing in.</small>
      </section>
    </main>
  );
}
