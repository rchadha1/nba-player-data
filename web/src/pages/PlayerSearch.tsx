import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { PlayerResult } from "../api/client";

export default function PlayerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSearch() {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const data = await api.searchPlayers(query);
      setResults(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Player Search</h1>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        placeholder="Search player name..."
      />
      <button onClick={handleSearch} disabled={loading}>
        {loading ? "Searching..." : "Search"}
      </button>

      <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
        {results.map((p) => (
          <li
            key={p.id}
            onClick={() => navigate(`/players/${p.id}`, { state: { name: p.full_name } })}
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #eee",
              cursor: "pointer",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{p.full_name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
