-- M3 · Money schema: double-entry ledger, payments, earnings, deposits, reconciliation, refunds and
-- adjustments (maker-checker), payout accounts and payouts (docs/spec/03 §4.5, 04 §9-11).
-- All writes happen through SECURITY DEFINER functions; clients only ever read through RLS or api.* RPCs.

create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded');
create type public.earning_payout_status as enum ('unpaid', 'in_payout', 'paid', 'held');

-- Keeps updated_at current. (These tables carry no created_by/updated_by, so private.stamp_row does not apply.)
create function private.touch_row() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

insert into public.app_settings (key, value, description) values
  ('finance.dual_approval_threshold', '5000', 'Refunds and adjustments at or above this amount need two distinct approvers.'),
  ('payouts.minimum_amount', '500', 'Minimum driver wallet balance to be included in a payout batch.'),
  ('payments.cash_collection_grace_h', '24', 'Hours after completion before an unconfirmed cash payment is flagged.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Ledger
-- ---------------------------------------------------------------------------
create table public.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  owner_type text not null check (owner_type in ('platform', 'driver', 'passenger')),
  owner_id uuid,
  kind text not null check (kind in ('asset', 'liability', 'revenue', 'expense')),
  currency char(3) not null default 'BDT',
  created_at timestamptz not null default now(),
  constraint chk_ledger_accounts_owner check ((owner_type = 'platform') = (owner_id is null))
);
create index idx_ledger_accounts_owner on public.ledger_accounts (owner_type, owner_id);

create table public.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  reference text not null,
  trip_id uuid references public.trips (id),
  reverses_id uuid references public.ledger_transactions (id),
  memo text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  constraint uq_ledger_transactions_idempotent unique (kind, reference),
  constraint uq_ledger_transactions_reverses unique (reverses_id)
);
create index idx_ledger_transactions_trip on public.ledger_transactions (trip_id) where trip_id is not null;
create index idx_ledger_transactions_created on public.ledger_transactions (created_at desc, id desc);

create table public.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references public.ledger_transactions (id),
  account_id uuid not null references public.ledger_accounts (id),
  debit numeric(14, 2) not null default 0,
  credit numeric(14, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint chk_ledger_entries_one_side check (debit >= 0 and credit >= 0 and (debit = 0) <> (credit = 0))
);
create index idx_ledger_entries_account on public.ledger_entries (account_id, id desc);
create index idx_ledger_entries_transaction on public.ledger_entries (transaction_id);

-- balance: credit - debit for liability/revenue accounts, debit - credit for asset/expense accounts.
create table public.ledger_account_balances (
  account_id uuid primary key references public.ledger_accounts (id),
  balance numeric(14, 2) not null default 0,
  debit_total numeric(14, 2) not null default 0,
  credit_total numeric(14, 2) not null default 0,
  last_entry_id bigint,
  updated_at timestamptz not null default now()
);

create table public.ledger_verification_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  accounts_checked integer not null,
  drift_count integer not null,
  unbalanced_count integer not null,
  details jsonb not null default '[]',
  ok boolean generated always as (drift_count = 0 and unbalanced_count = 0) stored
);

create trigger trg_ledger_transactions_append_only before update or delete on public.ledger_transactions
  for each row execute function private.forbid_update_delete();
create trigger trg_ledger_entries_append_only before update or delete on public.ledger_entries
  for each row execute function private.forbid_update_delete();
create trigger trg_ledger_accounts_no_delete before delete on public.ledger_accounts
  for each row execute function private.forbid_delete();
create trigger trg_ledger_verification_runs_append_only before update or delete on public.ledger_verification_runs
  for each row execute function private.forbid_update_delete();

-- Every transaction must balance at commit, whatever code wrote it.
create function private.check_ledger_balanced() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_debit numeric;
  v_credit numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_debit, v_credit
  from public.ledger_entries where transaction_id = new.transaction_id;
  if v_debit <> v_credit then
    perform private.raise_error('LEDGER_UNBALANCED', jsonb_build_object('debit', v_debit, 'credit', v_credit));
  end if;
  return null;
end $$;

