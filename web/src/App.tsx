import { BrowserRouter, Routes, Route, NavLink, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
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
  return (
    <nav className="flex gap-4 mb-6 border-b pb-3 items-center">
      <NavLink to="/" end className={({ isActive }) => isActive ? "text-sm font-semibold" : "text-sm text-muted-foreground hover:text-foreground"}>
        Players
      </NavLink>
      <NavLink to="/bets" className={({ isActive }) => isActive ? "text-sm font-semibold" : "text-sm text-muted-foreground hover:text-foreground"}>
        Bets
      </NavLink>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <span className="text-xs text-muted-foreground">{user?.email}</span>
        <button onClick={signOut} className="text-xs text-muted-foreground hover:text-foreground underline">
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
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
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
