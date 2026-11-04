-- M3 · Money RPCs: settlement at trip completion, cash collection, wallets, deposits, reconciliation,
-- refunds / adjustments / reversals (maker-checker), payout accounts and payouts, finance reads.
-- complete_trip and cancel_ride are re-declared at the end of this file with their settlement hooks.

create function private.has_any_permission(p_permissions text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from unnest(p_permissions) p where private.has_permission(p));
$$;

-- ---------------------------------------------------------------------------
-- Settlement
-- ---------------------------------------------------------------------------
-- Called by complete_trip in the same transaction, after the fare breakdown is frozen.
--   Cr driver wallet  = driver earning + pass-through (non-commissionable items)
--   Cr commission and booking-fee revenue
--   Dr cash held by the driver (or gateway clearing) = what the passenger pays
--   Dr promo expense  = platform-funded discount
create function private.settle_trip(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  b public.trip_fare_breakdowns;
  v_before numeric;
  v_pass numeric;
  v_driver_credit numeric;
  v_collect uuid;
  v_lines jsonb := '[]'::jsonb;
  v_payment uuid;
begin
  select * into t from public.trips where id = p_trip_id;
  select * into b from public.trip_fare_breakdowns where trip_id = p_trip_id;
  v_before := b.total_amount + b.discount_amount;
  v_pass := v_before - b.commissionable_amount - b.booking_fee;
  v_driver_credit := b.driver_earning + v_pass;

  perform private.apply_redemption(t.request_id, t.id, b.discount_amount);

  if b.total_amount > 0 then
    insert into public.payments (trip_id, passenger_id, driver_id, method, amount, currency)
    values (t.id, t.passenger_id, t.driver_id, t.payment_method, b.total_amount, t.currency)
    on conflict (trip_id) do nothing returning id into v_payment;
    if v_payment is not null then
      insert into public.payment_events (payment_id, from_status, to_status, source, note)
      values (v_payment, null, 'pending', 'system', 'Trip completed');
    end if;
  end if;

  insert into public.driver_earnings (trip_id, driver_id, gross_fare, discount_amount, commission_amount, net_earning)
  values (t.id, t.driver_id, v_before, b.discount_amount, b.platform_commission, v_driver_credit)
  on conflict (trip_id) do nothing;

  v_collect := case when t.payment_method = 'cash' then private.wallet_account('driver', t.driver_id) else private.platform_account('gateway_clearing') end;
  if b.total_amount > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_collect, 'debit', b.total_amount);
  end if;
  if b.discount_amount > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('promo_expense'), 'debit', b.discount_amount);
  end if;
  if v_driver_credit > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.wallet_account('driver', t.driver_id), 'credit', v_driver_credit);
  end if;
  if b.platform_commission > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('commission_revenue'), 'credit', b.platform_commission);
  end if;
  if b.booking_fee > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('booking_fee_revenue'), 'credit', b.booking_fee);
  end if;
  if jsonb_array_length(v_lines) > 0 then
    perform private.post_transaction('trip_completion', t.id::text, t.id, 'Trip completed', v_lines);
  end if;
end $$;

-- A passenger cancellation fee: a receivable on the passenger wallet, credited to the driver minus commission.
create function private.post_cancellation_fee(p_trip_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips;
  v_pct numeric;
  v_commission numeric;
  v_lines jsonb;
begin
  select * into t from public.trips where id = p_trip_id;
  if coalesce(t.cancellation_fee, 0) <= 0 then
    return;
  end if;
  v_pct := coalesce((t.pricing_rule_snapshot ->> 'platform_commission_pct')::numeric, 0);
  v_commission := round(t.cancellation_fee * v_pct, 2);
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', private.wallet_account('passenger', t.passenger_id), 'debit', t.cancellation_fee),
    jsonb_build_object('account_id', private.wallet_account('driver', t.driver_id), 'credit', t.cancellation_fee - v_commission));
  if v_commission > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', private.platform_account('commission_revenue'), 'credit', v_commission);
  end if;
  perform private.post_transaction('cancellation_fee', t.id::text, t.id, 'Passenger cancellation fee', v_lines);
end $$;

-- ---------------------------------------------------------------------------
-- Driver-facing
-- ---------------------------------------------------------------------------
create function private.payment_row_json(p public.payments) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'trip_id', p.trip_id, 'method', p.method, 'amount', p.amount, 'currency', p.currency, 'status', p.status,
    'collected_amount', p.collected_amount, 'collected_at', p.collected_at, 'refunded_amount', p.refunded_amount,
    'reconciled_at', p.reconciled_at, 'created_at', p.created_at,
    'passenger_name', (select full_name from public.profiles x where x.id = p.passenger_id),
    'driver_name', (select pr.full_name from public.driver_profiles d join public.profiles pr on pr.id = d.user_id where d.id = p.driver_id));
$$;

create function api.confirm_cash_collected(p_trip_id uuid, p_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  p public.payments;
  v_amount numeric;
begin
  if t.status <> 'completed' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', t.status));
  end if;
  select * into p from public.payments where trip_id = t.id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p.method <> 'cash' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"not a cash payment"}');
  end if;
  if p.status = 'succeeded' then
    return private.payment_row_json(p); -- idempotent
  end if;
  if p.status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', p.status));
  end if;
  v_amount := coalesce(p_amount, p.amount);
  if v_amount < 0 or v_amount > 1000000 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"Enter the amount you collected."}]}');
  end if;
  update public.payments set status = 'succeeded', collected_by_driver_id = p.driver_id, collected_amount = v_amount, collected_at = now()
  where id = p.id returning * into p;
  insert into public.payment_events (payment_id, from_status, to_status, source, note)
  values (p.id, 'pending', 'succeeded', 'api', case when v_amount <> p.amount then 'Collected ' || v_amount || ' of ' || p.amount end);
  if v_amount <> p.amount then
    perform private.open_ticket(auth.uid(), t.id, 'payment', 'Cash mismatch on a completed trip',
      'The driver reported collecting ' || v_amount || ' but the fare was ' || p.amount || '.', 'high', 'system');
  end if;
  return private.payment_row_json(p);
end $$;

create function api.driver_wallet() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_driver uuid;
  v_balance numeric;
