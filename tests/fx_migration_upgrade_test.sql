BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.fx_upgrade_test_baseline),
  10,
  'the upgrade fixture contains pre-existing USD, VND, JPY, future, and voided transactions'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.transaction_reporting_fx_snapshots AS snapshot
   JOIN public.fx_upgrade_test_baseline AS baseline ON baseline.transaction_id = snapshot.transaction_id
   WHERE snapshot.user_id = 'c8888888-8888-4888-8888-888888888888'),
  10,
  'the migration creates exactly one initial FX snapshot for every pre-existing income and expense'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.fx_upgrade_test_baseline AS baseline
    JOIN public.transaction_reporting_fx_snapshots AS snapshot
      ON snapshot.user_id = 'c8888888-8888-4888-8888-888888888888'
     AND snapshot.transaction_id = baseline.transaction_id
    JOIN public.transactions AS transaction_row ON transaction_row.id = baseline.transaction_id
    WHERE snapshot.revision <> 1
       OR snapshot.requested_on IS DISTINCT FROM transaction_row.occurred_on
       OR (
         snapshot.status = 'resolved'
         AND (
           snapshot.rate_to_jpy IS NULL
           OR NOT (snapshot.rate_to_jpy > 0 AND snapshot.rate_to_jpy < 'Infinity'::numeric)
           OR snapshot.converted_amount_jpy IS NULL
           OR snapshot.converted_amount_jpy < 0
           OR snapshot.converted_amount_jpy <> pg_catalog.trunc(snapshot.converted_amount_jpy)
           OR snapshot.resolution_reason IS NOT NULL
         )
       )
       OR (
         snapshot.status <> 'resolved'
         AND (
           snapshot.rate_to_jpy IS NOT NULL
           OR snapshot.converted_amount_jpy IS NOT NULL
           OR snapshot.resolution_reason IS NULL
           OR pg_catalog.length(pg_catalog.btrim(snapshot.resolution_reason)) = 0
         )
       )
       OR (
         snapshot.source_kind = 'identity'
         AND (
           snapshot.status <> 'resolved'
           OR snapshot.provider_code IS NOT NULL
           OR snapshot.rate_to_jpy IS DISTINCT FROM 1::numeric
           OR snapshot.rate_effective_on IS DISTINCT FROM snapshot.requested_on
           OR snapshot.fetched_at IS NOT NULL
           OR snapshot.override_note IS NOT NULL
         )
       )
       OR (
         snapshot.source_kind = 'unresolved'
         AND (
           snapshot.status = 'resolved'
           OR snapshot.rate_effective_on IS NOT NULL
           OR snapshot.fetched_at IS NOT NULL
           OR snapshot.provider_code IS NOT NULL
           OR snapshot.override_note IS NOT NULL
         )
       )
       OR snapshot.source_kind NOT IN ('identity', 'unresolved')
  ),
  'every initial snapshot has status-consistent source, reason, and nullable rate fields'
);

SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.fx_upgrade_test_baseline AS baseline
   JOIN public.transactions AS transaction_row ON transaction_row.id = baseline.transaction_id
   JOIN public.transaction_reporting_fx_snapshots AS snapshot
     ON snapshot.user_id = transaction_row.user_id AND snapshot.transaction_id = transaction_row.id
   WHERE baseline.label IN (
     'historical_usd_income', 'historical_usd_expense', 'current_usd_income',
     'historical_vnd_income', 'historical_vnd_expense', 'voided_historical_usd_expense'
   )
     AND transaction_row.occurred_on <= (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
     AND snapshot.status = 'unresolved'
     AND snapshot.source_kind = 'unresolved'
     AND snapshot.rate_to_jpy IS NULL
     AND snapshot.converted_amount_jpy IS NULL
     AND snapshot.rate_effective_on IS NULL
     AND snapshot.fetched_at IS NULL
     AND snapshot.provider_code IS NULL
     AND snapshot.resolution_reason IS NOT NULL
     AND pg_catalog.length(pg_catalog.btrim(snapshot.resolution_reason)) > 0),
  6,
  'historical and current USD/VND transactions, including a voided transaction, remain unresolved without fabricated rates'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.fx_upgrade_test_baseline AS baseline
   JOIN public.transactions AS transaction_row ON transaction_row.id = baseline.transaction_id
   JOIN public.transaction_reporting_fx_snapshots AS snapshot
     ON snapshot.user_id = transaction_row.user_id AND snapshot.transaction_id = transaction_row.id
   WHERE baseline.label IN ('jpy_income', 'jpy_expense')
     AND snapshot.status = 'resolved'
     AND snapshot.source_kind = 'identity'
     AND snapshot.rate_to_jpy = 1
     AND snapshot.converted_amount_jpy = transaction_row.amount
     AND snapshot.requested_on = transaction_row.occurred_on
     AND snapshot.rate_effective_on = transaction_row.occurred_on
     AND snapshot.provider_code IS NULL
     AND snapshot.fetched_at IS NULL
     AND snapshot.resolution_reason IS NULL),
  2,
  'existing JPY transactions receive exact rate-one identity conversions'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.fx_upgrade_test_baseline AS baseline
   JOIN public.transactions AS transaction_row ON transaction_row.id = baseline.transaction_id
   JOIN public.transaction_reporting_fx_snapshots AS snapshot
     ON snapshot.user_id = transaction_row.user_id AND snapshot.transaction_id = transaction_row.id
   WHERE baseline.label IN ('future_usd_expense', 'future_vnd_income')
     AND transaction_row.occurred_on > (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
     AND snapshot.status = 'pending_future'
     AND snapshot.source_kind = 'unresolved'
     AND snapshot.rate_to_jpy IS NULL
     AND snapshot.converted_amount_jpy IS NULL
     AND snapshot.rate_effective_on IS NULL
     AND snapshot.fetched_at IS NULL
     AND snapshot.provider_code IS NULL
     AND snapshot.resolution_reason IS NOT NULL
     AND pg_catalog.length(pg_catalog.btrim(snapshot.resolution_reason)) > 0),
  2,
  'future-dated foreign-currency transactions remain pending without a rate lookup'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.fx_upgrade_test_baseline AS baseline
    JOIN public.transactions AS transaction_row ON transaction_row.id = baseline.transaction_id
    WHERE baseline.transaction_before IS DISTINCT FROM pg_catalog.jsonb_build_object(
      'id', transaction_row.id,
      'user_id', transaction_row.user_id,
      'idempotency_key', transaction_row.idempotency_key,
      'transaction_kind', transaction_row.transaction_kind,
      'occurred_at', transaction_row.occurred_at,
      'occurred_on', transaction_row.occurred_on,
      'amount', transaction_row.amount::text,
      'currency_code', transaction_row.currency_code,
      'category_id', transaction_row.category_id,
      'payment_method_id', transaction_row.payment_method_id,
      'source', transaction_row.source,
      'merchant', transaction_row.merchant,
      'note', transaction_row.note,
      'adjustment_reason', transaction_row.adjustment_reason,
      'status', transaction_row.status,
      'voided_at', transaction_row.voided_at,
      'voided_by', transaction_row.voided_by,
      'void_reason', transaction_row.void_reason,
      'created_at', transaction_row.created_at,
      'updated_at', transaction_row.updated_at
    )
  ),
  'native amounts and every original transaction field remain unchanged by the FX migration'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.fx_rate_cache
   WHERE user_id = 'c8888888-8888-4888-8888-888888888888'),
  0,
  'the migration creates no provider cache rows or fetched FX observations'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.transaction_reporting_fx_snapshots AS snapshot
    JOIN public.fx_upgrade_test_baseline AS baseline ON baseline.transaction_id = snapshot.transaction_id
    WHERE snapshot.user_id = 'c8888888-8888-4888-8888-888888888888'
      AND (snapshot.provider_code IS NOT NULL OR snapshot.provider_metadata <> '{}'::jsonb)
  ),
  'the migration records no provider-sourced snapshot metadata'
);

SET LOCAL request.jwt.claim.sub = 'c8888888-8888-4888-8888-888888888888';
SET LOCAL request.jwt.claims = '{"sub":"c8888888-8888-4888-8888-888888888888","role":"authenticated"}';
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer
   FROM public.list_transactions(p_limit => 100, p_offset => 0) AS history
   JOIN public.fx_upgrade_test_baseline AS baseline ON baseline.transaction_id = history.transaction_id),
  10,
  'the existing transactions remain present in the owner transaction history'
);
SELECT extensions.ok(
  NOT EXISTS (
    SELECT 1
    FROM public.fx_upgrade_test_baseline AS baseline
    LEFT JOIN LATERAL public.list_transactions(
      p_transaction_id => baseline.transaction_id,
      p_limit => 1,
      p_offset => 0
    ) AS history ON true
    WHERE history.transaction_id IS NULL
       OR history.transaction_kind IS DISTINCT FROM baseline.transaction_kind::text
       OR history.occurred_on IS DISTINCT FROM baseline.occurred_on
       OR history.amount IS DISTINCT FROM baseline.amount::text
       OR history.currency_code IS DISTINCT FROM baseline.currency_code
       OR history.status IS DISTINCT FROM baseline.status::text
       OR history.merchant IS DISTINCT FROM 'Synthetic ' || baseline.label
       OR history.note IS DISTINCT FROM baseline.label
       OR history.void_reason IS DISTINCT FROM CASE WHEN baseline.status = 'voided' THEN 'Synthetic pre-migration void' END
  ),
  'transaction history retains native values and void audit details from before the migration'
);

SELECT * FROM extensions.finish();
ROLLBACK;
