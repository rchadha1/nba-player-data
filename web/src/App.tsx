import { BrowserRouter, Routes, Route } from "react-router-dom";
import PlayerSearch from "./pages/PlayerSearch";
import PlayerDetail from "./pages/PlayerDetail";

function App() {
  return (
    <BrowserRouter>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: 24 }}>
        <Routes>
          <Route path="/" element={<PlayerSearch />} />
          <Route path="/players/:playerId" element={<PlayerDetail />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App
