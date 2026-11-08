BEGIN;

CREATE FUNCTION public.post_transaction(
  p_idempotency_key uuid,
  p_transaction_kind public.transaction_kind,
  p_occurred_on date,
  p_amount text DEFAULT NULL,
  p_currency_code text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_entries jsonb DEFAULT '[]'::jsonb,
  p_source public.transaction_source DEFAULT 'manual',
  p_merchant text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_adjustment_reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_amount numeric;
  v_entry record;
  v_entry_account_id uuid;
  v_entry_amount numeric;
  v_entry_currency text;
  v_entry_count integer := 0;
  v_positive_count integer := 0;
  v_negative_count integer := 0;
  v_expected_count integer;
  v_single_entry_amount numeric;
  v_single_entry_currency text;
  v_transfer_sum numeric := 0;
  v_transfer_first_currency text;
  v_payment_method_kind public.payment_method_kind;
  v_linked_account_id uuid;
  v_method_archived_at timestamptz;
  v_category_kind public.category_kind;
  v_category_archived_at timestamptz;
  v_account_kind public.account_kind;
  v_account_status public.account_status;
  v_account_currency text;
  v_account_opening_as_of date;
  v_transaction_id uuid;
  v_existing public.transactions%ROWTYPE;
  v_entries_equal boolean;
BEGIN
  IF p_idempotency_key IS NULL OR p_occurred_on IS NULL OR p_transaction_kind IS NULL THEN
    RAISE EXCEPTION 'idempotency key, event type, and occurrence date are required'
      USING ERRCODE = '22023';
  END IF;
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_entries IS NULL OR pg_catalog.jsonb_typeof(p_entries) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_entries) > 2 THEN
    RAISE EXCEPTION 'entries must be an array with at most two account movements'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount IS NOT NULL THEN
    IF p_amount !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'amounts must be decimal strings without exponent notation'
        USING ERRCODE = '22023';
    END IF;
    v_amount := p_amount::numeric;
  END IF;
  IF p_currency_code IS NOT NULL AND p_currency_code !~ '^[A-Z]{3}$' THEN
    RAISE EXCEPTION 'currency code must be three uppercase letters' USING ERRCODE = '22023';
  END IF;
  IF (v_amount IS NULL) <> (p_currency_code IS NULL) THEN
    RAISE EXCEPTION 'amount and currency must either both be present or both be null'
      USING ERRCODE = '22023';
  END IF;
  IF v_amount IS NOT NULL AND NOT private.amount_uses_currency_scale(v_amount, p_currency_code) THEN
    RAISE EXCEPTION 'amount does not use the supported fractional scale for its currency'
      USING ERRCODE = '22023';
  END IF;

  FOR v_entry IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(p_entries) AS item(value)
  LOOP
    IF pg_catalog.jsonb_typeof(v_entry.value) IS DISTINCT FROM 'object'
       OR v_entry.value - ARRAY['account_id', 'amount', 'currency_code']::text[] <> '{}'::jsonb
       OR pg_catalog.jsonb_typeof(v_entry.value -> 'account_id') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_entry.value -> 'amount') IS DISTINCT FROM 'string'
       OR pg_catalog.jsonb_typeof(v_entry.value -> 'currency_code') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'each entry must contain only string account_id, amount, and currency_code fields'
        USING ERRCODE = '22023';
    END IF;
    v_entry_account_id := (v_entry.value ->> 'account_id')::uuid;
    IF (v_entry.value ->> 'amount') !~ '^-?(0|[1-9][0-9]*)(\.[0-9]+)?$' THEN
      RAISE EXCEPTION 'entry amounts must be decimal strings without exponent notation'
        USING ERRCODE = '22023';
    END IF;
    v_entry_amount := (v_entry.value ->> 'amount')::numeric;
    v_entry_currency := v_entry.value ->> 'currency_code';
    IF v_entry_currency !~ '^[A-Z]{3}$'
       OR v_entry_amount = 0
       OR NOT private.amount_uses_currency_scale(v_entry_amount, v_entry_currency) THEN
      RAISE EXCEPTION 'entry amount or currency is invalid' USING ERRCODE = '22023';
    END IF;

    v_entry_count := v_entry_count + 1;
    IF v_entry_amount > 0 THEN
      v_positive_count := v_positive_count + 1;
    ELSE
      v_negative_count := v_negative_count + 1;
    END IF;
    v_single_entry_amount := v_entry_amount;
    v_single_entry_currency := v_entry_currency;
    IF v_entry_count = 1 THEN
      v_transfer_first_currency := v_entry_currency;
      v_transfer_sum := v_entry_amount;
    ELSIF p_transaction_kind = 'transfer' AND v_entry_currency = v_transfer_first_currency THEN
      v_transfer_sum := v_transfer_sum + v_entry_amount;
    END IF;
  END LOOP;

  IF p_transaction_kind IN ('income', 'expense') THEN
    IF v_amount IS NULL OR v_amount <= 0 OR p_currency_code IS NULL OR p_category_id IS NULL
       OR p_adjustment_reason IS NOT NULL THEN
      RAISE EXCEPTION 'income and expense require a positive amount, currency, and category'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_transaction_kind = 'card_settlement' THEN
    IF v_amount IS NULL OR v_amount <= 0 OR p_currency_code IS NULL OR p_category_id IS NOT NULL
       OR p_adjustment_reason IS NOT NULL THEN
      RAISE EXCEPTION 'card settlement requires a positive amount and currency, but no category'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_transaction_kind = 'transfer' THEN
    IF v_amount IS NOT NULL OR p_currency_code IS NOT NULL OR p_category_id IS NOT NULL
       OR p_payment_method_id IS NOT NULL OR p_adjustment_reason IS NOT NULL THEN
      RAISE EXCEPTION 'transfers use only their two account entries'
        USING ERRCODE = '22023';
    END IF;
  ELSIF p_transaction_kind = 'balance_adjustment' THEN
    IF v_amount IS NULL OR v_amount = 0 OR p_currency_code IS NULL OR p_category_id IS NOT NULL
       OR p_payment_method_id IS NOT NULL OR p_adjustment_reason IS NULL
       OR pg_catalog.length(pg_catalog.btrim(p_adjustment_reason)) = 0 THEN
      RAISE EXCEPTION 'balance adjustments require a non-zero signed amount and reason'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0)
  );
  SELECT transaction_row.*
  INTO v_existing
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id
    AND transaction_row.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF ROW(v_existing.transaction_kind, v_existing.occurred_on, v_existing.amount, v_existing.currency_code,
           v_existing.category_id, v_existing.payment_method_id, v_existing.source, v_existing.merchant,
           v_existing.note, v_existing.adjustment_reason)
       IS DISTINCT FROM
       ROW(p_transaction_kind, p_occurred_on, v_amount, p_currency_code, p_category_id,
           p_payment_method_id, p_source, p_merchant, p_note, p_adjustment_reason) THEN
      RAISE EXCEPTION 'idempotency key was already used for a different financial event'
        USING ERRCODE = '23505';
    END IF;

    WITH requested AS (
      SELECT (item.value ->> 'account_id')::uuid AS account_id,
             (item.value ->> 'amount')::numeric AS amount,
             item.value ->> 'currency_code' AS currency_code
      FROM pg_catalog.jsonb_array_elements(p_entries) AS item(value)
    ), actual AS (
      SELECT entry.account_id, entry.amount, entry.currency_code
      FROM public.account_entries AS entry
      WHERE entry.user_id = v_user_id AND entry.transaction_id = v_existing.id
    )
    SELECT (SELECT pg_catalog.count(*) FROM actual) = v_entry_count
       AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM requested EXCEPT SELECT * FROM actual) AS difference)
       AND NOT EXISTS (SELECT 1 FROM (SELECT * FROM actual EXCEPT SELECT * FROM requested) AS difference)
    INTO v_entries_equal;

    IF NOT v_entries_equal THEN
      RAISE EXCEPTION 'idempotency key was already used with different account entries'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT category_row.kind, category_row.archived_at
    INTO v_category_kind, v_category_archived_at
    FROM public.categories AS category_row
    WHERE category_row.user_id = v_user_id AND category_row.id = p_category_id
    FOR SHARE;
    IF NOT FOUND OR v_category_archived_at IS NOT NULL
       OR (p_transaction_kind = 'income' AND v_category_kind <> 'income')
       OR (p_transaction_kind = 'expense' AND v_category_kind <> 'expense') THEN
      RAISE EXCEPTION 'category is unavailable or incompatible with the event type'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT method.method_kind, method.linked_account_id, method.archived_at
    INTO v_payment_method_kind, v_linked_account_id, v_method_archived_at
    FROM public.payment_methods AS method
    WHERE method.user_id = v_user_id AND method.id = p_payment_method_id
    FOR SHARE;
    IF NOT FOUND OR v_method_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'payment method is unavailable' USING ERRCODE = '23503';
    END IF;
  END IF;

  IF p_transaction_kind = 'income' THEN
    IF v_payment_method_kind = 'credit_card' THEN
      RAISE EXCEPTION 'income cannot use a credit-card payment method' USING ERRCODE = '23514';
    END IF;
    IF p_payment_method_id IS NULL AND v_entry_count = 0 THEN
      v_expected_count := 0;
    ELSE
      v_expected_count := 1;
      IF v_entry_count <> 1 OR v_single_entry_amount <> v_amount
         OR v_single_entry_currency <> p_currency_code OR v_positive_count <> 1 THEN
        RAISE EXCEPTION 'assigned income requires one matching positive account entry'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF p_transaction_kind = 'expense' THEN
    IF v_payment_method_kind = 'credit_card' THEN
      v_expected_count := 0;
      IF v_entry_count <> 0 THEN
        RAISE EXCEPTION 'credit-card purchases cannot create account entries'
          USING ERRCODE = '23514';
      END IF;
    ELSIF p_payment_method_id IS NULL AND v_entry_count = 0 THEN
      v_expected_count := 0;
    ELSE
      v_expected_count := 1;
      IF v_entry_count <> 1 OR v_single_entry_amount <> -v_amount
         OR v_single_entry_currency <> p_currency_code OR v_negative_count <> 1 THEN
        RAISE EXCEPTION 'cash/debit expenses require one matching negative account entry'
          USING ERRCODE = '23514';
      END IF;
    END IF;
  ELSIF p_transaction_kind = 'card_settlement' THEN
    v_expected_count := 1;
    IF (p_payment_method_id IS NOT NULL AND v_payment_method_kind <> 'credit_card')
       OR v_entry_count <> 1 OR v_single_entry_amount <> -v_amount
       OR v_single_entry_currency <> p_currency_code OR v_negative_count <> 1 THEN
      RAISE EXCEPTION 'card settlements require one matching negative account entry and no category'
        USING ERRCODE = '23514';
    END IF;
  ELSIF p_transaction_kind = 'transfer' THEN
    v_expected_count := 2;
    IF v_entry_count <> 2 OR v_positive_count <> 1 OR v_negative_count <> 1 THEN
      RAISE EXCEPTION 'transfers require exactly one positive and one negative account entry'
        USING ERRCODE = '23514';
    END IF;
    IF v_transfer_first_currency = (p_entries -> 1 ->> 'currency_code')
       AND v_transfer_sum <> 0 THEN
      RAISE EXCEPTION 'same-currency transfers must have equal and opposite account entries'
        USING ERRCODE = '23514';
    END IF;
  ELSIF p_transaction_kind = 'balance_adjustment' THEN
    v_expected_count := 1;
    IF v_entry_count <> 1 OR v_single_entry_amount <> v_amount
       OR v_single_entry_currency <> p_currency_code THEN
      RAISE EXCEPTION 'balance adjustments require one entry matching their signed amount'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_entry_count <> v_expected_count THEN
    RAISE EXCEPTION 'event has an invalid number of account entries' USING ERRCODE = '23514';
  END IF;

  FOR v_entry IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(p_entries) AS item(value)
  LOOP
    v_entry_account_id := (v_entry.value ->> 'account_id')::uuid;
    v_entry_amount := (v_entry.value ->> 'amount')::numeric;
    v_entry_currency := v_entry.value ->> 'currency_code';

    SELECT account.account_kind, account.status, account.currency_code, account.opening_as_of
    INTO v_account_kind, v_account_status, v_account_currency, v_account_opening_as_of
    FROM public.accounts AS account
    WHERE account.user_id = v_user_id AND account.id = v_entry_account_id
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account does not belong to the approved owner' USING ERRCODE = '23503';
    END IF;
    IF v_account_status <> 'active' OR p_occurred_on < v_account_opening_as_of THEN
      RAISE EXCEPTION 'account is archived or event predates its opening balance'
        USING ERRCODE = '23514';
    END IF;
    IF v_account_currency <> v_entry_currency THEN
      RAISE EXCEPTION 'entry currency must match its account currency' USING ERRCODE = '23514';
    END IF;
    IF p_transaction_kind IN ('expense', 'card_settlement') AND v_account_kind NOT IN ('bank', 'cash') THEN
      RAISE EXCEPTION 'expenses and card settlements must debit a bank or cash account'
        USING ERRCODE = '23514';
    END IF;
    IF p_transaction_kind IN ('income', 'expense') AND v_linked_account_id IS NOT NULL
       AND v_entry_account_id <> v_linked_account_id THEN
      RAISE EXCEPTION 'entry account must match the payment method linked account'
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF v_entry_count = 0 AND NOT EXISTS (
    SELECT 1
    FROM public.accounts AS account
    WHERE account.user_id = v_user_id AND account.opening_as_of <= p_occurred_on
  ) THEN
    RAISE EXCEPTION 'unassigned events must not predate the first account opening balance'
      USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.transactions (
    user_id, idempotency_key, transaction_kind, occurred_on, amount, currency_code,
    category_id, payment_method_id, source, merchant, note, adjustment_reason
  ) VALUES (
    v_user_id, p_idempotency_key, p_transaction_kind, p_occurred_on, v_amount, p_currency_code,
    p_category_id, p_payment_method_id, p_source, p_merchant, p_note, p_adjustment_reason
  )
  RETURNING id INTO v_transaction_id;

  FOR v_entry IN
    SELECT item.value
    FROM pg_catalog.jsonb_array_elements(p_entries) AS item(value)
  LOOP
    INSERT INTO public.account_entries (user_id, transaction_id, account_id, amount, currency_code)
    VALUES (
      v_user_id,
      v_transaction_id,
      (v_entry.value ->> 'account_id')::uuid,
      (v_entry.value ->> 'amount')::numeric,
      v_entry.value ->> 'currency_code'
    );
  END LOOP;

  RETURN v_transaction_id;
