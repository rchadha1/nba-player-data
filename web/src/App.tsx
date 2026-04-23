import { BrowserRouter, Routes, Route, NavLink } from "react-router-dom";
import PlayerSearch from "./pages/PlayerSearch";
import PlayerDetail from "./pages/PlayerDetail";
import GameRosterPage from "./pages/GameRoster";
import Bets from "./pages/Bets";

function App() {
  return (
    <BrowserRouter>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
        <nav className="flex gap-4 mb-6 border-b pb-3">
          <NavLink to="/" end className={({ isActive }) => isActive ? "text-sm font-semibold" : "text-sm text-muted-foreground hover:text-foreground"}>
            Players
          </NavLink>
          <NavLink to="/bets" className={({ isActive }) => isActive ? "text-sm font-semibold" : "text-sm text-muted-foreground hover:text-foreground"}>
            Bets
          </NavLink>
        </nav>
        <Routes>
          <Route path="/" element={<PlayerSearch />} />
          <Route path="/players/:playerId" element={<PlayerDetail />} />
          <Route path="/games/:gameId" element={<GameRosterPage />} />
          <Route path="/bets" element={<Bets />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
