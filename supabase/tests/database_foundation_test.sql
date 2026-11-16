BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();
CREATE TEMP TABLE correction_results (replacement_id uuid);
GRANT SELECT, INSERT ON TABLE pg_temp.correction_results TO authenticated;

-- Synthetic identities only. The allowlisted owner exists only inside this rolled-back test transaction.
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'faylo-owner@test.invalid', now(), now()),
  ('b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'other-user@test.invalid', now(), now());
INSERT INTO private.owner_allowlist (singleton, owner_user_id)
VALUES (true, 'a1111111-1111-4111-8111-111111111111')
ON CONFLICT (singleton) DO UPDATE SET owner_user_id = EXCLUDED.owner_user_id;

-- A second user's row is present to exercise cross-owner relationship attacks.
INSERT INTO public.accounts (id, user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b2222222-2222-4222-8222-222222222222',
        'Other user account', 'bank', 'JPY', 1000, '2026-01-01');


INSERT INTO public.payment_methods (id, user_id, name, method_kind)
VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'b2222222-2222-4222-8222-222222222222', 'Other user card', 'credit_card');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';

INSERT INTO public.user_preferences (user_id, base_currency, timezone)
VALUES ('a1111111-1111-4111-8111-111111111111', 'JPY', 'Asia/Tokyo');
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'Checking', 'bank', 'JPY', 100000, '2026-01-01'),
  ('a1111111-1111-4111-8111-111111111111', 'Savings', 'bank', 'JPY', 50000, '2026-01-01'),
  ('a1111111-1111-4111-8111-111111111111', 'USD Account', 'bank', 'USD', 9007199254740993.45, '2026-01-01'),
  ('a1111111-1111-4111-8111-111111111111', 'VND Cash', 'cash', 'VND', 250000, '2026-01-01'),
  ('a1111111-1111-4111-8111-111111111111', 'Late Account', 'bank', 'JPY', 10000, '2026-06-01'),
  ('a1111111-1111-4111-8111-111111111111', 'Investment', 'investment', 'JPY', 500000, '2026-01-01');
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts
   WHERE user_id = auth.uid() AND name = 'Checking' AND account_kind = 'bank'
     AND currency_code = 'JPY' AND opening_balance::text = '100000'
     AND opening_as_of = '2026-01-01' AND include_in_assets),
  1,
  'account creation persists its owner, immutable opening snapshot, and tracked-assets preference'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions WHERE transaction_kind IN ('income', 'expense')),
  0,
  'creating opening snapshots does not create income or expense transactions'
);
SELECT extensions.is(
  (SELECT opening_balance FROM public.account_balances_as_of('2026-01-01 00:00:00+09'::timestamptz) WHERE name = 'USD Account'),
  '9007199254740993.45',
  'owner balance projection returns large PostgreSQL NUMERIC opening amounts as exact decimal text'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_balances_as_of('2026-01-01 00:00:00+09'::timestamptz)),
  6,
  'approved owner can read all account balance projections'
);
INSERT INTO public.payment_methods (user_id, name, method_kind, linked_account_id)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'Debit', 'debit_card', (SELECT id FROM public.accounts WHERE name = 'Checking')),
  ('a1111111-1111-4111-8111-111111111111', 'Cash', 'cash', (SELECT id FROM public.accounts WHERE name = 'VND Cash')),
  ('a1111111-1111-4111-8111-111111111111', 'Credit Card', 'credit_card', NULL),
  ('a1111111-1111-4111-8111-111111111111', 'USD Debit', 'debit_card', (SELECT id FROM public.accounts WHERE name = 'USD Account'));

INSERT INTO public.categories (user_id, kind, name)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'expense', 'Food'),
  ('a1111111-1111-4111-8111-111111111111', 'income', 'Salary');
SELECT extensions.throws_ok(
  $$DELETE FROM public.accounts WHERE name = 'VND Cash'$$,
  '23503', NULL, 'a linked payment method prevents account deletion'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'VND Cash'),
  1,
  'blocked deletion preserves the account linked to a payment method'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.payment_methods
   WHERE name = 'Cash' AND linked_account_id = (SELECT id FROM public.accounts WHERE name = 'VND Cash')),
  1,
  'blocked deletion does not unlink or remove the payment method'
);

INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Race guarded account', 'cash', 'JPY', 0, '2026-01-01');
SELECT extensions.is(
  (SELECT
    (SELECT pg_catalog.count(*) FROM public.account_entries WHERE account_id = account.id)
    + (SELECT pg_catalog.count(*) FROM public.payment_methods WHERE linked_account_id = account.id)
   FROM public.accounts AS account WHERE account.name = 'Race guarded account'),
  0::bigint,
  'the synthetic deletion preflight sees no references before the simulated race'
);
INSERT INTO public.payment_methods (user_id, name, method_kind, linked_account_id)
SELECT 'a1111111-1111-4111-8111-111111111111', 'Racing linked method', 'debit_card', id
FROM public.accounts WHERE name = 'Race guarded account';
SELECT extensions.throws_ok(
  $$DELETE FROM public.accounts WHERE name = 'Race guarded account'$$,
  '23503', NULL, 'the RESTRICT foreign key blocks a linked method created after the preflight'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'Race guarded account'),
  1,
  'a dependency race cannot remove its account'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.payment_methods WHERE name = 'Racing linked method'),
  1,
  'a dependency race preserves the linked method'
);





SELECT extensions.ok(
  (SELECT pg_catalog.count(*) = 6 AND pg_catalog.bool_and(relrowsecurity AND relforcerowsecurity)
   FROM pg_catalog.pg_class
   WHERE relnamespace = 'public'::regnamespace
     AND relname IN ('user_preferences', 'accounts', 'payment_methods', 'categories', 'transactions', 'account_entries')),
  'all six user-owned tables force row-level security'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.user_preferences WHERE user_id = auth.uid()),
  1,
  'approved owner can create and read preferences'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE user_id = auth.uid()),
  7,
  'approved owner can read the six base accounts and one synthetic deletion-safety account'
);
SELECT extensions.is(
  (SELECT opening_balance::text FROM public.accounts WHERE name = 'Checking'),
  '100000',
  'JPY opening balance is stored exactly in whole yen'
);
SELECT extensions.is(
  (SELECT opening_balance::text FROM public.accounts WHERE name = 'USD Account'),
  '9007199254740993.45',
  'large USD opening balance remains exact beyond JavaScript safe integer precision'
);
SELECT extensions.is(
  (SELECT opening_balance::text FROM public.accounts WHERE name = 'VND Cash'),
  '250000',
  'VND opening balance is stored exactly in whole dong'
);

