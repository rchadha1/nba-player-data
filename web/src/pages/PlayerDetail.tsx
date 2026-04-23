import { useEffect, useState, useMemo } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { api } from "../api/client";
import type { GameLog, PropAnalysis, Team, WithoutSplit, GamePrediction, H2HResult, PlayerResult, DefenderRow, MatchupStats, SavedPrediction, BetEntry } from "../api/client";
import { evaluateBets } from "../lib/betEvaluator";
import type { BetEvaluation } from "../lib/betEvaluator";
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

const PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT", "3PA", "FTM"];
const COMBO_PROPS = [
  { label: "PTS+AST",     parts: ["PTS", "AST"]       },
  { label: "PTS+REB",     parts: ["PTS", "REB"]       },
  { label: "PTS+REB+AST", parts: ["PTS", "REB", "AST"] },
] as const;
const BET_COMBOS = ["PTS", "REB", "AST", "3PT", "PTS+REB", "PTS+AST", "AST+REB", "PTS+REB+AST"] as const;
type BetCombo = typeof BET_COMBOS[number];

function comboProjected(sp: SavedPrediction, combo: BetCombo): number | null {
  const get = (k: string) => k === "PTS" ? (sp.adjusted_pts ?? sp.props["PTS"]?.expected ?? null) : (sp.props[k]?.expected ?? null);
  const parts = combo.split("+");
  const vals = parts.map(get);
  if (vals.some((v) => v === null)) return null;
  return parseFloat((vals as number[]).reduce((a, b) => a + b, 0).toFixed(1));
}

function comboActual(sp: SavedPrediction, combo: BetCombo): number | null {
  if (!sp.actual_stats) return null;
  const parts = combo.split("+");
  const vals = parts.map((k) => sp.actual_stats![k] ?? null);
  if (vals.some((v) => v === null)) return null;
  return (vals as number[]).reduce((a, b) => a + b, 0);
}

function betResult(pick: "OVER" | "UNDER", line: number, actual: number | null): "WIN" | "LOSS" | "PUSH" | null {
  if (actual === null) return null;
  if (actual === line) return "PUSH";
  return (pick === "OVER" ? actual > line : actual < line) ? "WIN" : "LOSS";
}

