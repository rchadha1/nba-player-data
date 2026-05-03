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
  prediction_id   INTEGER
);

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


-- ─── Indexes ─────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS bet_picks_user_id_idx      ON public.bet_picks(user_id);
CREATE INDEX IF NOT EXISTS bet_picks_game_date_idx    ON public.bet_picks(game_date);
CREATE INDEX IF NOT EXISTS predictions_user_id_idx    ON public.predictions(user_id);
CREATE INDEX IF NOT EXISTS predictions_player_id_idx  ON public.predictions(player_id);
