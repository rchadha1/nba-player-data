import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { useModelChoice } from "@/lib/modelChoice";
import PlayerSearch from "./pages/PlayerSearch";
import PlayerDetail from "./pages/PlayerDetail";
import GameRosterPage from "./pages/GameRoster";
import Bets from "./pages/Bets";
import Login from "./pages/Login";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function NavBar() {
  const { user, signOut } = useAuth();
  const model = useModelChoice();
  return (
    <nav className="flex gap-4 mb-6 border-b pb-3 items-center">
      <NavLink to="/" end className={({ isActive }) => isActive ? "text-sm md:text-base font-semibold" : "text-sm md:text-base text-muted-foreground hover:text-foreground"}>
        Players
      </NavLink>
      <NavLink to="/bets" className={({ isActive }) => isActive ? "text-sm md:text-base font-semibold" : "text-sm md:text-base text-muted-foreground hover:text-foreground"}>
        Bets
      </NavLink>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <div className="flex rounded border border-border overflow-hidden text-xs" title="Blend = 90% model, 10% Kalshi's price">
          {(["original", "blend"] as const).map((c) => (
            <button key={c} onClick={() => model.set(c)}
              className={model.choice === c ? "px-2 py-1 bg-primary text-primary-foreground font-semibold" : "px-2 py-1 text-muted-foreground hover:text-foreground"}>
              {c === "original" ? "Original" : "Blend"}
            </button>
          ))}
        </div>
        <span className="text-xs md:text-sm text-muted-foreground">{user?.email}</span>
        <button onClick={signOut} className="text-xs md:text-sm text-muted-foreground hover:text-foreground underline">
          Sign out
        </button>
      </div>
    </nav>
  );
}

function AppRoutes() {
  const { session, loading } = useAuth();
  if (loading) return null;

  return (
    <div className="w-full max-w-4xl lg:max-w-5xl xl:max-w-6xl mx-auto p-4 md:p-6 lg:p-8">
      {session && <NavBar />}
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/" element={<ProtectedRoute><PlayerSearch /></ProtectedRoute>} />
        <Route path="/players/:playerId" element={<ProtectedRoute><PlayerDetail /></ProtectedRoute>} />
        <Route path="/games/:gameId" element={<ProtectedRoute><GameRosterPage /></ProtectedRoute>} />
        <Route path="/bets" element={<ProtectedRoute><Bets /></ProtectedRoute>} />
      </Routes>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