begin
  perform private.require_role('driver');
  v_driver := private.my_driver_id();
  select coalesce(b.balance, 0) into v_balance from public.ledger_accounts a
    left join public.ledger_account_balances b on b.account_id = a.id where a.code = 'driver:' || v_driver || ':wallet';
  return jsonb_build_object(
    'balance', coalesce(v_balance, 0), 'currency', 'BDT', 'owes_platform', coalesce(v_balance, 0) < 0,
    'unpaid_earnings', (select coalesce(sum(net_earning), 0) from public.driver_earnings where driver_id = v_driver and payout_status = 'unpaid'),
    'earned_today', (select coalesce(sum(net_earning), 0) from public.driver_earnings where driver_id = v_driver and earned_at >= date_trunc('day', now())),
    'open_payout', (select jsonb_build_object('id', p.id, 'amount', p.amount, 'status', p.status) from public.payouts p
                    where p.driver_id = v_driver and p.status in ('pending', 'approved')),
    'payout_account', (select jsonb_build_object('method', a.method, 'masked', a.account_ref_masked, 'status', a.status)
                       from public.driver_payout_accounts a where a.driver_id = v_driver and a.is_default));
end $$;

create function api.driver_earnings(p_limit integer default 30, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_role('driver');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'trip_id', x.trip_id, 'gross_fare', x.gross_fare, 'commission', x.commission_amount,
      'net_earning', x.net_earning, 'payout_status', x.payout_status, 'created_at', x.earned_at) order by x.earned_at desc, x.id desc), '[]') into v_rows
  from (select e.* from public.driver_earnings e where e.driver_id = private.my_driver_id()
          and (v_ts is null or (e.earned_at, e.id) < (v_ts, v_id)) order by e.earned_at desc, e.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit);
end $$;

create function api.driver_set_payout_account(p_method text, p_holder text, p_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_driver uuid;
  v_ref text := btrim(coalesce(p_ref, ''));
begin
  perform private.require_role('driver');
  v_driver := private.my_driver_id();
  if p_method is null or p_method not in ('bkash', 'nagad', 'bank') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"method","message":"Choose bKash, Nagad or bank."}]}');
  end if;
  if p_holder is null or length(btrim(p_holder)) not between 2 and 120 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"holder","message":"Enter the account holder name."}]}');
  end if;
  if v_ref !~ '^[0-9A-Za-z-]{5,40}$' then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"ref","message":"Enter a valid account or wallet number."}]}');
  end if;
  update public.driver_payout_accounts set is_default = false where driver_id = v_driver and is_default;
  insert into public.driver_payout_accounts (driver_id, method, account_holder, account_ref_enc, account_ref_masked)
  values (v_driver, p_method, btrim(p_holder), private.encrypt_pii(v_ref), private.mask_tail(v_ref, 3));
  return api.driver_wallet();
end $$;

-- ---------------------------------------------------------------------------
-- Admin: payments
-- ---------------------------------------------------------------------------
create function api.list_payments(
  p_status text default null, p_method text default null, p_unreconciled boolean default false, p_search text default null,
  p_limit integer default 50, p_cursor text default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_search text := nullif(btrim(p_search), '');
  v_grace integer := coalesce((private.setting('payments.cash_collection_grace_h'))::int, 24);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('payments.view');
  if p_status is not null and p_status not in ('pending', 'succeeded', 'failed', 'cancelled', 'refunded', 'partially_refunded', 'overdue') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"status","message":"Unknown status."}]}');
  end if;
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.payment_row_json(x) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select p.* from public.payments p
        join public.profiles pp on pp.id = p.passenger_id
        join public.driver_profiles d on d.id = p.driver_id join public.profiles dp on dp.id = d.user_id
        where (p_status is null or (p_status = 'overdue' and p.status = 'pending' and p.created_at < now() - make_interval(hours => v_grace)) or p.status::text = p_status)
          and (p_method is null or p.method::text = p_method)
          and (not coalesce(p_unreconciled, false) or (p.status in ('succeeded', 'partially_refunded', 'refunded') and p.reconciled_at is null))
          and (v_search is null or pp.full_name ilike '%' || v_search || '%' or dp.full_name ilike '%' || v_search || '%' or p.trip_id::text like lower(v_search) || '%')
          and (v_ts is null or (p.created_at, p.id) < (v_ts, v_id))
        order by p.created_at desc, p.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object(
      'pending', count(*) filter (where status = 'pending'),
      'overdue', count(*) filter (where status = 'pending' and created_at < now() - make_interval(hours => v_grace)),
      'unreconciled', count(*) filter (where status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null),
      'unreconciled_amount', coalesce(sum(amount) filter (where status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null), 0))
    from public.payments));
end $$;

create function api.get_payment(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  p public.payments;
begin
  perform private.require_permission('payments.view');
  select * into p from public.payments where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return private.payment_row_json(p) || jsonb_build_object(
    'events', (select coalesce(jsonb_agg(jsonb_build_object('from_status', e.from_status, 'to_status', e.to_status, 'source', e.source, 'note', e.note, 'created_at', e.created_at) order by e.id), '[]')
               from public.payment_events e where e.payment_id = p.id),
    'refunds', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'status', r.status, 'reason', r.reason, 'created_at', r.created_at) order by r.created_at), '[]')
                from public.refunds_adjustments r where r.payment_id = p.id));
end $$;

-- Money summary for a trip: payment, earning and (with ledger.view) the ledger lines.
create function api.get_trip_finance(p_trip_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tx uuid;
begin
  perform private.require_permission('payments.view');
  select id into v_tx from public.ledger_transactions where kind = 'trip_completion' and reference = p_trip_id::text;
  return jsonb_build_object(
    'payment', (select private.payment_row_json(p) from public.payments p where p.trip_id = p_trip_id),
    'earning', (select jsonb_build_object('gross_fare', e.gross_fare, 'discount', e.discount_amount, 'commission', e.commission_amount, 'net_earning', e.net_earning, 'payout_status', e.payout_status)
                from public.driver_earnings e where e.trip_id = p_trip_id),
    'ledger_transaction_id', case when private.has_permission('ledger.view') then v_tx end,
    'ledger_lines', case when private.has_permission('ledger.view') and v_tx is not null then
      (select coalesce(jsonb_agg(jsonb_build_object('account', a.code, 'debit', e.debit, 'credit', e.credit) order by e.id), '[]')
       from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where e.transaction_id = v_tx) end);
end $$;

create function api.reconcile_payments(p_payment_ids uuid[], p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_count integer;
  v_total numeric;
begin
  perform private.require_permission('payments.reconcile');
  if p_payment_ids is null or cardinality(p_payment_ids) not between 1 and 500 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"payment_ids","message":"Select between 1 and 500 payments."}]}');
  end if;
  select count(*), coalesce(sum(amount), 0) into v_count, v_total from public.payments
  where id = any (p_payment_ids) and status in ('succeeded', 'partially_refunded', 'refunded') and reconciled_at is null;
  if v_count <> cardinality(p_payment_ids) then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"payment_ids","message":"Only confirmed, unreconciled payments can be reconciled."}]}');
  end if;
  insert into public.payment_reconciliations (payment_count, total_amount, note, created_by)
  values (v_count, v_total, left(nullif(btrim(p_note), ''), 500), auth.uid()) returning id into v_id;
  update public.payments set reconciled_at = now(), reconciled_by = auth.uid(), reconciliation_id = v_id where id = any (p_payment_ids);
  perform private.log_admin_action('payments.reconcile', 'payment_reconciliation', v_id, null, jsonb_build_object('count', v_count, 'total', v_total), p_note);
  return jsonb_build_object('id', v_id, 'payment_count', v_count, 'total_amount', v_total);
