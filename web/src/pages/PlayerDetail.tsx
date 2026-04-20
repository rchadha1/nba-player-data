import { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api/client";
import type { GameLog, PropAnalysis, Team, WithoutSplit, GamePrediction, H2HResult, PlayerResult, DefenderRow, MatchupStats } from "../api/client";
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

const PROPS = ["PTS", "REB", "AST", "STL", "BLK", "3PT"];

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

function GameLogTable({ games }: { games: GameLog[] }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            {["Date", "Matchup", "W/L", "MIN", "PTS", "REB", "AST", "STL", "BLK", "3PT"].map((h) => (
              <TableHead key={h} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {games.length === 0 && (
            <TableRow>
              <TableCell colSpan={10} className="text-center text-muted-foreground py-8">
                No games found
              </TableCell>
            </TableRow>
          )}
          {games.map((g, i) => (
            <TableRow key={i} className="hover:bg-muted/30 transition-colors">
              <TableCell className="text-muted-foreground text-sm">{formatDate(g.date)}</TableCell>
              <TableCell className="font-medium text-sm">{g.matchup}</TableCell>
              <TableCell>
                <Badge
                  variant={g.result === "W" ? "default" : "destructive"}
                  className={cn(
                    "text-xs font-bold",
                    g.result === "W" ? "bg-emerald-500 hover:bg-emerald-600" : ""
                  )}
                >
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
  const [defSort, setDefSort] = useState<"misses" | "fga" | "fg_pct">("misses");

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
    api.getTeammates(playerId).then(setTeammates);
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

  // Recompute PTS projection client-side when defenders are toggled out
  function computeAdjustedPts(pred: GamePrediction, excluded: Set<string>) {
    const dm = pred.defender_matchup;
    const ptsRow = pred.props["PTS"];
    if (!ptsRow) return null;
    const base = ptsRow.expected - (ptsRow.defender_adj ?? 0);
    const remaining = dm.defenders.filter((d) => !excluded.has(d.defender_id));
    const totalFga  = remaining.reduce((s, d) => s + d.fga, 0);
    const totalFgm  = remaining.reduce((s, d) => s + d.fgm, 0);
    const totalPoss = remaining.reduce((s, d) => s + d.partial_poss, 0);
    if (totalFga === 0 || !dm.season_fg_pct) return { expected: base, def_adj: 0, team_fg_pct: 0, total_poss: 0 };
    const teamFgPct = totalFgm / totalFga;
    const defFactor = teamFgPct / dm.season_fg_pct;
    const defW      = totalPoss / (totalPoss + 50);
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
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{playerName}</h1>
        <p className="text-muted-foreground text-sm mt-1">2025–26 Season</p>
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
                <div className="rounded-lg border overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="text-xs uppercase tracking-wider">Stat</TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-center">
                          With {teammate.full_name.split(" ").slice(-1)[0]}
                          <span className="text-muted-foreground font-normal ml-1">({withoutSplit.with_teammate.games}g)</span>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-center">
                          Without {teammate.full_name.split(" ").slice(-1)[0]}
                          <span className="text-muted-foreground font-normal ml-1">({withoutSplit.without_teammate.games}g)</span>
                        </TableHead>
                        <TableHead className="text-xs uppercase tracking-wider text-center">Diff</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PROPS.map((p) => {
                        const w = withoutSplit.with_teammate.averages[p] ?? 0;
                        const wo = withoutSplit.without_teammate.averages[p] ?? 0;
                        const diff = wo - w;
                        return (
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
                        );
                      })}
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
          </div>

          {!opponent && (
            <p className="text-muted-foreground text-sm">Select an opponent to generate a prediction.</p>
          )}

          {opponent && (
            <>
              <Button
                onClick={() => {
                  if (!playerId) return;
                  setPredicting(true); setPrediction(null);
                  api.predictGame({
                    player_id: playerId,
                    opponent: opponent.display_name,
                    without_teammate_ids: missingTeammates.length > 0 ? missingTeammates.map((t) => t.id) : undefined,
                  }).then((d) => { setPrediction(d); setPredicting(false); setExcludedDefenders(new Set()); });
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
                      {PROPS.some((p) => prediction.props[p]?.wo_direction_warning) && woLabel && (
                        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                          ⚠️ The "without {woLabel}" sample shows <strong>lower</strong> averages for some stats than the season baseline — possible selection bias (load management, back-to-backs). Check sample games below.
                        </div>
                      )}

                      <div className="rounded-lg border overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-muted/50">
                              {["Stat", "Season", `vs ${opponent.short_name}`, "Series", woLabel ? `w/o ${woLabel}` : "W/O", "Last 5★", "Def Adj", "Projected", "Confidence"].map((h) => (
                                <TableHead key={h} className="text-xs uppercase tracking-wider">{h}</TableHead>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {PROPS.map((p) => {
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
                                  <TableCell>
                                    <span className={cn("font-bold text-base", diff > 0.5 ? "text-emerald-500" : diff < -0.5 ? "text-red-500" : "")}>
                                      {row.expected}
                                    </span>
                                    <span className={cn("text-xs ml-1", diff > 0 ? "text-emerald-500" : "text-red-500")}>
                                      ({diff > 0 ? "+" : ""}{diff.toFixed(1)})
                                    </span>
                                  </TableCell>
                                  <TableCell><ConfidenceBadge level={row.confidence} /></TableCell>
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
                        Series = games in current series (K=3, overrides history quickly). Last 5★ = recency-weighted (most recent game counts most). Def Adj = possession-level FG% vs {opponent.short_name} defenders (PTS only).
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
                          <div className="rounded-lg border overflow-hidden">
                            <Table>
                              <TableHeader>
                                <TableRow className="bg-muted/50">
                                  {["", "Defender", "Poss", "FGA", "Misses", "FG%", "Pts allowed"].map((h) => (
                                    <TableHead key={h} className="text-xs uppercase tracking-wider">{h}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {dm.defenders.map((d) => {
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
                  {(["misses","fga","fg_pct"] as const).map((s) => (
                    <Button key={s} size="sm" variant={defSort === s ? "default" : "outline"}
                      onClick={() => setDefSort(s)}
                      className="text-xs h-7 px-2"
                    >
                      {s === "misses" ? "Misses" : s === "fga" ? "FGA" : "FG%"}
                    </Button>
                  ))}
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
                const sorted = [...defBreakdown].sort((a, b) => {
                  if (defSort === "fg_pct") return a.fg_pct - b.fg_pct;
                  return b[defSort] - a[defSort];
                });
                return (
                  <>
                    <p className="text-xs text-muted-foreground mb-2">{label} · {defBreakdown.length} defenders</p>
                    <div className="rounded-lg border overflow-hidden max-h-72 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50 sticky top-0">
                            {["Defender","FGA","FGM","Misses","FG%","Pts","Time"].map((h) => (
                              <TableHead key={h} className="text-xs uppercase tracking-wider">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sorted.slice(0, 20).map((d) => (
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
                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead className="text-xs uppercase tracking-wider">Stat</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider text-center">{playerName}</TableHead>
                            <TableHead className="text-xs uppercase tracking-wider text-center">{h2hOpponent.full_name}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(["PTS","REB","AST","STL","BLK","TOV","FG_PCT","FG3_PCT"] as const).map((stat) => {
                            const a = h2hData.player_a_box.per_game?.[stat] ?? 0;
                            const b = h2hData.player_b_box.per_game?.[stat] ?? 0;
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

      </Tabs>
    </div>
  );
}