END;
$$;

CREATE FUNCTION public.void_transaction(p_transaction_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_transaction_id uuid;
  v_current_status public.transaction_status;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'transaction ID and non-empty void reason are required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.transactions AS transaction_row
  SET status = 'voided',
      voided_at = pg_catalog.clock_timestamp(),
      voided_by = v_user_id,
      void_reason = pg_catalog.btrim(p_reason)
  WHERE transaction_row.id = p_transaction_id
    AND transaction_row.user_id = v_user_id
    AND transaction_row.status = 'posted'
  RETURNING transaction_row.id INTO v_transaction_id;

  IF FOUND THEN
    RETURN v_transaction_id;
  END IF;

  SELECT transaction_row.status
  INTO v_current_status
  FROM public.transactions AS transaction_row
  WHERE transaction_row.id = p_transaction_id AND transaction_row.user_id = v_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'posted transaction was not found' USING ERRCODE = 'P0002';
  END IF;
  RAISE EXCEPTION 'transaction is already voided and cannot be voided again'
    USING ERRCODE = '23514';
END;
$$;

REVOKE ALL ON FUNCTION public.post_transaction(
  uuid, public.transaction_kind, date, text, text, uuid, uuid, jsonb,
  public.transaction_source, text, text, text
) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.void_transaction(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_transaction(
  uuid, public.transaction_kind, date, text, text, uuid, uuid, jsonb,
  public.transaction_source, text, text, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_transaction(uuid, text) TO authenticated;

COMMIT;
