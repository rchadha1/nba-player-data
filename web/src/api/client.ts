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
  intersection_avg: number | null;
  expected: number;
  confidence: "high" | "medium" | "low";
  wo_direction_warning: boolean;
}

export interface GamePrediction {
  player_id: string;
  opponent: string;
  sample_sizes: {
    season: number;
    vs_opponent: number;
    without_teammate: number | null;
    intersection: number | null;
  };
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

  getMatchupLog: (playerId: string, opponent: string, season = "2026") =>
    request<GameLog[]>(
      `/api/players/${playerId}/vs?opponent=${encodeURIComponent(opponent)}&season=${season}`
    ),

  getTeams: () =>
    request<Team[]>("/api/teams"),

  getTeammates: (playerId: string) =>
    request<PlayerResult[]>(`/api/players/${playerId}/teammates`),

  getWithoutSplit: (playerId: string, teammateId: string, season = "2026") =>
    request<WithoutSplit>(`/api/players/${playerId}/without/${teammateId}?season=${season}`),

  getPlayByPlay: (gameId: string) =>
    request<PlayByPlayEvent[]>(`/api/events/${gameId}`),

  predictGame: (body: { player_id: string; opponent: string; without_teammate_id?: string; season?: string }) =>
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
};