create constraint trigger trg_ledger_entries_balanced after insert on public.ledger_entries
  deferrable initially deferred for each row execute function private.check_ledger_balanced();

-- Account helpers --------------------------------------------------------------
create function private.ledger_account(p_code text, p_owner_type text, p_owner_id uuid, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  select id into v_id from public.ledger_accounts where code = p_code;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.ledger_accounts (code, owner_type, owner_id, kind) values (p_code, p_owner_type, p_owner_id, p_kind)
  on conflict (code) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.ledger_accounts where code = p_code;
  end if;
  return v_id;
end $$;

create function private.platform_account(p_name text) returns uuid
language sql security definer set search_path = '' as $$
  select private.ledger_account('platform:' || p_name, 'platform', null,
    case p_name
      when 'commission_revenue' then 'revenue'
      when 'booking_fee_revenue' then 'revenue'
      when 'payouts_clearing' then 'liability'
      when 'cash_on_hand' then 'asset'
      when 'gateway_clearing' then 'asset'
      else 'expense' end);
$$;

create function private.wallet_account(p_owner_type text, p_owner_id uuid) returns uuid
language sql security definer set search_path = '' as $$
  select private.ledger_account(p_owner_type || ':' || p_owner_id || ':wallet', p_owner_type, p_owner_id, 'liability');
$$;

-- The only writer of ledger rows. Idempotent on (kind, reference).
-- p_lines: [{"account_id": uuid, "debit": n} | {"account_id": uuid, "credit": n}].
create function private.post_transaction(
  p_kind text, p_reference text, p_trip_id uuid, p_memo text, p_lines jsonb, p_reverses uuid default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_debit numeric;
  v_credit numeric;
  l record;
begin
  select id into v_id from public.ledger_transactions where kind = p_kind and reference = p_reference;
  if v_id is not null then
    return v_id;
  end if;

  select coalesce(sum(coalesce((x ->> 'debit')::numeric, 0)), 0), coalesce(sum(coalesce((x ->> 'credit')::numeric, 0)), 0)
  into v_debit, v_credit from jsonb_array_elements(p_lines) x;
  if v_debit <> v_credit or v_debit <= 0 then
    perform private.raise_error('LEDGER_UNBALANCED', jsonb_build_object('debit', v_debit, 'credit', v_credit));
  end if;

  insert into public.ledger_transactions (kind, reference, trip_id, reverses_id, memo, created_by)
  values (p_kind, p_reference, p_trip_id, p_reverses, left(p_memo, 500), auth.uid())
  on conflict (kind, reference) do nothing returning id into v_id;
  if v_id is null then -- lost a race with an identical posting
    select id into v_id from public.ledger_transactions where kind = p_kind and reference = p_reference;
    return v_id;
  end if;

  insert into public.ledger_entries (transaction_id, account_id, debit, credit)
  select v_id, (x ->> 'account_id')::uuid, coalesce((x ->> 'debit')::numeric, 0), coalesce((x ->> 'credit')::numeric, 0)
  from jsonb_array_elements(p_lines) x
  where coalesce((x ->> 'debit')::numeric, 0) + coalesce((x ->> 'credit')::numeric, 0) > 0;

  -- Balances are updated in account order so concurrent postings cannot deadlock.
  for l in
    select e.account_id, sum(e.debit) as d, sum(e.credit) as c, max(e.id) as last_id, a.kind
    from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id
    where e.transaction_id = v_id group by e.account_id, a.kind order by e.account_id
  loop
    insert into public.ledger_account_balances (account_id, balance, debit_total, credit_total, last_entry_id)
    values (l.account_id, case when l.kind in ('liability', 'revenue') then l.c - l.d else l.d - l.c end, l.d, l.c, l.last_id)
    on conflict (account_id) do update set
      debit_total = public.ledger_account_balances.debit_total + l.d,
      credit_total = public.ledger_account_balances.credit_total + l.c,
      balance = case when l.kind in ('liability', 'revenue')
                     then public.ledger_account_balances.credit_total + l.c - public.ledger_account_balances.debit_total - l.d
                     else public.ledger_account_balances.debit_total + l.d - public.ledger_account_balances.credit_total - l.c end,
      last_entry_id = l.last_id, updated_at = now();
  end loop;
  return v_id;
end $$;

-- A reversal mirrors the original with debits and credits swapped; a transaction can be reversed once.
create function private.reverse_transaction(p_tx uuid, p_reference text, p_memo text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  o public.ledger_transactions;
  v_lines jsonb;
begin
  select * into o from public.ledger_transactions where id = p_tx;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if o.kind = 'reversal' or o.reverses_id is not null then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"a reversal cannot be reversed"}');
  end if;
  if exists (select 1 from public.ledger_transactions where reverses_id = p_tx) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"already reversed"}');
  end if;
  select jsonb_agg(jsonb_build_object('account_id', account_id, 'debit', credit, 'credit', debit) order by id) into v_lines
  from public.ledger_entries where transaction_id = p_tx;
  return private.post_transaction('reversal', p_reference, o.trip_id, p_memo, v_lines, p_tx);
end $$;

-- Nightly verification: balances table vs. entries, and per-transaction balance.
create function private.verify_ledger_balances() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_checked integer;
  v_drift jsonb;
  v_unbalanced jsonb;
  v_details jsonb;
  a record;
begin
  select count(*) into v_checked from public.ledger_accounts;

  select coalesce(jsonb_agg(jsonb_build_object('account', x.code, 'stored', x.stored, 'computed', x.computed)), '[]') into v_drift
  from (
    select a2.code, coalesce(b.balance, 0) as stored,
           coalesce(case when a2.kind in ('liability', 'revenue') then sum(e.credit) - sum(e.debit) else sum(e.debit) - sum(e.credit) end, 0) as computed
    from public.ledger_accounts a2
    left join public.ledger_account_balances b on b.account_id = a2.id
    left join public.ledger_entries e on e.account_id = a2.id
    group by a2.id, a2.code, a2.kind, b.balance
  ) x where x.stored <> x.computed;

  select coalesce(jsonb_agg(jsonb_build_object('transaction', t.transaction_id, 'debit', t.d, 'credit', t.c)), '[]') into v_unbalanced
  from (select transaction_id, sum(debit) d, sum(credit) c from public.ledger_entries group by transaction_id having sum(debit) <> sum(credit)) t;

  v_details := v_drift || v_unbalanced;
  insert into public.ledger_verification_runs (accounts_checked, drift_count, unbalanced_count, details)
  values (v_checked, jsonb_array_length(v_drift), jsonb_array_length(v_unbalanced), v_details);

  if jsonb_array_length(v_details) > 0 then
    for a in select p.id from public.profiles p where p.role = 'admin' and p.status = 'active' and private.admin_holds(p.id, 'ledger.view') loop
      perform private.notify(a.id, 'ledger_drift', 'Ledger verification failed',
        jsonb_array_length(v_drift) || ' account(s) drifted, ' || jsonb_array_length(v_unbalanced) || ' transaction(s) unbalanced.', '/ledger');
    end loop;
  end if;
  return jsonb_build_object('checked', v_checked, 'drift', v_drift, 'unbalanced', v_unbalanced);
end $$;

select cron.schedule('verify-ledger-balances', '0 2 * * *', 'select private.verify_ledger_balances()');

-- ---------------------------------------------------------------------------
-- Payments and earnings
-- ---------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips (id),
  passenger_id uuid not null references public.profiles (id),
  driver_id uuid not null references public.driver_profiles (id),
  method public.payment_method not null,
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'BDT',
  status public.payment_status not null default 'pending',
  collected_by_driver_id uuid references public.driver_profiles (id),
  collected_amount numeric(12, 2),
  collected_at timestamptz,
  refunded_amount numeric(12, 2) not null default 0 check (refunded_amount >= 0),
  provider text,
  provider_reference text,
  reconciled_at timestamptz,
  reconciled_by uuid references public.profiles (id),
  reconciliation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_payments_refund_cap check (refunded_amount <= amount)
);
create unique index uq_payments_provider_ref on public.payments (provider, provider_reference) where provider_reference is not null;
create index idx_payments_status_created on public.payments (status, created_at desc);
create index idx_payments_driver on public.payments (driver_id, created_at desc);
create index idx_payments_passenger on public.payments (passenger_id, created_at desc);
create index idx_payments_unreconciled on public.payments (created_at) where status = 'succeeded' and reconciled_at is null;

