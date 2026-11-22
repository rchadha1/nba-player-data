import { useState } from "react";
import type { SeasonGame } from "@/api/client";
import { kalshiPayout, maxWorthItPrice, seasonRecord, TOP_PICK_GAP } from "@/lib/betEvaluator";
import type { BetEvaluation } from "@/lib/betEvaluator";

const gradeStyle: Record<string, string> = {
  STRONG: "bg-emerald-500 text-white",
  SOLID:  "bg-blue-500 text-white",
  LEAN:   "bg-amber-400 text-black",
};

const STAT_NAME: Record<string, string> = {
  PTS: "Points", REB: "Rebounds", AST: "Assists", "3PT": "Threes", STL: "Steals", BLK: "Blocks",
  FTM: "Free Throws", "PTS+REB+AST": "Pts+Reb+Ast", "PTS+REB": "Pts+Reb", "PTS+AST": "Pts+Ast", "AST+REB": "Reb+Ast",
};

const STAKE = 10;   // payouts are shown for a $10 bet

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

interface Props {
  bet: BetEvaluation;
  playerName: string;
  showName?: boolean;          // false on the player's own page
  subtitle?: string;           // e.g. "Clippers at Mavericks" or a team abbreviation
  onPlayerClick?: () => void;
  seasonGames: SeasonGame[];
  kalshiUrl?: string;
  added: boolean;
  onAdd: () => void;
  live?: boolean;              // game started: prices react to it, the pregame model can't, so no grade
}

/** One bet in plain language (Top Picks, Best Bets, the player page). */
export function BetRow({ bet: b, playerName, showName = true, subtitle, onPlayerClick, seasonGames, kalshiUrl, added, onAdd, live }: Props) {
  const [expanded, setExpanded] = useState(false);
  const strike = b.line + 0.5;
  const stat = STAT_NAME[b.prop] ?? b.prop;
  const worthIt = maxWorthItPrice(b.prob);
  const r = seasonRecord(seasonGames, b);
  const solidUp = !live && (b.grade === "SOLID" || b.grade === "STRONG");
  const backed = r.n > 0 && r.hits / r.n - b.price >= TOP_PICK_GAP;

  return (
    <div className="px-4 py-3 flex flex-col gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            {live ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded bg-muted text-muted-foreground">LIVE</span>
            ) : (
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeStyle[b.grade] ?? "bg-muted text-muted-foreground"}`}>{b.grade}</span>
            )}
            {showName && (onPlayerClick ? (
              <button onClick={onPlayerClick} className="font-semibold text-sm hover:underline underline-offset-2">
                {playerName}
              </button>
            ) : (
              <span className="font-semibold text-sm">{playerName}</span>
            ))}
            {subtitle && <span className="text-xs text-muted-foreground">· {subtitle}</span>}
          </div>
          <span className="font-semibold text-sm">
            {b.side === "YES" ? `${strike}+ ${stat}` : `Under ${strike} ${stat}`}
          </span>
          <span className="text-xs">
            ${STAKE} pays <span className="font-semibold">${kalshiPayout(STAKE, b.price).toFixed(2)}</span> now
            {!live && worthIt != null && (
              <span className="text-muted-foreground"> · still worth it down to ${kalshiPayout(STAKE, worthIt).toFixed(2)}</span>
            )}
          </span>
          <span className="text-xs text-muted-foreground">
            {live ? "Pregame model" : "Our model"}: {howOften(b.prob)}
            {r.n > 0 && (
              <> · <span className={solidUp && r.low ? "text-amber-600 dark:text-amber-400" : ""}>This season: {r.hits} of {r.n} games</span></>
            )}
          </span>
          {b.side === "NO" && (
            <span className="text-[11px] text-muted-foreground/80">
              On Kalshi this shows as "No" on "{playerName}: {strike}+"
            </span>
          )}
          {!live && b.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400">⚠ {w}</p>
          ))}
          {/* A note, not a warning: warnings drop the grade, this only flags it */}
          {solidUp && r.low && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              ⚠ Low season record: {r.hits} of {r.n} games vs the model's {Math.round(b.prob * 100)}% — the model may be too optimistic here
            </p>
          )}
        </div>
        <div className="shrink-0 flex items-center gap-1.5">
          {kalshiUrl && (
            <a
              href={kalshiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Bet on Kalshi ↗
            </a>
          )}
          <button
            onClick={onAdd}
            disabled={added}
            className={`text-xs font-semibold px-2.5 py-1 rounded border transition-colors ${
              added
                ? "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 cursor-default"
                : "border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
            }`}
          >
            {added ? "Added ✓" : "+ Add to Slip"}
          </button>
          <button
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? "Hide details" : "Why this bet"}
            className="text-xs px-1.5 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 flex flex-col gap-1.5">
          <Bar label="Kalshi thinks" pct={b.price} />
          <Bar label={live ? "Pregame model" : "Our model"} pct={b.prob} />
          {r.n > 0 && <Bar label="This season" pct={r.hits / r.n} note={`(${r.hits}/${r.n})`} />}
          <p className="text-xs text-muted-foreground mt-1">
            {live ? (
              <>The game has started: Kalshi's price reacts to it, but our model is from before tip-off, so this bet isn't graded.</>
            ) : (
              <>
                Our model thinks this hits more often than Kalshi's price suggests
                {backed ? ", and the player's games this season back it too." : r.low ? ", but the player's games this season don't back it." : "."}
                {" "}Expected profit: about {b.prob * kalshiPayout(1, b.price) - 1 >= 0 ? "+" : ""}{Math.round((b.prob * kalshiPayout(1, b.price) - 1) * 100)}¢ per $1 bet.
                Prices move — if Kalshi's order panel shows ${STAKE} paying less than the "still worth it" amount, skip it.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
