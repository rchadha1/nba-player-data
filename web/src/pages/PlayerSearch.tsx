import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ArrowRight, TrendingUp } from "lucide-react";
import { api } from "../api/client";
import type { PlayerResult, TodayGame } from "../api/client";

const SUGGESTED = ["LeBron James", "Stephen Curry", "Luka Doncic", "Giannis Antetokounmpo", "Jayson Tatum"];

function GameCard({ game, onClick }: { game: TodayGame; onClick: () => void }) {
  const isLive = game.status_state === "in";
  const isFinal = game.status_state === "post";
  const isPre = game.status_state === "pre";

  return (
    <button
      onClick={onClick}
      className="bg-card border border-border rounded-2xl p-4 hover:border-primary/50 hover:shadow-md transition-all text-left w-full group"
    >
      {/* Status badge */}
      <div className="flex justify-center mb-3">
        {isLive && (
          <span className="text-[10px] font-bold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full uppercase tracking-wide flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
            Live · Q{game.status_period} {game.status_detail}
          </span>
        )}
        {isFinal && (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Final</span>
        )}
        {isPre && (
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{game.status_short}</span>
        )}
      </div>

      {/* Teams row */}
      <div className="flex items-center gap-2">
        {/* Away */}
        <div className="flex-1 flex flex-col items-center gap-1">
          {game.away_logo ? (
            <img src={game.away_logo} alt={game.away_abbr} className="h-8 w-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">{game.away_abbr.slice(0, 3)}</div>
          )}
          <span className="text-xs font-bold">{game.away_short}</span>
          {game.away_record && <span className="text-[10px] text-muted-foreground">{game.away_record}</span>}
          {!isPre && <span className="text-xl font-extrabold">{game.away_score}</span>}
        </div>

        {/* VS */}
        <div className="text-muted-foreground/40 text-sm font-light">vs</div>

        {/* Home */}
        <div className="flex-1 flex flex-col items-center gap-1">
          {game.home_logo ? (
            <img src={game.home_logo} alt={game.home_abbr} className="h-8 w-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          ) : (
            <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">{game.home_abbr.slice(0, 3)}</div>
          )}
          <span className="text-xs font-bold">{game.home_short}</span>
          {game.home_record && <span className="text-[10px] text-muted-foreground">{game.home_record}</span>}
          {!isPre && <span className="text-xl font-extrabold">{game.home_score}</span>}
        </div>
      </div>

      <div className="mt-3 text-center text-[10px] text-muted-foreground group-hover:text-primary transition-colors font-medium">
        View rosters →
      </div>
    </button>
  );
}

export default function PlayerSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [lastQuery, setLastQuery] = useState("");
  const [todayGames, setTodayGames] = useState<TodayGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    inputRef.current?.focus();
    api.getTodayGames()
      .then(setTodayGames)
      .catch(() => {})
      .finally(() => setGamesLoading(false));
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

      {/* Today's Games */}
      <div className="w-full max-w-xl mt-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Today's Games</h2>
          {gamesLoading && (
            <span className="h-3.5 w-3.5 border-2 border-primary/30 border-t-primary rounded-full animate-spin inline-block" />
          )}
        </div>

        {!gamesLoading && todayGames.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-4">No games scheduled today.</p>
        )}

        {todayGames.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {todayGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                onClick={() => navigate(`/games/${game.id}`, { state: { game } })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
