-- Ordle: conta, migração do browser e partidas sincronizadas.
-- Tudo é prefixado com ordle_ para não tocar nas tabelas dos outros produtos
-- que vivem no projeto caminho-anglicano.

create extension if not exists pgcrypto;

create table if not exists public.ordle_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_first_name text not null default 'Jogador'
    check (char_length(public_first_name) between 1 and 32),
  leaderboard_opt_in boolean not null default true,
  preferences jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ordle_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  mode text not null check (mode in ('normal', 'hard')),
  played integer not null default 0 check (played >= 0),
  wins integer not null default 0 check (wins >= 0 and wins <= played),
  streak integer not null default 0 check (streak >= 0),
  max_streak integer not null default 0 check (max_streak >= 0),
  distribution integer[] not null default array[0, 0, 0, 0, 0, 0],
  last_game_id date,
  last_result text check (last_result is null or last_result in ('won', 'lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, mode)
);

create table if not exists public.ordle_player_games (
  user_id uuid not null references auth.users(id) on delete cascade,
  game_id date not null,
  mode text not null check (mode in ('normal', 'hard')),
  guesses jsonb not null default '[]'::jsonb check (jsonb_typeof(guesses) = 'array'),
  status text not null check (status in ('playing', 'won', 'lost')),
  attempts smallint not null check (attempts >= 0 and attempts <= 7),
  points smallint not null default 0 check (points >= 0),
  source text not null check (source in ('server', 'imported')),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, game_id, mode)
);

create table if not exists public.ordle_legacy_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  migration_id text not null,
  mode text not null check (mode in ('normal', 'hard')),
  played integer not null check (played >= 0),
  wins integer not null check (wins >= 0 and wins <= played),
  streak integer not null check (streak >= 0),
  max_streak integer not null check (max_streak >= 0),
  distribution integer[] not null,
  last_game_id date,
  last_result text check (last_result is null or last_result in ('won', 'lost')),
  game_snapshot jsonb,
  preferences_snapshot jsonb,
  imported_at timestamptz not null default now(),
  unique (user_id, migration_id, mode)
);

create index if not exists ordle_player_games_leaderboard_idx
  on public.ordle_player_games (mode, game_id, source, status);

create or replace function public.ordle_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ordle_profiles_updated_at on public.ordle_profiles;
create trigger ordle_profiles_updated_at
before update on public.ordle_profiles
for each row execute function public.ordle_set_updated_at();

drop trigger if exists ordle_stats_updated_at on public.ordle_stats;
create trigger ordle_stats_updated_at
before update on public.ordle_stats
for each row execute function public.ordle_set_updated_at();

create or replace function public.ordle_add_distribution(a integer[], b integer[])
returns integer[]
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_agg(coalesce(a[i], 0) + coalesce(b[i], 0) order by i),
    '{}'::integer[]
  )
  from generate_series(
    1,
    greatest(coalesce(array_length(a, 1), 0), coalesce(array_length(b, 1), 0))
  ) as indexes(i);
$$;

create or replace function public.ordle_increment_distribution(a integer[], slot integer)
returns integer[]
language sql
immutable
set search_path = public
as $$
  select coalesce(
    array_agg(
      case when indexes.i = slot then coalesce(a[indexes.i], 0) + 1
           else coalesce(a[indexes.i], 0)
      end
      order by indexes.i
    ),
    '{}'::integer[]
  )
  from generate_series(1, coalesce(array_length(a, 1), 0)) as indexes(i);
$$;

