import { useAuth } from "@/contexts/AuthContext";

export default function Login() {
  const { signIn, loading } = useAuth();

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24 }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>NBA Betting Analytics</h1>
        <p style={{ color: "var(--muted-foreground)", fontSize: 14 }}>Sign in to track your picks and predictions</p>
      </div>
      <button
        onClick={signIn}
        disabled={loading}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 20px", borderRadius: 8, border: "1px solid #e2e8f0",
          background: "#fff", color: "#111", fontSize: 14, fontWeight: 500,
          cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
        }}
      >
        Sign in with Google
      </button>
    </div>
  );
}