end $$;

create function api.record_cash_deposit(p_driver_id uuid, p_amount numeric, p_method text, p_reference text, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_tx uuid;
  v_balance numeric;
begin
  perform private.require_permission('payments.reconcile');
  if p_amount is null or p_amount <= 0 or p_amount > 10000000 or scale(p_amount) > 2 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"Enter an amount above zero (up to 2 decimals)."}]}');
  end if;
  if p_method is null or p_method not in ('office', 'bank', 'bkash', 'nagad') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"method","message":"Choose how the cash was handed in."}]}');
  end if;
  if not exists (select 1 from public.driver_profiles where id = p_driver_id) then
    perform private.raise_error('NOT_FOUND');
  end if;
  v_id := gen_random_uuid(); -- deposits are append-only, so the ledger posting comes first
  v_tx := private.post_transaction('cash_deposit', v_id::text, null, 'Driver cash deposit', jsonb_build_array(
    jsonb_build_object('account_id', private.platform_account('cash_on_hand'), 'debit', p_amount),
    jsonb_build_object('account_id', private.wallet_account('driver', p_driver_id), 'credit', p_amount)));
  insert into public.cash_deposits (id, driver_id, amount, method, reference, notes, received_by, ledger_transaction_id)
  values (v_id, p_driver_id, p_amount, p_method, left(nullif(btrim(p_reference), ''), 100), left(nullif(btrim(p_notes), ''), 500), auth.uid(), v_tx);
  perform private.log_admin_action('cash_deposit.record', 'driver', p_driver_id, null, jsonb_build_object('amount', p_amount, 'method', p_method), p_reference);
  select coalesce(b.balance, 0) into v_balance from public.ledger_accounts a left join public.ledger_account_balances b on b.account_id = a.id
  where a.code = 'driver:' || p_driver_id || ':wallet';
  return jsonb_build_object('id', v_id, 'ledger_transaction_id', v_tx, 'wallet_balance', coalesce(v_balance, 0));
end $$;

create function api.list_driver_dues() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('payments.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'driver_id', d.id, 'driver_name', pr.full_name, 'balance', b.balance,
      'last_deposit_at', (select max(c.created_at) from public.cash_deposits c where c.driver_id = d.id)) order by b.balance), '[]')
    from public.ledger_accounts a
    join public.ledger_account_balances b on b.account_id = a.id
    join public.driver_profiles d on d.id = a.owner_id
    join public.profiles pr on pr.id = d.user_id
    where a.owner_type = 'driver' and a.code like '%:wallet' and b.balance < 0);
end $$;

-- ---------------------------------------------------------------------------
-- Admin: ledger reads
-- ---------------------------------------------------------------------------
create function api.ledger_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('ledger.view');
  return jsonb_build_object(
    'platform', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'kind', a.kind, 'balance', coalesce(b.balance, 0)) order by a.code), '[]')
                 from public.ledger_accounts a left join public.ledger_account_balances b on b.account_id = a.id where a.owner_type = 'platform'),
    'owed_to_drivers', (select coalesce(sum(b.balance), 0) from public.ledger_accounts a join public.ledger_account_balances b on b.account_id = a.id
                        where a.owner_type = 'driver' and b.balance > 0),
    'owed_by_drivers', (select coalesce(-sum(b.balance), 0) from public.ledger_accounts a join public.ledger_account_balances b on b.account_id = a.id
                        where a.owner_type = 'driver' and b.balance < 0),
    'owed_by_passengers', (select coalesce(-sum(b.balance), 0) from public.ledger_accounts a join public.ledger_account_balances b on b.account_id = a.id
                           where a.owner_type = 'passenger' and b.balance < 0),
    'verification', (select jsonb_build_object('ran_at', v.ran_at, 'ok', v.ok, 'drift_count', v.drift_count, 'unbalanced_count', v.unbalanced_count, 'accounts_checked', v.accounts_checked)
                     from public.ledger_verification_runs v order by v.id desc limit 1));
end $$;

create function api.run_ledger_verification() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
begin
  perform private.require_permission('ledger.adjust_approve');
  v := private.verify_ledger_balances();
  perform private.log_admin_action('ledger.verify', 'ledger', null, null, jsonb_build_object('drift', jsonb_array_length(v -> 'drift'), 'unbalanced', jsonb_array_length(v -> 'unbalanced')), null);
  return v;
end $$;

create function api.list_ledger_accounts(p_owner_type text default null, p_search text default null, p_limit integer default 100) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
  v_search text := nullif(btrim(p_search), '');
begin
  perform private.require_permission('ledger.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'code', x.code, 'owner_type', x.owner_type, 'kind', x.kind, 'balance', x.balance, 'owner_name', x.owner_name,
      'updated_at', x.updated_at) order by x.balance), '[]')
    from (select a.id, a.code, a.owner_type, a.kind, coalesce(b.balance, 0) as balance, b.updated_at,
                 case a.owner_type
                   when 'driver' then (select pr.full_name from public.driver_profiles d join public.profiles pr on pr.id = d.user_id where d.id = a.owner_id)
                   when 'passenger' then (select pr.full_name from public.profiles pr where pr.id = a.owner_id) end as owner_name
          from public.ledger_accounts a left join public.ledger_account_balances b on b.account_id = a.id
          where (p_owner_type is null or a.owner_type = p_owner_type)
            and (v_search is null or a.code ilike '%' || v_search || '%')
          order by coalesce(b.balance, 0) limit v_limit) x);
end $$;

