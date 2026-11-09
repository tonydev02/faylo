BEGIN;

CREATE TABLE public.transaction_corrections (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  original_transaction_id uuid NOT NULL,
  replacement_transaction_id uuid NOT NULL,
  reason text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(reason)) > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT transaction_corrections_distinct_transactions CHECK (original_transaction_id <> replacement_transaction_id),
  CONSTRAINT transaction_corrections_original_pk PRIMARY KEY (user_id, original_transaction_id),
  CONSTRAINT transaction_corrections_one_original_per_replacement UNIQUE (user_id, replacement_transaction_id),
  CONSTRAINT transaction_corrections_original_fk FOREIGN KEY (user_id, original_transaction_id)
    REFERENCES public.transactions(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transaction_corrections_replacement_fk FOREIGN KEY (user_id, replacement_transaction_id)
    REFERENCES public.transactions(user_id, id) ON DELETE RESTRICT
);
ALTER TABLE public.transaction_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_corrections FORCE ROW LEVEL SECURITY;
CREATE POLICY transaction_corrections_owner_select ON public.transaction_corrections
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
REVOKE ALL ON TABLE public.transaction_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transaction_corrections TO authenticated;

CREATE FUNCTION private.reject_transaction_correction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'transaction correction audit records are immutable';
END;
$$;
CREATE TRIGGER transaction_corrections_reject_mutation
BEFORE UPDATE OR DELETE ON public.transaction_corrections
FOR EACH ROW EXECUTE FUNCTION private.reject_transaction_correction_mutation();
REVOKE ALL ON FUNCTION private.reject_transaction_correction_mutation() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.correct_transaction(
  p_transaction_id uuid,
  p_idempotency_key uuid,
  p_transaction_kind public.transaction_kind,
  p_occurred_on date,
  p_amount text,
  p_currency_code text,
  p_category_id uuid,
  p_payment_method_id uuid,
  p_entries jsonb,
  p_reason text,
  p_merchant text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_occurred_at timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_original public.transactions%ROWTYPE;
  v_existing public.transactions%ROWTYPE;
  v_correction public.transaction_corrections%ROWTYPE;
  v_replacement_id uuid;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_idempotency_key IS NULL OR p_transaction_kind IS NULL
     OR p_occurred_on IS NULL OR p_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(p_reason)) = 0 THEN
    RAISE EXCEPTION 'transaction, idempotency key, replacement event, date, and non-empty reason are required'
      USING ERRCODE = '22023';
  END IF;
  IF p_transaction_kind NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'corrections must replace an income or expense with an income or expense'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text || ':' || p_idempotency_key::text, 0)
  );
  SELECT transaction_row.* INTO v_existing
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id AND transaction_row.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    SELECT correction.* INTO v_correction
    FROM public.transaction_corrections AS correction
    WHERE correction.user_id = v_user_id
      AND correction.original_transaction_id = p_transaction_id
      AND correction.replacement_transaction_id = v_existing.id
      AND correction.reason = pg_catalog.btrim(p_reason);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency key does not identify this exact correction'
        USING ERRCODE = '23505';
    END IF;
    RETURN public.post_transaction(
      p_idempotency_key, p_transaction_kind, p_occurred_on, p_amount, p_currency_code,
      p_category_id, p_payment_method_id, p_entries, 'manual', p_merchant, p_note, NULL, p_occurred_at
    );
  END IF;

  SELECT transaction_row.* INTO v_original
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id AND transaction_row.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND OR v_original.status <> 'posted' OR v_original.source <> 'manual'
     OR v_original.transaction_kind NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'posted manual income or expense was not found for correction'
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.void_transaction(p_transaction_id, pg_catalog.btrim(p_reason));
  v_replacement_id := public.post_transaction(
    p_idempotency_key, p_transaction_kind, p_occurred_on, p_amount, p_currency_code,
    p_category_id, p_payment_method_id, p_entries, 'manual', p_merchant, p_note, NULL, p_occurred_at
  );
  INSERT INTO public.transaction_corrections (
    user_id, original_transaction_id, replacement_transaction_id, reason
  ) VALUES (
    v_user_id, p_transaction_id, v_replacement_id, pg_catalog.btrim(p_reason)
  );
  RETURN v_replacement_id;
