// Mirror of web/src/api/client.ts — keep in sync or extract to shared package
const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export const api = {
  searchPlayers: (name: string) =>
    request<PlayerResult[]>(`/api/players/search?name=${encodeURIComponent(name)}`),

  getGameLog: (playerId: number, season = "2026") =>
    request<GameLog[]>(`/api/players/${playerId}/gamelog?season=${season}`),

  getMatchupLog: (playerId: number, opponent: string, season = "2026") =>
    request<GameLog[]>(
      `/api/players/${playerId}/vs?opponent=${encodeURIComponent(opponent)}&season=${season}`
    ),

  getTeams: () =>
    request<Team[]>("/api/teams"),

  analyzeProp: (body: PropRequest) =>
    request<PropAnalysis>("/api/bets/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
};

export interface PlayerResult {
  id: number;
  full_name: string;
}

export interface GameLog {
  GAME_DATE: string;
  MATCHUP: string;
  WL: string;
  PTS: number;
  REB: number;
  AST: number;
  STL: number;
  BLK: number;
  FG3M: number;
  MIN: string;
}

export interface Team {
  id: string;
  abbreviation: string;
  display_name: string;
  short_name: string;
  logo: string;
}

export interface PropRequest {
  player_id: number;
  prop: string;
  line: number;
  last_n_games?: number;
  season?: string;
  opponent?: string;
}

export interface PropAnalysis {
  player_id: number;
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