create function api.get_ledger_account(p_id uuid, p_limit integer default 50, p_cursor bigint default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  a public.ledger_accounts;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  perform private.require_permission('ledger.view');
  select * into a from public.ledger_accounts where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'transaction_id', e.transaction_id, 'debit', e.debit, 'credit', e.credit,
      'kind', t.kind, 'memo', t.memo, 'trip_id', t.trip_id, 'created_at', e.created_at) order by e.id desc), '[]') into v_rows
  from (select * from public.ledger_entries where account_id = p_id and (p_cursor is null or id < p_cursor) order by id desc limit v_limit + 1) e
  join public.ledger_transactions t on t.id = e.transaction_id;
  return jsonb_build_object(
    'account', jsonb_build_object('id', a.id, 'code', a.code, 'owner_type', a.owner_type, 'kind', a.kind,
      'balance', coalesce((select balance from public.ledger_account_balances where account_id = a.id), 0)),
    'entries', (select coalesce(jsonb_agg(r order by n), '[]') from jsonb_array_elements(v_rows) with ordinality x(r, n) where n <= v_limit),
    'next_cursor', case when jsonb_array_length(v_rows) > v_limit then (v_rows -> (v_limit - 1) ->> 'id') end);
end $$;

create function api.list_ledger_transactions(p_kind text default null, p_trip_id uuid default null, p_limit integer default 50, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  perform private.require_permission('ledger.view');
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', x.id, 'kind', x.kind, 'reference', x.reference, 'trip_id', x.trip_id, 'memo', x.memo, 'created_at', x.created_at,
      'reverses_id', x.reverses_id, 'reversed', exists (select 1 from public.ledger_transactions r where r.reverses_id = x.id),
      'amount', (select coalesce(sum(e.debit), 0) from public.ledger_entries e where e.transaction_id = x.id)) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select t.* from public.ledger_transactions t
        where (p_kind is null or t.kind = p_kind) and (p_trip_id is null or t.trip_id = p_trip_id)
          and (v_ts is null or (t.created_at, t.id) < (v_ts, v_id))
        order by t.created_at desc, t.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit);
end $$;

create function api.get_ledger_transaction(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  t public.ledger_transactions;
begin
  perform private.require_permission('ledger.view');
  select * into t from public.ledger_transactions where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return jsonb_build_object(
    'id', t.id, 'kind', t.kind, 'reference', t.reference, 'trip_id', t.trip_id, 'memo', t.memo, 'created_at', t.created_at,
    'reverses_id', t.reverses_id, 'reversed_by', (select r.id from public.ledger_transactions r where r.reverses_id = t.id),
    'created_by_name', (select full_name from public.profiles p where p.id = t.created_by),
    'entries', (select coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'account', a.code, 'debit', e.debit, 'credit', e.credit) order by e.id), '[]')
                from public.ledger_entries e join public.ledger_accounts a on a.id = e.account_id where e.transaction_id = t.id));
end $$;

-- ---------------------------------------------------------------------------
-- Refunds, adjustments and reversals (maker-checker)
-- ---------------------------------------------------------------------------
create function private.refund_row_json(r public.refunds_adjustments) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'status', r.status, 'amount', r.amount, 'currency', r.currency, 'reason', r.reason, 'evidence', r.evidence,
    'trip_id', r.trip_id, 'payment_id', r.payment_id, 'direction', r.direction, 'reverses_transaction_id', r.reverses_transaction_id,
    'account_id', r.account_id, 'account_code', (select code from public.ledger_accounts a where a.id = r.account_id),
    'passenger_name', (select full_name from public.profiles p where p.id = r.passenger_id),
    'requested_by', r.requested_by, 'requested_by_name', (select full_name from public.profiles p where p.id = r.requested_by),
    'approved_by_name', (select full_name from public.profiles p where p.id = r.approved_by),
    'second_approved_by_name', (select full_name from public.profiles p where p.id = r.second_approved_by),
    'needs_second_approval', r.amount >= coalesce((private.setting('finance.dual_approval_threshold'))::numeric, 5000),
    'rejection_reason', r.rejection_reason, 'ledger_transaction_id', r.ledger_transaction_id, 'created_at', r.created_at, 'updated_at', r.updated_at);
$$;

create function api.request_refund(p_payment_id uuid, p_amount numeric, p_reason text, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.payments;
  r public.refunds_adjustments;
  v_open numeric;
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_permission('refunds.request');
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"Enter an amount above zero (up to 2 decimals)."}]}');
  end if;
  select * into p from public.payments where id = p_payment_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p.status not in ('succeeded', 'partially_refunded') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', p.status));
  end if;
  select coalesce(sum(amount), 0) into v_open from public.refunds_adjustments
  where payment_id = p.id and kind = 'refund' and status in ('requested', 'awaiting_second_approval');
  if p_amount > p.amount - p.refunded_amount - v_open then
    perform private.raise_error('VALIDATION_FAILED', jsonb_build_object('fields', jsonb_build_array(jsonb_build_object(
      'path', 'amount', 'message', 'At most ' || (p.amount - p.refunded_amount - v_open) || ' can still be refunded on this payment.'))));
  end if;
  insert into public.refunds_adjustments (kind, trip_id, payment_id, passenger_id, amount, reason, evidence, requested_by)
  values ('refund', p.trip_id, p.id, p.passenger_id, p_amount, v_reason, left(nullif(btrim(p_evidence), ''), 2000), auth.uid())
  returning * into r;
  perform private.log_admin_action('refund.request', 'refund', r.id, null, private.refund_row_json(r), v_reason);
  perform private.notify_holders('refunds.approve', 'refund_requested', 'Refund awaiting approval', p_amount || ' BDT', '/refunds');
  return private.refund_row_json(r);
end $$;

create function api.request_adjustment(p_account_id uuid, p_direction text, p_amount numeric, p_reason text, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds_adjustments;
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_permission('ledger.adjust_request');
  if p_amount is null or p_amount <= 0 or scale(p_amount) > 2 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"Enter an amount above zero (up to 2 decimals)."}]}');
  end if;
  if p_direction is null or p_direction not in ('debit', 'credit') then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"direction","message":"Choose debit or credit."}]}');
  end if;
  if not exists (select 1 from public.ledger_accounts where id = p_account_id) then
    perform private.raise_error('NOT_FOUND');
  end if;
  insert into public.refunds_adjustments (kind, account_id, direction, amount, reason, evidence, requested_by)
  values ('adjustment', p_account_id, p_direction, p_amount, v_reason, left(nullif(btrim(p_evidence), ''), 2000), auth.uid())
  returning * into r;
  perform private.log_admin_action('adjustment.request', 'refund', r.id, null, private.refund_row_json(r), v_reason);
  perform private.notify_holders('ledger.adjust_approve', 'adjustment_requested', 'Ledger adjustment awaiting approval', p_amount || ' BDT', '/refunds');
  return private.refund_row_json(r);
