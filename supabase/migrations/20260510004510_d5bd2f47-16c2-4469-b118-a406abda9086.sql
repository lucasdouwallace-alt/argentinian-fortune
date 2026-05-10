
-- profiles
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  name text,
  risk_tolerance text check (risk_tolerance in ('conservador','moderado','agresivo')),
  horizon text check (horizon in ('corto','medio','largo')),
  monthly_capital_ars numeric default 0,
  sector_preference text,
  onboarding_completed boolean not null default false,
  disclaimer_accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile select" on public.profiles for select using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert with check (auth.uid() = id);
create policy "own profile update" on public.profiles for update using (auth.uid() = id);

-- portfolio_assets
create table public.portfolio_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  ticker text not null,
  name text not null,
  tipo text,
  pct_allocation numeric not null,
  sl_pct numeric not null,
  tp_pct numeric not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.portfolio_assets enable row level security;
create policy "own assets all" on public.portfolio_assets for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- positions
create table public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  ticker text not null,
  entry_price_usd numeric not null,
  entry_price_ars numeric,
  mep_at_entry numeric,
  ccl_at_entry numeric,
  quantity numeric not null default 1,
  entry_date timestamptz not null default now(),
  exit_price_usd numeric,
  exit_date timestamptz,
  status text not null default 'open' check (status in ('open','closed')),
  pnl_usd numeric,
  pnl_pct numeric
);
alter table public.positions enable row level security;
create policy "own positions all" on public.positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- signal_history
create table public.signal_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  ticker text not null,
  signal text not null,
  confidence numeric,
  price_at_signal_usd numeric,
  price_at_signal_ars numeric,
  mep_at_signal numeric,
  reason text,
  confirmed_by_user boolean not null default false,
  confirmed_at timestamptz,
  market_score numeric,
  created_at timestamptz not null default now()
);
alter table public.signal_history enable row level security;
create policy "own signals all" on public.signal_history for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
