import { useState, useEffect } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { api } from "../api/client";
import type { GameRoster, GameRosterTeam, GameRosterPlayer, GameEdges, TodayGame } from "../api/client";
import { evaluateBets } from "../lib/betEvaluator";
import type { BetEvaluation } from "../lib/betEvaluator";

const gradeStyle: Record<string, string> = {
  STRONG: "bg-emerald-500 text-white",
  SOLID:  "bg-blue-500 text-white",
  LEAN:   "bg-amber-400 text-black",
};

function BestBets({ gameId, onOpenPlayer }: { gameId: string; onOpenPlayer: (id: string, name: string) => void }) {
  const [edges, setEdges] = useState<GameEdges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    setError("");
    api.getGameEdges(gameId)
      .then(setEdges)
      .catch(() => setError("Failed to load best bets."))
      .finally(() => setLoading(false));
  }

  // After tip-off Kalshi prices react to the game and the pregame projection can't, so
  // grades would be meaningless: list every prop ungraded, biggest gap first.
  const live = !!edges && edges.game_state !== "pre";
  const bets: (BetEvaluation & { playerId: string; playerName: string; teamAbbr: string })[] = (edges?.players ?? [])
    .flatMap((p) => evaluateBets(p.quotes, p.prediction)
      .filter((b) => live || b.grade !== "SKIP")
      .map((b) => ({ ...b, playerId: p.id, playerName: p.name, teamAbbr: p.team_abbr })))
    .sort((a, b) => (live ? 0 : ["STRONG", "SOLID", "LEAN"].indexOf(a.grade) - ["STRONG", "SOLID", "LEAN"].indexOf(b.grade)) || b.edge - a.edge);

  return (
    <div className="mb-6 rounded-xl border border-border overflow-hidden bg-card">
      <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Best Bets</span>
        {!loading && (
          <button
            onClick={load}
            className="text-xs font-semibold px-2.5 py-1 rounded border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            {edges ? "Refresh" : "Find best bets"}
          </button>
        )}
      </div>
      {loading && (
        <div className="px-4 py-6 flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Running predictions for every player with Kalshi lines — about 15–30 seconds the first time…
        </div>
      )}
      {!loading && error && <p className="px-4 py-3 text-sm text-muted-foreground">{error}</p>}
      {!loading && edges?.status === "unavailable" && (
        <p className="px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">Kalshi lines unavailable — couldn't reach Kalshi. Try again in a few minutes.</p>
      )}
      {!loading && edges?.status === "ok" && live && (
        <p className="px-4 py-2.5 text-xs text-yellow-800 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 border-b">
          {edges.game_state === "in" ? "Game in progress" : "Game finished"} — Kalshi prices are live and react to the game, but these
          projections are pregame and don't know the game state. Bets are not graded; compare at your own judgment.
        </p>
      )}
      {!loading && edges?.status === "ok" && (
        bets.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No graded edges found across {edges.players.length} players with Kalshi lines.
          </p>
        ) : (
          <div className="divide-y">
            {bets.map((b) => (
              <button
                key={`${b.playerId}-${b.prop}`}
                onClick={() => onOpenPlayer(b.playerId, b.playerName)}
                className="w-full text-left px-4 py-2.5 flex flex-col gap-0.5 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-2 flex-wrap">
                  {live ? (
                    <span className="text-xs font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">LIVE</span>
                  ) : (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeStyle[b.grade]}`}>{b.grade}</span>
                  )}
                  <span className="font-semibold text-sm">{b.playerName}</span>
                  <span className="text-xs text-muted-foreground">{b.teamAbbr}</span>
                  <span className="font-semibold text-sm">
                    {b.side} {b.prop} {b.side === "YES" ? `${b.line + 0.5}+` : `under ${b.line + 0.5}`} @ {Math.round(b.price * 100)}¢
                  </span>
                  <span className="text-xs text-muted-foreground font-mono">
                    model {Math.round(b.prob * 100)}% · {b.edge >= 0 ? "+" : ""}{Math.round(b.edge * 100)}¢ per contract · predicted {b.expected}
                  </span>
                </div>
                {!live && b.warnings.map((w, i) => (
                  <p key={i} className="text-xs text-amber-600 dark:text-amber-400 pl-1">⚠ {w}</p>
                ))}
              </button>
            ))}
          </div>
        )
      )}
      {!loading && edges && edges.failed.length > 0 && (
        <p className="px-4 py-2 text-xs text-muted-foreground border-t">Couldn't predict: {edges.failed.join(", ")}</p>
      )}
    </div>
  );
}

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

function PlayerRow({
  player,
  onNavigate,
  onPredict,
}: {
  player: GameRosterPlayer;
  onNavigate: () => void;
  onPredict: (e: React.MouseEvent) => void;
}) {
  const isOut = player.status.toLowerCase() === "out";
  return (
    <div className="px-4 py-2.5 flex items-center justify-between gap-2">
      <button
        onClick={onNavigate}
        className="flex items-center gap-2.5 min-w-0 text-left group flex-1"
      >
        <div className="h-7 w-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
          {player.name.split(" ").map((n) => n[0]).slice(0, 2).join("")}
        </div>
        <div className="min-w-0">
          <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">{player.name}</div>
          {player.comment && (
            <span className="text-[10px] text-muted-foreground truncate">{player.comment}</span>
          )}
        </div>
      </button>

      <div className="flex items-center gap-2 shrink-0">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusBadge(player.status)}`}>
          {statusLabel(player.status)}
        </span>
        {!isOut && (
          <button
            onClick={onPredict}
            className="text-[10px] font-semibold px-2 py-1 rounded border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            Predict
          </button>
        )}
      </div>
    </div>
  );
}

function TeamColumn({
  team,
  opponentName,
  isHomeTeam,
  onNavigate,
  onPredict,
}: {
  team: GameRosterTeam;
  opponentName: string;
  isHomeTeam: boolean;
  onNavigate: (id: string, name: string) => void;
  onPredict: (id: string, name: string, opponentName: string, isHome: boolean) => void;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-4 px-1">
        {team.logo && (
          <img src={team.logo} alt={team.abbr} className="h-8 w-8 object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        <div>
          <div className="font-bold text-base leading-tight">{team.short_name}</div>
          <div className="text-xs text-muted-foreground">{isHomeTeam ? "Home" : "Away"}</div>
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden">
        {team.players.map((player, i) => (
          <div key={player.id}>
            <PlayerRow
              player={player}
              onNavigate={() => onNavigate(player.id, player.name)}
              onPredict={(e) => {
                e.stopPropagation();
                onPredict(player.id, player.name, opponentName, isHomeTeam);
              }}
            />
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

  function handleNavigate(id: string, name: string) {
    navigate(`/players/${id}`, { state: { name } });
  }

  function handlePredict(id: string, name: string, opponentName: string, isHome: boolean) {
    navigate(`/players/${id}`, {
      state: { name, opponentName, isHome, goToPredict: true },
    });
  }

  const teams = roster ? Object.values(roster) : [];

  function isHomeTeam(team: GameRosterTeam): boolean {
    if (!game) return false;
    return team.team_id === game.home_team_id;
  }

  function opponentNameFor(team: GameRosterTeam): string {
    if (!game) return "";
    return isHomeTeam(team) ? game.away_name : game.home_name;
  }

  return (
    <div className="min-h-screen px-4 py-6 max-w-2xl mx-auto">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Search
      </button>

      {game && (
        <div className="mb-6 bg-card border border-border rounded-2xl p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col items-center gap-1 flex-1">
              {game.away_logo && (
                <img src={game.away_logo} alt={game.away_abbr} className="h-10 w-10 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="font-bold text-sm">{game.away_short}</div>
              {game.away_record && <div className="text-xs text-muted-foreground">{game.away_record}</div>}
              {game.status_state !== "pre" && <div className="text-2xl font-extrabold">{game.away_score}</div>}
            </div>

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

            <div className="flex flex-col items-center gap-1 flex-1">
              {game.home_logo && (
                <img src={game.home_logo} alt={game.home_abbr} className="h-10 w-10 object-contain"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="font-bold text-sm">{game.home_short}</div>
              {game.home_record && <div className="text-xs text-muted-foreground">{game.home_record}</div>}
              {game.status_state !== "pre" && <div className="text-2xl font-extrabold">{game.home_score}</div>}
            </div>
          </div>
        </div>
      )}

      {gameId && <BestBets gameId={gameId} onOpenPlayer={(id, name) => {
        const team = teams.find((t) => t.players.some((p) => p.id === id));
        if (team) handlePredict(id, name, opponentNameFor(team), isHomeTeam(team));
        else handleNavigate(id, name);
      }} />}

      <h2 className="text-lg font-bold mb-4">Rosters</h2>

      {loading && (
        <div className="flex justify-center py-16">
          <span className="h-8 w-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}
      {error && <div className="text-center py-10 text-muted-foreground">{error}</div>}
      {!loading && !error && teams.length === 0 && (
        <div className="text-center py-10 text-muted-foreground">No roster data available.</div>
      )}

      {!loading && !error && teams.length > 0 && (
        <div className="flex gap-4">
          {teams.map((team) => (
            <TeamColumn
              key={team.abbr}
              team={team}
              opponentName={opponentNameFor(team)}
              isHomeTeam={isHomeTeam(team)}
              onNavigate={handleNavigate}
              onPredict={handlePredict}
            />
          ))}
        </div>
      )}
    </div>
  );
}
