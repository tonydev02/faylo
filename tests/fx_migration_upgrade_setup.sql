DO $fx_migration_upgrade_setup$
BEGIN

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES (
  'c8888888-8888-4888-8888-888888888888',
  'authenticated',
  'authenticated',
  'fx-migration-upgrade@test.invalid',
  pg_catalog.statement_timestamp(),
  pg_catalog.statement_timestamp()
);
INSERT INTO private.owner_allowlist (singleton, owner_user_id)
VALUES (true, 'c8888888-8888-4888-8888-888888888888');
INSERT INTO public.categories (user_id, id, kind, name)
VALUES
  ('c8888888-8888-4888-8888-888888888888', 'c1000000-0000-4000-8000-000000000001', 'income', 'FX upgrade income'),
  ('c8888888-8888-4888-8888-888888888888', 'c1000000-0000-4000-8000-000000000002', 'expense', 'FX upgrade expense');

CREATE TABLE public.fx_upgrade_test_baseline (
  label text PRIMARY KEY,
  transaction_id uuid NOT NULL UNIQUE,
  transaction_kind public.transaction_kind NOT NULL,
  occurred_on date NOT NULL,
  amount numeric NOT NULL,
  currency_code text NOT NULL,
  status public.transaction_status NOT NULL,
  transaction_before jsonb
);

WITH date_window AS (
  SELECT (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date AS today
)
INSERT INTO public.fx_upgrade_test_baseline (
  label, transaction_id, transaction_kind, occurred_on, amount, currency_code, status
)
SELECT fixture.label,
       fixture.transaction_id,
       fixture.transaction_kind,
       fixture.occurred_on,
       fixture.amount,
       fixture.currency_code,
       fixture.status
FROM date_window
CROSS JOIN LATERAL (
  VALUES
    ('historical_usd_income', 'c2000000-0000-4000-8000-000000000001'::uuid, 'income'::public.transaction_kind, date_window.today - 10, 12.34::numeric, 'USD', 'posted'::public.transaction_status),
    ('historical_usd_expense', 'c2000000-0000-4000-8000-000000000002'::uuid, 'expense'::public.transaction_kind, date_window.today - 9, 6.78::numeric, 'USD', 'posted'::public.transaction_status),
    ('current_usd_income', 'c2000000-0000-4000-8000-000000000003'::uuid, 'income'::public.transaction_kind, date_window.today, 25.00::numeric, 'USD', 'posted'::public.transaction_status),
    ('historical_vnd_income', 'c2000000-0000-4000-8000-000000000004'::uuid, 'income'::public.transaction_kind, date_window.today - 8, 250000::numeric, 'VND', 'posted'::public.transaction_status),
    ('historical_vnd_expense', 'c2000000-0000-4000-8000-000000000005'::uuid, 'expense'::public.transaction_kind, date_window.today - 7, 150000::numeric, 'VND', 'posted'::public.transaction_status),
    ('jpy_income', 'c2000000-0000-4000-8000-000000000006'::uuid, 'income'::public.transaction_kind, date_window.today - 5, 1500::numeric, 'JPY', 'posted'::public.transaction_status),
    ('jpy_expense', 'c2000000-0000-4000-8000-000000000007'::uuid, 'expense'::public.transaction_kind, date_window.today, 2500::numeric, 'JPY', 'posted'::public.transaction_status),
    ('future_usd_expense', 'c2000000-0000-4000-8000-000000000008'::uuid, 'expense'::public.transaction_kind, date_window.today + 2, 3.21::numeric, 'USD', 'posted'::public.transaction_status),
    ('future_vnd_income', 'c2000000-0000-4000-8000-000000000009'::uuid, 'income'::public.transaction_kind, date_window.today + 2, 10000::numeric, 'VND', 'posted'::public.transaction_status),
    ('voided_historical_usd_expense', 'c2000000-0000-4000-8000-000000000010'::uuid, 'expense'::public.transaction_kind, date_window.today - 30, 11.11::numeric, 'USD', 'voided'::public.transaction_status)
) AS fixture(label, transaction_id, transaction_kind, occurred_on, amount, currency_code, status);

INSERT INTO public.transactions (
  id, user_id, idempotency_key, transaction_kind, occurred_at, occurred_on,
  amount, currency_code, category_id, merchant, note, status,
  voided_at, voided_by, void_reason
)
SELECT baseline.transaction_id,
       'c8888888-8888-4888-8888-888888888888',
       baseline.transaction_id,
       baseline.transaction_kind,
       baseline.occurred_on::timestamp AT TIME ZONE 'Asia/Tokyo',
       baseline.occurred_on,
       baseline.amount,
       baseline.currency_code,
       CASE WHEN baseline.transaction_kind = 'income'
         THEN 'c1000000-0000-4000-8000-000000000001'::uuid
         ELSE 'c1000000-0000-4000-8000-000000000002'::uuid
       END,
       'Synthetic ' || baseline.label,
       baseline.label,
       baseline.status,
       CASE WHEN baseline.status = 'voided' THEN pg_catalog.statement_timestamp() END,
       CASE WHEN baseline.status = 'voided' THEN 'c8888888-8888-4888-8888-888888888888'::uuid END,
       CASE WHEN baseline.status = 'voided' THEN 'Synthetic pre-migration void' END
FROM public.fx_upgrade_test_baseline AS baseline;

UPDATE public.fx_upgrade_test_baseline AS baseline
SET transaction_before = pg_catalog.jsonb_build_object(
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
FROM public.transactions AS transaction_row
WHERE transaction_row.id = baseline.transaction_id;

END;
$fx_migration_upgrade_setup$;
