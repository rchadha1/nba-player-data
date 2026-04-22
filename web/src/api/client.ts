const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export interface PlayerResult {
  id: string;         // ESPN athlete ID
  full_name: string;
}

export interface Team {
  id: string;
  abbreviation: string;
  display_name: string;
  short_name: string;
  logo: string;
}

export interface GameLog {
  game_id: string;
  date: string;
  matchup: string;
  home_away: string;
  result: string;
  opponent_abbr: string;
  opponent_name: string;
  MIN: string;
  PTS: string;
  REB: string;
  AST: string;
  STL: string;
  BLK: string;
  "3PT": string;
  [key: string]: string;
}

export interface PlayByPlayEvent {
  id: string;
  sequence: number;
  period: number;
  clock: string;
  type: string;
  description: string;
  home_score: number;
  away_score: number;
  scoring_play: boolean;
  score_value: number;
  participants: string[];
}

export interface PropRequest {
  player_id: string;
  prop: string;
  line: number;
  last_n_games?: number;
  season?: string;
  opponent?: string;   // full team name, e.g. "Houston Rockets"
}

export interface PropPrediction {
  season_avg: number;
  vs_opponent_avg: number;
  without_teammate_avg: number;
  last5_avg: number;
  series_avg: number | null;
  intersection_avg: number | null;
  defender_adj: number | null;
  location_avg: number | null;
  series_correction: number | null;
  player_bias: number | null;
  pace_factor: number | null;
  expected: number;
  confidence: "high" | "medium" | "low";
  wo_direction_warning: boolean;
}

export interface DefenderMatchup {
  season_used: string | null;
  team_fg_pct: number | null;
  season_fg_pct: number;
  def_factor: number;
  total_poss: number;
  defenders: {
    defender_name: string;
    defender_id: string;
    partial_poss: number;
    fgm: number;
    fga: number;
    misses: number;
    fg_pct: number;
    pts: number;
  }[];
}

export interface PaceInfo {
  player_season_pace: number | null;
  matchup_pace: number | null;
  pace_ratio: number;
  source: "playoffs" | "regular_season" | "none";
}

export interface MinutesFlag {
  warning: boolean;
  season_avg_min: number;
  last_series_min: number | null;
  last5_avg_min: number | null;
  series_game_mins: number[];
}

export interface FoulTroubleGame {
  game_id: string;
  fouls_by_quarter: Record<string, number>;
  total_fouls: number;
  early_foul: boolean;
}

export interface FoulTrouble {
  avg_fouls: number;
  early_foul_games: number;
  games: FoulTroubleGame[];
  warning: boolean;
}

export interface ShotZoneDist {
  paint: number;
  mid: number;
  three: number;
  total_attempts: number;
}

export interface ShotZones {
  series: ShotZoneDist;
  baseline: ShotZoneDist;
  drift: { paint: number; mid: number; three: number };
  paint_drift_warning: boolean;
}

export interface GamePrediction {
  player_id: string;
  opponent: string;
  minutes_flag: MinutesFlag;
  pace_info: PaceInfo;
  foul_trouble: FoulTrouble | null;
  shot_zones: ShotZones | null;
  sample_sizes: {
    season: number;
    vs_opponent: number;
    series: number;
    without_teammate: number | null;
    intersection: number | null;
    last5: number;
    def_poss: number;
  };
  defender_matchup: DefenderMatchup;
  props: Record<string, PropPrediction>;
  without_teammate_games: { date: string; matchup: string; result: string }[];
}

export interface WithoutSplit {
  with_teammate: {
    games: number;
    averages: Record<string, number>;
  };
  without_teammate: {
    games: number;
    averages: Record<string, number>;
  };
}

export interface MatchupStats {
  season: string;
  season_type: string;
  games: number;
  matchup_min: string;
  partial_poss: number;
  pts_total: number;
  pts_per_game: number;
  pts_per_100_poss: number;
  fgm: number;
  fga: number;
  misses: number;
  fg_pct: number;
  fg3m: number;
  fg3a: number;
  fg3_pct: number;
  turnovers: number;
  blocks: number;
}

export interface DefenderRow extends MatchupStats {
  defender_id: string;
  defender_name: string;
}

export interface H2HBoxStats {
  games: number;
  wins: number;
  losses: number;
  per_game: {
    PTS: number;
    REB: number;
    AST: number;
    STL: number;
    BLK: number;
    FG_PCT: number;
    FG3_PCT: number;
    TOV: number;
    MIN: number;
  };
}

export interface H2HInteraction {
  game_id: string;
  date: string;
  period: number;
  clock: string;
  actor_id: string;
  action: "blocked" | "stole" | "assisted";
  target_id: string;
  description: string;
  score_value: number;
}

export interface H2HResult {
  player_a_id: string;
  player_b_id: string;
  shared_games: number;
  player_a_box: H2HBoxStats;
  player_b_box: H2HBoxStats;
  a_scores_on_b: MatchupStats | Record<string, never>;
  b_scores_on_a: MatchupStats | Record<string, never>;
  interaction_summary: {
    a_blocks_b: number;
    b_blocks_a: number;
    a_steals_b: number;
    b_steals_a: number;
    a_assists_b: number;
    b_assists_a: number;
    a_blocks_b_per_game: number;
    b_blocks_a_per_game: number;
    a_steals_b_per_game: number;
    b_steals_a_per_game: number;
  };
  interactions: H2HInteraction[];
}

