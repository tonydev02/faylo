BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

CREATE TEMP TABLE fx_reporting_context (
  today date NOT NULL,
  future_date date NOT NULL,
  current_month date NOT NULL,
  future_month date NOT NULL
);
INSERT INTO pg_temp.fx_reporting_context
SELECT today,
       today + 1,
       pg_catalog.date_trunc('month', today::timestamp)::date,
       pg_catalog.date_trunc('month', (today + 1)::timestamp)::date
FROM (SELECT (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date AS today) AS clock;

CREATE TEMP TABLE fx_test_transactions (label text PRIMARY KEY, transaction_id uuid NOT NULL);
CREATE TEMP TABLE fx_test_snapshots (label text PRIMARY KEY, snapshot_id uuid NOT NULL);
CREATE TEMP TABLE fx_reporting_baseline (
  month_start date NOT NULL,
  transaction_kind text NOT NULL,
  currency_code text,
  total_amount text,
  transaction_count bigint NOT NULL,
  resolved_total_jpy text,
  resolved_transaction_count bigint NOT NULL,
  unresolved_transaction_count bigint NOT NULL,
  included_transaction_count bigint NOT NULL
);
GRANT SELECT, INSERT ON TABLE pg_temp.fx_test_transactions, pg_temp.fx_test_snapshots, pg_temp.fx_reporting_baseline, pg_temp.fx_reporting_context TO authenticated;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('a8888888-8888-4888-8888-888888888888', 'authenticated', 'authenticated', 'fx-owner@test.invalid', now(), now()),
  ('b9999999-9999-4999-8999-999999999999', 'authenticated', 'authenticated', 'fx-other@test.invalid', now(), now());
INSERT INTO private.owner_allowlist (singleton, owner_user_id)
VALUES (true, 'a8888888-8888-4888-8888-888888888888')
ON CONFLICT (singleton) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id;
INSERT INTO public.user_preferences (user_id, base_currency, timezone)
VALUES ('a8888888-8888-4888-8888-888888888888', 'JPY', 'Asia/Tokyo');
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES
  ('a8888888-8888-4888-8888-888888888888', 'Synthetic FX owner account', 'cash', 'JPY', 0, (SELECT today - 1 FROM pg_temp.fx_reporting_context)),
  ('b9999999-9999-4999-8999-999999999999', 'Synthetic FX other account', 'cash', 'JPY', 0, (SELECT today - 1 FROM pg_temp.fx_reporting_context));
INSERT INTO public.categories (user_id, kind, name)
VALUES
  ('a8888888-8888-4888-8888-888888888888', 'income', 'Synthetic FX income'),
  ('a8888888-8888-4888-8888-888888888888', 'expense', 'Synthetic FX expense'),
  ('b9999999-9999-4999-8999-999999999999', 'income', 'Other synthetic FX income');

-- Create an unrelated owner's snapshot and rate cache to verify row-level isolation.
UPDATE private.owner_allowlist SET owner_user_id = 'b9999999-9999-4999-8999-999999999999' WHERE singleton;
SET LOCAL request.jwt.claim.sub = 'b9999999-9999-4999-8999-999999999999';
SET LOCAL request.jwt.claims = '{"sub":"b9999999-9999-4999-8999-999999999999","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO pg_temp.fx_test_transactions
SELECT 'other_owner', public.post_transaction(
  'd0000000-0000-4000-8000-000000000001', 'income', (SELECT today FROM pg_temp.fx_reporting_context),
  '2.00', 'USD', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Other synthetic FX income'),
  NULL, '[]'::jsonb
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'other_owner', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'other_owner'),
  'd0000000-0000-4000-8000-000000000002', 'resolved', 155.5, 'frankfurter_blended', 'frankfurter',
  (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.statement_timestamp(),
  '{"providers":["ECB"]}'::jsonb, NULL,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
    'rate', '155.5', 'providers', pg_catalog.jsonb_build_array('ECB')
  )),
  (SELECT today - 7 FROM pg_temp.fx_reporting_context),
  (SELECT today FROM pg_temp.fx_reporting_context)
);
RESET ROLE;
UPDATE private.owner_allowlist SET owner_user_id = 'a8888888-8888-4888-8888-888888888888' WHERE singleton;
SET LOCAL request.jwt.claim.sub = 'a8888888-8888-4888-8888-888888888888';
SET LOCAL request.jwt.claims = '{"sub":"a8888888-8888-4888-8888-888888888888","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO pg_temp.fx_test_transactions
SELECT 'resolved_usd', public.post_transaction(
  'd0000000-0000-4000-8000-000000000010', 'income', (SELECT today FROM pg_temp.fx_reporting_context),
  '0.01', 'USD', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic FX income'),
  NULL, '[]'::jsonb
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'automatic', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
  'd0000000-0000-4000-8000-000000000011', 'resolved', 150.5, 'frankfurter_blended', 'frankfurter',
  (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.transaction_timestamp(),
  '{"providers":["ECB"]}'::jsonb, NULL,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
    'rate', '150.5', 'providers', pg_catalog.jsonb_build_array('ECB')
  )),
  (SELECT today - 7 FROM pg_temp.fx_reporting_context),
  (SELECT today FROM pg_temp.fx_reporting_context)
);

