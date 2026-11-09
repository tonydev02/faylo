BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT extensions.no_plan();

-- Synthetic identities only. The allowlisted owner exists only inside this rolled-back test transaction.
INSERT INTO auth.users (id, aud, role, email, created_at, updated_at)
VALUES
  ('a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'faylo-owner@test.invalid', now(), now()),
  ('b2222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'other-user@test.invalid', now(), now());
INSERT INTO private.owner_allowlist (singleton, owner_user_id)
VALUES (true, 'a1111111-1111-4111-8111-111111111111');

-- A second user's row is present to exercise cross-owner relationship attacks.
INSERT INTO public.accounts (id, user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b2222222-2222-4222-8222-222222222222',
        'Other user account', 'bank', 'JPY', 1000, '2026-01-01');

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
INSERT INTO public.accounts (user_id, name, account_kind, currency_code, opening_balance, opening_as_of)
VALUES ('a1111111-1111-4111-8111-111111111111', 'Stale confirmation account', 'cash', 'JPY', 0, '2026-01-01');
UPDATE public.accounts
SET name = 'Renamed after confirmation'
WHERE user_id = auth.uid() AND name = 'Stale confirmation account';
DELETE FROM public.accounts AS target
WHERE target.user_id = auth.uid()
  AND target.id = (
    SELECT current_account.id
    FROM public.accounts AS current_account
    WHERE current_account.user_id = auth.uid()
      AND current_account.name = 'Renamed after confirmation'
  )
  AND target.name = 'Stale confirmation account';
SELECT extensions.is(
  (SELECT pg_catalog.count(*)::integer FROM public.accounts
   WHERE user_id = auth.uid() AND name = 'Renamed after confirmation'),
  1,
  'an account renamed after confirmation is not deleted by the stale confirmed name'
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