UPDATE public.user_preferences SET base_currency = 'USD'
WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
SELECT extensions.is(
  (SELECT base_currency FROM public.user_preferences WHERE user_id = auth.uid()),
  'USD',
  'approved owner can update preferences'
);
UPDATE public.user_preferences SET base_currency = 'JPY'
WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Temporary Account', 'cash', 'JPY', 0, '2026-01-01');
UPDATE public.accounts SET name = 'Temporary Account Renamed', include_in_assets = false WHERE name = 'Temporary Account';
SELECT extensions.is(
  (SELECT name || ':' || include_in_assets::text FROM public.accounts WHERE name = 'Temporary Account Renamed'),
  'Temporary Account Renamed:false',
  'active account can be renamed and excluded from tracked assets without changing its opening snapshot'
);
SELECT extensions.lives_ok(
  $$DELETE FROM public.accounts WHERE name = 'Temporary Account Renamed'$$,
  'approved owner can delete an unused active account'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'Temporary Account Renamed'),
  0,
  'unused active account deletion removes only its account row'
);
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Unused archived account', 'bank', 'JPY', 0, '2026-01-01');
UPDATE public.accounts SET status = 'archived' WHERE name = 'Unused archived account';
SELECT extensions.lives_ok(
  $$DELETE FROM public.accounts WHERE name = 'Unused archived account'$$,
  'approved owner can delete an unused archived account without updating it'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'Unused archived account'),
  0,
  'unused archived account deletion removes the account row'
);
INSERT INTO public.payment_methods (user_id, name, method_kind)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Temporary Method', 'other');
UPDATE public.payment_methods SET name = 'Temporary Method Renamed' WHERE name = 'Temporary Method';
DELETE FROM public.payment_methods WHERE name = 'Temporary Method Renamed';
INSERT INTO public.categories (user_id, kind, name)
VALUES ('a1111111-1111-4111-8111-111111111111', 'expense', 'Temporary Category');
UPDATE public.categories SET name = 'Temporary Category Renamed' WHERE name = 'Temporary Category';
DELETE FROM public.categories WHERE name = 'Temporary Category Renamed';

SELECT extensions.throws_ok(
  $$INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'Invalid JPY', 'cash', 'JPY', 1.25, '2026-01-01')$$,
  '23514', NULL, 'JPY rejects fractional minor units'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'Invalid VND', 'cash', 'VND', 1.5, '2026-01-01')$$,
  '23514', NULL, 'VND rejects fractional minor units'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'Invalid USD', 'cash', 'USD', 1.001, '2026-01-01')$$,
  '23514', NULL, 'USD rejects precision below one cent'
);
SELECT extensions.throws_ok(
  $$UPDATE public.accounts SET opening_balance = 1 WHERE name = 'Checking'$$,
  '42501', NULL, 'opening balance cannot be silently edited after account creation'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.transactions (user_id, idempotency_key, transaction_kind, occurred_on, amount, currency_code, category_id)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000099',
            'expense', '2026-01-01', 1, 'JPY', (SELECT id FROM public.categories WHERE name = 'Food'))$$,
  '42501', NULL, 'financial transactions cannot bypass the atomic posting function'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.account_entries (user_id, transaction_id, account_id, amount, currency_code)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000099',
            (SELECT id FROM public.accounts WHERE name = 'Checking'), -1, 'JPY')$$,
  '42501', NULL, 'account entries cannot be written outside atomic posting'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.payment_methods (user_id, name, method_kind, linked_account_id)
    VALUES ('a1111111-1111-4111-8111-111111111111', 'Cross-owner method', 'debit_card',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '23503', NULL, 'composite ownership foreign key rejects cross-owner account links'
);

SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000010', 'expense', '2026-05-31', '100', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Late Account'), 'amount', '-100', 'currency_code', 'JPY'))
  )$$,
  '23514', NULL, 'account opening date rejects financial entries before tracking begins'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000015', 'expense', '2026-06-01', '100', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Late Account'), 'amount', '-100', 'currency_code', 'JPY'))
  )$$,
  'the opening date itself is included in the account tracking period'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-06-01 00:00:00+09'::timestamptz) WHERE name = 'Late Account'),
  '9900',
  'as-of projection includes entries on the opening date itself'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Late Account' GROUP BY account.id),
  9900::numeric,
  'an opening-date expense is included in the initial balance movements'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000014', 'expense', '2025-12-31', '1', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'), '[]'::jsonb
  )$$,
  '23514', NULL, 'credit-card expenses cannot predate the first account opening balance'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000011', 'income', '2026-01-02', '100', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '100', 'currency_code', 'JPY'))
  )$$,
  '23503', NULL, 'income cannot use an expense category'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000012', 'expense', '2026-01-02', '0.01', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL, '[]'::jsonb
  )$$,
  '22023', NULL, 'posting rejects fractional yen before any row is written'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000013', 'expense', '2026-01-02', '1200', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', -1200, 'currency_code', 'JPY'))
  )$$,
  '22023', NULL, 'posting rejects JSON numeric entry amounts instead of accepting floating-point input'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000032', 'expense', '2026-01-02', '100', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-100', 'currency_code', 'JPY'))
  )$$,
  '23514', NULL, 'debit payment method rejects a different supplied account entry'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000001', 'expense', '2026-01-02', '1200', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-1200', 'currency_code', 'JPY'))
  )$$,
  'cash/debit expense posts atomically with a matching account debit'
);
SELECT extensions.is(
  (SELECT occurred_at FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  '2026-01-01 15:00:00+00'::timestamptz,
  'date-only posting uses local midnight in Asia/Tokyo as its effective instant'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000039', 'expense', '2026-01-01', '1', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL, '[]'::jsonb,
    'manual', NULL, NULL, NULL, '2026-01-02 00:30:00+09'::timestamptz
  )$$,
  '22023', NULL, 'explicit timestamp must match the supplied local booking date'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking' GROUP BY account.id),
  98800::numeric,
  'cash/debit expense reduces the tracked JPY balance'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000002', 'expense', '2026-01-03', '10000', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'), '[]'::jsonb
  )$$,
  'credit-card purchase posts without account entries'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking' GROUP BY account.id),
  98800::numeric,
  'credit-card purchase does not reduce the bank balance'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000002'),
  0,
  'credit-card purchase creates no liability or cash entry'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000003', 'card_settlement', '2026-01-10', '10000', 'JPY', NULL,
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-10000', 'currency_code', 'JPY'))
  )$$,
  'card settlement posts one cash debit and no category'
);
SELECT extensions.is(
  (SELECT pg_catalog.sum(transaction_row.amount)
   FROM public.transactions AS transaction_row
   WHERE transaction_row.transaction_kind = 'expense' AND transaction_row.currency_code = 'JPY'
     AND transaction_row.status = 'posted'),
  11300::numeric,
  'settlement does not add a second expense'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking' GROUP BY account.id),
  88800::numeric,
  'card settlement reduces the bank balance exactly once'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000004', 'transfer', '2026-01-12', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-30000', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '30000', 'currency_code', 'JPY')
    )
  )$$,
  'same-currency transfer posts two opposite account movements'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000004'),
  2,
  'transfer has exactly two account entries'
);
SELECT extensions.is(
  (SELECT pg_catalog.sum(entry.amount)
   FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000004'),
  0::numeric,
  'same-currency transfer nets to zero and is not income or expense'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000004'
     AND transaction_kind IN ('income', 'expense')),
  0,
  'transfer does not create an income or expense report row'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000005', 'transfer', '2026-02-01', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'USD Account'), 'amount', '-100.00', 'currency_code', 'USD'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '15000', 'currency_code', 'JPY')
    )
  )$$,
  'cross-currency transfer accepts actual unequal currency legs'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000005'
     AND ((entry.currency_code = 'USD' AND entry.amount = -100.00)
       OR (entry.currency_code = 'JPY' AND entry.amount = 15000))),
  2,
  'cross-currency transfer preserves both exact native amounts'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000033', 'transfer', '2026-03-15', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-100', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Investment'), 'amount', '100', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2026-03-15 09:00:00+09'::timestamptz
  )$$,
  'backdated transfer records an explicit economic effective time'
);
SELECT extensions.is(
  (SELECT occurred_at FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000033'),
  '2026-03-15 00:00:00+00'::timestamptz,
  'backdated transfer preserves its original instant instead of insertion time'
);
SELECT extensions.ok(
  (SELECT entry.recorded_at > transaction_row.occurred_at
   FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row
     ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000033'
   LIMIT 1),
  'recording time remains distinct from a backdated economic time'
);
SELECT extensions.is(
  public.post_transaction(
    'c0000000-0000-4000-8000-000000000033', 'transfer', '2026-03-15', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-100', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Investment'), 'amount', '100', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2026-03-15 09:00:00+09'::timestamptz
  ),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000033'),
  'identical timestamp retry returns the original transaction'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000033', 'transfer', '2026-03-15', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-100', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Investment'), 'amount', '100', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2026-03-15 09:01:00+09'::timestamptz
  )$$,
  '23505', NULL, 'same idempotency key rejects a changed effective timestamp'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000034', 'transfer', '2026-04-01', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-1000', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Investment'), 'amount', '1000', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2026-04-01 09:00:00+09'::timestamptz
  )$$,
  'investment contribution before a same-day valuation is recorded precisely'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000035', 'transfer', '2026-04-01', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '-2000', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Investment'), 'amount', '2000', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2026-04-01 17:00:00+09'::timestamptz
  )$$,
  'investment contribution after a same-day valuation is recorded precisely'
);
SELECT extensions.is(
  (SELECT COALESCE(pg_catalog.sum(entry.amount), 0)
   FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row
     ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE entry.account_id = (SELECT id FROM public.accounts WHERE name = 'Investment')
     AND transaction_row.status = 'posted'
     AND transaction_row.occurred_at > '2026-04-01 12:00:00+09'::timestamptz
     AND transaction_row.occurred_at <= pg_catalog.transaction_timestamp()),
  2000::numeric,
  'same-day valuation cutoff includes only the later investment contribution'
);

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000006', 'expense', '2026-01-15', '1.23', 'USD',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'USD Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'USD Account'), 'amount', '-1.23', 'currency_code', 'USD'))
  )$$,
  'USD expense preserves exact cents through posting'
);
SELECT extensions.is(
  (SELECT amount::text FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000006'),
  '1.23',
  'USD transaction amount is exact'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-01-15 00:00:00+09'::timestamptz) WHERE name = 'USD Account'),
  '9007199254740992.22',
  'balance projection adds posted native-currency entries exactly without JavaScript-number precision loss'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000007', 'expense', '2026-01-15', '1000', 'VND',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Cash'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'VND Cash'), 'amount', '-1000', 'currency_code', 'VND'))
  )$$,
  'VND cash expense preserves exact whole dong'
);
SELECT extensions.is(
  (SELECT amount::text FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000007'),
  '1000',
  'VND transaction amount is exact'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000009', 'expense', '2026-01-16', '50', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL, '[]'::jsonb
  )$$,
  'unassigned expense can be recorded explicitly without inventing an account movement'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000009'),
  0,
  'unassigned expense remains distinguishable from a cash/debit expense'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions AS transaction_row
   WHERE transaction_row.transaction_kind = 'expense' AND transaction_row.payment_method_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.account_entries AS entry
                     WHERE entry.user_id = transaction_row.user_id AND entry.transaction_id = transaction_row.id)),
  1,
  'unassigned expense can be surfaced for later reconciliation'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000014', 'income', '2026-01-16', '1000', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Salary'), NULL, '[]'::jsonb
  )$$,
  'unassigned income can be recorded without a fabricated account movement'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions
   WHERE transaction_kind = 'income' AND payment_method_id IS NULL),
  1,
  'unassigned income remains included in income reporting'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking' GROUP BY account.id),
  58800::numeric,
  'unassigned events do not change an account balance'
);
SELECT extensions.is(
  (SELECT pg_catalog.sum(amount) FROM public.transactions
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY' AND status = 'posted'),
  11350::numeric,
  'unassigned expense still counts once in expense reporting'
);


SELECT extensions.is(
  public.post_transaction(
    'c0000000-0000-4000-8000-000000000001', 'expense', '2026-01-02', '1200', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-1200', 'currency_code', 'JPY'))
  ),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  'identical idempotent retry returns the original transaction ID'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'idempotent retry creates no duplicate financial event'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000001'),
  1,
  'idempotent retry creates no duplicate account entry'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000001', 'expense', '2026-01-02', '1201', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-1201', 'currency_code', 'JPY'))
  )$$,
  '23505', NULL, 'reusing an idempotency key with a different payload is rejected'
);

SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000020', 'transfer', '2026-01-20', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-100', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '100', 'currency_code', 'JPY')
    )
  )$$,
  '23505', NULL, 'duplicate transfer account legs fail after the parent insert attempt'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000020'),
  0,
  'failed account-entry insert atomically rolls back its parent transaction'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000020'),
  0,
  'failed posting leaves no partial account entries'
);

SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000021', 'balance_adjustment', '2026-01-20', '500', 'JPY', NULL, NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '500', 'currency_code', 'JPY'))
  )$$,
  '22023', NULL, 'balance adjustment without an explicit reason is rejected'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000008', 'balance_adjustment', '2026-01-20', '500', 'JPY', NULL, NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '500', 'currency_code', 'JPY')),
    'manual', NULL, NULL, 'Synthetic reconciliation correction'
  )$$,
  'reasoned balance adjustment posts as an explicit account movement'
);
SELECT extensions.is(
  (SELECT adjustment_reason FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000008'),
  'Synthetic reconciliation correction',
  'balance adjustment reason is retained for audit'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions WHERE transaction_kind = 'expense'),
  6,
  'balance adjustment is excluded from expense totals'
);
SELECT extensions.lives_ok(
  $$SELECT public.void_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000008'),
    'Synthetic duplicate correction'
  )$$,
  'voiding records an auditable reason without deleting the event'
);
SELECT extensions.is(
  (SELECT status::text || ':' || void_reason FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000008'),
  'voided:Synthetic duplicate correction',
  'void state and reason remain visible in the audit record'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000008'),
  1,
  'voiding retains original immutable account entries'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (WHERE transaction_row.status = 'posted'), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking' GROUP BY account.id),
  58800::numeric,
  'voided adjustment no longer affects derived account balance'
);
SELECT extensions.throws_ok(
  $$SELECT public.void_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000008'), 'Second void'
  )$$,
  '23514', NULL, 'a posted financial event cannot be voided twice'
);
SELECT extensions.is(
  public.post_transaction(
    'c0000000-0000-4000-8000-000000000008', 'balance_adjustment', '2026-01-20', '500', 'JPY', NULL, NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '500', 'currency_code', 'JPY')),
    'manual', NULL, NULL, 'Synthetic reconciliation correction'
  ),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000008'),
  'retry of a voided idempotency key returns the original voided event without reposting'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000036', 'transfer', '2999-01-01', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-100', 'currency_code', 'JPY'),
      jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Savings'), 'amount', '100', 'currency_code', 'JPY')
    ),
    'manual', NULL, NULL, NULL, '2999-01-01 09:00:00+09'::timestamptz
  )$$,
  'future-effective transfer can be recorded without affecting the current balance'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (
     WHERE transaction_row.status = 'posted'
       AND transaction_row.occurred_at <= pg_catalog.transaction_timestamp()
   ), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry
     ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row
     ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking'
   GROUP BY account.id),
  58800::numeric,
  'future-effective account entry is excluded from a current as-of balance'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-01-21 23:59:59+09'::timestamptz) WHERE name = 'Checking'),
  '58800',
  'as-of projection excludes voided and future-effective entries'
);
SELECT extensions.is(
  (SELECT account.opening_balance + COALESCE(pg_catalog.sum(entry.amount) FILTER (
     WHERE transaction_row.status = 'posted'
       AND transaction_row.occurred_at <= '2999-01-02 00:00:00+09'::timestamptz
   ), 0)
   FROM public.accounts AS account
   LEFT JOIN public.account_entries AS entry
     ON entry.user_id = account.user_id AND entry.account_id = account.id
   LEFT JOIN public.transactions AS transaction_row
     ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE account.name = 'Checking'
   GROUP BY account.id),
  58700::numeric,
  'future-effective account entry is included once its effective instant is reached'
);
UPDATE public.accounts SET status = 'archived' WHERE name = 'Late Account';
SELECT extensions.is(
  (SELECT status FROM public.account_balances_as_of('2026-06-02 23:59:59+09'::timestamptz) WHERE name = 'Late Account'),
  'archived',
  'archived account remains available as a read-only balance record'
);
SELECT extensions.throws_ok(
  $$UPDATE public.accounts SET name = 'Late Account Renamed' WHERE name = 'Late Account'$$,
  '23514', NULL, 'an archived account cannot be renamed through direct database updates'
);
SELECT extensions.throws_ok(
  $$UPDATE public.accounts SET include_in_assets = false WHERE name = 'Late Account'$$,
  '23514', NULL, 'an archived account tracked-assets preference cannot be changed directly'
);
SELECT extensions.throws_ok(
  $$UPDATE public.accounts SET status = 'active' WHERE name = 'Late Account'$$,
  '23514', NULL, 'an archived account cannot be reactivated through direct database updates'
);
SELECT extensions.throws_ok(
  $$UPDATE public.accounts SET name = name WHERE name = 'Late Account'$$,
  '23514', NULL, 'even a no-op direct update is rejected for an archived account'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000037', 'expense', '2026-06-02', '1', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL,
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Late Account'), 'amount', '-1', 'currency_code', 'JPY'))
  )$$,
  '23514', NULL, 'posting rejects an archived account'
);
UPDATE public.payment_methods SET archived_at = pg_catalog.clock_timestamp() WHERE name = 'Debit';
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000038', 'expense', '2026-01-02', '1', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-1', 'currency_code', 'JPY'))
  )$$,
  '23503', NULL, 'posting rejects an archived payment method'
);

INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Transaction acceptance', 'bank', 'JPY', 100000, '2026-01-01');
INSERT INTO public.payment_methods (user_id, name, method_kind, linked_account_id)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Acceptance debit', 'debit_card',
        (SELECT id FROM public.accounts WHERE name = 'Transaction acceptance'));
