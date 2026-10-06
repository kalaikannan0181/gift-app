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
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }
    if (data.user.app_metadata?.role !== "admin") {
      await supabase.auth.signOut();
      setError("This account does not have the required admin role.");
      setLoading(false);
      return;
    }
    navigate("/admin", { replace: true });
  };

  return (
    <main className="login-shell">
      <div className="login-atmosphere" />
      <Link to="/" className="login-logo">DJ<span>o</span>z</Link>
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
