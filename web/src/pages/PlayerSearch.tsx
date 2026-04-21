import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight, TrendingUp } from "lucide-react";
import { api } from "../api/client";
import type { PlayerResult } from "../api/client";

const SUGGESTED = ["LeBron James", "Stephen Curry", "Luka Doncic", "Giannis Antetokounmpo", "Jayson Tatum"];

export default function PlayerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSearch(q = query) {
    if (!q.trim()) return;
    setLoading(true);
    setLastQuery(q);
    try {
      const data = await api.searchPlayers(q);
      setResults(data);
    } finally {
      setLoading(false);
    }
  }

  function handleSuggestion(name: string) {
    setQuery(name);
    handleSearch(name);
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-[15vh] px-4">
      {/* Hero */}
      <div className="mb-10 text-center space-y-3">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold px-3 py-1.5 rounded-full mb-2 tracking-wide uppercase">
          <TrendingUp className="h-3.5 w-3.5" />
          NBA Betting Analytics
        </div>
        <h1 className="text-5xl font-extrabold tracking-tight leading-none">
          Find a Player
        </h1>
        <p className="text-muted-foreground text-lg max-w-sm mx-auto">
          Projected stats, prop breakdowns, and series analysis for every player.
        </p>
      </div>

      {/* Search bar */}
      <div className="w-full max-w-xl">
        <div
          className={`flex items-center gap-3 bg-card border-2 rounded-2xl px-5 py-3.5 shadow-sm transition-all duration-200 ${
            focused ? "border-primary shadow-primary/20 shadow-md" : "border-border"
          }`}
        >
          <Search className={`h-5 w-5 shrink-0 transition-colors ${focused ? "text-primary" : "text-muted-foreground"}`} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="Search by player name…"
            className="flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground/60"
          />
          <button
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
            className="shrink-0 bg-primary text-primary-foreground rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40 hover:bg-primary/90 transition-colors flex items-center gap-1.5"
          >
            {loading ? (
              <span className="h-4 w-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin inline-block" />
            ) : (
              <>Search <ArrowRight className="h-3.5 w-3.5" /></>
            )}
          </button>
        </div>

        {/* Suggestions */}
        {results.length === 0 && !loading && (
          <div className="mt-4 flex flex-wrap gap-2 justify-center">
            {SUGGESTED.map((name) => (
              <button
                key={name}
                onClick={() => handleSuggestion(name)}
                className="text-xs text-muted-foreground bg-muted hover:bg-muted/70 hover:text-foreground border border-border rounded-full px-3 py-1.5 transition-colors"
              >
                {name}
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="mt-4 bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                {results.length} result{results.length !== 1 ? "s" : ""}
              </span>
              <button
                onClick={() => { setResults([]); setQuery(""); setLastQuery(""); inputRef.current?.focus(); }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear
              </button>
            </div>
            <ul>
              {results.map((p, i) => (
                <li key={p.id}>
                  <button
                    onClick={() => navigate(`/players/${p.id}`, { state: { name: p.full_name } })}
                    className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-muted/60 transition-colors group text-left"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                        {p.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                      </div>
                      <span className="font-medium">{p.full_name}</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
                  </button>
                  {i < results.length - 1 && <div className="mx-5 border-b border-border/60" />}
                </li>
              ))}
            </ul>
          </div>
        )}

        {lastQuery && results.length === 0 && !loading && (
          <div className="mt-10 text-center space-y-2">
            <p className="text-2xl font-bold">No players found</p>
            <p className="text-muted-foreground">No results for &ldquo;{lastQuery}&rdquo; — try a different spelling.</p>
          </div>
        )}
      </div>
    </div>
  );
}