create table public.payment_events (
  id bigint generated always as identity primary key,
  payment_id uuid not null references public.payments (id),
  from_status public.payment_status,
  to_status public.payment_status not null,
  source text not null check (source in ('api', 'webhook', 'admin', 'system')),
  note text,
  created_at timestamptz not null default now()
);
create index idx_payment_events_payment on public.payment_events (payment_id, id);
create trigger trg_payment_events_append_only before update or delete on public.payment_events
  for each row execute function private.forbid_update_delete();
create trigger trg_payments_no_delete before delete on public.payments
  for each row execute function private.forbid_delete();

create table public.driver_earnings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null unique references public.trips (id),
  driver_id uuid not null references public.driver_profiles (id),
  gross_fare numeric(12, 2) not null,
  discount_amount numeric(12, 2) not null default 0,
  commission_amount numeric(12, 2) not null,
  net_earning numeric(12, 2) not null,
  payout_status public.earning_payout_status not null default 'unpaid',
  payout_id uuid,
  earned_at timestamptz not null default now(),
  constraint chk_driver_earnings_net check (net_earning >= 0)
);
create index idx_driver_earnings_driver on public.driver_earnings (driver_id, earned_at desc);
create index idx_driver_earnings_unpaid on public.driver_earnings (driver_id) where payout_status = 'unpaid';
create trigger trg_driver_earnings_no_delete before delete on public.driver_earnings
  for each row execute function private.forbid_delete();