INSERT INTO public.categories (user_id, kind, name)
VALUES ('a1111111-1111-4111-8111-111111111111', 'expense', 'Transport');
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000201', 'expense', '2026-10-05', '1200', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'),
    (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
      'amount', '-1200', 'currency_code', 'JPY'
    ))
  )$$,
  'acceptance expense posts against the exact ¥100,000 opening snapshot'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-10-05 23:59:59+09'::timestamptz)
   WHERE name = 'Transaction acceptance'),
  '98800',
  '¥100,000 opening less ¥1,200 expense projects exactly ¥98,800'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals('2026-10-01')
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  '1200',
  'October native-currency spending totals ¥1,200'
);
CREATE TEMP TABLE future_expense_test_context AS
WITH future_event AS (
  SELECT pg_catalog.statement_timestamp() + INTERVAL '1 day' AS occurred_at
)
SELECT future_event.occurred_at,
       (future_event.occurred_at AT TIME ZONE 'Asia/Tokyo')::date AS occurred_on,
       pg_catalog.date_trunc('month', future_event.occurred_at AT TIME ZONE 'Asia/Tokyo')::date AS month_start,
       COALESCE(month_total.total_amount, '0') AS prior_total_amount,
       COALESCE(month_total.transaction_count, 0::bigint) AS prior_transaction_count
FROM future_event
LEFT JOIN LATERAL public.transaction_totals(
  pg_catalog.date_trunc('month', future_event.occurred_at AT TIME ZONE 'Asia/Tokyo')::date
) AS month_total
  ON month_total.transaction_kind = 'expense' AND month_total.currency_code = 'JPY';
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000206', 'expense',
    (SELECT occurred_on FROM pg_temp.future_expense_test_context),
    '777', 'JPY', (SELECT id FROM public.categories WHERE name = 'Food'),
    NULL, '[]'::jsonb, 'manual', 'Future-effective monthly expense', NULL, NULL,
    (SELECT occurred_at FROM pg_temp.future_expense_test_context)
  )$$,
  'a posted expense can be recorded with a future effective instant'
);
SELECT extensions.is(
  (SELECT status::text FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000206'),
  'posted',
  'the future-effective expense remains posted'
);
SELECT extensions.is(
  COALESCE((
    SELECT month_total.total_amount
    FROM public.transaction_totals((SELECT month_start FROM pg_temp.future_expense_test_context)) AS month_total
    WHERE month_total.transaction_kind = 'expense' AND month_total.currency_code = 'JPY'
  ), '0'),
  (SELECT prior_total_amount FROM pg_temp.future_expense_test_context),
  'future-effective posted expense does not change exact monthly spending before its effective instant'
);
SELECT extensions.is(
  COALESCE((
    SELECT month_total.transaction_count
    FROM public.transaction_totals((SELECT month_start FROM pg_temp.future_expense_test_context)) AS month_total
    WHERE month_total.transaction_kind = 'expense' AND month_total.currency_code = 'JPY'
  ), 0::bigint),
  (SELECT prior_transaction_count FROM pg_temp.future_expense_test_context),
  'future-effective posted expense is not counted before its effective instant'
);

SELECT extensions.throws_ok(
  $$SELECT * FROM public.transaction_totals('2026-10-05')$$,
  '22023', NULL, 'monthly totals require a first-of-month boundary'
);
SELECT extensions.throws_ok(
  $$SELECT public.correct_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
    'c0000000-0000-4000-8000-000000000202', 'expense', '2026-10-05', '1500', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Salary'),
    (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
      'amount', '-1500', 'currency_code', 'JPY'
    )), 'wrong replacement category'
  )$$,
  '23503', NULL, 'failed replacement validation rolls the original void transition back'
);
SELECT extensions.is(
  (SELECT status::text FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
  'posted',
  'failed correction leaves its original transaction posted'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transaction_corrections),
  0,
  'failed correction leaves no audit linkage row'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000203', 'income', '2026-10-06', '5000', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Salary'),
    (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
      'amount', '5000', 'currency_code', 'JPY'
    ))
  )$$,
  'income posting increases the tracked balance'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-10-06 23:59:59+09'::timestamptz)
   WHERE name = 'Transaction acceptance'),
  '103800',
  'posted income adds exactly once to the same native-currency balance'
);
SELECT extensions.is(
  (SELECT transaction_count FROM public.transaction_totals('2026-10-01')
   WHERE transaction_kind = 'income' AND currency_code = 'JPY'),
  1::bigint,
  'income is counted once in its native-currency monthly group'
);
INSERT INTO pg_temp.correction_results (replacement_id)
SELECT public.correct_transaction(
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
  'c0000000-0000-4000-8000-000000000202', 'expense', '2026-10-05', '1500', 'JPY',
  (SELECT id FROM public.categories WHERE name = 'Transport'),
  (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
  jsonb_build_array(jsonb_build_object(
    'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
    'amount', '-1500', 'currency_code', 'JPY'
  )), 'Corrected category and amount'
);
SELECT extensions.is(
  (SELECT replacement_id FROM pg_temp.correction_results),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000202'),
  'atomic correction returns its replacement transaction ID'
);
SELECT extensions.is(
  (SELECT status::text || ':' || void_reason FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
  'voided:Corrected category and amount',
  'correction preserves the original voided transaction and reason for audit'
);
SELECT extensions.is(
  (SELECT category.name || ':' || transaction_row.amount::text
   FROM public.transactions AS transaction_row
   JOIN public.categories AS category
     ON category.user_id = transaction_row.user_id AND category.id = transaction_row.category_id
   WHERE transaction_row.idempotency_key = 'c0000000-0000-4000-8000-000000000202'),
  'Transport:1500',
  'replacement records its new category and exact replacement amount'
);
SELECT extensions.is(
  (SELECT balance FROM public.account_balances_as_of('2026-10-06 23:59:59+09'::timestamptz)
   WHERE name = 'Transaction acceptance'),
  '103500',
  'replacement-only balance effect restores the original debit then applies the corrected debit'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals('2026-10-01')
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  '1500',
  'monthly spending includes only the posted replacement, never the voided original'
);
SELECT extensions.is(
  (SELECT corrected_from_transaction_id
   FROM public.list_transactions(p_transaction_id =>
     (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000202'))),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
  'transaction list exposes correction linkage from the replacement'
);
SELECT extensions.is(
  public.correct_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
    'c0000000-0000-4000-8000-000000000202', 'expense', '2026-10-05', '1500', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Transport'),
    (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
      'amount', '-1500', 'currency_code', 'JPY'
    )), 'Corrected category and amount'
  ),
  (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000202'),
  'identical correction retry returns the same replacement'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000202'),
  1,
  'correction retry creates no duplicate replacement transaction'
);
SELECT extensions.throws_ok(
  $$SELECT public.correct_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000201'),
    'c0000000-0000-4000-8000-000000000202', 'expense', '2026-10-05', '1600', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Transport'),
    (SELECT id FROM public.payment_methods WHERE name = 'Acceptance debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Transaction acceptance'),
      'amount', '-1600', 'currency_code', 'JPY'
    )), 'Corrected category and amount'
  )$$,
  '23505', NULL, 'changed correction payload on an existing key is rejected'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000204', 'expense', '2026-10-07', '700', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'),
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'), '[]'::jsonb
  )$$,
  'credit-card expense remains recordable without a bank movement'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000205', 'expense', '2026-10-08', '300', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), NULL, '[]'::jsonb
  )$$,
  'unassigned expense remains recordable without an invented payment method or entry'
);
SELECT extensions.is(
  (SELECT string_agg(transaction_row.idempotency_key::text || ':' || listing.funding_status, ',' ORDER BY transaction_row.idempotency_key)
   FROM public.transactions AS transaction_row
   JOIN LATERAL public.list_transactions(p_transaction_id => transaction_row.id) AS listing ON true
   WHERE transaction_row.idempotency_key IN (
     'c0000000-0000-4000-8000-000000000204', 'c0000000-0000-4000-8000-000000000205'
   )),
  'c0000000-0000-4000-8000-000000000204:credit_card,c0000000-0000-4000-8000-000000000205:unassigned',
  'list classifies credit-card and unassigned expenses distinctly'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries AS entry
   JOIN public.transactions AS transaction_row ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
   WHERE transaction_row.idempotency_key IN (
     'c0000000-0000-4000-8000-000000000204', 'c0000000-0000-4000-8000-000000000205'
   )),
  0,
  'credit-card and unassigned expenses create no bank entries'
);
SELECT extensions.lives_ok(
  $$SELECT public.void_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000205'),
    'Standalone void test'
  )$$,
  'standalone void retains the financial event for audit'
);
SELECT extensions.is(
  (SELECT status::text || ':' || void_reason FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000205'),
  'voided:Standalone void test',
  'standalone void preserves status and reason'
);
SELECT extensions.is(
  (SELECT total_amount FROM public.transaction_totals('2026-10-01')
   WHERE transaction_kind = 'expense' AND currency_code = 'JPY'),
  '2200',
  'standalone void removes its amount from monthly spending while retaining the event'
);
SELECT extensions.throws_ok(
  $$SELECT public.list_transactions(p_limit => 101)$$,
  '22023', NULL, 'transaction list enforces bounded page size'
);
SELECT extensions.ok(
  (SELECT pg_catalog.bool_and(relrowsecurity AND relforcerowsecurity)
   FROM pg_catalog.pg_class WHERE oid = 'public.transaction_corrections'::regclass),
  'correction linkage table forces row-level security'
);
SELECT extensions.throws_ok(
  $$UPDATE public.transaction_corrections SET reason = 'rewrite'$$,
  '42501', NULL, 'correction history cannot be updated directly'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.transaction_corrections$$,
  '42501', NULL, 'correction history cannot be deleted directly'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.transaction_corrections (user_id, original_transaction_id, replacement_transaction_id, reason)
    VALUES (auth.uid(), 'c0000000-0000-4000-8000-000000000201', 'c0000000-0000-4000-8000-000000000202', 'direct write')$$,
  '42501', NULL, 'correction history cannot be inserted directly'
);

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
SELECT extensions.throws_ok($$SELECT * FROM public.categories$$, '42501', NULL, 'anonymous category reads are denied');
SELECT extensions.throws_ok($$SELECT * FROM public.payment_methods$$, '42501', NULL, 'anonymous payment-method reads are denied');
SELECT extensions.throws_ok($$SELECT * FROM public.list_transactions()$$, '42501', NULL, 'anonymous transaction list access is denied');
SELECT extensions.throws_ok($$SELECT * FROM public.transaction_totals()$$, '42501', NULL, 'anonymous transaction totals access is denied');
SELECT extensions.throws_ok(
  $$SELECT public.correct_transaction(NULL, NULL, 'expense', NULL, NULL, NULL, NULL, NULL, '[]', 'reason')$$,
  '42501', NULL, 'anonymous correction RPC execution is denied'
);
SELECT extensions.throws_ok($$SELECT * FROM public.transaction_corrections$$, '42501', NULL, 'anonymous correction audit reads are denied');
RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'b2222222-2222-4222-8222-222222222222';
SET LOCAL request.jwt.claims = '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}';
SELECT extensions.throws_ok($$SELECT * FROM public.list_transactions()$$, '42501', NULL, 'non-owner transaction list access is denied');
SELECT extensions.throws_ok($$SELECT * FROM public.transaction_totals()$$, '42501', NULL, 'non-owner transaction totals access is denied');
SELECT extensions.throws_ok(
  $$SELECT public.correct_transaction(NULL, NULL, 'expense', NULL, NULL, NULL, NULL, NULL, '[]', 'reason')$$,
  '42501', NULL, 'non-owner correction RPC execution is denied'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transaction_corrections),
  0,
  'non-owner cannot read correction audit linkage rows'
);
SELECT extensions.is((SELECT pg_catalog.count(*)::integer FROM public.categories), 0, 'non-owner cannot read categories');
SELECT extensions.is((SELECT pg_catalog.count(*)::integer FROM public.payment_methods), 0, 'non-owner cannot read payment methods');

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'a1111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims = '{"sub":"a1111111-1111-4111-8111-111111111111","role":"authenticated"}';
SELECT extensions.is(
  (SELECT total_count FROM public.list_transactions(p_search => 'transport', p_kind => 'expense', p_status => 'posted',
    p_occurred_from => '2026-10-01', p_occurred_through => '2026-10-31', p_limit => 1)),
  1::bigint,
  'transaction list filters case-insensitively across category with date, type, status, and bounded pagination'
);

