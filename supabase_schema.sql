-- Run this in the Supabase SQL editor (Database > SQL Editor > New query)

-- ─── Profiles ────────────────────────────────────────────────────────────────
-- One row per user, auto-created on first sign-in via trigger below.
-- 'role' controls feature access: 'standard' | 'premium'
CREATE TABLE IF NOT EXISTS public.profiles (
  id         UUID    PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      TEXT,
  full_name  TEXT,
  role       TEXT    NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Auto-create profile on new sign-in
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ─── Bet Picks ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bet_picks (
  id              SERIAL PRIMARY KEY,
  user_id         UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  game_date       TEXT,
  game_label      TEXT,
  player_id       TEXT,
  player_name     TEXT    NOT NULL,
  prop            TEXT    NOT NULL,
  line            REAL    NOT NULL,
  pick            TEXT    NOT NULL,
  result          TEXT,
  actual_value    REAL,
  line_type       TEXT    NOT NULL DEFAULT 'standard',
  grade           TEXT,
  predicted_value REAL,
  notes           TEXT,
  prediction_id   INTEGER,
  kalshi_url      TEXT    -- kalshi.com page of the leg's market
);
ALTER TABLE public.bet_picks ADD COLUMN IF NOT EXISTS kalshi_url TEXT;

ALTER TABLE public.bet_picks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users CRUD own picks"
  ON public.bet_picks FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─── Predictions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.predictions (
  id                     SERIAL PRIMARY KEY,
  user_id                UUID    NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  player_id              TEXT    NOT NULL,
  player_name            TEXT    NOT NULL,
  season                 TEXT    NOT NULL,
  opponent               TEXT    NOT NULL,
  game_label             TEXT,
  without_teammate_ids   JSONB   NOT NULL DEFAULT '[]',
  without_teammate_names JSONB   NOT NULL DEFAULT '[]',
  excluded_defender_ids  JSONB   NOT NULL DEFAULT '[]',
  props                  JSONB   NOT NULL,
  sample_sizes           JSONB   NOT NULL,
  adjusted_pts           REAL,
  actual_stats           JSONB,
  bets                   JSONB,
  notes                  TEXT
);

ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users CRUD own predictions"
  ON public.predictions FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ─── Box Scores ──────────────────────────────────────────────────────────────
-- One row per player per finished game, synced from ESPN by box_score_service.
-- Read only by the backend (postgres role bypasses RLS); RLS with no policies
-- keeps it off the public REST API.
CREATE TABLE IF NOT EXISTS public.box_scores (
  game_id     TEXT     NOT NULL,
  game_date   DATE     NOT NULL,            -- US date the game was played (not UTC)
  season      TEXT     NOT NULL,            -- end year, e.g. '2027' for 2026-27
  season_type SMALLINT NOT NULL,            -- 2 regular, 3 postseason
  team_abbr   TEXT     NOT NULL,
  opp_abbr    TEXT     NOT NULL,
  player_id   TEXT     NOT NULL,            -- ESPN athlete id
  player_name TEXT     NOT NULL,
  position    TEXT,                         -- G / F / C
  starter     BOOLEAN  NOT NULL,
  min REAL, pts REAL, reb REAL, ast REAL, fg3m REAL, fg3a REAL, stl REAL, blk REAL,
  fgm REAL, fga REAL, ftm REAL, fta REAL, oreb REAL, dreb REAL, tov REAL, pf REAL,
  PRIMARY KEY (game_id, player_id)
);

ALTER TABLE public.box_scores ENABLE ROW LEVEL SECURITY;


-- ─── Kalshi Quotes ───────────────────────────────────────────────────────────
-- Last pregame quote per Kalshi player-prop contract: kalshi_snapshot_service
-- overwrites each row every 15 min until tip-off, then leaves it alone.
CREATE TABLE IF NOT EXISTS public.kalshi_quotes (
  ticker       TEXT        PRIMARY KEY,     -- e.g. KXNBAPTS-26NOV18MILMIA-MIAKTHOMPSON11-30
  event_ticker TEXT        NOT NULL,
  game_date    DATE        NOT NULL,        -- US date from the ticker
  tip_time     TIMESTAMPTZ NOT NULL,        -- from ESPN's scoreboard
  player_name  TEXT        NOT NULL,
  stat         TEXT        NOT NULL,        -- PTS / REB / ... / PTS+REB+AST
  strike       REAL        NOT NULL,        -- YES pays if stat > strike
  yes_bid      REAL,
  yes_ask      REAL,
  last_price   REAL,
  captured_at  TIMESTAMPTZ NOT NULL
);

ALTER TABLE public.kalshi_quotes ENABLE ROW LEVEL SECURITY;

-- ─── Model Picks ──────────────────────────────────────────────────────────────
-- The app's grade for every player prop before each game (pick_log_service.py), for the
-- money test. final_* = last check before tip-off; best_* = highest grade reached that day.
CREATE TABLE IF NOT EXISTS public.model_picks (
  game_date      DATE        NOT NULL,        -- US Eastern date
  game_id        TEXT        NOT NULL,        -- ESPN event id
  tip_time       TIMESTAMPTZ NOT NULL,
  player_id      TEXT        NOT NULL,
  player_name    TEXT        NOT NULL,
  team_abbr      TEXT,
  prop           TEXT        NOT NULL,        -- PTS / REB / ... / PTS+REB+AST
  expected       REAL,
  season_hits    INTEGER,                     -- final pick's side won in this many games this season
  season_n       INTEGER,
  final_warnings TEXT,
  final_grade    TEXT, final_ticker TEXT, final_side TEXT, final_strike REAL, final_price REAL,
  final_prob     REAL, final_edge   REAL, final_top_pick BOOLEAN, final_at TIMESTAMPTZ,
  best_grade     TEXT, best_ticker  TEXT, best_side  TEXT, best_strike  REAL, best_price  REAL,
  best_prob      REAL, best_edge    REAL, best_top_pick  BOOLEAN, best_at  TIMESTAMPTZ,
  confidence     TEXT,                        -- high / medium / low at the last check (SOLID+ needs high)
  season_games   INTEGER,                     -- games this season at the last check (any grade needs 10+)
  PRIMARY KEY (game_id, player_id, prop)
);
ALTER TABLE public.model_picks ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE public.model_picks ADD COLUMN IF NOT EXISTS season_games INTEGER;

ALTER TABLE public.model_picks ENABLE ROW LEVEL SECURITY;

-- Every pregame change to a prop's grade, contract or side, so the money test can replay
-- "bet when a pick first turned SOLID" (model_picks keeps only final and best).
CREATE TABLE IF NOT EXISTS public.model_pick_history (
  game_id     TEXT        NOT NULL,
  player_id   TEXT        NOT NULL,
  prop        TEXT        NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL,
  game_date   DATE        NOT NULL,
  player_name TEXT        NOT NULL,
  grade       TEXT        NOT NULL,
  ticker      TEXT,
  side        TEXT,
  strike      REAL,
  price       REAL,
  prob        REAL,
  edge        REAL,
  top_pick    BOOLEAN,
  confidence   TEXT,
  season_games INTEGER,
  warnings     TEXT,
  PRIMARY KEY (game_id, player_id, prop, changed_at)
);
ALTER TABLE public.model_pick_history ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE public.model_pick_history ADD COLUMN IF NOT EXISTS season_games INTEGER;
ALTER TABLE public.model_pick_history ADD COLUMN IF NOT EXISTS warnings TEXT;

ALTER TABLE public.model_pick_history ENABLE ROW LEVEL SECURITY;


-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS box_scores_opp_date_idx    ON public.box_scores(opp_abbr, game_date);
CREATE INDEX IF NOT EXISTS bet_picks_user_id_idx      ON public.bet_picks(user_id);
CREATE INDEX IF NOT EXISTS bet_picks_game_date_idx    ON public.bet_picks(game_date);
CREATE INDEX IF NOT EXISTS predictions_user_id_idx    ON public.predictions(user_id);
CREATE INDEX IF NOT EXISTS predictions_player_id_idx  ON public.predictions(player_id);
