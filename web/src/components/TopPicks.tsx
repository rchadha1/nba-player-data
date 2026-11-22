import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { SeasonGame, TonightEdges } from "@/api/client";
import { evaluateBets, kalshiOrderUrl, topPickGap, TOP_PICK_GAP } from "@/lib/betEvaluator";
import type { BetEvaluation } from "@/lib/betEvaluator";
import { AddToSlipModal } from "@/components/AddToSlipModal";
import { BetRow } from "@/components/BetRow";
import { betKey, useSavedBets } from "@/lib/savedBets";

type Pick = BetEvaluation & {
  gameId: string; gameLabel: string; playerId: string; playerName: string; opponentName: string; isHome: boolean;
  kalshiUrl?: string; seasonGames: SeasonGame[]; gap: number;
};

/** Solids across tonight's pregame games that the player's season record also backs. */
export function TopPicks() {
  const navigate = useNavigate();
  const [data, setData] = useState<TonightEdges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slipBet, setSlipBet] = useState<Pick | null>(null);
  const [added, markAdded] = useSavedBets();
  const [now, setNow] = useState(() => Date.now());

  // Keep "prices from N min ago" current
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  function load() {
    setLoading(true);
    setError("");
    api.getTonightEdges()
      .then((d) => { setData(d); setNow(Date.now()); })
      .catch(() => setError("Failed to load top picks."))
      .finally(() => setLoading(false));
  }

  const picks: Pick[] = (data?.games ?? []).flatMap((g) => g.players.flatMap((p) => {
    const isHome = p.team_abbr === g.home_abbr;
    return evaluateBets(p.quotes, p.prediction).flatMap((b) => {
      const gap = topPickGap(p.season_games ?? [], b);
      if (gap == null) return [];
      return [{
        ...b, gap, gameId: g.id, gameLabel: `${g.away_short} at ${g.home_short}`, playerId: p.id, playerName: p.name,
        opponentName: isHome ? g.away_name : g.home_name, isHome,
        kalshiUrl: p.urls?.[b.prop] && kalshiOrderUrl(p.urls[b.prop], b), seasonGames: p.season_games ?? [],
      }];
    });
  })).sort((a, b) => (a.grade === b.grade ? 0 : a.grade === "STRONG" ? -1 : 1) || b.gap - a.gap);

  const pricesAge = data?.prices_as_of ? Math.max(0, Math.round((now / 1000 - data.prices_as_of) / 60)) : null;

  return (
    <div className="w-full max-w-xl mt-12 rounded-xl border border-border overflow-hidden bg-card">
      <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Top Picks tonight</span>
          <span className="text-xs text-muted-foreground">
            Bets our model likes that the player's season also backs
            {pricesAge != null && ` · prices from ${pricesAge < 1 ? "just now" : `${pricesAge} min ago`}`}
          </span>
        </div>
        {!loading && (
          <button
            onClick={load}
            className="shrink-0 text-xs font-semibold px-2.5 py-1 rounded border border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            {data ? "Refresh" : "Find top picks"}
          </button>
        )}
      </div>
      {loading && (
        <div className="px-4 py-6 flex items-center gap-3 text-sm text-muted-foreground">
          <span className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          Checking every game tonight — usually a few seconds, longer right after a server restart…
        </div>
      )}
      {!loading && error && <p className="px-4 py-3 text-sm text-muted-foreground">{error}</p>}
      {!loading && data?.status === "unavailable" && (
        <p className="px-4 py-3 text-sm text-yellow-700 dark:text-yellow-300">Kalshi lines unavailable — couldn't reach Kalshi. Try again in a few minutes.</p>
      )}
      {!loading && data?.status === "ok" && (
        picks.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No top picks across {data.games.length} upcoming {data.games.length === 1 ? "game" : "games"}.
          </p>
        ) : (
          <div className="divide-y">
            {picks.map((b) => (
              <BetRow
                key={`${b.playerId}-${b.prop}`}
                bet={b}
                playerName={b.playerName}
                subtitle={b.gameLabel}
                onPlayerClick={() => navigate(`/players/${b.playerId}`, {
                  state: { name: b.playerName, opponentName: b.opponentName, isHome: b.isHome, goToPredict: true },
                })}
                seasonGames={b.seasonGames}
                kalshiUrl={b.kalshiUrl}
                added={added.has(betKey(b.playerName, b.prop))}
                onAdd={() => setSlipBet(b)}
              />
            ))}
          </div>
        )
      )}
      {!loading && data?.status === "ok" && picks.length > 0 && (
        <p className="px-4 py-2 text-[11px] text-muted-foreground border-t">
          Shown: Solid and Strong bets where the player's season record beats Kalshi's price by {Math.round(TOP_PICK_GAP * 100)}+ points.
          Experimental — not yet proven against real results.
        </p>
      )}
      {slipBet && (
        <AddToSlipModal
          bet={slipBet}
          playerId={slipBet.playerId}
          playerName={slipBet.playerName}
          kalshiUrl={slipBet.kalshiUrl}
          gameId={slipBet.gameId}
          onClose={() => setSlipBet(null)}
          onAdded={() => markAdded(slipBet.playerName, slipBet.prop)}
        />
      )}
    </div>
  );
}