SELECT extensions.is(
  (SELECT converted_amount_jpy::text FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'automatic')),
  '2',
  'per-transaction numeric conversion rounds the 1.505 JPY tie away from zero'
);
SELECT extensions.is(
  (SELECT rate_effective_on::text FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'automatic')),
  (SELECT today::text FROM pg_temp.fx_reporting_context),
  'the snapshot preserves Frankfurter’s actual effective date'
);
SELECT extensions.is(
  public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000011', 'resolved', 150.5, 'frankfurter_blended', 'frankfurter',
    (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.transaction_timestamp(),
    '{"providers":["ECB"]}'::jsonb, NULL,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
      'rate', '150.5', 'providers', pg_catalog.jsonb_build_array('ECB')
    )),
    (SELECT today - 7 FROM pg_temp.fx_reporting_context),
    (SELECT today FROM pg_temp.fx_reporting_context)
  ),
  (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'automatic'),
  'replaying the same automatic idempotency key returns its original snapshot'
);
SELECT extensions.throws_ok(
  $$SELECT public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000013', 'resolved', 151.5, 'frankfurter_blended', 'frankfurter',
    (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.transaction_timestamp(),
    '{"providers":["ECB"]}'::jsonb, NULL,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
      'rate', '150.5', 'providers', pg_catalog.jsonb_build_array('ECB')
    )),
    (SELECT today - 7 FROM pg_temp.fx_reporting_context),
    (SELECT today FROM pg_temp.fx_reporting_context)
  )$$,
  '22023', NULL, 'automatic snapshots must match the cached Frankfurter observation'
);

SELECT extensions.is(
  public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000012', 'resolved', 150.5, 'frankfurter_blended', 'frankfurter',
    (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.transaction_timestamp(),
    '{"providers":["ECB"]}'::jsonb, NULL,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
      'rate', '150.5', 'providers', pg_catalog.jsonb_build_array('ECB')
    )),
    (SELECT today - 7 FROM pg_temp.fx_reporting_context),
    (SELECT today FROM pg_temp.fx_reporting_context)
  ),
  (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'automatic'),
  'row locking and fingerprint equality coalesce an identical concurrent automatic snapshot'
);
SELECT extensions.throws_ok(
  $$SELECT public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000011', 'resolved', 151.5, 'frankfurter_blended', 'frankfurter',
    (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.transaction_timestamp(),
    '{"providers":["ECB"]}'::jsonb, NULL, '[]'::jsonb, NULL, NULL
  )$$,
  '23505', NULL, 'reusing an automatic idempotency key for different details is rejected'
);
SELECT extensions.is(
  (SELECT rate FROM public.get_cached_reporting_fx_rate('USD', (SELECT today FROM pg_temp.fx_reporting_context))),
  '150.5',
  'owner cache lookup returns the exact historical rate as text'
);
SELECT extensions.is(
  (SELECT effective_on::text FROM public.get_cached_reporting_fx_rate('USD', (SELECT today FROM pg_temp.fx_reporting_context))),
  (SELECT today::text FROM pg_temp.fx_reporting_context),
  'cache hits retain their actual effective date'
);