end $$;

create function api.request_reversal(p_transaction_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.ledger_transactions;
  r public.refunds_adjustments;
  v_amount numeric;
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_permission('ledger.adjust_request');
  select * into o from public.ledger_transactions where id = p_transaction_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if o.kind = 'reversal' or exists (select 1 from public.ledger_transactions where reverses_id = o.id) then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"this transaction is a reversal or was already reversed"}');
  end if;
  select sum(debit) into v_amount from public.ledger_entries where transaction_id = o.id;
  begin
    insert into public.refunds_adjustments (kind, trip_id, reverses_transaction_id, amount, reason, requested_by)
    values ('reversal', o.trip_id, o.id, v_amount, v_reason, auth.uid()) returning * into r;
  exception when unique_violation then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"a reversal is already requested for this transaction"}');
  end;
  perform private.log_admin_action('reversal.request', 'refund', r.id, null, private.refund_row_json(r), v_reason);
  perform private.notify_holders('ledger.adjust_approve', 'reversal_requested', 'Ledger reversal awaiting approval', v_amount || ' BDT', '/refunds');
  return private.refund_row_json(r);
end $$;

create function api.list_refunds(p_status text default null, p_limit integer default 50, p_cursor text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_ts timestamptz;
  v_id uuid;
  v_rows jsonb;
begin
  if not private.has_any_permission(array['ledger.view', 'refunds.request', 'refunds.approve', 'ledger.adjust_request', 'ledger.adjust_approve']) then
    perform private.raise_error('FORBIDDEN');
  end if;
  if p_cursor is not null then
    v_ts := split_part(p_cursor, '|', 1)::timestamptz;
    v_id := split_part(p_cursor, '|', 2)::uuid;
  end if;
  select coalesce(jsonb_agg(private.refund_row_json(x) order by x.created_at desc, x.id desc), '[]') into v_rows
  from (select r.* from public.refunds_adjustments r
        where (p_status is null or (p_status = 'open' and r.status in ('requested', 'awaiting_second_approval')) or r.status = p_status)
          and (v_ts is null or (r.created_at, r.id) < (v_ts, v_id))
        order by r.created_at desc, r.id desc limit v_limit + 1) x;
  return private.page_rows(v_rows, v_limit) || jsonb_build_object('counts', (
    select jsonb_build_object('open', count(*) filter (where status in ('requested', 'awaiting_second_approval'))) from public.refunds_adjustments));
end $$;

-- Posts the approved request to the ledger. Re-checks every limit at the moment of posting.
create function private.process_refund(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds_adjustments;
  p public.payments;
  v_tx uuid;
begin
  select * into r from public.refunds_adjustments where id = p_id for update;
  if r.kind = 'refund' then
    select * into p from public.payments where id = r.payment_id for update;
    if r.amount > p.amount - p.refunded_amount then
      perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"amount","message":"The payment cannot be refunded by more than its amount."}]}');
    end if;
    v_tx := private.post_transaction('refund', r.id::text, r.trip_id, 'Refund to passenger wallet', jsonb_build_array(
      jsonb_build_object('account_id', private.platform_account('refund_expense'), 'debit', r.amount),
      jsonb_build_object('account_id', private.wallet_account('passenger', r.passenger_id), 'credit', r.amount)));
    update public.payments set refunded_amount = refunded_amount + r.amount,
      status = case when refunded_amount + r.amount >= amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end
    where id = p.id;
    insert into public.payment_events (payment_id, from_status, to_status, source, note)
    values (p.id, p.status, case when p.refunded_amount + r.amount >= p.amount then 'refunded'::public.payment_status else 'partially_refunded'::public.payment_status end,
            'admin', 'Refund ' || r.amount);
  elsif r.kind = 'adjustment' then
    v_tx := private.post_transaction('adjustment', r.id::text, null, left(r.reason, 200), jsonb_build_array(
      jsonb_build_object('account_id', case when r.direction = 'credit' then private.platform_account('adjustments') else r.account_id end, 'debit', r.amount),
      jsonb_build_object('account_id', case when r.direction = 'credit' then r.account_id else private.platform_account('adjustments') end, 'credit', r.amount)));
  else
    v_tx := private.reverse_transaction(r.reverses_transaction_id, 'reversal:' || r.id, left(r.reason, 200));
  end if;
  update public.refunds_adjustments set status = 'processed', ledger_transaction_id = v_tx where id = r.id;
end $$;

create function api.review_refund(p_id uuid, p_approve boolean, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds_adjustments;
  v_threshold numeric := coalesce((private.setting('finance.dual_approval_threshold'))::numeric, 5000);
begin
  select * into r from public.refunds_adjustments where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  perform private.require_permission(case when r.kind = 'refund' then 'refunds.approve' else 'ledger.adjust_approve' end);
  if r.status not in ('requested', 'awaiting_second_approval') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  if r.requested_by = auth.uid() or r.approved_by = auth.uid() then
    perform private.raise_error('SELF_APPROVAL');
  end if;

  if not coalesce(p_approve, false) then
    update public.refunds_adjustments set status = 'rejected', rejected_by = auth.uid(), rejection_reason = private.require_reason(p_reason) where id = r.id;
    perform private.log_admin_action(r.kind || '.reject', 'refund', r.id, jsonb_build_object('status', r.status), jsonb_build_object('status', 'rejected'), p_reason);
    perform private.notify(r.requested_by, 'refund_rejected', 'Your ' || r.kind || ' request was rejected', left(p_reason, 120), '/refunds');
  elsif r.approved_by is null then
    update public.refunds_adjustments set approved_by = auth.uid(), approved_at = now(),
      status = case when r.amount >= v_threshold then 'awaiting_second_approval' else status end where id = r.id;
    if r.amount >= v_threshold then
      perform private.log_admin_action(r.kind || '.approve_first', 'refund', r.id, null, null, p_reason);
      perform private.notify_holders(case when r.kind = 'refund' then 'refunds.approve' else 'ledger.adjust_approve' end,
        'refund_second_approval', 'A second approval is needed', r.amount || ' BDT', '/refunds');
    else
      perform private.process_refund(r.id);
      perform private.log_admin_action(r.kind || '.approve', 'refund', r.id, null, null, p_reason);
    end if;
  else
    update public.refunds_adjustments set second_approved_by = auth.uid() where id = r.id;
    perform private.process_refund(r.id);
    perform private.log_admin_action(r.kind || '.approve', 'refund', r.id, null, null, p_reason);
  end if;
  select * into r from public.refunds_adjustments where id = p_id;
  return private.refund_row_json(r);
end $$;

create function api.cancel_refund_request(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds_adjustments;
begin
  select * into r from public.refunds_adjustments where id = p_id for update;
  if not found or r.requested_by <> auth.uid() then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status not in ('requested', 'awaiting_second_approval') then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;
  update public.refunds_adjustments set status = 'cancelled' where id = r.id;
  perform private.log_admin_action(r.kind || '.cancel', 'refund', r.id, null, null, null);
end $$;

-- ---------------------------------------------------------------------------
-- Payout accounts and payouts
-- ---------------------------------------------------------------------------
create function api.list_payout_accounts(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('payouts.view');
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'driver_id', a.driver_id, 'driver_name', pr.full_name, 'method', a.method, 'account_holder', a.account_holder,
      'masked', a.account_ref_masked, 'status', a.status, 'review_note', a.review_note, 'created_at', a.created_at) order by a.created_at desc), '[]')
    from public.driver_payout_accounts a join public.driver_profiles d on d.id = a.driver_id join public.profiles pr on pr.id = d.user_id
    where a.is_default and (p_status is null or a.status = p_status));