-- A migração legada é exatamente uma vez por snapshot e modo. Snapshots de
-- dispositivos diferentes são somados, conforme a política do produto.
create or replace function public.ordle_import_legacy(
  p_user_id uuid,
  p_migration_id text,
  p_device_id text,
  p_mode text,
  p_played integer,
  p_wins integer,
  p_streak integer,
  p_max_streak integer,
  p_distribution integer[],
  p_last_game_id date,
  p_last_result text,
  p_game_snapshot jsonb,
  p_preferences_snapshot jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if p_mode not in ('normal', 'hard') then raise exception 'invalid mode'; end if;
  if p_played < 0 or p_wins < 0 or p_wins > p_played then raise exception 'invalid stats'; end if;

  insert into public.ordle_legacy_imports (
    user_id, migration_id, device_id, mode, played, wins, streak,
    max_streak, distribution, last_game_id, last_result,
    game_snapshot, preferences_snapshot
  ) values (
    p_user_id, p_migration_id, p_device_id, p_mode, p_played, p_wins, p_streak,
    p_max_streak, p_distribution, p_last_game_id, p_last_result,
    p_game_snapshot, p_preferences_snapshot
  ) on conflict (user_id, migration_id, mode) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return false; end if;

  insert into public.ordle_stats (
    user_id, mode, played, wins, streak, max_streak, distribution,
    last_game_id, last_result
  ) values (
    p_user_id, p_mode, p_played, p_wins, p_streak, p_max_streak,
    p_distribution, p_last_game_id, p_last_result
  ) on conflict (user_id, mode) do update set
    played = public.ordle_stats.played + excluded.played,
    wins = public.ordle_stats.wins + excluded.wins,
    streak = case
      when excluded.last_game_id is not null
       and (public.ordle_stats.last_game_id is null
            or excluded.last_game_id >= public.ordle_stats.last_game_id)
        then excluded.streak
      else public.ordle_stats.streak
    end,
    max_streak = greatest(public.ordle_stats.max_streak, excluded.max_streak),
    distribution = public.ordle_add_distribution(
      public.ordle_stats.distribution, excluded.distribution
    ),
    last_game_id = case
      when excluded.last_game_id is not null
       and (public.ordle_stats.last_game_id is null
            or excluded.last_game_id >= public.ordle_stats.last_game_id)
        then excluded.last_game_id
      else public.ordle_stats.last_game_id
    end,
    last_result = case
      when excluded.last_game_id is not null
       and (public.ordle_stats.last_game_id is null
            or excluded.last_game_id >= public.ordle_stats.last_game_id)
        then excluded.last_result
      else public.ordle_stats.last_result
    end;

  return true;
end;
$$;

-- Registra uma partida capturada pelo servidor. O primeiro estado final é
-- imutável; a função retorna false quando outra tentativa já encerrou o dia.
create or replace function public.ordle_record_server_game(
  p_user_id uuid,
  p_game_id date,
  p_mode text,
  p_guesses jsonb,
  p_status text,
  p_attempts integer,
  p_points integer,
  p_completed_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_status text;
  counted boolean := false;
  default_distribution integer[];
begin
  if p_mode not in ('normal', 'hard') then raise exception 'invalid mode'; end if;
  if p_status not in ('playing', 'won', 'lost') then raise exception 'invalid status'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_game_id::text || ':' || p_mode, 0)
  );

  select status into current_status
  from public.ordle_player_games
  where user_id = p_user_id and game_id = p_game_id and mode = p_mode
  for update;

  if current_status in ('won', 'lost') then return false; end if;

  insert into public.ordle_player_games (
    user_id, game_id, mode, guesses, status, attempts, points, source,
    updated_at, completed_at
  ) values (
    p_user_id, p_game_id, p_mode, p_guesses, p_status, p_attempts, p_points,
    'server', now(), p_completed_at
  ) on conflict (user_id, game_id, mode) do update set
    guesses = excluded.guesses,
    status = excluded.status,
    attempts = excluded.attempts,
    points = excluded.points,
    source = 'server',
    updated_at = now(),
    completed_at = excluded.completed_at;

  if p_status = 'playing' then return false; end if;
  counted := true;
  default_distribution := case
    when p_mode = 'hard' then array[0, 0, 0, 0, 0, 0, 0]
    else array[0, 0, 0, 0, 0, 0]
  end;

  insert into public.ordle_stats (
    user_id, mode, played, wins, streak, max_streak, distribution,
    last_game_id, last_result
  ) values (
    p_user_id, p_mode, 1, case when p_status = 'won' then 1 else 0 end,
    case when p_status = 'won' then 1 else 0 end,
    case when p_status = 'won' then 1 else 0 end,
    case when p_status = 'won' then
      public.ordle_increment_distribution(default_distribution, p_attempts)
      else default_distribution
    end,
    p_game_id, p_status
  ) on conflict (user_id, mode) do update set
    played = public.ordle_stats.played + 1,
    wins = public.ordle_stats.wins + case when p_status = 'won' then 1 else 0 end,
    streak = case
      when p_status <> 'won' then 0
      when public.ordle_stats.last_game_id = p_game_id - 1 then public.ordle_stats.streak + 1
      else 1
    end,
    max_streak = case
      when p_status <> 'won' then public.ordle_stats.max_streak
      else greatest(
        public.ordle_stats.max_streak,
        case
          when public.ordle_stats.last_game_id = p_game_id - 1 then public.ordle_stats.streak + 1
          else 1
        end
      )
    end,
    distribution = case when p_status = 'won' then
      public.ordle_increment_distribution(public.ordle_stats.distribution, p_attempts)
      else public.ordle_stats.distribution
    end,
    last_game_id = case
      when public.ordle_stats.last_game_id is null or p_game_id >= public.ordle_stats.last_game_id
        then p_game_id else public.ordle_stats.last_game_id
    end,
    last_result = case
      when public.ordle_stats.last_game_id is null or p_game_id >= public.ordle_stats.last_game_id
        then p_status else public.ordle_stats.last_result
    end;

  return counted;
end;
$$;

alter table public.ordle_profiles enable row level security;
alter table public.ordle_stats enable row level security;
alter table public.ordle_player_games enable row level security;
alter table public.ordle_legacy_imports enable row level security;

-- O client nunca acessa essas tabelas diretamente. As APIs Nitro validam a
-- sessão e usam apenas o service-role key no servidor.
revoke all on public.ordle_profiles from anon, authenticated;
revoke all on public.ordle_stats from anon, authenticated;
revoke all on public.ordle_player_games from anon, authenticated;
revoke all on public.ordle_legacy_imports from anon, authenticated;

revoke all on function public.ordle_import_legacy(uuid, text, text, text, integer, integer, integer, integer, integer[], date, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ordle_import_legacy(uuid, text, text, text, integer, integer, integer, integer, integer[], date, text, jsonb, jsonb) to service_role;
revoke all on function public.ordle_record_server_game(uuid, date, text, jsonb, text, integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.ordle_record_server_game(uuid, date, text, jsonb, text, integer, integer, timestamptz) to service_role;