function formatDate(raw: string): string {
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function parseStat(value: unknown): number {
  return parseFloat(String(value ?? "0").split("-")[0]) || 0;
}

function statAvg(games: GameLog[], stat: string): number | null {
  const vals = games
    .map((g) => parseStat((g as Record<string, unknown>)[stat]))
    .filter((v) => v > 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
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
  return (
    <Card className="flex-1 min-w-[80px] text-center">
      <CardContent className="pt-4 pb-3 px-2">
        <div className="text-2xl font-bold tracking-tight">
          {value !== null ? value.toFixed(1) : "—"}
        </div>
        <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider mt-0.5">
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
    ["PTS","PTS"],["REB","REB"],["AST","AST"],["STL","STL"],["BLK","BLK"],["3PT","3PT"],
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
              <TableCell colSpan={10} className="text-center text-muted-foreground py-8">No games found</TableCell>
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
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function PlayerDetail() {
  const { playerId } = useParams<{ playerId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const playerName = (location.state as { name?: string })?.name ?? "Player";
  const [headshotUrl, setHeadshotUrl] = useState<string | null>(null);

  const [gamelog, setGamelog] = useState<GameLog[]>([]);
  const [gamelogLoading, setGamelogLoading] = useState(true);
  const [officialAvgs, setOfficialAvgs] = useState<Record<string, number>>({});

  // Prop analyzer
  const [prop, setProp] = useState("PTS");
  const [line, setLine] = useState("");
  const [lastN, setLastN] = useState(10);
  const [result, setResult] = useState<PropAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // With/Without
  const [teammates, setTeammates] = useState<{ id: string; full_name: string }[]>([]);
  const [teamInjuries, setTeamInjuries] = useState<{ id: string; full_name: string; short_name: string; status: string; comment: string }[]>([]);
  const [teammate, setTeammate] = useState<{ id: string; full_name: string } | null>(null);
  const [withoutSplit, setWithoutSplit] = useState<WithoutSplit | null>(null);
  const [withoutLoading, setWithoutLoading] = useState(false);
  const [showSampleGames, setShowSampleGames] = useState(false);

  // Matchup
  const [teams, setTeams] = useState<Team[]>([]);
  const [opponent, setOpponent] = useState<Team | null>(null);
  const [matchupLog, setMatchupLog] = useState<GameLog[]>([]);
  const [matchupLoading, setMatchupLoading] = useState(false);
  const [matchupResult, setMatchupResult] = useState<PropAnalysis | null>(null);
  const [matchupAnalyzing, setMatchupAnalyzing] = useState(false);

  // Prediction
  const [prediction, setPrediction] = useState<GamePrediction | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [excludedDefenders, setExcludedDefenders] = useState<Set<string>>(new Set());
  const [missingTeammates, setMissingTeammates] = useState<{ id: string; full_name: string }[]>([]);
  const [isHome, setIsHome] = useState<boolean | null>(null);
  const [ppLines, setPpLines] = useState<Record<string, number> | null>(null);
  const [ppStatus, setPpStatus] = useState<"ok" | "rate_limited" | "unavailable" | null>(null);

  // H2H
  const [h2hSearch, setH2hSearch] = useState("");
  const [h2hResults, setH2hResults] = useState<PlayerResult[]>([]);
  const [h2hOpponent, setH2hOpponent] = useState<PlayerResult | null>(null);
  const [h2hData, setH2hData] = useState<H2HResult | null>(null);
  const [h2hLoading, setH2hLoading] = useState(false);
  const [h2hSearching, setH2hSearching] = useState(false);
  const [showH2hPlays, setShowH2hPlays] = useState(false);

  // Defender breakdown
  const [defBreakdown, setDefBreakdown] = useState<DefenderRow[]>([]);
  const [defBreakdownLoading, setDefBreakdownLoading] = useState(false);
  // defSort replaced by useSortable below

  // Saved predictions
  const [savedPredictions, setSavedPredictions] = useState<SavedPrediction[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveLabel, setSaveLabel] = useState("");
  const [actualsTarget, setActualsTarget] = useState<SavedPrediction | null>(null);
  const [actualsInput, setActualsInput] = useState<Record<string, string>>({});
  const [betsTarget, setBetsTarget] = useState<SavedPrediction | null>(null);
  const [betsInput, setBetsInput] = useState<Record<string, { line: string; pick: "OVER" | "UNDER" }>>({});
  const [savedActualsSorts, setSavedActualsSorts] = useState<Record<number, SortState>>({});
  const savedActualsSort = (id: number): SortState => savedActualsSorts[id] ?? { key: null, dir: "asc" };
  const toggleSavedActuals = (id: number, key: string) =>
    setSavedActualsSorts((prev) => {
      const cur = prev[id] ?? { key: null, dir: "asc" as const };
      return { ...prev, [id]: { key, dir: cur.key === key && cur.dir === "asc" ? "desc" : "asc" } };
    });

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

  const { sorted: sortedDefBreakdown, sort: defBreakdownSort, toggle: toggleDefBreakdown } = useSortable(
    defBreakdown as unknown as Record<string, unknown>[]
  );

  const h2hBoxRows = useMemo(() =>
    h2hData ? (["PTS","REB","AST","STL","BLK","TOV","FG_PCT","FG3_PCT"] as const).map(s => ({
      _stat: s as string,
      _a: h2hData.player_a_box.per_game?.[s] ?? 0,
      _b: h2hData.player_b_box.per_game?.[s] ?? 0,
    })) : [],
    [h2hData]
  );
  const { sorted: sortedH2hBoxRows, sort: h2hBoxSort, toggle: toggleH2hBoxSort } = useSortable(
    h2hBoxRows as unknown as Record<string, unknown>[]
  );

  const withoutRows = useMemo(() =>
    withoutSplit ? PROPS.map(p => ({
      _prop: p,
      _with: withoutSplit.with_teammate.averages[p] ?? 0,
      _without: withoutSplit.without_teammate.averages[p] ?? 0,
      _diff: (withoutSplit.without_teammate.averages[p] ?? 0) - (withoutSplit.with_teammate.averages[p] ?? 0),
    })) : [],
    [withoutSplit]
  );
  const { sorted: sortedWithoutRows, sort: withoutSort, toggle: toggleWithoutSort } = useSortable(
    withoutRows as unknown as Record<string, unknown>[]
  );

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
  useEffect(() => {
    if (!playerId) return;
    setSavedLoading(true);
    api.getSavedPredictions(playerId).then((d) => { setSavedPredictions(d); setSavedLoading(false); });
  }, [playerId]);

  useEffect(() => {
    if (!playerId || !opponent) return;
    setMatchupLog([]); setMatchupResult(null); setMatchupLoading(true);
    api.getMatchupLog(playerId, opponent.display_name).then((data) => {
      setMatchupLog(data); setMatchupLoading(false);
    });
  }, [playerId, opponent]);

  async function analyze() {
    if (!line || !playerId) return;
    setAnalyzing(true);
    try {
      setResult(await api.analyzeProp({ player_id: playerId, prop, line: parseFloat(line), last_n_games: lastN }));
    } finally { setAnalyzing(false); }
  }

  async function analyzeMatchup() {
    if (!line || !playerId || !opponent) return;
    setMatchupAnalyzing(true);
    try {
      setMatchupResult(await api.analyzeProp({
        player_id: playerId, prop, line: parseFloat(line),
        last_n_games: lastN, opponent: opponent.display_name,
      }));
    } finally { setMatchupAnalyzing(false); }
  }

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

  const seasonAvgs = PROPS.reduce<Record<string, number | null>>((acc, p) => {
    acc[p] = officialAvgs[p] ?? null;
    return acc;
  }, {});

  const recColor = (rec?: string) =>
    rec === "OVER" ? "bg-emerald-500" : rec === "UNDER" ? "bg-red-500" : "bg-muted-foreground";

  return (
    <div className="px-4 py-6 max-w-5xl mx-auto space-y-6">
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
      <div className="flex gap-2 flex-wrap">
        {PROPS.map((p) => (
          <StatCard key={p} label={p} value={seasonAvgs[p]} />
        ))}
      </div>

      <Tabs defaultValue="gamelog">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="gamelog">Game Log</TabsTrigger>
          <TabsTrigger value="matchup">Matchup</TabsTrigger>
          <TabsTrigger value="without">With / Without</TabsTrigger>
          <TabsTrigger value="predict" className={cn(opponent && teammate ? "text-primary font-semibold" : "")}>
            Predict {opponent && teammate ? "✦" : ""}
          </TabsTrigger>
            <TabsTrigger value="props">Prop Analyzer</TabsTrigger>
          <TabsTrigger value="h2h">Head to Head</TabsTrigger>
          <TabsTrigger value="saved">Saved</TabsTrigger>
        </TabsList>

        {/* ── Game Log ── */}
        <TabsContent value="gamelog" className="mt-4">
          {gamelogLoading ? (
            <p className="text-muted-foreground text-sm py-8 text-center">Loading…</p>
          ) : (
            <GameLogTable games={gamelog} />
          )}
        </TabsContent>

        {/* ── Matchup ── */}
        <TabsContent value="matchup" className="mt-4 space-y-4">
          <Select
            value={opponent?.abbreviation ?? ""}
            onValueChange={(val) => {
              setOpponent(teams.find((t) => t.abbreviation === val) ?? null);
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select opponent team…" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.abbreviation} value={t.abbreviation}>
                  {t.display_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {matchupLoading && <p className="text-muted-foreground text-sm">Loading matchup data…</p>}

          {opponent && !matchupLoading && matchupLog.length === 0 && (
            <p className="text-muted-foreground text-sm">No games vs {opponent.display_name} found this season.</p>
          )}

          {opponent && matchupLog.length > 0 && (
            <>
              <div className="flex gap-2 flex-wrap">
                {PROPS.map((p) => (
                  <StatCard
                    key={p} label={p}
                    value={statAvg(matchupLog, p)}
                    baseline={seasonAvgs[p]}
                  />
                ))}
                <StatCard label="GP" value={matchupLog.length} />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-primary">
                    Prop Analyzer — vs {opponent.display_name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex gap-2 flex-wrap">
                    {PROPS.map((p) => (
                      <Button
                        key={p} size="sm"
                        variant={prop === p ? "default" : "outline"}
                        onClick={() => { setProp(p); setMatchupResult(null); setResult(null); }}
                      >
                        {p}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2 items-center flex-wrap">
                    <input
                      type="number" placeholder="Line (e.g. 24.5)" value={line}
                      onChange={(e) => setLine(e.target.value)}
                      className="w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                    <Select value={String(lastN)} onValueChange={(v) => setLastN(Number(v))}>
                      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[5, 10, 15, 20].map((n) => (
                          <SelectItem key={n} value={String(n)}>Last {n} games</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={analyzeMatchup} disabled={matchupAnalyzing || !line}>
                      {matchupAnalyzing ? "Analyzing…" : "Analyze"}
                    </Button>
                  </div>
                  {matchupResult && (
                    <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Games vs {opponent.short_name}</span>
                        <span className="font-medium">{matchupResult.games_found}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Avg {prop}</span>
                        <span className="font-medium">{matchupResult.average}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Hit Rate vs {matchupResult.line}</span>
                        <span className="font-medium">{(matchupResult.hit_rate * 100).toFixed(1)}%</span>
                      </div>
                      <div className={cn("rounded-md py-3 text-center text-lg font-bold tracking-widest text-white mt-2", recColor(matchupResult.recommendation))}>
                        {matchupResult.recommendation}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <GameLogTable games={matchupLog} />
            </>
          )}
        </TabsContent>

        {/* ── With / Without ── */}
        <TabsContent value="without" className="mt-4 space-y-4">
          <Select
            value={teammate?.id ?? ""}
            onValueChange={(val) => {
              const t = teammates.find((p) => p.id === val) ?? null;
              setTeammate(t); setWithoutSplit(null);
              if (t && playerId) {
                setWithoutLoading(true);
                api.getWithoutSplit(playerId, t.id).then((data) => {
                  setWithoutSplit(data); setWithoutLoading(false);
                });
              }
            }}
          >
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select teammate…" />
            </SelectTrigger>
            <SelectContent>
              {teammates.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {withoutLoading && <p className="text-muted-foreground text-sm">Loading splits…</p>}

          {withoutSplit && teammate && (
            <Card>
              <CardContent className="pt-4">
                <div className="rounded-lg border table-scroll">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <SortableHead label="Stat" sortKey="_prop" sort={withoutSort} onSort={toggleWithoutSort} className="text-xs uppercase tracking-wider" />
                        <SortableHead label={<>With {teammate.full_name.split(" ").slice(-1)[0]} <span className="text-muted-foreground font-normal ml-1">({withoutSplit.with_teammate.games}g)</span></>} sortKey="_with" sort={withoutSort} onSort={toggleWithoutSort} className="text-xs uppercase tracking-wider text-center" />
                        <SortableHead label={<>Without {teammate.full_name.split(" ").slice(-1)[0]} <span className="text-muted-foreground font-normal ml-1">({withoutSplit.without_teammate.games}g)</span></>} sortKey="_without" sort={withoutSort} onSort={toggleWithoutSort} className="text-xs uppercase tracking-wider text-center" />
                        <SortableHead label="Diff" sortKey="_diff" sort={withoutSort} onSort={toggleWithoutSort} className="text-xs uppercase tracking-wider text-center" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(sortedWithoutRows as unknown as { _prop: string; _with: number; _without: number; _diff: number }[]).map(({ _prop: p, _with: w, _without: wo, _diff: diff }) => (
                          <TableRow key={p} className="hover:bg-muted/30">
                            <TableCell className="font-semibold">{p}</TableCell>
                            <TableCell className="text-center text-muted-foreground">{w.toFixed(1)}</TableCell>
                            <TableCell className="text-center font-semibold">{wo.toFixed(1)}</TableCell>
                            <TableCell className="text-center">
                              <span className={cn("font-semibold text-sm", diff > 0 ? "text-emerald-500" : diff < 0 ? "text-red-500" : "text-muted-foreground")}>
                                {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                              </span>
                            </TableCell>
                          </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {withoutSplit.without_teammate.games === 0 && (
                  <p className="text-muted-foreground text-xs mt-3">No games found without {teammate.full_name} this season.</p>
                )}
              </CardContent>
            </Card>
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
              <Button
                onClick={() => {
                  if (!playerId) return;
                  setPredicting(true); setPrediction(null); setPpLines(null);
                  const playerName = (location.state as { name?: string } | null)?.name ?? "";
                  Promise.all([
                    api.predictGame({
                      player_id: playerId,
                      opponent: opponent.display_name,
                      without_teammate_ids: missingTeammates.length > 0 ? missingTeammates.map((t) => t.id) : undefined,
                      is_home: isHome ?? undefined,
                    }),
                    playerName ? api.getPrizePicks(playerId, playerName).catch(() => ({ lines: {}, status: "unavailable" as const })) : Promise.resolve({ lines: {}, status: "ok" as const }),
                  ]).then(([pred, pp]) => {
                    setPrediction(pred);
                    setPpLines(Object.keys(pp.lines).length > 0 ? pp.lines : null);
                    setPpStatus(pp.status);
                    setPredicting(false);
                    setExcludedDefenders(new Set());
                  });
                }}
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
                          LEAN:   "bg-amber-400 text-black",
                        };
                        return (
                          <div className="mb-4 rounded-lg border border-border overflow-hidden">
                            <div className="px-4 py-2.5 bg-muted/50 border-b flex items-center justify-between">
                              <span className="text-sm font-semibold">Suggested Bets</span>
                              <span className="text-xs text-muted-foreground">vs PrizePicks lines · STRONG ≥20% edge · LEAN ≥12%</span>
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
                                      <span className="text-xs text-muted-foreground ml-auto font-mono">
                                        predicted {b.expected} · edge {Math.round(b.edge * 100)}%
                                        {b.std_dev != null && (
                                          <span className={b.variance_flag ? " text-orange-500 font-semibold" : ""}>
                                            {" "}· σ {b.std_dev}
                                          </span>
                                        )}
                                      </span>
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
                                ["series_correction","Series Corr"], ["player_bias","Bias"],
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
                                    {row.series_correction !== null && row.series_correction !== undefined ? (
                                      <span className={cn("text-xs font-semibold", row.series_correction > 0 ? "text-emerald-500" : "text-red-500")}>
                                        {row.series_correction > 0 ? "+" : ""}{row.series_correction.toFixed(1)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    {row.player_bias !== null && row.player_bias !== undefined ? (
                                      <span className={cn("text-xs font-semibold", row.player_bias > 0 ? "text-emerald-500" : "text-red-500")}>
                                        {row.player_bias > 0 ? "+" : ""}{row.player_bias.toFixed(1)}
                                      </span>
                                    ) : (
                                      <span className="text-muted-foreground text-xs">—</span>
                                    )}
                                  </TableCell>
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
                              const projected = sum("expected");
                              const ppLine = ppLines?.[label] ?? null;
                              const edge = projected !== null && ppLine !== null ? parseFloat((projected - ppLine).toFixed(1)) : null;
                              const numCols = (isHome !== null ? 1 : 0); // extra location col
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
                                  {/* suppress numCols warning */ void numCols}
                                  <TableCell><span className="text-muted-foreground text-xs">—</span></TableCell>
                                  <TableCell><span className="text-muted-foreground text-xs">—</span></TableCell>
                                  <TableCell>
                                    {projected !== null ? (
                                      <span className="font-bold text-base">{projected}</span>
                                    ) : "—"}
                                  </TableCell>
                                  <TableCell><span className="text-muted-foreground text-xs">—</span></TableCell>
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
                        api.getSavedPredictions(playerId).then(setSavedPredictions);
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

        {/* ── Prop Analyzer ── */}
        <TabsContent value="props" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Prop Analyzer — All Games</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2 flex-wrap">
                {PROPS.map((p) => (
                  <Button key={p} size="sm" variant={prop === p ? "default" : "outline"}
                    onClick={() => { setProp(p); setResult(null); }}>
                    {p}
                  </Button>
                ))}
              </div>
              <div className="flex gap-2 items-center flex-wrap">
                <input
                  type="number" placeholder="Line (e.g. 24.5)" value={line}
                  onChange={(e) => setLine(e.target.value)}
                  className="w-36 rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                <Select value={String(lastN)} onValueChange={(v) => setLastN(Number(v))}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[5, 10, 15, 20].map((n) => (
                      <SelectItem key={n} value={String(n)}>Last {n} games</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button onClick={analyze} disabled={analyzing || !line}>
                  {analyzing ? "Analyzing…" : "Analyze"}
                </Button>
              </div>

              {result && (
                <div className="rounded-lg border p-4 space-y-2 bg-muted/30">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Average ({result.last_n_games}g)</span>
                    <span className="font-semibold">{result.average}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Hit Rate vs {result.line}</span>
                    <span className="font-semibold">{(result.hit_rate * 100).toFixed(1)}%</span>
                  </div>
                  <div className={cn("rounded-md py-3 text-center text-xl font-bold tracking-widest text-white mt-1", recColor(result.recommendation))}>
                    {result.recommendation}
                  </div>
                  <p className="text-xs text-muted-foreground pt-1">
                    Values: [{result.game_values.join(", ")}]
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        {/* ── Head to Head ── */}
        <TabsContent value="h2h" className="mt-4 space-y-4">

          {/* ── Defender breakdown — loads on tab open ── */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <CardTitle className="text-sm font-semibold">Which defenders stop {playerName}?</CardTitle>
                <div className="flex gap-1">
                  {defBreakdown.length === 0 && !defBreakdownLoading && playerId && (
                    <Button size="sm" variant="outline" className="text-xs h-7 px-2"
                      onClick={() => {
                        setDefBreakdownLoading(true);
                        api.getDefenderBreakdown(playerId).then((d) => {
                          setDefBreakdown(d);
                          setDefBreakdownLoading(false);
                        }).catch(() => setDefBreakdownLoading(false));
                      }}
                    >
                      Load
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {defBreakdownLoading && <p className="text-muted-foreground text-sm py-4 text-center">Loading defender data… (may take ~15s)</p>}
              {defBreakdown.length > 0 && (() => {
                const label = `${defBreakdown[0].season} ${defBreakdown[0].season_type}`;
                return (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">{label} · {defBreakdown.length} defenders</p>
                    <div className="rounded-lg border table-scroll max-h-72 overflow-y-auto overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 sticky top-0">
                            {([["defender_name","Defender"],["fga","FGA"],["fgm","FGM"],["misses","Misses"],["fg_pct","FG%"],["pts_total","Pts"],["matchup_min","Time"]] as [string,string][]).map(([key,label]) => (
                              <SortableHead key={key} label={label} sortKey={key} sort={defBreakdownSort} onSort={toggleDefBreakdown} className="text-xs uppercase tracking-wider" />
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(sortedDefBreakdown as unknown as typeof defBreakdown).slice(0, 20).map((d) => (
                            <TableRow key={d.defender_id} className="hover:bg-muted/30">
                              <TableCell className="font-medium text-sm">{d.defender_name}</TableCell>
                              <TableCell className="text-sm">{d.fga}</TableCell>
                              <TableCell className="text-sm">{d.fgm}</TableCell>
                              <TableCell className={cn("text-sm font-semibold", d.misses >= 4 ? "text-red-500" : "")}>{d.misses}</TableCell>
                              <TableCell className={cn("text-sm", d.fg_pct < 0.35 ? "text-emerald-600 font-bold" : d.fg_pct > 0.55 ? "text-red-500" : "")}>{(d.fg_pct * 100).toFixed(1)}%</TableCell>
                              <TableCell className="text-sm">{d.pts_total}</TableCell>
                              <TableCell className="text-muted-foreground text-sm">{d.matchup_min}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                );
              })()}
              {defBreakdown.length === 0 && !defBreakdownLoading && (
                <p className="text-muted-foreground text-sm py-2">Click Load to fetch defender data.</p>
              )}
            </CardContent>
          </Card>

          {/* ── H2H vs specific player ── */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Search opponent player…"
              value={h2hSearch}
              onChange={(e) => setH2hSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && h2hSearch.trim()) {
                  setH2hSearching(true); setH2hResults([]);
                  api.searchPlayers(h2hSearch.trim()).then((r) => { setH2hResults(r); setH2hSearching(false); }).catch(() => setH2hSearching(false));
                }
              }}
              className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <Button variant="outline" disabled={h2hSearching || !h2hSearch.trim()}
              onClick={() => {
                setH2hSearching(true); setH2hResults([]);
                api.searchPlayers(h2hSearch.trim()).then((r) => { setH2hResults(r); setH2hSearching(false); }).catch(() => setH2hSearching(false));
              }}
            >
              {h2hSearching ? "Searching…" : "Search player"}
            </Button>
          </div>

          {h2hResults.length > 0 && !h2hOpponent && (
            <div className="rounded-md border divide-y w-64">
              {h2hResults.map((p) => (
                <button key={p.id} className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                  onClick={() => {
                    setH2hOpponent(p); setH2hResults([]); setH2hData(null);
                    if (playerId) {
                      setH2hLoading(true);
                      api.getH2H(playerId, p.id).then((d) => { setH2hData(d); setH2hLoading(false); }).catch(() => setH2hLoading(false));
                    }
                  }}
                >{p.full_name}</button>
              ))}
            </div>
          )}

          {h2hOpponent && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">vs {h2hOpponent.full_name}</span>
              <Button variant="ghost" size="sm" onClick={() => { setH2hOpponent(null); setH2hData(null); setH2hSearch(""); }}>Change</Button>
            </div>
          )}

          {h2hLoading && <p className="text-muted-foreground text-sm">Loading head-to-head data… (may take ~15s)</p>}

          {h2hData && h2hOpponent && (() => {
            const nameA = playerName.split(" ").slice(-1)[0];
            const nameB = h2hOpponent.full_name.split(" ").slice(-1)[0];

            const ScoredOnCard = ({ data, scorer, defender }: { data: MatchupStats; scorer: string; defender: string }) => (
              <div className="rounded-lg border p-3 space-y-1 text-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {scorer} scoring on {defender}
                  <span className="ml-2 normal-case font-normal text-muted-foreground/70">({data.season} {data.season_type})</span>
                </p>
                <div className="grid grid-cols-4 gap-2 mt-2">
                  {[
                    { label: "Pts/g", value: data.pts_per_game.toFixed(1) },
                    { label: "FGA",   value: data.fga },
                    { label: "Misses",value: data.misses, highlight: data.misses >= 3 ? "text-red-500 font-bold" : "" },
                    { label: "FG%",   value: `${(data.fg_pct * 100).toFixed(1)}%`, highlight: data.fg_pct < 0.35 ? "text-emerald-600 font-bold" : data.fg_pct > 0.55 ? "text-red-500 font-bold" : "" },
                  ].map(({ label, value, highlight }) => (
                    <div key={label} className="text-center">
                      <div className={cn("text-base font-semibold", highlight ?? "")}>{value}</div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground pt-1">{data.matchup_min} matched up · {data.partial_poss} poss · {data.pts_per_100_poss} pts/100</p>
              </div>
            );

            const hasScoreData = (d: MatchupStats | Record<string, never>): d is MatchupStats => "fga" in d;

            return (
              <div className="space-y-4">
                {/* Season stats side-by-side */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">
                      Season Stats — {h2hData.player_a_box.games ?? "—"}g / {h2hData.player_b_box.games ?? "—"}g
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-lg border table-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <SortableHead label="Stat" sortKey="_stat" sort={h2hBoxSort} onSort={toggleH2hBoxSort} className="text-xs uppercase tracking-wider" />
                            <SortableHead label={playerName} sortKey="_a" sort={h2hBoxSort} onSort={toggleH2hBoxSort} className="text-xs uppercase tracking-wider text-center" />
                            <SortableHead label={h2hOpponent.full_name} sortKey="_b" sort={h2hBoxSort} onSort={toggleH2hBoxSort} className="text-xs uppercase tracking-wider text-center" />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(sortedH2hBoxRows as unknown as { _stat: string; _a: number; _b: number }[]).map((statRow) => {
                            const stat = statRow._stat as "PTS"|"REB"|"AST"|"STL"|"BLK"|"TOV"|"FG_PCT"|"FG3_PCT";
                            const a = statRow._a;
                            const b = statRow._b;
                            const isPct = stat.endsWith("_PCT");
                            const fmt = (v: number) => isPct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
                            return (
                              <TableRow key={stat} className="hover:bg-muted/30">
                                <TableCell className="font-semibold text-sm">{stat.replace("_PCT", "%").replace("FG3%", "3P%")}</TableCell>
                                <TableCell className={cn("text-center font-medium", a > b && "text-emerald-600 font-bold")}>{fmt(a)}</TableCell>
                                <TableCell className={cn("text-center font-medium", b > a && "text-emerald-600 font-bold")}>{fmt(b)}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Scored-on cards */}
                {(hasScoreData(h2hData.a_scores_on_b) || hasScoreData(h2hData.b_scores_on_a)) && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">Direct Matchup — Scored On</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {hasScoreData(h2hData.a_scores_on_b) && <ScoredOnCard data={h2hData.a_scores_on_b} scorer={nameA} defender={nameB} />}
                      {hasScoreData(h2hData.b_scores_on_a) && <ScoredOnCard data={h2hData.b_scores_on_a} scorer={nameB} defender={nameA} />}
                    </CardContent>
                  </Card>
                )}

                {/* Play interactions */}
                {h2hData.shared_games > 0 && (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-semibold">
                        Play Interactions — {h2hData.shared_games} shared game{h2hData.shared_games !== 1 ? "s" : ""}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        {[
                          { label: "Blocks", a: h2hData.interaction_summary.a_blocks_b, b: h2hData.interaction_summary.b_blocks_a, aPg: h2hData.interaction_summary.a_blocks_b_per_game, bPg: h2hData.interaction_summary.b_blocks_a_per_game },
                          { label: "Steals", a: h2hData.interaction_summary.a_steals_b, b: h2hData.interaction_summary.b_steals_a, aPg: h2hData.interaction_summary.a_steals_b_per_game, bPg: h2hData.interaction_summary.b_steals_a_per_game },
                        ].map(({ label, a, b, aPg, bPg }) => (
                          <div key={label} className="rounded-lg border p-3 space-y-1">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                            <span className={cn("block", a > b ? "font-bold text-emerald-600" : "text-muted-foreground")}>{nameA}: {a} ({aPg}/g)</span>
                            <span className={cn("block", b > a ? "font-bold text-emerald-600" : "text-muted-foreground")}>{nameB}: {b} ({bPg}/g)</span>
                          </div>
                        ))}
                      </div>
                      {h2hData.interactions.length > 0 && (
                        <div className="mt-4">
                          <button onClick={() => setShowH2hPlays((s) => !s)} className="flex items-center gap-1 text-sm text-primary font-semibold">
                            {showH2hPlays ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            Play log ({h2hData.interactions.length} plays)
                          </button>
                          {showH2hPlays && (
                            <div className="mt-2 space-y-1 max-h-72 overflow-y-auto">
                              {h2hData.interactions.map((ix, i) => (
                                <div key={i} className="text-xs px-3 py-2 rounded-md bg-muted/40 flex gap-3">
                                  <span className="text-muted-foreground shrink-0">Q{ix.period} {ix.clock}</span>
                                  <span className={cn("font-semibold shrink-0 capitalize", ix.action === "blocked" ? "text-red-500" : ix.action === "stole" ? "text-amber-500" : "text-emerald-500")}>{ix.action}</span>
                                  <span className="text-muted-foreground">{ix.description}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {h2hData.shared_games === 0 && (
                  <p className="text-muted-foreground text-sm">No shared games found this season — players may be on the same team or haven't faced each other yet.</p>
                )}
              </div>
            );
          })()}
        </TabsContent>

        {/* ── Saved Predictions ── */}
        <TabsContent value="saved" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">{savedPredictions.length} saved prediction{savedPredictions.length !== 1 ? "s" : ""}</p>
            <Button size="sm" variant="outline" onClick={() => {
              if (playerId) { setSavedLoading(true); api.getSavedPredictions(playerId).then((d) => { setSavedPredictions(d); setSavedLoading(false); }); }
            }}>Refresh</Button>
          </div>

          {savedLoading && <p className="text-muted-foreground text-sm py-4 text-center">Loading…</p>}

          {!savedLoading && savedPredictions.length === 0 && (
            <p className="text-muted-foreground text-sm py-4 text-center">No saved predictions yet — run a prediction and click Save.</p>
          )}

          {savedPredictions.map((sp) => {
            const pts = sp.props["PTS"];
            const reb = sp.props["REB"];
            const ast = sp.props["AST"];
            const projPts  = sp.adjusted_pts ?? pts?.expected ?? null;
            const projReb  = reb?.expected ?? null;
            const projAst  = ast?.expected ?? null;
            const actPts   = sp.actual_stats?.["PTS"] ?? null;
            const actReb   = sp.actual_stats?.["REB"] ?? null;
            const actAst   = sp.actual_stats?.["AST"] ?? null;
            const isActualsOpen = actualsTarget?.id === sp.id;
            const isBetsOpen = betsTarget?.id === sp.id;

            const DiffCell = ({ proj, actual }: { proj: number | null; actual: number | null }) => {
              if (proj === null) return <span className="text-muted-foreground">—</span>;
              if (actual === null) return <span className="font-semibold">{proj}</span>;
              const diff = actual - proj;
              return (
                <span>
                  <span className="font-semibold">{proj}</span>
                  <span className={cn("text-xs ml-1", diff > 0 ? "text-emerald-500" : diff < 0 ? "text-red-500" : "text-muted-foreground")}>
                    →{actual} ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                  </span>
                </span>
              );
            };

            return (
              <Card key={sp.id}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        {sp.game_label && (
                          <Badge variant="outline" className="text-xs font-bold text-primary border-primary">{sp.game_label}</Badge>
                        )}
                        <CardTitle className="text-sm font-semibold">
                          vs {sp.opponent}
                        </CardTitle>
                        <span className="text-xs text-muted-foreground">{new Date(sp.created_at).toLocaleDateString()}</span>
                      </div>
                      <div className="flex gap-1.5 flex-wrap mt-1">
                        {sp.without_teammate_names.length > 0 && (
                          <span className="text-xs text-muted-foreground">w/o {sp.without_teammate_names.join(", ")}</span>
                        )}
                        {sp.excluded_defender_ids.length > 0 && (
                          <span className="text-xs text-amber-600">{sp.excluded_defender_ids.length} defender{sp.excluded_defender_ids.length !== 1 ? "s" : ""} excluded</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        onClick={() => {
                          if (isActualsOpen) { setActualsTarget(null); setActualsInput({}); }
                          else { setActualsTarget(sp); setActualsInput(
                            PROPS.reduce((a, p) => ({ ...a, [p]: sp.actual_stats?.[p]?.toString() ?? "" }), {})
                          ); }
                        }}
                      >
                        {sp.actual_stats ? "Edit Actuals" : "Record Actuals"}
                      </Button>
                      <Button size="sm" variant="outline" className="text-xs h-7"
                        onClick={() => {
                          if (isBetsOpen) { setBetsTarget(null); setBetsInput({}); }
                          else {
                            setBetsTarget(sp);
                            const init: Record<string, { line: string; pick: "OVER" | "UNDER" }> = {};
                            BET_COMBOS.forEach((c) => {
                              const existing = sp.bets?.find((b) => b.stat === c);
                              init[c] = { line: existing?.line?.toString() ?? "", pick: existing?.pick ?? "OVER" };
                            });
                            setBetsInput(init);
                          }
                        }}
                      >
                        {sp.bets ? "Edit Bets" : "Add Bets"}
                      </Button>
                      <Button size="sm" variant="ghost" className="text-xs h-7 text-red-500 hover:text-red-600"
                        onClick={() => api.deletePrediction(sp.id).then(() => setSavedPredictions((prev) => prev.filter((p) => p.id !== sp.id)))}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* PTS / REB / AST summary */}
                  <div className="grid grid-cols-3 gap-3">
                    {([["PTS", projPts, actPts], ["REB", projReb, actReb], ["AST", projAst, actAst]] as [string, number|null, number|null][]).map(([label, proj, actual]) => (
                      <div key={label} className="rounded-lg border p-3 text-center">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                        <DiffCell proj={proj} actual={actual} />
                      </div>
                    ))}
                  </div>

                  {/* Full stat table if actuals exist */}
                  {sp.actual_stats && (
                    <div className="rounded-lg border table-scroll">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            {([["_prop","Stat"],["proj","Projected"],["actual","Actual"],["diff","Diff"]] as [string,string][]).map(([key,label]) => (
                              <SortableHead key={key} label={label} sortKey={key} sort={savedActualsSort(sp.id)} onSort={(k) => toggleSavedActuals(sp.id, k)} className="text-xs uppercase tracking-wider" />
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(() => {
                            const srt = savedActualsSort(sp.id);
                            const rows = PROPS.map((p) => {
                              const proj = p === "PTS" ? (sp.adjusted_pts ?? sp.props[p]?.expected ?? null) : (sp.props[p]?.expected ?? null);
                              const actual = sp.actual_stats?.[p] ?? null;
                              return { _prop: p, proj, actual, diff: proj !== null && actual !== null ? actual - proj : null };
                            });
                            if (srt.key) {
                              rows.sort((a, b) => {
                                const av = (a as Record<string, unknown>)[srt.key!] ?? 0;
                                const bv = (b as Record<string, unknown>)[srt.key!] ?? 0;
                                const cmp = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv));
                                return srt.dir === "asc" ? cmp : -cmp;
                              });
                            }
                            return rows.map(({ _prop: p, proj, actual, diff }) => (
                              <TableRow key={p} className="hover:bg-muted/30">
                                <TableCell className="font-semibold text-sm">{p}</TableCell>
                                <TableCell className="text-muted-foreground">{proj?.toFixed(1) ?? "—"}</TableCell>
                                <TableCell className="font-semibold">{actual ?? "—"}</TableCell>
                                <TableCell>
                                  {diff !== null ? (
                                    <span className={cn("font-semibold text-sm", diff > 0 ? "text-emerald-500" : diff < 0 ? "text-red-500" : "text-muted-foreground")}>
                                      {diff > 0 ? "+" : ""}{diff.toFixed(1)}
                                    </span>
                                  ) : "—"}
                                </TableCell>
                              </TableRow>
                            ));
                          })()}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {/* Saved bets display */}
                  {sp.bets && sp.bets.length > 0 && !isBetsOpen && (
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                            <th className="text-left px-3 py-2">Stat</th>
                            <th className="px-3 py-2">Proj</th>
                            <th className="px-3 py-2">Line</th>
                            <th className="px-3 py-2">Pick</th>
                            {sp.actual_stats && <th className="px-3 py-2">Actual</th>}
                            {sp.actual_stats && <th className="px-3 py-2">Result</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {sp.bets.map((bet) => {
                            const proj = comboProjected(sp, bet.stat as BetCombo);
                            const actual = comboActual(sp, bet.stat as BetCombo);
                            const res = betResult(bet.pick, bet.line, actual);
                            return (
                              <tr key={bet.stat} className="border-t hover:bg-muted/20">
                                <td className="px-3 py-2 font-semibold">{bet.stat}</td>
                                <td className="px-3 py-2 text-center text-muted-foreground">{proj ?? "—"}</td>
                                <td className="px-3 py-2 text-center">{bet.line}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={cn("text-xs font-bold", bet.pick === "OVER" ? "text-emerald-500" : "text-red-500")}>{bet.pick}</span>
                                </td>
                                {sp.actual_stats && (
                                  <td className="px-3 py-2 text-center font-semibold">{actual ?? "—"}</td>
                                )}
                                {sp.actual_stats && (
                                  <td className="px-3 py-2 text-center">
                                    {res ? (
                                      <span className={cn("text-xs font-bold px-1.5 py-0.5 rounded", res === "WIN" ? "bg-emerald-100 text-emerald-700" : res === "LOSS" ? "bg-red-100 text-red-700" : "bg-muted text-muted-foreground")}>
                                        {res}
                                      </span>
                                    ) : "—"}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Bets input form */}
                  {isBetsOpen && (
                    <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter betting lines</p>
                      <div className="space-y-2">
                        {BET_COMBOS.map((combo) => {
                          const proj = comboProjected(sp, combo);
                          const entry = betsInput[combo] ?? { line: "", pick: "OVER" as const };
                          return (
                            <div key={combo} className="flex items-center gap-3">
                              <span className="text-sm font-semibold w-28 shrink-0">{combo}</span>
                              <span className="text-xs text-muted-foreground w-14 shrink-0">proj: {proj ?? "—"}</span>
                              <input
                                type="number"
                                step="0.5"
                                placeholder="Line"
                                value={entry.line}
                                onChange={(e) => setBetsInput((prev) => ({ ...prev, [combo]: { ...entry, line: e.target.value } }))}
                                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm text-center"
                              />
                              <div className="flex rounded-md border overflow-hidden text-xs font-semibold">
                                <button
                                  className={cn("px-2 py-1", entry.pick === "OVER" ? "bg-emerald-500 text-white" : "bg-background text-muted-foreground hover:bg-muted")}
                                  onClick={() => setBetsInput((prev) => ({ ...prev, [combo]: { ...entry, pick: "OVER" } }))}
                                >OVER</button>
                                <button
                                  className={cn("px-2 py-1", entry.pick === "UNDER" ? "bg-red-500 text-white" : "bg-background text-muted-foreground hover:bg-muted")}
                                  onClick={() => setBetsInput((prev) => ({ ...prev, [combo]: { ...entry, pick: "UNDER" } }))}
                                >UNDER</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => {
                          const bets: BetEntry[] = [];
                          BET_COMBOS.forEach((c) => {
                            const e = betsInput[c];
                            const line = parseFloat(e?.line ?? "");
                            if (!isNaN(line)) bets.push({ stat: c, line, pick: e.pick ?? "OVER" });
                          });
                          api.saveBets(sp.id, bets).then((updated) => {
                            setSavedPredictions((prev) => prev.map((x) => x.id === sp.id ? updated : x));
                            setBetsTarget(null); setBetsInput({});
                          });
                        }}>Save Bets</Button>
                        <Button size="sm" variant="outline" onClick={() => { setBetsTarget(null); setBetsInput({}); }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {/* Record actuals inline form */}
                  {isActualsOpen && (
                    <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Enter actual stats</p>
                      <div className="flex gap-2 flex-wrap">
                        {PROPS.map((p) => (
                          <div key={p} className="flex flex-col items-center gap-1">
                            <label className="text-xs text-muted-foreground">{p}</label>
                            <input
                              type="number"
                              value={actualsInput[p] ?? ""}
                              onChange={(e) => setActualsInput((prev) => ({ ...prev, [p]: e.target.value }))}
                              className="w-16 rounded-md border border-input bg-background px-2 py-1 text-sm text-center"
                            />
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => {
                          const stats: Record<string, number> = {};
                          PROPS.forEach((p) => { const v = parseFloat(actualsInput[p] ?? ""); if (!isNaN(v)) stats[p] = v; });
                          api.recordActuals(sp.id, stats).then((updated) => {
                            setSavedPredictions((prev) => prev.map((x) => x.id === sp.id ? updated : x));
                            setActualsTarget(null); setActualsInput({});
                          });
                        }}>Save Actuals</Button>
                        <Button size="sm" variant="outline" onClick={() => { setActualsTarget(null); setActualsInput({}); }}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Season: {sp.sample_sizes.season}g · vs {sp.opponent.split(" ").slice(-1)[0]}: {sp.sample_sizes.vs_opponent}g
                    {sp.sample_sizes.series > 0 && ` · series: ${sp.sample_sizes.series}g`}
                    {sp.sample_sizes.without_teammate !== null && ` · w/o: ${sp.sample_sizes.without_teammate}g`}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>

      </Tabs>
    </div>
  );
}