end $$;

create function api.review_payout_account(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a public.driver_payout_accounts;
begin
  perform private.require_permission('payouts.approve');
  select * into a from public.driver_payout_accounts where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if a.status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', a.status));
  end if;
  if not coalesce(p_approve, false) then
    perform private.require_reason(p_note);
  end if;
  update public.driver_payout_accounts set status = case when p_approve then 'verified' else 'rejected' end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(p_note), ''), 500) where id = a.id;
  perform private.log_admin_action('payout_account.' || case when p_approve then 'verify' else 'reject' end, 'driver', a.driver_id, null, null, p_note);
end $$;

create function private.payout_batch_json(b public.payout_batches) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'period_start', b.period_start, 'period_end', b.period_end, 'total_amount', b.total_amount,
    'payout_count', b.payout_count, 'notes', b.notes, 'created_at', b.created_at, 'approved_at', b.approved_at,
    'created_by_name', (select full_name from public.profiles p where p.id = b.created_by),
    'approved_by_name', (select full_name from public.profiles p where p.id = b.approved_by),
    'counts', (select jsonb_build_object('pending', count(*) filter (where status = 'pending'), 'approved', count(*) filter (where status = 'approved'),
        'paid', count(*) filter (where status = 'paid'), 'failed', count(*) filter (where status = 'failed')) from public.payouts x where x.batch_id = b.id));
$$;

create function api.create_payout_batch(p_notes text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_min numeric := coalesce((private.setting('payouts.minimum_amount'))::numeric, 500);
  b public.payout_batches;
  v_count integer;
  v_total numeric;
begin
  perform private.require_permission('payouts.create');
  insert into public.payout_batches (period_start, period_end, notes, created_by)
  values ((now() - interval '7 days')::date, now()::date, left(nullif(btrim(p_notes), ''), 500), auth.uid()) returning * into b;

  insert into public.payouts (batch_id, driver_id, payout_account_id, amount)
  select b.id, d.id, a.id, bal.balance
  from public.driver_profiles d
  join public.driver_payout_accounts a on a.driver_id = d.id and a.is_default and a.status = 'verified'
  join public.ledger_accounts la on la.code = 'driver:' || d.id || ':wallet'
  join public.ledger_account_balances bal on bal.account_id = la.id
  where d.onboarding_status = 'approved' and bal.balance >= v_min
    and not exists (select 1 from public.payouts x where x.driver_id = d.id and x.status in ('pending', 'approved'))
  order by d.id;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    perform private.raise_error('NOTHING_TO_PAY');
  end if;

  update public.driver_earnings e set payout_status = 'in_payout', payout_id = p.id
  from public.payouts p where p.batch_id = b.id and p.driver_id = e.driver_id and e.payout_status = 'unpaid';
  select coalesce(sum(amount), 0) into v_total from public.payouts where batch_id = b.id;
  update public.payout_batches set total_amount = v_total, payout_count = v_count where id = b.id returning * into b;
  perform private.log_admin_action('payout_batch.create', 'payout_batch', b.id, null, private.payout_batch_json(b), p_notes);
  perform private.notify_holders('payouts.approve', 'payout_batch', 'Payout batch awaiting approval', v_count || ' drivers, ' || v_total || ' BDT', '/payouts');
  return private.payout_batch_json(b);
end $$;

create function api.list_payout_batches() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('payouts.view');
  return (select coalesce(jsonb_agg(private.payout_batch_json(b) order by b.created_at desc), '[]')
          from (select * from public.payout_batches order by created_at desc limit 50) b);
end $$;

create function api.get_payout_batch(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  b public.payout_batches;
begin
  perform private.require_permission('payouts.view');
  select * into b from public.payout_batches where id = p_id;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  return private.payout_batch_json(b) || jsonb_build_object('payouts', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'driver_id', p.driver_id, 'driver_name', pr.full_name, 'amount', p.amount, 'status', p.status, 'reference', p.reference,
      'failure_reason', p.failure_reason, 'method', a.method, 'masked', a.account_ref_masked, 'paid_at', p.paid_at) order by pr.full_name), '[]')
    from public.payouts p join public.driver_profiles d on d.id = p.driver_id join public.profiles pr on pr.id = d.user_id
    join public.driver_payout_accounts a on a.id = p.payout_account_id where p.batch_id = b.id));
end $$;

create function private.settle_batch_status(p_batch_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.payouts where batch_id = p_batch_id and status in ('pending', 'approved')) then
    update public.payout_batches set status = case when exists (select 1 from public.payouts where batch_id = p_batch_id and status = 'paid') then 'paid' else 'failed' end
    where id = p_batch_id and status in ('pending', 'approved');
  end if;
end $$;

