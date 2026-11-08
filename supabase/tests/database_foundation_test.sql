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
  6,
  'approved owner can create and read balance-tracked accounts'
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
UPDATE public.accounts SET name = 'Temporary Account Renamed' WHERE name = 'Temporary Account';
DELETE FROM public.accounts WHERE name = 'Temporary Account Renamed';
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

SELECT extensions.lives_ok(
  $$SELECT public.post_transaction(
    'c0000000-0000-4000-8000-000000000001', 'expense', '2026-01-02', '1200', 'JPY',
    (SELECT id FROM public.categories WHERE name = 'Food'), (SELECT id FROM public.payment_methods WHERE name = 'Debit'),
    jsonb_build_array(jsonb_build_object('account_id', (SELECT id::text FROM public.accounts WHERE name = 'Checking'), 'amount', '-1200', 'currency_code', 'JPY'))
  )$$,
  'cash/debit expense posts atomically with a matching account debit'
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
  11200::numeric,
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
  (SELECT pg_catalog.count(*)::integer FROM public.transactions WHERE transaction_kind IN ('income', 'expense')),
  2,
  'transfer does not add income or expense reports'
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
  11250::numeric,
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
  5,
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
  $$SELECT * FROM private.owner_allowlist$$,
  '42501', NULL, 'authenticated non-owner cannot read the private owner allowlist'
);

RESET ROLE;
SELECT * FROM extensions.finish();
ROLLBACK;