UPDATE public.user_preferences SET timezone = 'America/Los_Angeles' WHERE user_id = auth.uid();
SELECT extensions.is(
  (SELECT timezone FROM public.user_preferences WHERE user_id = auth.uid()),
  'America/Los_Angeles',
  'account opening dates use the configured user timezone'
);
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Future Opening', 'bank', 'USD', 9007199254740993.45, '2026-11-20');
SELECT extensions.ok(
  (SELECT balance IS NULL
   FROM public.account_balances_as_of('2026-11-20 07:59:59.999999+00'::timestamptz)
   WHERE name = 'Future Opening'),
  'balance is unavailable immediately before midnight on the opening date in the configured timezone'
);
SELECT extensions.is(
  (SELECT balance
   FROM public.account_balances_as_of('2026-11-20 08:00:00+00'::timestamptz)
   WHERE name = 'Future Opening'),
  '9007199254740993.45',
  'opening balance becomes effective exactly at local midnight without decimal precision loss'
);
SELECT extensions.is(
  (SELECT balance
   FROM public.account_balances_as_of('2026-11-20 08:00:00.000001+00'::timestamptz)
   WHERE name = 'Future Opening'),
  '9007199254740993.45',
  'opening balance remains available after its local effective opening instant'
);
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Race entry account', 'cash', 'JPY', 0, '2026-01-01');
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries
   WHERE account_id = (SELECT id FROM public.accounts WHERE name = 'Race entry account')),
  0,
  'the synthetic entry-race preflight sees no ledger entries'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000101', 'transfer', '2026-01-02', NULL, NULL, NULL, NULL,
    jsonb_build_array(
      jsonb_build_object(
        'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Race entry account'),
        'amount', '-1', 'currency_code', 'JPY'
      ),
      jsonb_build_object(
        'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'),
        'amount', '1', 'currency_code', 'JPY'
      )
    )
  )$$,
  'a financial entry can be added after a zero-entry preflight'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.accounts WHERE name = 'Race entry account'$$,
  '23503', NULL, 'the account-entry foreign key blocks deletion after an entry is added'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries
   WHERE account_id = (SELECT id FROM public.accounts WHERE name = 'Race entry account')),
  1,
  'the race-safe delete preserves the newly posted ledger entry'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions
   WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000101'),
  1,
  'the race-safe delete preserves the posted transaction'
);

INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Voided entry blocker', 'cash', 'JPY', 0, '2026-01-01');
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000102', 'balance_adjustment', '2026-01-02', '1', 'JPY', NULL, NULL,
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Voided entry blocker'),
      'amount', '1', 'currency_code', 'JPY'
    )),
    'manual', NULL, NULL, 'Synthetic voided history check'
  )$$,
  'synthetic history is posted before the voided-entry delete check'
);
SELECT extensions.lives_ok(
  $$SELECT public.void_transaction(
    (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000102'),
    'Synthetic voided history retention check'
  )$$,
  'synthetic history is voided but retained before deletion is attempted'
);
SELECT extensions.throws_ok(
  $$DELETE FROM public.accounts WHERE name = 'Voided entry blocker'$$,
  '23503', NULL, 'a voided transaction entry still prevents account deletion'
);
SELECT extensions.is(
  (SELECT status::text FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000102'),
  'voided',
  'blocked account deletion preserves the voided financial event'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries
   WHERE transaction_id = (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000102')),
  1,
  'blocked account deletion preserves the voided event ledger entry'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'Voided entry blocker'),
  1,
  'blocked deletion preserves the account that owns voided ledger history'
);
CREATE TEMP TABLE card_settlement_test_baseline AS
WITH current_month AS (
  SELECT pg_catalog.date_trunc(
    'month',
    pg_catalog.statement_timestamp() AT TIME ZONE COALESCE(
      (SELECT preference.timezone FROM public.user_preferences AS preference WHERE preference.user_id = auth.uid()),
      'Asia/Tokyo'
    )
  )::date AS settlement_month
)
SELECT current_month.settlement_month,
       current_month.settlement_month - 1 AS purchase_date,
       (current_month.settlement_month - INTERVAL '1 month')::date AS purchase_month,
       COALESCE((
         SELECT total.total_amount::numeric
         FROM public.transaction_totals((current_month.settlement_month - INTERVAL '1 month')::date) AS total
         WHERE total.transaction_kind = 'expense' AND total.currency_code = 'JPY'
       ), 0) AS purchase_month_expenses,
       COALESCE((
         SELECT total.total_amount::numeric
         FROM public.transaction_totals(current_month.settlement_month) AS total
         WHERE total.transaction_kind = 'expense' AND total.currency_code = 'JPY'
       ), 0) AS settlement_month_expenses,
       (SELECT projection.balance::numeric
        FROM public.account_balances_as_of(pg_catalog.statement_timestamp()) AS projection
        WHERE projection.name = 'Checking') AS checking_balance
FROM current_month;

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000300', 'expense',
    (SELECT purchase_date FROM pg_temp.card_settlement_test_baseline), '10000', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'),
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'), '[]'::jsonb
  )$$,
  'a credit-card purchase posts in the previous calendar month without a cash entry'
);
SELECT extensions.is(
  (SELECT projection.balance::numeric - baseline.checking_balance
   FROM public.account_balances_as_of(pg_catalog.statement_timestamp()) AS projection
   CROSS JOIN pg_temp.card_settlement_test_baseline AS baseline
   WHERE projection.name = 'Checking'),
  0::numeric,
  'a cross-month credit-card purchase leaves the funded account unchanged'
);
SELECT extensions.is(
  COALESCE((
    SELECT total.total_amount::numeric
    FROM public.transaction_totals((SELECT purchase_month FROM pg_temp.card_settlement_test_baseline)) AS total
    WHERE total.transaction_kind = 'expense' AND total.currency_code = 'JPY'
  ), 0) - (SELECT purchase_month_expenses FROM pg_temp.card_settlement_test_baseline),
  10000::numeric,
  'the purchase month recognizes the credit-card expense exactly once'
);
SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000301', 'card_settlement',
    (SELECT settlement_month FROM pg_temp.card_settlement_test_baseline), '10000', 'JPY', NULL,
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'),
      'amount', '-10000', 'currency_code', 'JPY'
    ))
  )$$,
  'the next-month card settlement posts its single funded-account debit'
);
SELECT extensions.is(
  (SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000301', 'card_settlement',
    (SELECT settlement_month FROM pg_temp.card_settlement_test_baseline), '10000', 'JPY', NULL,
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'),
      'amount', '-10000', 'currency_code', 'JPY'
    ))
  ) = (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000301')),
  true,
  'retrying a settlement returns the original event instead of posting another debit'
);
SELECT extensions.is(
  (SELECT projection.balance::numeric - baseline.checking_balance
   FROM public.account_balances_as_of(pg_catalog.statement_timestamp()) AS projection
   CROSS JOIN pg_temp.card_settlement_test_baseline AS baseline
   WHERE projection.name = 'Checking'),
  -10000::numeric,
  'the idempotent settlement reduces the funded account by exactly one payment'
);
SELECT extensions.is(
  COALESCE((
    SELECT total.total_amount::numeric
    FROM public.transaction_totals((SELECT settlement_month FROM pg_temp.card_settlement_test_baseline)) AS total
    WHERE total.transaction_kind = 'expense' AND total.currency_code = 'JPY'
  ), 0) - (SELECT settlement_month_expenses FROM pg_temp.card_settlement_test_baseline),
  0::numeric,
  'the settlement month does not count the cash payment as a second expense'
);
SELECT extensions.is(
  COALESCE((
    SELECT total.total_amount::numeric
    FROM public.transaction_totals((SELECT purchase_month FROM pg_temp.card_settlement_test_baseline)) AS total
    WHERE total.transaction_kind = 'expense' AND total.currency_code = 'JPY'
  ), 0) - (SELECT purchase_month_expenses FROM pg_temp.card_settlement_test_baseline),
  10000::numeric,
  'the next-month settlement leaves the prior month expense report unchanged'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.account_entries
   WHERE transaction_id = (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000301')),
  1,
  'a repeated settlement request retains exactly one immutable account entry'
);
SELECT extensions.is(
  (SELECT transaction_kind || ':' || amount || ':' || payment_method_name || ':' || funding_account_name || ':' || funding_status
   FROM public.list_transactions(
     p_kind => 'card_settlement',
     p_transaction_id => (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000301'),
     p_limit => 1
   )),
  'card_settlement:10000:Credit Card:Checking:funded',
  'settlement history identifies the card and debited account without a category'
);
SELECT extensions.is(
  (SELECT category_id
   FROM public.list_transactions(
     p_kind => 'card_settlement',
     p_transaction_id => (SELECT id FROM public.transactions WHERE idempotency_key = 'c0000000-0000-4000-8000-000000000301'),
     p_limit => 1
   )),
  NULL::uuid,
  'card settlement history has no expense category'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000302', 'card_settlement',
    (SELECT settlement_month FROM pg_temp.card_settlement_test_baseline), '100', 'JPY', NULL,
    (SELECT id FROM public.payment_methods WHERE name = 'USD Debit'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'),
      'amount', '-100', 'currency_code', 'JPY'
    ))
  )$$,
  '23514', NULL,
  'a settlement rejects a non-credit-card payment method'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000303', 'card_settlement',
    (SELECT settlement_month FROM pg_temp.card_settlement_test_baseline), '100', 'JPY', NULL,
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'),
      'amount', '-100', 'currency_code', 'JPY'
    ))
  )$$,
  '23503', NULL,
  'a settlement rejects a credit-card payment method owned by another user'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000304', 'card_settlement',
    (SELECT settlement_month FROM pg_temp.card_settlement_test_baseline), '100', 'JPY', NULL,
    (SELECT id FROM public.payment_methods WHERE name = 'Credit Card'),
    jsonb_build_array(jsonb_build_object(
      'account_id', (SELECT id::text FROM public.accounts WHERE name = 'USD Account'),
      'amount', '-100', 'currency_code', 'JPY'
    ))
  )$$,
  '23514', NULL,
  'a settlement rejects an amount currency that differs from the selected account'
);