create function api.approve_payout_batch(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.payout_batches;
  p record;
  v_balance numeric;
  v_tx uuid;
  v_ok integer := 0;
begin
  perform private.require_permission('payouts.approve');
  select * into b from public.payout_batches where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if b.status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', b.status));
  end if;
  if b.created_by = auth.uid() then
    perform private.raise_error('SELF_APPROVAL');
  end if;
  for p in select * from public.payouts where batch_id = b.id and status = 'pending' order by id for update loop
    select coalesce(bal.balance, 0) into v_balance from public.ledger_accounts la left join public.ledger_account_balances bal on bal.account_id = la.id
    where la.code = 'driver:' || p.driver_id || ':wallet';
    if coalesce(v_balance, 0) < p.amount then
      update public.payouts set status = 'failed', failure_reason = 'Wallet balance is below the payout amount.' where id = p.id;
      update public.driver_earnings set payout_status = 'unpaid', payout_id = null where payout_id = p.id;
    else
      v_tx := private.post_transaction('payout_approved', p.id::text, null, 'Payout approved', jsonb_build_array(
        jsonb_build_object('account_id', private.wallet_account('driver', p.driver_id), 'debit', p.amount),
        jsonb_build_object('account_id', private.platform_account('payouts_clearing'), 'credit', p.amount)));
      update public.payouts set status = 'approved', approved_by = auth.uid(), approved_at = now(), approve_transaction_id = v_tx where id = p.id;
      v_ok := v_ok + 1;
    end if;
  end loop;
  update public.payout_batches set status = case when v_ok > 0 then 'approved' else 'failed' end, approved_by = auth.uid(), approved_at = now() where id = b.id;
  perform private.log_admin_action('payout_batch.approve', 'payout_batch', b.id, null, jsonb_build_object('approved', v_ok), null);
  select * into b from public.payout_batches where id = p_id;
  return private.payout_batch_json(b);
end $$;

create function api.cancel_payout_batch(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.payout_batches;
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_permission('payouts.create');
  select * into b from public.payout_batches where id = p_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if b.status <> 'pending' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', b.status));
  end if;
  update public.driver_earnings set payout_status = 'unpaid', payout_id = null
  where payout_id in (select id from public.payouts where batch_id = b.id);
  update public.payouts set status = 'cancelled', failure_reason = v_reason where batch_id = b.id and status = 'pending';
  update public.payout_batches set status = 'cancelled' where id = b.id;
  perform private.log_admin_action('payout_batch.cancel', 'payout_batch', b.id, null, null, v_reason);
end $$;

create function api.mark_payout_paid(p_payout_id uuid, p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.payouts;
  v_ref text := nullif(btrim(p_reference), '');
  v_tx uuid;
begin
  perform private.require_permission('payouts.approve');
  if v_ref is null or length(v_ref) > 100 then
    perform private.raise_error('VALIDATION_FAILED', '{"fields":[{"path":"reference","message":"Enter the transfer reference."}]}');
  end if;
  select * into p from public.payouts where id = p_payout_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p.status <> 'approved' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', p.status));
  end if;
  v_tx := private.post_transaction('payout_paid', p.id::text, null, 'Payout paid', jsonb_build_array(
    jsonb_build_object('account_id', private.platform_account('payouts_clearing'), 'debit', p.amount),
    jsonb_build_object('account_id', private.platform_account('cash_on_hand'), 'credit', p.amount)));
  update public.payouts set status = 'paid', reference = v_ref, paid_by = auth.uid(), paid_at = now(), paid_transaction_id = v_tx where id = p.id;
  update public.driver_earnings set payout_status = 'paid' where payout_id = p.id;
  perform private.settle_batch_status(p.batch_id);
  perform private.log_admin_action('payout.paid', 'payout', p.id, null, jsonb_build_object('reference', v_ref), null);
  return api.get_payout_batch(p.batch_id);
end $$;

create function api.fail_payout(p_payout_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.payouts;
  v_reason text := private.require_reason(p_reason);
begin
  perform private.require_permission('payouts.approve');
  select * into p from public.payouts where id = p_payout_id for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if p.status <> 'approved' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', p.status));
  end if;
  -- Funds return to the wallet through a reversal of the approval posting.
  perform private.reverse_transaction(p.approve_transaction_id, 'payout_failed:' || p.id, 'Payout failed: ' || left(v_reason, 200));
  update public.payouts set status = 'failed', failure_reason = v_reason where id = p.id;
  update public.driver_earnings set payout_status = 'unpaid', payout_id = null where payout_id = p.id;
  perform private.settle_batch_status(p.batch_id);
  perform private.log_admin_action('payout.failed', 'payout', p.id, null, null, v_reason);
  return api.get_payout_batch(p.batch_id);
end $$;

-- ---------------------------------------------------------------------------
-- Overview for the payments page
-- ---------------------------------------------------------------------------
create function api.payments_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_permission('payments.view');
  return jsonb_build_object(
    'collected_today', (select coalesce(sum(collected_amount), 0) from public.payments where collected_at >= date_trunc('day', now())),
    'pending_cash', (select coalesce(sum(amount), 0) from public.payments where status = 'pending' and method = 'cash'),
    'refunds_open', (select count(*) from public.refunds_adjustments where status in ('requested', 'awaiting_second_approval')),
    'payouts_pending', (select count(*) from public.payout_batches where status in ('pending', 'approved')),
    'dues_total', (select coalesce(-sum(b.balance), 0) from public.ledger_accounts a join public.ledger_account_balances b on b.account_id = a.id
                   where a.owner_type = 'driver' and b.balance < 0));
end $$;

-- ---------------------------------------------------------------------------
-- Settlement hooks: complete_trip and cancel_ride re-declared with the M3 calls.
-- ---------------------------------------------------------------------------
create or replace function api.complete_trip(p_trip_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  t public.trips := private.driver_trip(p_trip_id);
  r public.ride_requests;
  v_loc extensions.geography;
  v_points integer;
  v_trail_m numeric;
  v_distance integer;
  v_source text;
  v_duration integer;
  v_waiting integer;
  v_surge numeric;
  v_b jsonb;
  v_review boolean;
  v_disc numeric;
  v_variance numeric := coalesce((private.setting('trips.fare_variance_pct'))::numeric, 30);
  v_factor numeric := coalesce((private.setting('trips.road_factor'))::numeric, 1.35);
begin
  if t.status = 'completed' then
    return api.get_driver_trip(p_trip_id); -- idempotent
  end if;
  t := private.lock_trip(p_trip_id);
  if t.status <> 'in_progress' then
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('from', t.status, 'to', 'completed'));
  end if;
  select * into r from public.ride_requests where id = t.request_id;
  select location into v_loc from public.driver_live_locations where driver_id = t.driver_id;

  -- Distance from the recorded trail; implausible points (poor accuracy, > 120 km/h) are dropped.
  with pts as (
    select location, recorded_at,
           lag(location) over (order by recorded_at, id) as prev_location,
           lag(recorded_at) over (order by recorded_at, id) as prev_at
    from public.trip_location_points
    where trip_id = t.id and (accuracy_m is null or accuracy_m <= 50)
  ), legs as (
    select extensions.st_distance(location, prev_location) as d,
           greatest(extract(epoch from recorded_at - prev_at), 0.001) as s
    from pts where prev_location is not null
  )
  select (select count(*) from public.trip_location_points where trip_id = t.id),
         coalesce(sum(d) filter (where d / s <= 33.3), 0)
  into v_points, v_trail_m from legs;

  if v_points >= 3 and v_trail_m >= 50 then
    v_distance := round(v_trail_m)::int;
    v_source := 'trail';
  else
    v_distance := round(coalesce(extensions.st_distance(coalesce(t.start_point, r.pickup_point), coalesce(v_loc, r.destination_point)) * v_factor,
                                 r.estimated_distance_m))::int;
    v_source := 'fallback';
  end if;
  v_distance := greatest(v_distance, 100);
  v_duration := greatest(round(extract(epoch from now() - t.started_at))::int, 30);
  v_waiting := greatest(round(extract(epoch from t.started_at - coalesce(t.arrived_at, t.started_at)))::int, 0);
  v_surge := coalesce((select (q.breakdown ->> 'surge_multiplier')::numeric from public.fare_quotes q where q.id = r.quote_id), 1);

  v_b := private.compute_fare(t.pricing_rule_snapshot, v_distance, v_duration, v_waiting, v_surge);
  -- Promotion: the discount is capped by what was reserved at request time.
  v_disc := private.promo_discount(t.request_id, (v_b ->> 'total_amount')::numeric);
  if v_disc > 0 then
    v_b := private.compute_fare(t.pricing_rule_snapshot, v_distance, v_duration, v_waiting, v_surge, v_disc);
  end if;
  v_review := (v_b ->> 'total_amount')::numeric + (v_b ->> 'discount_amount')::numeric > r.estimated_fare * (1 + v_variance / 100) or v_source = 'fallback';

  perform private.transition_trip(p_trip_id, 'completed', 'driver', null,
    jsonb_build_object('distance_source', v_source, 'trail_points', v_points), v_loc);

  insert into public.trip_fare_breakdowns (trip_id, base_amount, distance_amount, time_amount, surge_amount, waiting_amount,
    minimum_adjustment, rounding_amount, booking_fee, discount_amount, total_amount, commissionable_amount,
    platform_commission, driver_earning, commission_pct, distance_m, duration_s, pricing_rule_snapshot)
  values (p_trip_id, (v_b ->> 'base_amount')::numeric, (v_b ->> 'distance_amount')::numeric, (v_b ->> 'time_amount')::numeric,
    (v_b ->> 'surge_amount')::numeric, (v_b ->> 'waiting_amount')::numeric, (v_b ->> 'minimum_adjustment')::numeric,
    (v_b ->> 'rounding_amount')::numeric, (v_b ->> 'booking_fee')::numeric, (v_b ->> 'discount_amount')::numeric,
    (v_b ->> 'total_amount')::numeric, (v_b ->> 'commissionable_amount')::numeric, (v_b ->> 'platform_commission')::numeric,
    (v_b ->> 'driver_earning')::numeric, (v_b ->> 'commission_pct')::numeric, v_distance, v_duration, t.pricing_rule_snapshot);

  update public.trips set final_fare = (v_b ->> 'total_amount')::numeric, actual_distance_m = v_distance,
    actual_duration_s = v_duration, waiting_s = v_waiting, distance_source = v_source, fare_review_required = v_review
  where id = p_trip_id;

  perform private.settle_trip(p_trip_id);

  return api.get_driver_trip(p_trip_id);
end $$;

create or replace function api.cancel_ride(p_request_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.ride_requests;
  t public.trips;
  v_fee numeric;
begin
  perform private.require_role('passenger');
  select * into r from public.ride_requests where id = p_request_id and passenger_id = auth.uid() for update;
  if not found then
    perform private.raise_error('NOT_FOUND');
  end if;
  if r.status in ('cancelled_by_passenger', 'cancelled_by_driver', 'cancelled_by_admin', 'no_driver_found', 'failed', 'completed') then
    if r.status = 'cancelled_by_passenger' then
      return api.get_ride(p_request_id); -- idempotent
    end if;
    perform private.raise_error('INVALID_STATE_TRANSITION', jsonb_build_object('status', r.status));
  end if;

  if r.status = 'searching' then
    perform private.withdraw_pending_offers(r.id, 'passenger cancelled');
    update public.ride_requests set status = 'cancelled_by_passenger', closed_at = now(), cancel_reason = coalesce(nullif(btrim(p_reason), ''), 'Cancelled by passenger')
    where id = r.id;
    perform private.log_request_event(r.id, 'searching', 'cancelled_by_passenger', 'passenger', p_reason);
    perform private.broadcast('ride:' || r.id, 'status_changed', jsonb_build_object('request_id', r.id, 'status', 'cancelled_by_passenger'));
    perform private.notify_ops('request', r.id, 'cancelled_by_passenger');
    return api.get_ride(r.id);
  end if;

  select * into t from public.trips where request_id = r.id for update;
  if t.status = 'in_progress' then
    perform private.raise_error('INVALID_STATE_TRANSITION', '{"reason":"the ride has started"}');
  end if;
  v_fee := private.passenger_cancel_fee(t);
  perform private.transition_trip(t.id, 'cancelled_by_passenger', 'passenger',
    coalesce(nullif(btrim(p_reason), ''), 'Cancelled by passenger'), jsonb_build_object('fee', v_fee));
  update public.trips set cancellation_fee = v_fee where id = t.id;
  perform private.post_cancellation_fee(t.id);
  return api.get_ride(r.id);
end $$;

-- ---------------------------------------------------------------------------
-- Grants (functions are not executable by default)
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema api from public, anon;
revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function
  private.has_permission(text), private.is_admin(), private.has_aal2(), private.current_app_role(),
  private.can_upload_driver_document(text), private.my_driver_id(), private.my_trip_ids(), private.can_receive_topic(text)
to authenticated;
grant execute on function private.custom_access_token_hook(jsonb) to supabase_auth_admin;
do $$
declare
  f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'api' loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
