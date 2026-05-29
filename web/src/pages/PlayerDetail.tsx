import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { api } from "../api/client";
import type { GameLog, Team, GamePrediction, SeriesFlowData } from "../api/client";
import { evaluateBets } from "../lib/betEvaluator";
import type { BetEvaluation } from "../lib/betEvaluator";
import { AddToSlipModal } from "@/components/AddToSlipModal";
import { SeriesFlowPanel } from "@/components/SeriesFlowPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PROPS = ["PTS", "REB", "AST", "STL", "BLK", "2PM", "2PA", "3PT", "3PA", "FTM", "FTA"];
const COMBO_PROPS = [
  { label: "PTS+AST",     parts: ["PTS", "AST"]       },
  { label: "PTS+REB",     parts: ["PTS", "REB"]       },
  { label: "AST+REB",     parts: ["AST", "REB"]       },
  { label: "PTS+REB+AST", parts: ["PTS", "REB", "AST"] },
] as const;

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}



function DeltaBadge({ value, baseline }: { value: number | null; baseline: number | null }) {
  if (value === null || baseline === null) return null;
  const diff = value - baseline;
  if (Math.abs(diff) < 0.1) return <Minus className="h-3 w-3 text-muted-foreground inline" />;
  return (
    <span className={cn("text-xs font-medium ml-1", diff > 0 ? "text-emerald-500" : "text-red-500")}>
      {diff > 0 ? <TrendingUp className="h-3 w-3 inline" /> : <TrendingDown className="h-3 w-3 inline" />}
      {" "}{diff > 0 ? "+" : ""}{diff.toFixed(1)}
    </span>
  );
}

function StatCard({ label, value, baseline }: { label: string; value: number | null; baseline?: number | null }) {
  const display = value !== null ? value.toFixed(1) : "—";
  return (
    <Card className="flex-1 min-w-[72px] text-center">
      <CardContent className="pt-3 pb-2 px-2">
        <div className="text-xl font-bold tracking-tight">{display}</div>
        <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mt-0.5">
          {label}
        </div>
        {baseline !== undefined && <DeltaBadge value={value} baseline={baseline} />}
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ level }: { level: "high" | "medium" | "low" }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-xs font-semibold uppercase",
        level === "high" && "border-emerald-500 text-emerald-600",
        level === "medium" && "border-amber-500 text-amber-600",
        level === "low" && "border-muted-foreground text-muted-foreground",
      )}
    >
      {level}
    </Badge>
  );
}

// ── Sortable table helpers ────────────────────────────────────────────────────

type SortState = { key: string | null; dir: "asc" | "desc" };