END;
$$;
REVOKE ALL ON FUNCTION public.correct_transaction(
  uuid, uuid, public.transaction_kind, date, text, text, uuid, uuid, jsonb, text, text, text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.correct_transaction(
  uuid, uuid, public.transaction_kind, date, text, text, uuid, uuid, jsonb, text, text, text, timestamptz
) TO authenticated;

CREATE FUNCTION public.list_transactions(
  p_search text DEFAULT NULL,
  p_kind text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_occurred_from date DEFAULT NULL,
  p_occurred_through date DEFAULT NULL,
  p_transaction_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  transaction_id uuid,
  transaction_kind text,
  occurred_at timestamptz,
  occurred_on date,
  amount text,
  currency_code text,
  category_id uuid,
  category_name text,
  payment_method_id uuid,
  payment_method_name text,
  payment_method_kind text,
  funding_account_id uuid,
  funding_account_name text,
  funding_status text,
  status text,
  merchant text,
  note text,
  void_reason text,
  voided_at timestamptz,
  created_at timestamptz,
  corrected_from_transaction_id uuid,
  corrected_by_transaction_id uuid,
  correction_reason text,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 OR p_offset IS NULL OR p_offset < 0 OR p_offset > 1000000
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('income', 'expense'))
     OR (p_status IS NOT NULL AND p_status NOT IN ('posted', 'voided'))
     OR (p_occurred_from IS NOT NULL AND p_occurred_through IS NOT NULL AND p_occurred_from > p_occurred_through) THEN
    RAISE EXCEPTION 'invalid transaction list filter or pagination'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  WITH filtered AS (
    SELECT transaction_row.*,
           category.name AS category_name,
           method.name AS payment_method_name,
           method.method_kind::text AS payment_method_kind,
           funding.account_id AS funding_account_id,
           funding.name AS funding_account_name,
           original_link.original_transaction_id AS corrected_from_transaction_id,
           replacement_link.replacement_transaction_id AS corrected_by_transaction_id,
           COALESCE(original_link.reason, replacement_link.reason) AS correction_reason
    FROM public.transactions AS transaction_row
    LEFT JOIN public.categories AS category
      ON category.user_id = transaction_row.user_id AND category.id = transaction_row.category_id
    LEFT JOIN public.payment_methods AS method
      ON method.user_id = transaction_row.user_id AND method.id = transaction_row.payment_method_id
    LEFT JOIN LATERAL (
      SELECT entry.account_id, account.name
      FROM public.account_entries AS entry
      JOIN public.accounts AS account ON account.user_id = entry.user_id AND account.id = entry.account_id
      WHERE entry.user_id = transaction_row.user_id AND entry.transaction_id = transaction_row.id
      ORDER BY entry.recorded_at DESC, entry.id
      LIMIT 1
    ) AS funding ON true
    LEFT JOIN public.transaction_corrections AS original_link
      ON original_link.user_id = transaction_row.user_id
     AND original_link.replacement_transaction_id = transaction_row.id
    LEFT JOIN public.transaction_corrections AS replacement_link
      ON replacement_link.user_id = transaction_row.user_id
     AND replacement_link.original_transaction_id = transaction_row.id
    WHERE transaction_row.user_id = v_user_id
      AND transaction_row.transaction_kind IN ('income', 'expense')
      AND (p_kind IS NULL OR transaction_row.transaction_kind::text = p_kind)
      AND (p_status IS NULL OR transaction_row.status::text = p_status)
      AND (p_occurred_from IS NULL OR transaction_row.occurred_on >= p_occurred_from)
      AND (p_occurred_through IS NULL OR transaction_row.occurred_on <= p_occurred_through)
      AND (p_transaction_id IS NULL OR transaction_row.id = p_transaction_id)
      AND (p_search IS NULL OR pg_catalog.length(pg_catalog.btrim(p_search)) = 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.merchant, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.note, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(category.name, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(method.name, '')), pg_catalog.lower(p_search)) > 0)
  )
  SELECT filtered.id, filtered.transaction_kind::text, filtered.occurred_at, filtered.occurred_on,
         filtered.amount::text, filtered.currency_code, filtered.category_id, filtered.category_name,
         filtered.payment_method_id, filtered.payment_method_name, filtered.payment_method_kind,
         filtered.funding_account_id, filtered.funding_account_name,
         CASE WHEN filtered.payment_method_id IS NULL THEN 'unassigned'
              WHEN filtered.payment_method_kind = 'credit_card' THEN 'credit_card'
              ELSE 'funded' END,
         filtered.status::text, filtered.merchant, filtered.note, filtered.void_reason, filtered.voided_at,
         filtered.created_at, filtered.corrected_from_transaction_id, filtered.corrected_by_transaction_id,
         filtered.correction_reason, pg_catalog.count(*) OVER ()
  FROM filtered
  ORDER BY filtered.occurred_on DESC, filtered.occurred_at DESC, filtered.created_at DESC, filtered.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  TO authenticated;

CREATE FUNCTION public.transaction_totals(p_month_start date DEFAULT NULL)
RETURNS TABLE (
  transaction_kind text,
  currency_code text,
  total_amount text,
  transaction_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_month_start date;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NOT NULL
     AND pg_catalog.date_trunc('month', p_month_start::timestamp)::date <> p_month_start THEN
    RAISE EXCEPTION 'month start must be the first calendar day'
      USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    (SELECT preference.timezone FROM public.user_preferences AS preference WHERE preference.user_id = v_user_id),
    'Asia/Tokyo'
  ) INTO v_timezone;
  v_month_start := COALESCE(p_month_start,
    pg_catalog.date_trunc('month', pg_catalog.statement_timestamp() AT TIME ZONE v_timezone)::date);
  RETURN QUERY
  SELECT transaction_row.transaction_kind::text, transaction_row.currency_code,
         pg_catalog.sum(transaction_row.amount)::text, pg_catalog.count(*)
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id
    AND transaction_row.status = 'posted'
    AND transaction_row.transaction_kind IN ('income', 'expense')
    AND transaction_row.occurred_on >= v_month_start
    AND transaction_row.occurred_on < (v_month_start + INTERVAL '1 month')::date
  GROUP BY transaction_row.transaction_kind, transaction_row.currency_code
  ORDER BY transaction_row.transaction_kind, transaction_row.currency_code;
END;
$$;
REVOKE ALL ON FUNCTION public.transaction_totals(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_totals(date) TO authenticated;

COMMIT;
