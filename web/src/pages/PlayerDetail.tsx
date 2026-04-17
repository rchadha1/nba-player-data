import { useEffect, useState } from "react";
import { useParams, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "../api/client";
import type { GameLog, PropAnalysis, Team, WithoutSplit, GamePrediction } from "../api/client";
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
              <TableCell className="text-muted-foreground text-sm">{g.date}</TableCell>
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

  useEffect(() => {
    if (!playerId) return;
    api.getGameLog(playerId).then((data) => { setGamelog(data); setGamelogLoading(false); });
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

  const seasonAvgs = PROPS.reduce<Record<string, number | null>>((acc, p) => {
    acc[p] = statAvg(gamelog, p);
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

            <Select value={teammate?.id ?? ""} onValueChange={(val) => {
              const t = teammates.find((p) => p.id === val) ?? null;
              setTeammate(t); setPrediction(null);
              if (t && playerId) {
                setWithoutLoading(true);
                api.getWithoutSplit(playerId, t.id).then((d) => { setWithoutSplit(d); setWithoutLoading(false); });
              }
            }}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Missing teammate…" /></SelectTrigger>
              <SelectContent>
                {teammates.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {(!opponent || !teammate) && (
            <p className="text-muted-foreground text-sm">Select an opponent and a missing teammate to generate a prediction.</p>
          )}

          {opponent && teammate && (
            <>
              <Button
                onClick={() => {
                  if (!playerId) return;
                  setPredicting(true); setPrediction(null);
                  api.predictGame({ player_id: playerId, opponent: opponent.display_name, without_teammate_id: teammate.id })
                    .then((d) => { setPrediction(d); setPredicting(false); });
                }}
                disabled={predicting}
                className="gap-2"
              >
                {predicting ? "Calculating…" : `Predict ${playerName} vs ${opponent.short_name}`}
              </Button>

              {prediction && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      {playerName} vs {opponent.display_name}
                      <span className="text-muted-foreground font-normal text-sm ml-2">without {teammate.full_name}</span>
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Season: {prediction.sample_sizes.season}g &nbsp;·&nbsp;
                      vs {opponent.short_name}: {prediction.sample_sizes.vs_opponent}g &nbsp;·&nbsp;
                      w/o {teammate.full_name.split(" ").slice(-1)[0]}: {prediction.sample_sizes.without_teammate}g &nbsp;·&nbsp;
                      intersection: {prediction.sample_sizes.intersection}g
                    </p>
                  </CardHeader>
                  <CardContent>
                    {PROPS.some((p) => prediction.props[p]?.wo_direction_warning) && (
                      <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800">
                        ⚠️ The "without {teammate.full_name.split(" ").slice(-1)[0]}" sample shows <strong>lower</strong> averages for some stats than the season baseline — possible selection bias (load management, back-to-backs). Check sample games below.
                      </div>
                    )}

                    <div className="rounded-lg border overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            {["Stat", "Season", `vs ${opponent.short_name}`, `w/o ${teammate.full_name.split(" ").slice(-1)[0]}`, "Projected", "Confidence"].map((h) => (
                              <TableHead key={h} className="text-xs uppercase tracking-wider">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {PROPS.map((p) => {
                            const row = prediction.props[p];
                            if (!row) return null;
                            const diff = row.expected - row.season_avg;
                            return (
                              <TableRow key={p} className="hover:bg-muted/30">
                                <TableCell className="font-semibold">{p}</TableCell>
                                <TableCell className="text-muted-foreground">{row.season_avg}</TableCell>
                                <TableCell>{row.vs_opponent_avg}</TableCell>
                                <TableCell>{row.without_teammate_avg}</TableCell>
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
                        <button
                          onClick={() => setShowSampleGames((s) => !s)}
                          className="flex items-center gap-1 text-sm text-primary font-semibold"
                        >
                          {showSampleGames ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          Games without {teammate.full_name} ({prediction.without_teammate_games.length})
                        </button>
                        {showSampleGames && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {prediction.without_teammate_games.map((g, i) => (
                              <span
                                key={i}
                                className={cn(
                                  "text-xs px-2 py-1 rounded-full font-medium",
                                  g.result === "W" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200"
                                )}
                              >
                                {g.date} · {g.matchup} · {g.result}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground mt-4">
                      Projection uses additive adjustment with Bayesian shrinkage — each factor only moves the baseline proportional to its sample size. Low confidence = treat as directional only.
                    </p>
                  </CardContent>
                </Card>
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
      </Tabs>
    </div>
  );
}