function useSortable<T extends Record<string, unknown>>(
  data: T[],
  toNum?: (key: string, val: unknown) => number
) {
  const [sort, setSort] = useState<SortState>({ key: null, dir: "asc" });

  const sorted = useMemo(() => {
    if (!sort.key) return data;
    const k = sort.key;
    return [...data].sort((a, b) => {
      const av = a[k];
      const bv = b[k];
      const an = toNum ? toNum(k, av) : (typeof av === "number" ? av : NaN);
      const bn = toNum ? toNum(k, bv) : (typeof bv === "number" ? bv : NaN);
      const cmp = !isNaN(an) && !isNaN(bn)
        ? an - bn
        : String(av ?? "").localeCompare(String(bv ?? ""));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [data, sort, toNum]);

  const toggle = (key: string) =>
    setSort((prev) => ({
      key,
      dir: prev.key === key && prev.dir === "asc" ? "desc" : "asc",
    }));

  return { sorted, sort, toggle };
}

function SortableHead({
  label, sortKey, sort, onSort, className,
}: {
  label: React.ReactNode;
  sortKey: string;
  sort: SortState;
  onSort: (k: string) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead
      className={cn("cursor-pointer select-none group", className)}
      onClick={() => onSort(sortKey)}
    >
      <span className="flex items-center gap-1 whitespace-nowrap">
        {label}
        {active
          ? sort.dir === "asc"
            ? <ChevronUp className="h-3 w-3 text-primary" />
            : <ChevronDown className="h-3 w-3 text-primary" />
          : <ChevronsUpDown className="h-3 w-3 opacity-0 group-hover:opacity-40 transition-opacity" />}
      </span>
    </TableHead>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const glToNum = (key: string, val: unknown) => {
  if (key === "date") return new Date(String(val)).getTime();
  if (key === "result") return val === "W" ? 1 : 0;
  const n = parseFloat(String(val ?? "0").split("-")[0]);
  return isNaN(n) ? 0 : n;
};

function GameLogTable({ games }: { games: GameLog[] }) {
  const { sorted, sort, toggle } = useSortable(games as unknown as Record<string, unknown>[], glToNum);
  const cols: [string, string][] = [
    ["date","Date"],["matchup","Matchup"],["result","W/L"],["MIN","MIN"],
    ["PTS","PTS"],["REB","REB"],["AST","AST"],["STL","STL"],["BLK","BLK"],["3PT","3PT"],["2PM","2PM"],
  ];
  return (
    <div className="rounded-lg border table-scroll">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {cols.map(([key, label]) => (
              <SortableHead key={key} label={label} sortKey={key} sort={sort} onSort={toggle}
                className="text-xs font-semibold uppercase tracking-wider text-muted-foreground" />
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.length === 0 && (
            <TableRow>
              <TableCell colSpan={11} className="text-center text-muted-foreground py-8">No games found</TableCell>
            </TableRow>
          )}
          {(sorted as unknown as GameLog[]).map((g, i) => (
            <TableRow key={i} className="hover:bg-muted/30 transition-colors">
              <TableCell className="text-muted-foreground text-sm">{formatDate(g.date)}</TableCell>
              <TableCell className="font-medium text-sm">{g.matchup}</TableCell>
              <TableCell>
                <Badge variant={g.result === "W" ? "default" : "destructive"}
                  className={cn("text-xs font-bold", g.result === "W" ? "bg-emerald-500 hover:bg-emerald-600" : "")}>
                  {g.result}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">{g.MIN}</TableCell>
              <TableCell className="font-bold">{g.PTS}</TableCell>
              <TableCell>{g.REB}</TableCell>
              <TableCell>{g.AST}</TableCell>
              <TableCell>{g.STL}</TableCell>
              <TableCell>{g.BLK}</TableCell>
              <TableCell>{g["3PT"]}</TableCell>
              <TableCell>{Number(g["2PM"] ?? 0)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}



export default function PlayerDetail() {
  const { isPremium } = useAuth();
  const { playerId } = useParams<{ playerId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locState = location.state as { name?: string; opponentName?: string; isHome?: boolean; goToPredict?: boolean } | null;
  const playerName   = locState?.name ?? "Player";
  const initOpponent = locState?.opponentName ?? null;
  const initIsHome   = locState?.isHome ?? null;
  const goToPredict  = !!locState?.goToPredict;
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);

  const [gamelog, setGamelog] = useState<GameLog[]>([]);
  const [gamelogLoading, setGamelogLoading] = useState(true);
  const [officialAvgs, setOfficialAvgs] = useState<Record<string, number>>({});

  // With/Without
  const [teammates, setTeammates] = useState<{ id: string; full_name: string }[]>([]);
  const [teamInjuries, setTeamInjuries] = useState<{ id: string; full_name: string; short_name: string; status: string; comment: string }[]>([]);
  const [showSampleGames, setShowSampleGames] = useState(false);

  // Matchup
  const [teams, setTeams] = useState<Team[]>([]);
  const [opponent, setOpponent] = useState<Team | null>(null);

  // Prediction
  const [prediction, setPrediction] = useState<GamePrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [excludedDefenders, setExcludedDefenders] = useState<Set<string>>(new Set());
  const [missingTeammates, setMissingTeammates] = useState<{ id: string; full_name: string }[]>([]);
  const [isHome, setIsHome] = useState<boolean | null>(null);
  const [seriesContext, setSeriesContext] = useState("");
  const [ppLines, setPpLines] = useState<Record<string, number> | null>(null);
  const [ppStatus, setPpStatus] = useState<"ok" | "rate_limited" | "unavailable" | null>(null);
  const [seriesFlow, setSeriesFlow] = useState<SeriesFlowData | null>(null);


  // Add-to-bet-slip modal
  const [slipBet, setSlipBet] = useState<BetEvaluation | null>(null);
  const [addedBets, setAddedBets] = useState<Set<string>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");

  // ── Per-table sort state (useSortable called at component level per hooks rules) ──
  const predTableRows = useMemo(
    () => prediction ? PROPS.map(p => ({ _prop: p, ...prediction.props[p] as object })) : [],
    [prediction]
  );
  const { sorted: sortedPredRows, sort: predSort, toggle: togglePredSort } = useSortable(predTableRows as Record<string, unknown>[]);

  const defCardRows = useMemo(
    () => (prediction?.defender_matchup?.defenders ?? []) as unknown as Record<string, unknown>[],
    [prediction]
  );
  const { sorted: sortedDefCardRows, sort: defCardSort, toggle: toggleDefCardSort } = useSortable(defCardRows);




  useEffect(() => {
    if (!playerId) return;
    Promise.all([
      api.getGameLog(playerId),
      api.getSeasonAverages(playerId),
    ]).then(([log, avgs]) => {
      setGamelog(log);
      setOfficialAvgs(avgs);
      setGamelogLoading(false);
    });
    api.getTeams().then(setTeams);
    api.getHeadshot(playerId).then((r) => setHeadshotUrl(r.url)).catch(() => {});
    api.getTeammates(playerId).then(setTeammates);
    api.getTeamInjuries(playerId).then((injuries) => {
      setTeamInjuries(injuries);
      setMissingTeammates(injuries.filter((p) => p.status === "Out").map((p) => ({ id: p.id, full_name: p.full_name })));
    });
  }, [playerId]);

  const autoRan = useRef(false);

  const runPredict = useCallback(() => {
    if (!playerId || !opponent) return;
    setPredicting(true); setPrediction(null); setPpLines(null); setSeriesFlow(null);
    Promise.all([
      api.predictGame({
        player_id: playerId,
        opponent: opponent.display_name,
        without_teammate_ids: missingTeammates.length > 0 ? missingTeammates.map(t => t.id) : undefined,
        is_home: isHome ?? undefined,
        series_context: seriesContext.trim() || undefined,
      }),
      api.getPrizePicks(playerId, playerName).catch(() => ({ lines: {}, status: "unavailable" as const })),
      api.getSeriesFlow(playerId).catch(() => null),
    ]).then(([pred, pp, flow]) => {
      setPrediction(pred);
      setPpLines(Object.keys(pp.lines).length > 0 ? pp.lines : null);
      setPpStatus(pp.status);
      setSeriesFlow(flow && flow.games.length > 0 ? flow : null);
      setPredicting(false);
      setExcludedDefenders(new Set());
    });
  }, [playerId, opponent, missingTeammates, isHome, playerName, seriesContext]);

  // Pre-fill opponent + home/away when navigated from GameRoster
  useEffect(() => {
    if (!initOpponent || !teams.length || opponent) return;
    const found = teams.find(t => t.display_name === initOpponent);
    if (found) setOpponent(found);
    if (initIsHome !== null) setIsHome(initIsHome);
  }, [teams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-run prediction once when opponent is pre-filled from GameRoster
  useEffect(() => {
    if (!goToPredict || !opponent || !playerId || autoRan.current) return;
    autoRan.current = true;
    runPredict();
  }, [opponent]); // eslint-disable-line react-hooks/exhaustive-deps


  // Recompute PTS projection client-side when defenders are toggled out.
  // When nothing is excluded, returns the backend values directly so the card
  // always matches the main table (avoids poss/dampening recomputation drift).
  function computeAdjustedPts(pred: GamePrediction, excluded: Set<string>) {
    const dm = pred.defender_matchup;
    const ptsRow = pred.props["PTS"];
    if (!ptsRow) return null;

    // No exclusions — pass through the server-computed values unchanged
    if (excluded.size === 0) {
      return {
        expected:    ptsRow.expected,
        def_adj:     ptsRow.defender_adj ?? 0,
        team_fg_pct: dm.team_fg_pct ?? 0,
        total_poss:  dm.total_poss,
      };
    }

    // Exclusions active — recompute from remaining defenders
    const base     = ptsRow.expected - (ptsRow.defender_adj ?? 0);
    const remaining = dm.defenders.filter((d) => !excluded.has(d.defender_id));
    const totalFga  = remaining.reduce((s, d) => s + d.fga, 0);
    const totalFgm  = remaining.reduce((s, d) => s + d.fgm, 0);
    const totalPoss = remaining.reduce((s, d) => s + d.partial_poss, 0);
    if (totalFga === 0 || !dm.season_fg_pct) return { expected: base, def_adj: 0, team_fg_pct: 0, total_poss: 0 };
    const teamFgPct = totalFgm / totalFga;
    const defFactor = teamFgPct / dm.season_fg_pct;
    // Use the same total_poss denominator the backend used (includes unlisted defenders)
    // scaled proportionally to remaining possession share
    const possScale = dm.total_poss > 0 ? totalPoss / dm.total_poss : 1;
    const scaledPoss = dm.total_poss * possScale;
    const defW      = scaledPoss / (scaledPoss + 50);
    const defAdj    = (defFactor - 1) * ptsRow.season_avg * defW;
    return {
      expected:     Math.round((base + defAdj) * 10) / 10,
      def_adj:      Math.round(defAdj * 10) / 10,
      team_fg_pct:  teamFgPct,
      total_poss:   Math.round(totalPoss),
    };
  }

  const woLabel = missingTeammates.length > 0
    ? missingTeammates.map((t) => t.full_name.split(" ").slice(-1)[0]).join(", ")
    : null;



  return (
    <div className="py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="gap-1">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>
      <div className="flex items-center gap-4">
        {headshotUrl && (
          <img
            src={headshotUrl}
            alt={playerName}
            className="h-20 w-20 rounded-full object-cover object-top bg-muted border border-border shrink-0"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        )}
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{playerName}</h1>
          <p className="text-muted-foreground text-sm mt-1">2025–26 Season</p>
        </div>
      </div>

      {/* Season stat cards */}
      <div className="flex flex-wrap gap-2">
        {(["PTS","REB","AST","STL","BLK","TO","MIN","FG%","3FG%","3PA","FT%","FTA"] as const).map(k => (
          <StatCard key={k} label={k} value={officialAvgs[k === "3FG%" ? "3PT%" : k] ?? null} />
        ))}
      </div>

      <Tabs defaultValue="predict">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="predict">Predict</TabsTrigger>
          <TabsTrigger value="gamelog">Game Log</TabsTrigger>
        </TabsList>

        {/* ── Game Log ── */}
        <TabsContent value="gamelog" className="mt-4">
          {gamelogLoading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
          ) : (
            <GameLogTable games={gamelog} />
          )}
        </TabsContent>

        {/* ── Predict ── */}
        <TabsContent value="predict" className="mt-4 space-y-4">
          <div className="flex gap-3 flex-wrap">
            <Select value={opponent?.abbreviation ?? ""} onValueChange={(val) => {
              setOpponent(teams.find((t) => t.abbreviation === val) ?? null);
              setPrediction(null);
            }}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Opponent team…" /></SelectTrigger>
              <SelectContent>
                {teams.map((t) => <SelectItem key={t.abbreviation} value={t.abbreviation}>{t.display_name}</SelectItem>)}
              </SelectContent>
            </Select>

            <div className="space-y-2">
              {teamInjuries.length > 0 && (
                <div className="flex flex-wrap gap-1.5 items-center">
                  <span className="text-xs text-muted-foreground font-medium">Out/DTD:</span>
                  {teamInjuries.map((p) => {
                    const added = !!missingTeammates.find((m) => m.id === p.id);
                    return (
                      <button
                        key={p.id}
                        title={p.comment}
                        onClick={() => {
                          if (added) {
                            setMissingTeammates((prev) => prev.filter((m) => m.id !== p.id));
                          } else {
                            setMissingTeammates((prev) => [...prev, { id: p.id, full_name: p.full_name }]);
                          }
                          setPrediction(null);
                          setExcludedDefenders(new Set());
                        }}
                        className={cn(
                          "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium border transition-colors",
                          added
                            ? "bg-destructive/10 text-destructive border-destructive/30"
                            : "bg-muted text-muted-foreground border-border hover:text-foreground",
                          p.status === "Out" ? "border-dashed" : ""
                        )}
                      >
                        {p.short_name}
                        <span className={cn("text-[10px]", p.status === "Out" ? "text-destructive" : "text-amber-500")}>
                          {p.status === "Out" ? "OUT" : "DTD"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              <Select value="" onValueChange={(val) => {
                const t = teammates.find((p) => p.id === val);
                if (t && !missingTeammates.find((m) => m.id === val)) {
                  setMissingTeammates((prev) => [...prev, t]);
                  setPrediction(null);
                  setExcludedDefenders(new Set());
                }
              }}>
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Add missing teammate…" />
                </SelectTrigger>
                <SelectContent>
                  {teammates
                    .filter((p) => !missingTeammates.find((m) => m.id === p.id))
                    .map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
              {missingTeammates.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {missingTeammates.map((t) => (
                    <span key={t.id} className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-1 rounded-full font-medium">
                      {t.full_name}
                      <button
                        onClick={() => { setMissingTeammates((prev) => prev.filter((m) => m.id !== t.id)); setPrediction(null); }}
                        className="text-muted-foreground hover:text-foreground ml-0.5 leading-none"
                      >×</button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1">
              {([["Home", true], ["Away", false], ["—", null]] as [string, boolean | null][]).map(([label, val]) => (
                <button
                  key={label}
                  onClick={() => { setIsHome(val); setPrediction(null); }}
                  className={cn("px-3 py-1.5 text-sm rounded-md border font-medium transition-colors",
                    isHome === val ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:text-foreground"
                  )}
                >{label}</button>
              ))}
            </div>
          </div>

          {!opponent && (
            <p className="text-muted-foreground text-sm">Select an opponent to generate a prediction.</p>
          )}

          {opponent && (
            <>
              {isPremium && (
                <div className="flex flex-col gap-1.5">
                  <input
                    className="h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    placeholder="Series context for AI reasoning (e.g. Series tied 1-1, team lost G2 at home)"
                    defaultValue={seriesContext}
                    onBlur={e => setSeriesContext(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Optional — adds situational reasoning from Claude on top of the formula.
                  </p>
                </div>
              )}
              <Button
                onClick={runPredict}
                disabled={predicting}
                className="gap-2"
              >
                {predicting ? "Calculating…" : `Predict ${playerName} vs ${opponent.short_name}`}
              </Button>

              {prediction && (
                <div className="space-y-4">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        {playerName} vs {opponent.display_name}
                        {woLabel && <span className="text-muted-foreground font-normal text-sm ml-2">without {woLabel}</span>}
                      </CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Season: {prediction.sample_sizes.season}g &nbsp;·&nbsp;
                        vs {opponent.short_name}: {prediction.sample_sizes.vs_opponent}g &nbsp;·&nbsp;
                        {prediction.sample_sizes.series > 0 && <><span className="text-primary font-medium">series: {prediction.sample_sizes.series}g</span> &nbsp;·&nbsp;</>}
                        {prediction.sample_sizes.without_teammate !== null && woLabel && <>w/o {woLabel}: {prediction.sample_sizes.without_teammate}g &nbsp;·&nbsp;</>}
                        last 5: {prediction.sample_sizes.last5}g &nbsp;·&nbsp;
                        def poss: {prediction.sample_sizes.def_poss}
                      </p>
                    </CardHeader>
                    <CardContent>
                      {prediction.summary && (
                        <div className="mb-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground leading-relaxed">
                          {prediction.summary}
                        </div>
                      )}

                      {prediction.situational_reasoning && (
                        <div className="mb-4 rounded-lg border border-violet-300 bg-violet-50 dark:bg-violet-950/40 dark:border-violet-700 px-4 py-3 text-sm text-foreground leading-relaxed space-y-1">
                          <p className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-1.5">Claude's situational read</p>
                          {prediction.situational_reasoning}
                        </div>
                      )}

                      {prediction.blowout_risk?.warning && (
                        <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 text-orange-900 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-700 px-4 py-3 text-sm flex items-start gap-2">
                          <span className="font-bold text-base mt-0.5">⚠</span>
                          <span>
                            <strong>Series game-script risk</strong>
                            {prediction.blowout_risk.series_record && (
                              <span className="ml-1 font-mono text-xs opacity-70">({prediction.blowout_risk.series_record})</span>
                            )}
                            {" — "}{prediction.blowout_risk.message}
                          </span>
                        </div>
                      )}

                      {(() => {
                        const pi = prediction.pace_info;
                        if (!pi || pi.pace_ratio === 1.0 || !pi.matchup_pace || !pi.player_season_pace) return null;
                        const pct = Math.round((pi.pace_ratio - 1) * 100);
                        const down = pct < 0;
                        return (
                          <div className={`mb-4 rounded-lg border px-4 py-3 text-sm flex items-center gap-2 ${down ? "border-blue-300 bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-800" : "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800"}`}>
                            <span className="font-semibold text-base">{down ? "↓" : "↑"}</span>
                            <span>
                              <strong>Pace {pct > 0 ? "+" : ""}{pct}%</strong>
                              {" — "}matchup {pi.matchup_pace} poss/g vs {pi.player_season_pace} season pace. All averages adjusted.
                              {pi.source === "playoffs" && <span className="ml-1 text-xs opacity-60">(playoff data)</span>}
                            </span>
                          </div>
                        );
                      })()}

                      {prediction.minutes_flag?.warning && (() => {
                        const mf = prediction.minutes_flag;
                        const drop = mf.season_avg_min > 0
                          ? Math.round((1 - (mf.last_series_min! / mf.season_avg_min)) * 100)
                          : 0;
                        const allMins = mf.series_game_mins.map((m, i) => `G${mf.series_game_mins.length - i}: ${m} min`).join(" · ");
                        return (
                          <div className="mb-4 rounded-lg border border-orange-300 bg-orange-50 px-4 py-3 text-sm text-orange-800 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800">
                            <strong>⚠ Minutes warning:</strong> Last series game was <strong>{mf.last_series_min} min</strong> vs {mf.season_avg_min} min season avg (−{drop}% playing time).
                            {mf.series_game_mins.length > 1 && <span className="ml-1 opacity-70">{allMins}</span>}
                            {" "}Prediction assumes full minutes — adjust if this is a rotation change.
                          </div>
                        );
                      })()}

                      {PROPS.some((p) => prediction.props[p]?.wo_direction_warning) && woLabel && (
                        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                          ⚠️ The "without {woLabel}" sample shows <strong>lower</strong> averages for some stats than the season baseline — possible selection bias (load management, back-to-backs). Check sample games below.
                        </div>
                      )}

                      {prediction.foul_trouble?.warning && (() => {
                        const ft = prediction.foul_trouble!;
                        return (
                          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200 dark:border-red-800">
                            🚨 <strong>Foul trouble ({ft.avg_fouls} fouls/game in series)</strong> — projection reduced for minutes lost.
                            {ft.early_foul_games > 0 && <span className="ml-1">Early foul trouble (Q1/Q2) in {ft.early_foul_games} of {ft.games.length} games.</span>}
                            <div className="mt-1 flex gap-3 flex-wrap">
                              {ft.games.map((g, i) => (
                                <span key={g.game_id} className="text-xs font-mono">
                                  G{i + 1}: {g.total_fouls}F {g.early_foul ? <span className="text-red-600 font-bold">(early)</span> : ""}
                                  &nbsp;[Q1:{g.fouls_by_quarter["1"]} Q2:{g.fouls_by_quarter["2"]} Q3:{g.fouls_by_quarter["3"]} Q4:{g.fouls_by_quarter["4"]}]
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {prediction.shot_zones && (prediction.shot_zones.series?.total_attempts ?? 0) > 0 && (() => {
                        const sz = prediction.shot_zones!;
                        const s = sz.series;
                        const b = sz.baseline;
                        const d = sz.drift;
                        const fmt = (v: number) => `${Math.round(v * 100)}%`;
                        const dFmt = (v: number) => v === 0 ? "" : `${v > 0 ? "+" : ""}${Math.round(v * 100)}pp`;
                        return (
                          <div className={cn("mb-4 rounded-lg border px-4 py-3 text-sm", sz.paint_drift_warning ? "border-orange-300 bg-orange-50 text-orange-800 dark:bg-orange-950 dark:text-orange-200 dark:border-orange-800" : "border-border bg-muted/30")}>
                            {sz.paint_drift_warning && (() => {
                              const cause = sz.paint_cause?.cause;
                              const causeLabel =
                                cause === "opponent_scheme"   ? "Opponent boxing out more — scheme-driven, adjustment applied." :
                                cause === "player_execution"  ? "Player choosing fewer paint touches — self-inflicted, no adjustment." :
                                cause === "normal_variance"   ? "Within normal variance — light adjustment applied." :
                                                                "Cause unknown — conservative adjustment applied.";
                              const causeColor =
                                cause === "opponent_scheme"   ? "text-orange-700 dark:text-orange-300" :
                                cause === "player_execution"  ? "text-blue-700 dark:text-blue-300" :
                                                                "text-muted-foreground";
                              return (
                                <span className="font-bold">
                                  ⚠️ Shot zone drift — being pushed off the paint. PTS/REB/BLK projection adjusted.{" "}
                                  <span className={cn("font-normal text-xs", causeColor)}>{causeLabel}</span>
                                  <br/>
                                </span>
                              );
                            })()}
                            <span className="font-semibold">Shot zones</span> ({s.total_attempts} series att · {b.total_attempts} baseline att)
                            <div className="mt-1.5 flex gap-4 flex-wrap text-xs font-mono">
                              {(["paint", "mid", "three"] as const).map((z) => (
                                <span key={z}>
                                  <span className="uppercase text-muted-foreground">{z}</span>{" "}
                                  <span className="font-semibold">{fmt(s[z] ?? 0)}</span>
                                  {b.total_attempts > 0 && (
                                    <span className={cn("ml-1", (d[z] ?? 0) < -0.05 ? "text-red-500" : (d[z] ?? 0) > 0.05 ? "text-emerald-500" : "text-muted-foreground")}>
                                      {dFmt(d[z] ?? 0)}
                                    </span>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {seriesFlow && (
                        <div className="mb-4">
                          <SeriesFlowPanel data={seriesFlow} />
                        </div>
                      )}

                      {ppStatus === "rate_limited" && (
                        <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 dark:border-yellow-800 px-4 py-3 text-sm text-yellow-800 dark:text-yellow-300">
                          PrizePicks lines unavailable — API rate limited. Try again in ~30 min. You can still enter lines manually below.
                        </div>
                      )}

                      {ppLines && Object.keys(ppLines).length > 0 && (() => {
                        const bets = evaluateBets(ppLines, prediction);
                        const visible = bets.filter((b) => b.grade !== "SKIP");
                        const gradeStyle: Record<string, string> = {
                          STRONG: "bg-emerald-500 text-white",
                          SOLID:  "bg-blue-500 text-white",
                          LEAN:   "bg-amber-400 text-black",
                        };
                        return (
                          <div className="mb-4 rounded-lg border border-border overflow-hidden">
                            <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between">
                              <span className="text-sm font-semibold">Suggested Bets</span>
                              <span className="text-xs text-muted-foreground">vs PrizePicks lines · STRONG ≥20% edge · SOLID ≥12% low-var · LEAN ≥12%</span>
                            </div>
                            {visible.length === 0 ? (
                              <p className="px-4 py-3 text-sm text-muted-foreground">No strong edges found against current PrizePicks lines.</p>
                            ) : (
                              <div className="divide-y">
                                {visible.map((b: BetEvaluation) => (
                                  <div key={b.prop} className="px-4 py-2.5 flex flex-col gap-0.5">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className={`text-xs font-bold px-2 py-0.5 rounded ${gradeStyle[b.grade]}`}>
                                        {b.grade}
                                      </span>
                                      <span className="font-semibold text-sm uppercase">
                                        {b.direction === "over" ? "OVER" : "UNDER"} {b.line} {b.prop}
                                      </span>
                                      <span className="text-xs text-muted-foreground font-mono">
                                        predicted {b.expected} · edge {Math.round(b.edge * 100)}%
                                        {b.std_dev != null && (
                                          <span className={b.variance_flag ? " text-orange-500 font-semibold" : ""}>
                                            {" "}· σ {b.std_dev}
                                          </span>
                                        )}
                                      </span>
                                      <button
                                        onClick={() => setSlipBet(b)}
                                        disabled={addedBets.has(b.prop)}
                                        className={`ml-auto text-xs font-semibold px-2.5 py-1 rounded border transition-colors ${
                                          addedBets.has(b.prop)
                                            ? "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 cursor-default"
                                            : "border-primary/40 text-primary hover:bg-primary hover:text-primary-foreground"
                                        }`}
                                      >
                                        {addedBets.has(b.prop) ? "Added ✓" : "+ Add to Slip"}
                                      </button>
                                    </div>
                                    {b.warnings.map((w, i) => (
                                      <p key={i} className="text-xs text-amber-600 dark:text-amber-400 pl-1">⚠ {w}</p>
                                    ))}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      <div className="rounded-lg border table-scroll">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              {([
                                ["_prop","Stat"], ["season_avg","Season"], ["vs_opponent_avg",`vs ${opponent.short_name}`],
                                ["series_avg","Series"], ["without_teammate_avg", woLabel ? `w/o ${woLabel}` : "W/O"],
                                ["last5_avg","Last 5★"], ["defender_adj","Def Adj"],
                                ...(isHome !== null ? [["location_avg", isHome ? "Home" : "Away"] as [string,string]] : []),
                                ["expected","Projected"], ["confidence","Confidence"],
                                ...(ppLines ? [["pp_line","PP Line"] as [string,string]] : []),
                              ] as [string,string][]).map(([key, label]) => (
                                <SortableHead key={key} label={label} sortKey={key} sort={predSort} onSort={togglePredSort} className="text-xs uppercase tracking-wider" />
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(sortedPredRows as unknown as { _prop: string }[]).map((sortedRow) => {
                              const p = sortedRow._prop;
                              const row = prediction.props[p];
                              if (!row) return null;
                              const diff = row.expected - row.season_avg;
                              const hasDefAdj = row.defender_adj !== null && row.defender_adj !== 0;
                              return (
                                <TableRow key={p} className="hover:bg-muted/30">
                                  <TableCell className="font-semibold">{p}</TableCell>
                                  <TableCell className="text-muted-foreground">{row.season_avg}</TableCell>
                                  <TableCell>{row.vs_opponent_avg}</TableCell>
                                  <TableCell>
                                    {row.series_avg !== null ? (
                                      <span className="font-semibold text-primary">{row.series_avg}</span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                    {row.series_reversal && (
                                      <span
                                        className="ml-1.5 text-xs font-bold text-orange-500 cursor-default"
                                        title={`Opponent adjustment detected: last game ${row.series_reversal.last} vs prior avg ${row.series_reversal.prior_avg} — treat OVER bets on this prop with caution`}
                                      >
                                        ↓adj
                                      </span>
                                    )}
                                    {row.series_spike && (
                                      <span
                                        className="ml-1.5 text-xs font-bold text-blue-500 cursor-default"
                                        title={`Last game was a spike (2x+ prior series avg) — projection uses unweighted series average to avoid over-indexing on the outlier`}
                                      >
                                        ↑spike
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>{row.without_teammate_avg}</TableCell>
                                  <TableCell>{row.last5_avg}</TableCell>
                                  <TableCell>
                                    {hasDefAdj ? (
                                      <span className={cn("text-xs font-semibold", (row.defender_adj ?? 0) > 0 ? "text-emerald-500" : "text-red-500")}>
                                        {(row.defender_adj ?? 0) > 0 ? "+" : ""}{row.defender_adj?.toFixed(1)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </TableCell>
                                  {isHome !== null && (
                                    <TableCell>
                                      {row.location_avg !== null && row.location_avg !== undefined ? (
                                        <span className={cn("text-xs font-semibold", row.location_avg > row.season_avg ? "text-emerald-500" : row.location_avg < row.season_avg ? "text-red-500" : "")}>
                                          {row.location_avg}
                                        </span>
                                      ) : (
                                        <span className="text-muted-foreground text-xs">—</span>
                                      )}
                                    </TableCell>
                                  )}
                                  <TableCell>
                                    <span className={cn("font-bold text-base", diff > 0.5 ? "text-emerald-500" : diff < -0.5 ? "text-red-500" : "")}>
                                      {row.expected}
                                    </span>
                                    <span className={cn("text-xs ml-1", diff > 0 ? "text-emerald-500" : "text-red-500")}>
                                      ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                                    </span>
                                  </TableCell>
                                  <TableCell><ConfidenceBadge level={row.confidence} /></TableCell>
                                  {ppLines && (() => {
                                    const line = ppLines[p] ?? null;
                                    if (line === null) return <TableCell className="text-muted-foreground text-xs">—</TableCell>;
                                    const edge = row.expected - line;
                                    return (
                                      <TableCell>
                                        <span className="font-semibold">{line}</span>
                                        <span className={cn("text-xs ml-1 font-semibold", edge > 0.5 ? "text-emerald-500" : edge < -0.5 ? "text-red-500" : "text-muted-foreground")}>
                                          {edge > 0 ? "+" : ""}{edge.toFixed(1)}
                                        </span>
                                      </TableCell>
                                    );
                                  })()}
                                </TableRow>
                              );
                            })}
                            {COMBO_PROPS.map(({ label, parts }) => {
                              const sum = (key: string) => {
                                const vals = parts.map((p) => {
                                  const v = (prediction.props[p] as unknown as Record<string, unknown> | undefined)?.[key];
                                  return typeof v === "number" ? v : null;
                                });
                                if (vals.some((v) => v === null)) return null;
                                return parseFloat((vals as number[]).reduce((a, b) => a + b, 0).toFixed(1));
                              };
                              const confRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
                              const comboConf = (() => {
                                const levels = parts
                                  .map((p) => (prediction.props[p] as unknown as Record<string, unknown> | undefined)?.["confidence"] as string | undefined)
                                  .filter((c): c is string => !!c);
                                if (!levels.length) return null;
                                return levels.reduce((a, b) => confRank[a] <= confRank[b] ? a : b) as "high" | "medium" | "low";
                              })();
                              const projected = sum("expected");
                              const ppLine = ppLines?.[label] ?? null;
                              const edge = projected !== null && ppLine !== null ? parseFloat((projected - ppLine).toFixed(1)) : null;
                              return (
                                <TableRow key={label} className="hover:bg-muted/30 bg-muted/10">
                                  <TableCell className="font-semibold text-primary">{label}</TableCell>
                                  <TableCell className="text-muted-foreground">{sum("season_avg") ?? "—"}</TableCell>
                                  <TableCell>{sum("vs_opponent_avg") ?? "—"}</TableCell>
                                  <TableCell>{sum("series_avg") ?? <span className="text-muted-foreground text-xs">—</span>}</TableCell>
                                  <TableCell>{sum("without_teammate_avg") ?? "—"}</TableCell>
                                  <TableCell>{sum("last5_avg") ?? "—"}</TableCell>
                                  <TableCell><span className="text-muted-foreground text-xs">—</span></TableCell>
                                  {isHome !== null && <TableCell>{sum("location_avg") ?? <span className="text-muted-foreground text-xs">—</span>}</TableCell>}
                                  <TableCell>
                                    {projected !== null ? (
                                      <span className="font-bold text-base">{projected}</span>
                                    ) : "—"}
                                  </TableCell>
                                  <TableCell>
                                    {comboConf ? <ConfidenceBadge level={comboConf} /> : <span className="text-muted-foreground text-xs">—</span>}
                                  </TableCell>
                                  {ppLines && (
                                    ppLine !== null ? (
                                      <TableCell>
                                        <span className="font-semibold">{ppLine}</span>
                                        {edge !== null && (
                                          <span className={cn("text-xs ml-1 font-semibold", edge > 0.5 ? "text-emerald-500" : edge < -0.5 ? "text-red-500" : "text-muted-foreground")}>
                                            {edge > 0 ? "+" : ""}{edge}
                                          </span>
                                        )}
                                      </TableCell>
                                    ) : (
                                      <TableCell className="text-muted-foreground text-xs">—</TableCell>
                                    )
                                  )}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>

                      {prediction.without_teammate_games.length > 0 && (
                        <div className="mt-4">
                          <button onClick={() => setShowSampleGames((s) => !s)} className="flex items-center gap-1 text-sm text-primary font-semibold">
                            {showSampleGames ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            Games without {woLabel ?? "selected teammates"} ({prediction.without_teammate_games.length})
                          </button>
                          {showSampleGames && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {prediction.without_teammate_games.map((g, i) => (
                                <span key={i} className={cn("text-xs px-2 py-1 rounded-full font-medium", g.result === "W" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200")}>
                                  {formatDate(g.date)} · {g.matchup} · {g.result}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground mt-4">
                        Series = current series games. Last 5★ = recency-weighted. Def Adj = possession FG% vs {opponent.short_name} (PTS only). Series Corr = avg error correction from prior saved games vs this opponent. Bias = systematic model error correction across all saved games for this player.
                      </p>
                    </CardContent>
                  </Card>

                  {/* Defender matchup breakdown */}
                  {prediction.defender_matchup.season_used && prediction.defender_matchup.defenders.length > 0 && (() => {
                    const dm = prediction.defender_matchup;
                    const factorPct = ((dm.def_factor - 1) * 100).toFixed(1);
                    const factorPositive = dm.def_factor >= 1;
                    const adj = computeAdjustedPts(prediction, excludedDefenders);
                    const nExcluded = excludedDefenders.size;
                    const basePts = prediction.props["PTS"]?.expected ?? null;
                    return (
                      <Card>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-4 flex-wrap">
                            <div>
                              <CardTitle className="text-sm font-semibold">
                                {opponent.short_name} Defenders vs {playerName} — PTS Adjustment
                              </CardTitle>
                              <p className="text-xs text-muted-foreground mt-1">
                                {dm.season_used} · {adj ? adj.total_poss : dm.total_poss} poss · team FG% allowed:{" "}
                                <span className={cn("font-semibold", factorPositive ? "text-emerald-600" : "text-red-500")}>
                                  {adj && adj.team_fg_pct ? `${(adj.team_fg_pct * 100).toFixed(1)}%` : dm.team_fg_pct !== null ? `${(dm.team_fg_pct * 100).toFixed(1)}%` : "—"}
                                </span>
                                {" "}vs season {(dm.season_fg_pct * 100).toFixed(1)}%
                                {" "}→{" "}
                                <span className={cn("font-semibold", factorPositive ? "text-emerald-600" : "text-red-500")}>
                                  {factorPositive ? "+" : ""}{factorPct}% efficiency
                                </span>
                              </p>
                            </div>
                            {adj !== null && (
                              <div className="text-right">
                                <p className="text-xs text-muted-foreground uppercase tracking-wider">Projected PTS</p>
                                {nExcluded > 0 ? (
                                  <div className="flex items-center gap-2 justify-end">
                                    <span className="text-sm line-through text-muted-foreground">{basePts}</span>
                                    <span className="text-xl font-bold text-primary">{adj.expected}</span>
                                  </div>
                                ) : (
                                  <span className="text-xl font-bold">{adj.expected}</span>
                                )}
                                {nExcluded > 0 && (
                                  <p className="text-xs text-amber-600 font-medium">{nExcluded} defender{nExcluded !== 1 ? "s" : ""} excluded</p>
                                )}
                              </div>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="rounded-lg border table-scroll">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/50">
                                  <TableHead className="text-xs uppercase tracking-wider w-8" />
                                  {([["defender_name","Defender"],["partial_poss","Poss"],["fga","FGA"],["misses","Misses"],["fg_pct","FG%"],["pts","Pts allowed"]] as [string,string][]).map(([key,label]) => (
                                    <SortableHead key={key} label={label} sortKey={key} sort={defCardSort} onSort={toggleDefCardSort} className="text-xs uppercase tracking-wider" />
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(sortedDefCardRows as unknown as typeof dm.defenders).map((d) => {
                                  const isExcluded = excludedDefenders.has(d.defender_id);
                                  return (
                                    <TableRow key={d.defender_id} className={cn("hover:bg-muted/30 transition-colors", isExcluded && "opacity-40")}>
                                      <TableCell className="pr-0 pl-3 w-8">
                                        <button
                                          onClick={() => setExcludedDefenders((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(d.defender_id)) next.delete(d.defender_id);
                                            else next.add(d.defender_id);
                                            return next;
                                          })}
                                          className={cn(
                                            "text-xs font-bold px-1.5 py-0.5 rounded border transition-colors",
                                            isExcluded
                                              ? "border-red-400 text-red-500 bg-red-50 dark:bg-red-950"
                                              : "border-emerald-400 text-emerald-600 bg-emerald-50 dark:bg-emerald-950 hover:border-red-300 hover:text-red-400"
                                          )}
                                          title={isExcluded ? "Click to include" : "Click to exclude (didn't play)"}
                                        >
                                          {isExcluded ? "OUT" : "IN"}
                                        </button>
                                      </TableCell>
                                      <TableCell className={cn("font-medium text-sm", isExcluded && "line-through")}>{d.defender_name}</TableCell>
                                      <TableCell className="text-sm text-muted-foreground">{d.partial_poss.toFixed(0)}</TableCell>
                                      <TableCell className="text-sm">{d.fga}</TableCell>
                                      <TableCell className={cn("text-sm font-semibold", d.misses >= 3 ? "text-emerald-600" : "")}>{d.misses}</TableCell>
                                      <TableCell className={cn("text-sm font-semibold", d.fg_pct < 0.4 ? "text-emerald-600" : d.fg_pct > 0.65 ? "text-red-500" : "")}>{(d.fg_pct * 100).toFixed(1)}%</TableCell>
                                      <TableCell className="text-sm">{d.pts}</TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          </div>
                          {nExcluded > 0 && (
                            <button
                              onClick={() => setExcludedDefenders(new Set())}
                              className="mt-2 text-xs text-muted-foreground hover:text-foreground underline"
                            >
                              Reset all to IN
                            </button>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })()}

                  {/* Save prediction */}
                  <div className="flex gap-2 items-center flex-wrap pt-2 border-t">
                    <input
                      type="text"
                      placeholder="Label (e.g. G1, G2)…"
                      value={saveLabel}
                      onChange={(e) => setSaveLabel(e.target.value)}
                      className="w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <Button
                      size="sm"
                      disabled={saving}
                      onClick={async () => {
                        if (!playerId || !opponent || !prediction) return;
                        setSaving(true);
                        const adj = computeAdjustedPts(prediction, excludedDefenders);
                        await api.savePrediction({
                          player_id: playerId,
                          player_name: playerName,
                          season: "2026",
                          opponent: opponent.display_name,
                          game_label: saveLabel.trim() || undefined,
                          without_teammate_ids: missingTeammates.map((t) => t.id),
                          without_teammate_names: missingTeammates.map((t) => t.full_name),
                          excluded_defender_ids: Array.from(excludedDefenders),
                          props: prediction.props,
                          sample_sizes: prediction.sample_sizes,
                          adjusted_pts: adj?.expected ?? undefined,
                        });
                        setSaving(false);
                        setSaveLabel("");
                      }}
                    >
                      {saving ? "Saving…" : "Save Prediction"}
                    </Button>
                    <span className="text-xs text-muted-foreground">Saves current projection to the Saved tab for later comparison</span>
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>


      </Tabs>

      {slipBet && playerName && (
        <AddToSlipModal
          bet={slipBet}
          playerId={playerId ?? null}
          playerName={playerName}
          onClose={() => setSlipBet(null)}
          onAdded={() => setAddedBets(prev => new Set(prev).add(slipBet.prop))}
        />
      )}
    </div>
  );
}