INSERT INTO pg_temp.fx_test_transactions
SELECT 'native_jpy', public.post_transaction(
  'd0000000-0000-4000-8000-000000000020', 'income', (SELECT today FROM pg_temp.fx_reporting_context),
  '100', 'JPY', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic FX income'),
  NULL, '[]'::jsonb
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'identity', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'native_jpy'),
  'd0000000-0000-4000-8000-000000000021', 'resolved', 1, 'identity', NULL,
  (SELECT today FROM pg_temp.fx_reporting_context), NULL, '{}'::jsonb, NULL, '[]'::jsonb, NULL, NULL
);
SELECT extensions.is(
  (SELECT converted_amount_jpy::text FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'identity')),
  '100',
  'JPY-native income uses an exact identity snapshot'
);

INSERT INTO pg_temp.fx_test_transactions
SELECT 'unavailable_usd', public.post_transaction(
  'd0000000-0000-4000-8000-000000000030', 'expense', (SELECT today FROM pg_temp.fx_reporting_context),
  '10.00', 'USD', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic FX expense'),
  NULL, '[]'::jsonb
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'unavailable', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'unavailable_usd'),
  'd0000000-0000-4000-8000-000000000031', 'unavailable', NULL, 'unresolved', 'frankfurter',
  NULL, pg_catalog.statement_timestamp(), '{"failure":"no_eligible_rate"}'::jsonb,
  'No eligible historical rate was available in the seven-day window.', '[]'::jsonb, NULL, NULL
);
SELECT extensions.is(
  (SELECT status FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'unavailable')),
  'unavailable',
  'a missing historical rate remains explicitly unavailable rather than becoming zero'
);
SELECT extensions.is(
  (SELECT resolved_total_jpy FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'USD'),
  NULL::text,
  'an expense with no resolved FX rate has no fabricated JPY subtotal'
);
SELECT extensions.is(
  (SELECT unresolved_transaction_count FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'USD'),
  1::bigint,
  'incomplete reporting counts every included unresolved conversion'
);