create table public.payment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  payment_count integer not null,
  total_amount numeric(14, 2) not null,
  note text,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);
alter table public.payments add constraint fk_payments_reconciliation foreign key (reconciliation_id) references public.payment_reconciliations (id);
create trigger trg_payment_reconciliations_append_only before update or delete on public.payment_reconciliations
  for each row execute function private.forbid_update_delete();

create table public.cash_deposits (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles (id),
  amount numeric(12, 2) not null check (amount > 0),
  method text not null check (method in ('office', 'bank', 'bkash', 'nagad')),
  reference text,
  notes text,
  received_by uuid not null references public.profiles (id),
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at timestamptz not null default now()
);
create index idx_cash_deposits_driver on public.cash_deposits (driver_id, created_at desc);
create trigger trg_cash_deposits_append_only before update or delete on public.cash_deposits
  for each row execute function private.forbid_update_delete();

-- ---------------------------------------------------------------------------
-- Refunds, adjustments, reversals (maker-checker)
-- ---------------------------------------------------------------------------
create table public.refunds_adjustments (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('refund', 'adjustment', 'reversal')),
  trip_id uuid references public.trips (id),
  payment_id uuid references public.payments (id),
  passenger_id uuid references public.profiles (id),
  account_id uuid references public.ledger_accounts (id),
  direction text check (direction in ('debit', 'credit')),
  reverses_transaction_id uuid references public.ledger_transactions (id),
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'BDT',
  reason text not null check (length(btrim(reason)) between 5 and 1000),
  evidence text check (length(evidence) <= 2000),
  status text not null default 'requested'
    check (status in ('requested', 'awaiting_second_approval', 'processed', 'rejected', 'cancelled', 'failed')),
  requested_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  second_approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles (id),
  rejection_reason text,
  ledger_transaction_id uuid references public.ledger_transactions (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_refunds_maker_checker check (approved_by is null or approved_by <> requested_by),
  constraint chk_refunds_second_distinct check (second_approved_by is null or (second_approved_by <> requested_by and second_approved_by <> approved_by)),
  constraint chk_refunds_kind_fields check (
    (kind = 'refund' and payment_id is not null and passenger_id is not null)
    or (kind = 'adjustment' and account_id is not null and direction is not null)
    or (kind = 'reversal' and reverses_transaction_id is not null))
);
create index idx_refunds_status on public.refunds_adjustments (status, created_at desc);
create index idx_refunds_payment on public.refunds_adjustments (payment_id) where payment_id is not null;
create unique index uq_refunds_one_reversal_open on public.refunds_adjustments (reverses_transaction_id)
  where kind = 'reversal' and status in ('requested', 'awaiting_second_approval', 'processed');