export interface PropAnalysis {
  player_id: string;
  prop: string;
  line: number;
  last_n_games: number;
  opponent: string | null;
  games_found: number;
  average: number;
  hit_rate: number;
  recommendation: "OVER" | "UNDER" | "PASS";
  game_values: number[];
}

export interface BetEntry {
  stat: string;   // "PTS", "REB+AST", etc.
  line: number;
  pick: "OVER" | "UNDER";
  result?: "WIN" | "LOSS" | "PUSH";
}

export interface SavedPrediction {
  id: number;
  created_at: string;
  player_id: string;
  player_name: string;
  season: string;
  opponent: string;
  game_label: string | null;
  without_teammate_ids: string[];
  without_teammate_names: string[];
  excluded_defender_ids: string[];
  props: Record<string, PropPrediction>;
  sample_sizes: GamePrediction["sample_sizes"];
  adjusted_pts: number | null;
  actual_stats: Record<string, number> | null;
  bets: BetEntry[] | null;
  notes: string | null;
}

export interface TodayGame {
  id: string;
  name: string;
  status_state: "pre" | "in" | "post";
  status_detail: string;
  status_period: number;
  status_short: string;
  completed: boolean;
  home_team_id: string;
  home_abbr: string;
  home_name: string;
  home_short: string;
  home_logo: string;
  home_score: string;
  home_record: string;
  away_team_id: string;
  away_abbr: string;
  away_name: string;
  away_short: string;
  away_logo: string;
  away_score: string;
  away_record: string;
}

export interface GameRosterPlayer {
  id: string;
  name: string;
  status: string;
  comment: string;
}

export interface GameRosterTeam {
  team_id: string;
  abbr: string;
  name: string;
  short_name: string;
  logo: string;
  players: GameRosterPlayer[];
}

export interface GameRoster {
  [abbr: string]: GameRosterTeam;
}

export interface SavePredictionRequest {
  player_id: string;
  player_name: string;
  season: string;
  opponent: string;
  game_label?: string;
  without_teammate_ids: string[];
  without_teammate_names: string[];
  excluded_defender_ids: string[];
  props: Record<string, PropPrediction>;
  sample_sizes: GamePrediction["sample_sizes"];
  adjusted_pts?: number;
  notes?: string;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  searchPlayers: (name: string) =>
    request<PlayerResult[]>(`/api/players/search?name=${encodeURIComponent(name)}`),

  getGameLog: (playerId: string, season = "2026") =>
    request<GameLog[]>(`/api/players/${playerId}/gamelog?season=${season}`),

  getSeasonAverages: (playerId: string, season = "2026") =>
    request<Record<string, number>>(`/api/players/${playerId}/season-averages?season=${season}`),

  getMatchupLog: (playerId: string, opponent: string, season = "2026") =>
    request<GameLog[]>(
      `/api/players/${playerId}/vs?opponent=${encodeURIComponent(opponent)}&season=${season}`
    ),

  getTeams: () =>
    request<Team[]>("/api/teams"),

  getTeammates: (playerId: string) =>
    request<PlayerResult[]>(`/api/players/${playerId}/teammates`),

  getHeadshot: (playerId: string) =>
    request<{ url: string }>(`/api/players/${playerId}/headshot`),

  getPrizePicks: (playerId: string, playerName: string) =>
    request<Record<string, number>>(`/api/players/${playerId}/prizepicks?player_name=${encodeURIComponent(playerName)}`),

  getTeamInjuries: (playerId: string) =>
    request<{ id: string; full_name: string; short_name: string; status: string; comment: string }[]>(
      `/api/players/${playerId}/team-injuries`
    ),

  getWithoutSplit: (playerId: string, teammateId: string, season = "2026") =>
    request<WithoutSplit>(`/api/players/${playerId}/without/${teammateId}?season=${season}`),

  getPlayByPlay: (gameId: string) =>
    request<PlayByPlayEvent[]>(`/api/events/${gameId}`),

  predictGame: (body: { player_id: string; opponent: string; without_teammate_ids?: string[]; season?: string; is_home?: boolean }) =>
    request<GamePrediction>("/api/bets/predict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  analyzeProp: (body: PropRequest) =>
    request<PropAnalysis>("/api/bets/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getH2H: (playerAId: string, playerBId: string, season = "2026") =>
    request<H2HResult>(`/api/players/${playerAId}/h2h/${playerBId}?season=${season}`),

  getDefenderBreakdown: (playerId: string, season = "2026") =>
    request<DefenderRow[]>(`/api/players/${playerId}/defender-breakdown?season=${season}`),

  savePrediction: (body: SavePredictionRequest) =>
    request<SavedPrediction>("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),

  getSavedPredictions: (playerId: string) =>
    request<SavedPrediction[]>(`/api/predictions?player_id=${playerId}`),

  recordActuals: (id: number, actual_stats: Record<string, number>) =>
    request<SavedPrediction>(`/api/predictions/${id}/actuals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actual_stats }),
    }),

  saveBets: (id: number, bets: BetEntry[]) =>
    request<SavedPrediction>(`/api/predictions/${id}/bets`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bets }),
    }),

  deletePrediction: (id: number) =>
    request<void>(`/api/predictions/${id}`, { method: "DELETE" }),

  getTodayGames: () =>
    request<TodayGame[]>("/api/games/today"),

  getGameRoster: (gameId: string) =>
    request<GameRoster>(`/api/games/${gameId}/roster`),
};