DELETE FROM public.user_preferences WHERE user_id = 'a1111111-1111-4111-8111-111111111111';
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.user_preferences WHERE user_id = auth.uid()),
  0,
  'approved owner can delete their own preferences'
);

RESET ROLE;
SET LOCAL ROLE anon;
SET LOCAL request.jwt.claim.sub = '';
SET LOCAL request.jwt.claims = '{}';
SELECT extensions.throws_ok($$SELECT pg_catalog.count(*) FROM public.accounts$$, '42501', NULL, 'anonymous reads are denied');
SELECT extensions.throws_ok(
  $$INSERT INTO public.user_preferences (user_id) VALUES ('a1111111-1111-4111-8111-111111111111')$$,
  '42501', NULL, 'anonymous writes are denied'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction('c0000000-0000-4000-8000-000000000030', 'expense', '2026-01-02', '1', 'JPY')$$,
  '42501', NULL, 'anonymous callers cannot execute the posting RPC'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.account_balances_as_of()$$,
  '42501', NULL, 'anonymous callers cannot execute the account balance projection'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = 'b2222222-2222-4222-8222-222222222222';
SET LOCAL request.jwt.claims = '{"sub":"b2222222-2222-4222-8222-222222222222","role":"authenticated"}';
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts),
  0,
  'authenticated non-owner cannot read any Faylo account, including their own seeded row'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.transactions),
  0,
  'authenticated non-owner cannot read financial events'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.user_preferences (user_id) VALUES ('b2222222-2222-4222-8222-222222222222')$$,
  '42501', NULL, 'authenticated non-owner cannot create their own Faylo preferences'
);
SELECT extensions.throws_ok(
  $$INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
    VALUES ('b2222222-2222-4222-8222-222222222222', 'Unauthorized account', 'bank', 'USD', 1.00, '2026-01-01')$$,
  '42501', NULL, 'authenticated non-owner cannot fabricate their own Faylo account'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction('c0000000-0000-4000-8000-000000000031', 'expense', '2026-01-02', '1', 'JPY')$$,
  '42501', NULL, 'authenticated non-owner cannot post an unauthorized Faylo transaction'
);
SELECT extensions.throws_ok(
  $$SELECT public.post_transaction('c0000000-0000-4000-8000-000000000305', 'card_settlement', '2026-11-01', '1', 'JPY')$$,
  '42501', NULL,
  'a non-owner cannot post a card settlement'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.list_transactions(p_kind => 'card_settlement')$$,
  '42501', NULL,
  'a non-owner cannot read card-settlement history'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM public.account_balances_as_of()$$,
  '42501', NULL, 'authenticated non-owner cannot execute the account balance projection'
);
SELECT extensions.throws_ok(
  $$SELECT * FROM private.owner_allowlist$$,
  '42501', NULL, 'authenticated non-owner cannot read the private owner allowlist'
);

SELECT extensions.lives_ok(
  $$DELETE FROM public.accounts WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$,
  'authenticated non-owner account deletion executes only within the RLS-visible set'
);
SELECT extensions.lives_ok(
  $$DELETE FROM public.accounts WHERE name = 'Checking'$$,
  'authenticated non-owner cannot target the approved owner account'
);

RESET ROLE;
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts
   WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1,
  'RLS leaves the non-owner account intact after an unauthorized delete attempt'
);
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts WHERE name = 'Checking'),
  1,
  'RLS leaves the approved owner account intact after an unauthorized delete attempt'
);
SELECT * FROM extensions.finish();
ROLLBACK;
