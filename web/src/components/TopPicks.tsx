import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { TonightEdges } from "@/api/client";
import {
  evaluateBets, kalshiOrderUrl, kalshiPayout, maxWorthItPrice, seasonRecord, topPickGap, TOP_PICK_GAP,
} from "@/lib/betEvaluator";
import type { BetEvaluation } from "@/lib/betEvaluator";
import { AddToSlipModal } from "@/components/AddToSlipModal";
import { betKey, useSavedBets } from "@/lib/savedBets";

const gradeStyle: Record<string, string> = {
  STRONG: "bg-emerald-500 text-white",
  SOLID:  "bg-blue-500 text-white",
};

const STAT_NAME: Record<string, string> = {
  PTS: "Points", REB: "Rebounds", AST: "Assists", "3PT": "Threes", STL: "Steals", BLK: "Blocks",
  FTM: "Free Throws", "PTS+REB+AST": "Pts+Reb+Ast", "PTS+REB": "Pts+Reb", "PTS+AST": "Pts+Ast", "AST+REB": "Reb+Ast",
};

const STAKE = 10;   // payouts are shown for a $10 bet

type Pick = BetEvaluation & {
  gameId: string; gameLabel: string; playerId: string; playerName: string; opponentName: string; isHome: boolean;
  kalshiUrl?: string; record: { hits: number; n: number }; gap: number;
};

/** "about 7 in 10" — out of 20 near the ends, where tenths would read "10 in 10" or "0 in 10". */
function howOften(prob: number): string {
  const out = prob >= 0.9 || prob <= 0.1 ? 20 : 10;
  return `about ${Math.round(prob * out)} in ${out}`;
}

function Bar({ label, pct, note }: { label: string; pct: number; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
        <div className="h-full bg-primary/70" style={{ width: `${Math.round(pct * 100)}%` }} />
      </div>
      <span className="w-24 shrink-0 font-mono">{Math.round(pct * 100)}%{note ? ` ${note}` : ""}</span>
    </div>
  );
}

/** Solids across tonight's pregame games that the player's season record also backs. */
export function TopPicks() {
  const navigate = useNavigate();
  const [data, setData] = useState<TonightEdges | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [slipBet, setSlipBet] = useState<Pick | null>(null);
  const [added, markAdded] = useSavedBets();
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  function toggle(key: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const picks: Pick[] = (data?.games ?? []).flatMap((g) => g.players.flatMap((p) => {
    const isHome = p.team_abbr === g.home_abbr;
    return evaluateBets(p.quotes, p.prediction).flatMap((b) => {
      const gap = topPickGap(p.season_games ?? [], b);
      if (gap == null) return [];
      return [{
        ...b, gap, gameId: g.id, gameLabel: `${g.away_short} at ${g.home_short}`, playerId: p.id, playerName: p.name,
        opponentName: isHome ? g.away_name : g.home_name, isHome,
        kalshiUrl: p.urls?.[b.prop] && kalshiOrderUrl(p.urls[b.prop], b), record: seasonRecord(p.season_games, b),
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
            {picks.map((b) => {
              const key = `${b.playerId}-${b.prop}`;
              const isAdded = added.has(betKey(b.playerName, b.prop));
              const strike = b.line + 0.5;
              const stat = STAT_NAME[b.prop] ?? b.prop;
              const worthIt = maxWorthItPrice(b.prob);
              const expanded = open.has(key);
              return (
                <div key={key} className="px-4 py-3 flex flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeStyle[b.grade]}`}>{b.grade}</span>
                        <button
                          onClick={() => navigate(`/players/${b.playerId}`, {
                            state: { name: b.playerName, opponentName: b.opponentName, isHome: b.isHome, goToPredict: true },
                          })}
                          className="font-semibold text-sm hover:underline underline-offset-2"
                        >
                          {b.playerName}
                        </button>
                        <span className="text-xs text-muted-foreground">· {b.gameLabel}</span>
                      </div>
                      <span className="font-semibold text-sm">
                        {b.side === "YES" ? `${strike}+ ${stat}` : `Under ${strike} ${stat}`}
                      </span>
                      <span className="text-xs">
                        ${STAKE} pays <span className="font-semibold">${kalshiPayout(STAKE, b.price).toFixed(2)}</span> now
                        {worthIt != null && (
                          <span className="text-muted-foreground"> · still worth it down to ${kalshiPayout(STAKE, worthIt).toFixed(2)}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Our model: {howOften(b.prob)} · This season: {b.record.hits} of {b.record.n} games
                      </span>
                      {b.side === "NO" && (
                        <span className="text-[11px] text-muted-foreground/80">
                          On Kalshi this shows as "No" on "{b.playerName}: {strike}+"
                        </span>
                      )}
                    </div>
                    <div className="shrink-0 flex items-center gap-1.5">
                      {b.kalshiUrl && (
                        <a
                          href={b.kalshiUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-semibold px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          Bet on Kalshi ↗
                        </a>
                      )}
                      <button
                        onClick={() => setSlipBet(b)}
                        disabled={isAdded}
                        className={`text-xs font-semibold px-2.5 py-1 rounded border transition-colors ${
                          isAdded
                            ? "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 cursor-default"
                            : "border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
                        }`}
                      >
                        {isAdded ? "Added ✓" : "+ Add to Slip"}
                      </button>
                      <button
                        onClick={() => toggle(key)}
                        aria-label={expanded ? "Hide details" : "Why it's a pick"}
                        className="text-xs px-1.5 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      >
                        {expanded ? "▴" : "▾"}
                      </button>
                    </div>
                  </div>
                  {expanded && (
                    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex flex-col gap-1.5">
                      <Bar label="Kalshi thinks" pct={b.price} />
                      <Bar label="Our model" pct={b.prob} />
                      <Bar label="This season" pct={b.record.hits / b.record.n} note={`(${b.record.hits}/${b.record.n})`} />
                      <p className="text-xs text-muted-foreground mt-1">
                        Why it's a pick: our model and the player's games this season both say this hits more often than
                        Kalshi's price suggests. Expected profit: about +{Math.round((b.prob * kalshiPayout(1, b.price) - 1) * 100)}¢ per $1 bet.
                        Prices move — if Kalshi's order panel shows ${STAKE} paying less than the "still worth it" amount, skip it.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
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
