BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

CREATE TEMP TABLE dashboard_test_context AS
SELECT (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date AS today,
       pg_catalog.date_trunc(
         'month', pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo'
       )::date AS current_month,
       (
         pg_catalog.date_trunc('month', pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
         - INTERVAL '6 months'
       )::date AS first_account_opening,
       (
         pg_catalog.date_trunc('month', pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
         - INTERVAL '2 months' + INTERVAL '14 days'
       )::date AS second_account_opening;
GRANT SELECT ON TABLE pg_temp.dashboard_test_context TO authenticated;

INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('d9110000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'issue9-owner@test.invalid', now(), now()),
  ('d9110000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'issue9-other@test.invalid', now(), now());
INSERT INTO private.owner_allowlist (singleton, owner_user_id)
VALUES (true, 'd9110000-0000-4000-8000-000000000001')
ON CONFLICT (singleton) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id;
INSERT INTO public.user_preferences (user_id, base_currency, timezone)
VALUES ('d9110000-0000-4000-8000-000000000001', 'JPY', 'Asia/Tokyo');

SET LOCAL request.jwt.claim.sub = 'd9110000-0000-4000-8000-000000000001';
SET LOCAL request.jwt.claims = '{"sub":"d9110000-0000-4000-8000-000000000001","role":"authenticated"}';
SET LOCAL ROLE authenticated;

INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES
  (auth.uid(), 'Synthetic Issue 9 account A', 'bank', 'JPY', '10000', (SELECT first_account_opening FROM pg_temp.dashboard_test_context)),
  (auth.uid(), 'Synthetic Issue 9 account B', 'cash', 'JPY', '5000', (SELECT second_account_opening FROM pg_temp.dashboard_test_context));
INSERT INTO public.payment_methods (user_id, name, method_kind, linked_account_id)
VALUES (auth.uid(), 'Synthetic Issue 9 credit card', 'credit_card', NULL);
INSERT INTO public.categories (user_id, kind, name)
VALUES
  (auth.uid(), 'expense', 'Synthetic Issue 9 parent category'),
  (auth.uid(), 'income', 'Synthetic Issue 9 income category');
INSERT INTO public.categories (user_id, kind, name, parent_id)
SELECT auth.uid(), 'expense', 'Synthetic Issue 9 child category', category.id
FROM public.categories AS category
WHERE category.user_id = auth.uid() AND category.name = 'Synthetic Issue 9 parent category';

INSERT INTO public.category_budgets (user_id, category_id, month_start, limit_jpy)
SELECT auth.uid(), category.id, context.current_month, 150
FROM public.categories AS category
CROSS JOIN pg_temp.dashboard_test_context AS context
WHERE category.user_id = auth.uid() AND category.name = 'Synthetic Issue 9 parent category';

SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000010', 'expense',
  (SELECT today FROM pg_temp.dashboard_test_context), '100', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 parent category'),
  NULL, '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000011', 'expense',
  (SELECT today FROM pg_temp.dashboard_test_context), '200', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 child category'),
  NULL, '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000012', 'expense',
  (SELECT today FROM pg_temp.dashboard_test_context), '300', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 parent category'),
  (SELECT id FROM public.payment_methods WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 credit card'), '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000013', 'expense',
  (SELECT today FROM pg_temp.dashboard_test_context), '2', 'VND',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 parent category'),
  NULL, '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000014', 'income',
  (SELECT today FROM pg_temp.dashboard_test_context), '1000', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 income category'),
  NULL, '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000015', 'expense',
  (((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '3 months')::date + 20), '55', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 parent category'),
  NULL, '[]'::jsonb
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000016', 'expense',
  (SELECT today FROM pg_temp.dashboard_test_context), '999', 'JPY',
  (SELECT id FROM public.categories WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 parent category'),
  NULL, '[]'::jsonb
);
SELECT public.void_transaction(
  (SELECT id FROM public.transactions WHERE idempotency_key = 'd9110000-0000-4000-8000-000000000016'),
  'Synthetic Issue 9 void regression'
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000017', 'card_settlement',
  (SELECT today FROM pg_temp.dashboard_test_context), '300', 'JPY', NULL,
  (SELECT id FROM public.payment_methods WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 credit card'),
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'account_id', (SELECT id::text FROM public.accounts WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 account A'),
    'amount', '-300', 'currency_code', 'JPY'
  ))
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000018', 'transfer',
  (SELECT today FROM pg_temp.dashboard_test_context), NULL, NULL, NULL, NULL,
  pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 account A'),
      'amount', '-50', 'currency_code', 'JPY'
    ),
    pg_catalog.jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 account B'),
      'amount', '50', 'currency_code', 'JPY'
    )
  )
);
SELECT public.post_transaction(
  'd9110000-0000-4000-8000-000000000019', 'balance_adjustment',
  (SELECT today FROM pg_temp.dashboard_test_context), '25', 'JPY', NULL, NULL,
  pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'account_id', (SELECT id::text FROM public.accounts WHERE user_id = auth.uid() AND name = 'Synthetic Issue 9 account A'),
    'amount', '25', 'currency_code', 'JPY'
  )), 'manual', NULL, NULL, 'Synthetic Issue 9 adjustment'
);

DO $$
DECLARE
  v_transaction record;
BEGIN
  FOR v_transaction IN
    SELECT transaction_row.id, transaction_row.occurred_on
    FROM public.transactions AS transaction_row
    WHERE transaction_row.user_id = auth.uid()
      AND transaction_row.transaction_kind IN ('income', 'expense')
      AND transaction_row.currency_code = 'JPY'
      AND transaction_row.status = 'posted'
  LOOP
    PERFORM public.record_transaction_reporting_fx_snapshot(
      v_transaction.id,
      pg_catalog.gen_random_uuid(),
      'resolved', 1, 'identity', NULL, v_transaction.occurred_on, NULL, '{}'::jsonb,
      NULL, '[]'::jsonb, NULL, NULL
    );
  END LOOP;
END;
$$;

SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  '600',
  'the refactored native total preserves posted JPY expenses and excludes settlement, transfer, adjustment, and voided events'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'VND'),
  '2',
  'native currencies remain separate in monthly totals'
);
SELECT extensions.is(
  (SELECT resolved_total_jpy FROM public.transaction_totals((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  '600',
  'resolved JPY totals still sum stored per-transaction snapshots'
);
SELECT extensions.is(
  (SELECT unresolved_transaction_count FROM public.transaction_totals((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  1::bigint,
  'unresolved foreign-currency events remain counted without becoming zero'
);

SELECT extensions.is(
  (SELECT total_amount FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = (SELECT current_month FROM pg_temp.dashboard_test_context)
       AND transaction_kind = 'expense' AND currency_code = 'JPY'),
  '600',
  'dashboard monthly aggregation includes each posted expense once'
);
SELECT extensions.is(
  (SELECT unresolved_transaction_count FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = (SELECT current_month FROM pg_temp.dashboard_test_context)
       AND transaction_kind = 'expense' AND currency_code = 'JPY'),
  1::bigint,
  'dashboard aggregation counts included unresolved FX without a zero conversion'
);
SELECT extensions.is(
  (SELECT resolved_total_jpy FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = (SELECT current_month FROM pg_temp.dashboard_test_context)
       AND transaction_kind = 'expense' AND currency_code = 'JPY'),
  '600',
  'dashboard JPY reporting uses the same stored per-transaction snapshots as transaction_totals'
);

SELECT extensions.is(
  (SELECT native_total FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 parent category' AND currency_code = 'JPY'),
  '400',
  'category spending includes only transactions assigned directly to that category'
);
SELECT extensions.is(
  (SELECT resolved_total_jpy FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 parent category' AND currency_code = 'JPY'),
  '400',
  'the parent category does not silently roll up its child category'
);
SELECT extensions.is(
  (SELECT budget_limit_jpy FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 parent category' AND currency_code = 'JPY'),
  '150',
  'category report returns the exact-category JPY budget'
);
SELECT extensions.is(
  (SELECT unresolved_transaction_count FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 parent category' AND currency_code = 'JPY'),
  1::bigint,
  'category budget progress identifies its included unresolved FX transaction'
);
SELECT extensions.is(
  (SELECT native_total FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 child category' AND currency_code = 'JPY'),
  '200',
  'child transactions remain visible in their own category row'
);
SELECT extensions.is(
  (SELECT count(*)::integer FROM public.monthly_category_spending((SELECT current_month FROM pg_temp.dashboard_test_context))
   WHERE category_name = 'Synthetic Issue 9 child category' AND budget_limit_jpy IS NOT NULL),
  0,
  'a parent budget is not inherited by a child category'
);

SELECT extensions.is(
  (SELECT coverage_status FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '3 months')::date
       AND transaction_kind = 'expense' AND currency_code = 'JPY'),
  'partial_account_coverage',
  'valid historical transactions remain reportable during partial account coverage'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '3 months')::date
       AND transaction_kind = 'expense' AND currency_code = 'JPY'),
  '55',
  'partial-coverage months preserve valid historical amounts'
);
SELECT extensions.is(
  (SELECT pg_catalog.bool_and(comparable_to_previous) FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '3 months')::date
       AND transaction_kind = 'expense'),
  true,
  'adjacent partial months with the same account-coverage signature are comparable'
);
SELECT extensions.is(
  (SELECT pg_catalog.bool_and(comparable_to_previous) FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '2 months')::date
       AND transaction_kind = 'expense'),
  false,
  'a month with changed account coverage is not marked comparable to its previous month'
);
SELECT extensions.is(
  (SELECT coverage_status FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '1 month')::date
       AND transaction_kind = 'expense' AND currency_code IS NULL),
  'fully_tracked',
  'months after all account opening dates are fully tracked'
);
SELECT extensions.is(
  (SELECT included_transaction_count FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '1 month')::date
       AND transaction_kind = 'expense' AND currency_code IS NULL),
  0::bigint,
  'a fully tracked month with no expense activity is explicitly represented as a complete zero-activity period'
);
SELECT extensions.is(
  (SELECT coverage_status FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = ((SELECT current_month FROM pg_temp.dashboard_test_context) - INTERVAL '7 months')::date
       AND transaction_kind = 'expense' AND currency_code IS NULL),
  'insufficient_history',
  'periods before any tracked account opening are distinguished from fully tracked zero-activity months'
);
SELECT extensions.is(
  (SELECT pg_catalog.bool_and(comparable_to_previous) FROM public.monthly_dashboard_totals(
     (SELECT current_month FROM pg_temp.dashboard_test_context), 9
   ) WHERE month_start = (SELECT current_month FROM pg_temp.dashboard_test_context)
       AND transaction_kind = 'expense'),
  false,
  'the current month-to-date period is not presented as a complete-month comparison'
);

SELECT extensions.throws_ok(
  $$INSERT INTO public.category_budgets (user_id, category_id, month_start, limit_jpy)
    SELECT auth.uid(), category.id, context.current_month, 100
    FROM public.categories AS category CROSS JOIN pg_temp.dashboard_test_context AS context
    WHERE category.user_id = auth.uid() AND category.name = 'Synthetic Issue 9 income category'$$,
  '23503', NULL,
  'income categories cannot receive expense budgets'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.category_budgets (user_id, category_id, month_start, limit_jpy)
    SELECT auth.uid(), category.id, context.current_month, 1.5
    FROM public.categories AS category CROSS JOIN pg_temp.dashboard_test_context AS context
    WHERE category.user_id = auth.uid() AND category.name = 'Synthetic Issue 9 parent category'$$,
  '23514', NULL,
  'JPY budget limits reject fractional yen'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.category_budgets (user_id, category_id, month_start, limit_jpy)
    SELECT auth.uid(), category.id, context.current_month + 1, 100
    FROM public.categories AS category CROSS JOIN pg_temp.dashboard_test_context AS context
    WHERE category.user_id = auth.uid() AND category.name = 'Synthetic Issue 9 child category'$$,
  '23514', NULL,
  'budget month keys must be the first day of the month'
);

RESET ROLE;
UPDATE private.owner_allowlist
SET owner_user_id = 'd9110000-0000-4000-8000-000000000001'
WHERE singleton;
SET LOCAL request.jwt.claim.sub = 'd9110000-0000-4000-8000-000000000002';
SET LOCAL request.jwt.claims = '{"sub":"d9110000-0000-4000-8000-000000000002","role":"authenticated"}';
SET LOCAL ROLE authenticated;
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.category_budgets),
  0,
  'a non-owner cannot read the owner budget'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.monthly_dashboard_totals()$$,
  '42501', NULL,
  'a non-owner cannot call the monthly dashboard report'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
