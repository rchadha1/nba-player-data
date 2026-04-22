import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { api } from "../api/client";
import type { GameRoster, GameRosterTeam, TodayGame } from "../api/client";

function statusBadge(status: string) {
  const s = status.toLowerCase();
  if (s === "out") return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
  if (s === "day-to-day" || s === "dtd" || s === "questionable") return "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400";
  if (s === "probable") return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
  return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400";
}

function statusLabel(status: string) {
  const s = status.toLowerCase();
  if (!s || s === "active") return "Active";
  return status;
}

function TeamColumn({ team, onPlayerClick }: { team: GameRosterTeam; onPlayerClick: (id: string, name: string) => void }) {
  return (
    <div className="flex-1 min-w-0">
      {/* Team header */}
      <div className="flex items-center gap-2 mb-4 px-1">
        {team.logo && (
          <img src={team.logo} alt={team.abbr} className="h-8 w-8 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div>
          <div className="font-bold text-base leading-tight">{team.short_name}</div>
          <div className="text-xs text-muted-foreground">{team.name}</div>
        </div>
      </div>

      {/* Players list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {team.players.map((player, i) => (
          <div key={player.id}>
            <button
              onClick={() => onPlayerClick(player.id, player.name)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/60 transition-colors group text-left"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                  {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{player.name}</div>
                  {player.comment && (
                    <div className="text-[10px] text-muted-foreground truncate">{player.comment}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusBadge(player.status)}`}>
                  {statusLabel(player.status)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
            </button>
            {i < team.players.length - 1 && <div className="mx-4 border-b border-border/60" />}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GameRosterPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const game = location.state?.game as TodayGame | undefined;

  const [roster, setRoster] = useState<GameRoster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    api.getGameRoster(gameId)
      .then(setRoster)
      .catch(() => setError("Failed to load roster."))
      .finally(() => setLoading(false));
  }, [gameId]);

  function handlePlayerClick(id: string, name: string) {
    navigate(`/players/${id}`, { state: { name } });
  }

  const teams = roster ? Object.values(roster) : [];

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Search
      </button>

      {/* Game header */}
      {game && (
        <div className="mb-6 bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between gap-4">
            {/* Away */}
            <div className="flex flex-col items-center gap-1 flex-1">
              {game.away_logo && (
                <img src={game.away_logo} alt={game.away_abbr} className="h-10 w-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="font-bold text-sm">{game.away_short}</div>
              {game.away_record && <div className="text-xs text-muted-foreground">{game.away_record}</div>}
              {game.status_state !== "pre" && (
                <div className="text-2xl font-extrabold">{game.away_score}</div>
              )}
            </div>

            {/* Status */}
            <div className="flex flex-col items-center gap-1">
              {game.status_state === "pre" ? (
                <div className="text-sm font-medium text-muted-foreground">{game.status_short}</div>
              ) : game.status_state === "in" ? (
                <>
                  <div className="text-[10px] font-semibold bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Live</div>
                  <div className="text-xs text-muted-foreground">{`Q${game.status_period} ${game.status_detail}`}</div>
                </>
              ) : (
                <div className="text-xs text-muted-foreground font-medium">Final</div>
              )}
              <div className="text-muted-foreground/40 text-lg font-light">vs</div>
            </div>

            {/* Home */}
            <div className="flex flex-col items-center gap-1 flex-1">
              {game.home_logo && (
                <img src={game.home_logo} alt={game.home_abbr} className="h-10 w-10 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="font-bold text-sm">{game.home_short}</div>
              {game.home_record && <div className="text-xs text-muted-foreground">{game.home_record}</div>}
              {game.status_state !== "pre" && (
                <div className="text-2xl font-extrabold">{game.home_score}</div>
              )}
            </div>
          </div>
        </div>
      )}

      <h2 className="text-lg font-bold mb-4">Rosters</h2>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="h-8 w-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {error && (
        <div className="text-center py-10 text-muted-foreground">{error}</div>
      )}

      {!loading && !error && teams.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">No roster data available.</div>
      )}

      {!loading && !error && teams.length > 0 && (
        <div className="flex gap-4">
          {teams.map((team) => (
            <TeamColumn key={team.abbr} team={team} onPlayerClick={handlePlayerClick} />
          ))}
        </div>
      )}
    </div>
  );
}