create trigger trg_refunds_no_delete before delete on public.refunds_adjustments
  for each row execute function private.forbid_delete();
create trigger trg_refunds_stamp before update on public.refunds_adjustments
  for each row execute function private.touch_row();

-- ---------------------------------------------------------------------------
-- Payout accounts and payouts
-- ---------------------------------------------------------------------------
create table public.driver_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.driver_profiles (id),
  method text not null check (method in ('bkash', 'nagad', 'bank')),
  account_holder text not null check (length(btrim(account_holder)) between 2 and 120),
  account_ref_enc bytea not null,
  account_ref_masked text not null,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  is_default boolean not null default true,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_payout_accounts_default on public.driver_payout_accounts (driver_id) where is_default;
create trigger trg_payout_accounts_no_delete before delete on public.driver_payout_accounts
  for each row execute function private.forbid_delete();
create trigger trg_payout_accounts_stamp before update on public.driver_payout_accounts
  for each row execute function private.touch_row();

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'failed', 'cancelled')),
  total_amount numeric(14, 2) not null default 0,
  payout_count integer not null default 0,
  notes text,
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_payout_batches_maker_checker check (approved_by is null or approved_by <> created_by)
);
create trigger trg_payout_batches_no_delete before delete on public.payout_batches
  for each row execute function private.forbid_delete();
create trigger trg_payout_batches_stamp before update on public.payout_batches
  for each row execute function private.touch_row();

create table public.payouts (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches (id),
  driver_id uuid not null references public.driver_profiles (id),
  payout_account_id uuid not null references public.driver_payout_accounts (id),
  amount numeric(12, 2) not null check (amount > 0),
  currency char(3) not null default 'BDT',
  status text not null default 'pending' check (status in ('pending', 'approved', 'paid', 'failed', 'cancelled')),
  reference text,
  failure_reason text,
  approve_transaction_id uuid references public.ledger_transactions (id),
  paid_transaction_id uuid references public.ledger_transactions (id),
  approved_by uuid references public.profiles (id),
  approved_at timestamptz,
  paid_by uuid references public.profiles (id),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index uq_payouts_one_open_per_driver on public.payouts (driver_id) where status in ('pending', 'approved');
create index idx_payouts_batch on public.payouts (batch_id);
create index idx_payouts_driver on public.payouts (driver_id, created_at desc);
create trigger trg_payouts_no_delete before delete on public.payouts
  for each row execute function private.forbid_delete();
create trigger trg_payouts_stamp before update on public.payouts
  for each row execute function private.touch_row();

alter table public.driver_earnings add constraint fk_driver_earnings_payout foreign key (payout_id) references public.payouts (id);

-- ---------------------------------------------------------------------------
-- RLS: admins read by permission; everything else goes through api.* functions.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('ledger_accounts', 'ledger.view'), ('ledger_transactions', 'ledger.view'), ('ledger_entries', 'ledger.view'),
      ('ledger_account_balances', 'ledger.view'), ('ledger_verification_runs', 'ledger.view'),
      ('payments', 'payments.view'), ('payment_events', 'payments.view'), ('driver_earnings', 'payments.view'),
      ('payment_reconciliations', 'payments.view'), ('cash_deposits', 'payments.view'),
      ('refunds_adjustments', 'ledger.view'), ('payout_batches', 'payouts.view'), ('payouts', 'payouts.view')
    ) as x(tbl, perm)
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    execute format('alter table public.%I force row level security', r.tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', r.tbl);
    execute format('grant select on public.%I to authenticated', r.tbl);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_permission(%L)))', r.tbl || '_admin_read', r.tbl, r.perm);
  end loop;
end $$;

-- Payout account numbers are never readable directly: not even by admins.
alter table public.driver_payout_accounts enable row level security;
alter table public.driver_payout_accounts force row level security;
revoke all on public.driver_payout_accounts from public, anon, authenticated;