SELECT extensions.throws_ok(
  $$SELECT public.override_transaction_reporting_fx(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000040', 250.25,
    (SELECT today FROM pg_temp.fx_reporting_context), ''
  )$$,
  '22023', NULL, 'manual FX overrides require a non-empty explanation'
);
SELECT extensions.throws_ok(
  $$SELECT public.override_transaction_reporting_fx(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000041', 250.25,
    (SELECT today - 8 FROM pg_temp.fx_reporting_context), 'Synthetic explanation'
  )$$,
  '22023', NULL, 'manual FX overrides reject rates more than seven days before the transaction date'
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'manual', public.override_transaction_reporting_fx(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
  'd0000000-0000-4000-8000-000000000042', 250.25,
  (SELECT today FROM pg_temp.fx_reporting_context), 'Synthetic manual correction'
);
SELECT extensions.is(
  (SELECT revision FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual')),
  2,
  'manual override appends an immutable revision'
);
SELECT extensions.is(
  (SELECT converted_amount_jpy::text FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual')),
  '3',
  'manual rate conversion uses exact decimal multiplication and per-transaction JPY rounding'
);
SELECT extensions.is(
  (SELECT override_note FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual')),
  'Synthetic manual correction',
  'manual explanation is retained in the revision audit'
);
SELECT extensions.is(
  public.override_transaction_reporting_fx(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000042', 250.25,
    (SELECT today FROM pg_temp.fx_reporting_context), 'Synthetic manual correction'
  ),
  (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual'),
  'replaying a manual override with the same idempotency key returns its original revision'
);
SELECT extensions.throws_ok(
  $$SELECT public.override_transaction_reporting_fx(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000042', 251.25,
    (SELECT today FROM pg_temp.fx_reporting_context), 'Synthetic manual correction'
  )$$,
  '23505', NULL, 'reusing a manual override key with changed details is rejected'
);
SELECT extensions.is(
  public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    'd0000000-0000-4000-8000-000000000043', 'resolved', 150.5, 'frankfurter_blended', 'frankfurter',
    (SELECT today FROM pg_temp.fx_reporting_context), pg_catalog.statement_timestamp(),
    '{"providers":["ECB"]}'::jsonb, NULL,
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'effective_on', (SELECT today::text FROM pg_temp.fx_reporting_context),
      'rate', '150.5', 'providers', pg_catalog.jsonb_build_array('ECB')
    )),
    (SELECT today - 7 FROM pg_temp.fx_reporting_context),
    (SELECT today FROM pg_temp.fx_reporting_context)
  ),
  (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual'),
  'automatic resolution cannot overwrite a newer manual override'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transaction_reporting_fx_snapshots
   WHERE transaction_id = (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd')),
  2,
  'automatic resolution after a manual override does not append a third revision'
);
SELECT extensions.is(
  (SELECT amount::text || ':' || currency_code FROM public.transactions
   WHERE id = (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd')),
  '0.01:USD',
  'manual FX revision leaves the original transaction amount and currency unchanged'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries
   WHERE transaction_id = (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd')),
  0,
  'FX reporting does not create or alter account movements'
);
SELECT extensions.is(
  (SELECT resolved_total_jpy FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'income' AND currency_code = 'USD'),
  '103',
  'monthly JPY subtotal sums the latest per-transaction snapshots after manual revision'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'income' AND currency_code = 'USD'),
  '0.01',
  'native USD income total remains exact and unchanged by JPY reporting'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'income' AND currency_code = 'JPY'),
  '100',
  'native JPY income remains grouped separately from USD income'
);
SELECT extensions.is(
  (SELECT resolved_transaction_count FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
   WHERE transaction_kind = 'income' AND currency_code = 'JPY'),
  2::bigint,
  'resolved transaction counts include both foreign-currency and JPY identity snapshots'
);
SELECT extensions.is(
  (SELECT reporting_fx->>'rate_effective_on' FROM public.list_transactions(
    p_transaction_id => (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    p_limit => 1, p_offset => 0
  )),
  (SELECT today::text FROM pg_temp.fx_reporting_context),
  'transaction history returns the exact current FX snapshot metadata'
);
SELECT extensions.is(
  (SELECT pg_catalog.jsonb_array_length(reporting_fx_history) FROM public.list_transactions(
    p_transaction_id => (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'resolved_usd'),
    p_limit => 1, p_offset => 0
  )),
  2,
  'transaction history retains automatic and manual reporting revisions'
);
SELECT extensions.throws_ok(
  $$UPDATE public.transaction_reporting_fx_snapshots SET revision = 99
    WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'manual')$$,
  '42501', NULL, 'authenticated users cannot mutate append-only FX snapshots directly'
);

INSERT INTO pg_temp.fx_reporting_baseline
SELECT (SELECT current_month FROM pg_temp.fx_reporting_context),
       transaction_kind, currency_code, total_amount, transaction_count,
       resolved_total_jpy, resolved_transaction_count, unresolved_transaction_count, included_transaction_count
FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context));
INSERT INTO pg_temp.fx_test_transactions
SELECT 'future_usd', public.post_transaction(
  'd0000000-0000-4000-8000-000000000050', 'expense', (SELECT future_date FROM pg_temp.fx_reporting_context),
  '999.00', 'USD', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic FX expense'),
  NULL, '[]'::jsonb, 'manual', 'Synthetic future event', NULL, NULL,
  ((SELECT future_date FROM pg_temp.fx_reporting_context)::timestamp AT TIME ZONE 'Asia/Tokyo')
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'future_pending', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'future_usd'),
  'd0000000-0000-4000-8000-000000000051', 'pending_future', NULL, 'unresolved', NULL,
  NULL, NULL, '{}'::jsonb,
  'Future-effective foreign-currency transaction is not yet eligible for lookup.', '[]'::jsonb, NULL, NULL
);
SELECT extensions.is(
  (SELECT status FROM public.transaction_reporting_fx_snapshots
   WHERE id = (SELECT snapshot_id FROM pg_temp.fx_test_snapshots WHERE label = 'future_pending')),
  'pending_future',
  'future-effective FX remains pending without a provider rate'
);
INSERT INTO pg_temp.fx_test_transactions
SELECT 'future_timestamp_usd', public.post_transaction(
  'd0000000-0000-4000-8000-000000000052', 'expense', (SELECT today FROM pg_temp.fx_reporting_context),
  '3.00', 'USD', (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic FX expense'),
  NULL, '[]'::jsonb, 'manual', 'Synthetic future timestamp event', NULL, NULL,
  (((SELECT today FROM pg_temp.fx_reporting_context)::timestamp + INTERVAL '23 hours 59 minutes 59 seconds')
    AT TIME ZONE 'Asia/Tokyo')
);
INSERT INTO pg_temp.fx_test_snapshots
SELECT 'future_timestamp_unresolved', public.record_transaction_reporting_fx_snapshot(
  (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'future_timestamp_usd'),
  'd0000000-0000-4000-8000-000000000053', 'unresolved', NULL, 'unresolved', 'frankfurter',
  NULL, NULL, '{"failure":"synthetic_future_timestamp"}'::jsonb,
  'Synthetic future timestamp has no eligible JPY snapshot yet.', '[]'::jsonb, NULL, NULL
);
SELECT extensions.ok(
  (SELECT occurred_at > pg_catalog.statement_timestamp()
   FROM public.transactions
   WHERE id = (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'future_timestamp_usd')),
  'the same-day regression fixture is future-effective at statement time'
);

SELECT extensions.ok(
  NOT EXISTS (
    (SELECT transaction_kind, currency_code, total_amount, transaction_count, resolved_total_jpy,
            resolved_transaction_count, unresolved_transaction_count, included_transaction_count
     FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
     EXCEPT
     SELECT transaction_kind, currency_code, total_amount, transaction_count, resolved_total_jpy,
            resolved_transaction_count, unresolved_transaction_count, included_transaction_count
     FROM pg_temp.fx_reporting_baseline)
  )
  AND NOT EXISTS (
    (SELECT transaction_kind, currency_code, total_amount, transaction_count, resolved_total_jpy,
            resolved_transaction_count, unresolved_transaction_count, included_transaction_count
     FROM pg_temp.fx_reporting_baseline)
     EXCEPT
     SELECT transaction_kind, currency_code, total_amount, transaction_count, resolved_total_jpy,
            resolved_transaction_count, unresolved_transaction_count, included_transaction_count
     FROM public.transaction_totals((SELECT current_month FROM pg_temp.fx_reporting_context))
  ),
  'future-effective transactions do not change current native totals, JPY totals, or unresolved counts'
);

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transaction_reporting_fx_snapshots
   WHERE user_id = 'b9999999-9999-4999-8999-999999999999'),
  0,
  'owner row-level security hides another user’s FX snapshots'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.fx_rate_cache
   WHERE user_id = 'b9999999-9999-4999-8999-999999999999'),
  0,
  'owner row-level security hides another user’s FX cache'
);
SELECT extensions.throws_ok(
  $$SELECT public.record_transaction_reporting_fx_snapshot(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'other_owner'),
    'd0000000-0000-4000-8000-000000000060', 'unresolved', NULL, 'unresolved', 'frankfurter',
    NULL, NULL, '{"failure":"cross_owner"}'::jsonb, 'Synthetic cross-owner attempt', '[]'::jsonb, NULL, NULL
  )$$,
  '23503', NULL, 'FX snapshot RPC cannot write against another owner’s transaction'
);

RESET ROLE;
SET LOCAL request.jwt.claim.sub = 'b9999999-9999-4999-8999-999999999999';
SET LOCAL request.jwt.claims = '{"sub":"b9999999-9999-4999-8999-999999999999","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transaction_reporting_fx_snapshots),
  0,
  'non-owner cannot read FX snapshots'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.get_cached_reporting_fx_rate('USD', (SELECT today FROM pg_temp.fx_reporting_context))$$,
  '42501', NULL, 'non-owner cannot resolve cached FX rates'
);
SELECT extensions.throws_ok(
  $$SELECT public.override_transaction_reporting_fx(
    (SELECT transaction_id FROM pg_temp.fx_test_transactions WHERE label = 'other_owner'),
    'd0000000-0000-4000-8000-000000000061', 200,
    (SELECT today FROM pg_temp.fx_reporting_context), 'Synthetic unauthorized attempt'
  )$$,
  '42501', NULL, 'non-owner cannot create manual reporting revisions'
);

SELECT * FROM extensions.finish();
ROLLBACK;
