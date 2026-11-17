BEGIN;

CREATE TABLE public.fx_rate_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  base_currency text NOT NULL CHECK (base_currency ~ '^[A-Z]{3}$'),
  quote_currency text NOT NULL CHECK (quote_currency ~ '^[A-Z]{3}$'),
  rate numeric NOT NULL CHECK (rate > 0 AND rate < 'Infinity'::numeric),
  provider_code text NOT NULL CHECK (provider_code = 'frankfurter'),
  effective_on date NOT NULL,
  requested_from date NOT NULL,
  requested_through date NOT NULL,
  fetched_at timestamptz NOT NULL,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT fx_rate_cache_distinct_pair CHECK (base_currency <> quote_currency),
  CONSTRAINT fx_rate_cache_request_window CHECK (requested_from <= effective_on AND effective_on <= requested_through),
  CONSTRAINT fx_rate_cache_provider_pair_effective_key UNIQUE (user_id, provider_code, base_currency, quote_currency, effective_on)
);
CREATE INDEX fx_rate_cache_owner_pair_date_idx
  ON public.fx_rate_cache (user_id, provider_code, base_currency, quote_currency, effective_on DESC);
ALTER TABLE public.fx_rate_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fx_rate_cache FORCE ROW LEVEL SECURITY;
CREATE POLICY fx_rate_cache_owner_select ON public.fx_rate_cache
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
REVOKE ALL ON TABLE public.fx_rate_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.fx_rate_cache TO authenticated;

CREATE TABLE public.transaction_reporting_fx_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  status text NOT NULL CHECK (status IN ('resolved', 'pending_future', 'unavailable', 'unresolved')),
  rate_to_jpy numeric,
  converted_amount_jpy numeric,
  source_kind text NOT NULL CHECK (source_kind IN ('frankfurter_blended', 'manual', 'identity', 'unresolved')),
  provider_code text CHECK (provider_code IS NULL OR provider_code = 'frankfurter'),
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(provider_metadata) = 'object'),
  requested_on date NOT NULL,
  rate_effective_on date,
  fetched_at timestamptz,
  override_note text,
  resolution_reason text,
  idempotency_key uuid NOT NULL,
  request_fingerprint text NOT NULL CHECK (pg_catalog.length(request_fingerprint) > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT transaction_reporting_fx_snapshots_user_transaction_revision_key UNIQUE (user_id, transaction_id, revision),
  CONSTRAINT transaction_reporting_fx_snapshots_user_transaction_idempotency_key UNIQUE (user_id, transaction_id, idempotency_key),
  CONSTRAINT transaction_reporting_fx_snapshots_transaction_fk FOREIGN KEY (user_id, transaction_id)
    REFERENCES public.transactions(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transaction_reporting_fx_snapshots_resolved_amounts CHECK (
    (status = 'resolved' AND rate_to_jpy IS NOT NULL AND rate_to_jpy > 0 AND rate_to_jpy < 'Infinity'::numeric
      AND converted_amount_jpy IS NOT NULL AND converted_amount_jpy >= 0
      AND converted_amount_jpy = pg_catalog.trunc(converted_amount_jpy))
    OR (status <> 'resolved' AND rate_to_jpy IS NULL AND converted_amount_jpy IS NULL)
  ),
  CONSTRAINT transaction_reporting_fx_snapshots_source_fields CHECK (
    (source_kind = 'frankfurter_blended' AND status = 'resolved' AND provider_code = 'frankfurter'
      AND rate_effective_on IS NOT NULL AND fetched_at IS NOT NULL AND override_note IS NULL)
    OR (source_kind = 'identity' AND status = 'resolved' AND provider_code IS NULL
      AND rate_to_jpy = 1 AND rate_effective_on = requested_on AND fetched_at IS NULL AND override_note IS NULL)
    OR (source_kind = 'manual' AND status = 'resolved' AND provider_code IS NULL
      AND rate_effective_on IS NOT NULL AND fetched_at IS NULL
      AND override_note IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(override_note)) > 0)
    OR (source_kind = 'unresolved' AND status <> 'resolved' AND rate_effective_on IS NULL
      AND override_note IS NULL)
  ),
  CONSTRAINT transaction_reporting_fx_snapshots_resolution_reason CHECK (
    (status = 'resolved' AND resolution_reason IS NULL)
    OR (status <> 'resolved' AND resolution_reason IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(resolution_reason)) > 0)
  )
);
CREATE INDEX transaction_reporting_fx_snapshots_latest_idx
  ON public.transaction_reporting_fx_snapshots (user_id, transaction_id, revision DESC);
ALTER TABLE public.transaction_reporting_fx_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transaction_reporting_fx_snapshots FORCE ROW LEVEL SECURITY;
CREATE POLICY transaction_reporting_fx_snapshots_owner_select ON public.transaction_reporting_fx_snapshots
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
REVOKE ALL ON TABLE public.transaction_reporting_fx_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.transaction_reporting_fx_snapshots TO authenticated;

CREATE FUNCTION private.reject_reporting_fx_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'transaction reporting FX snapshots are append-only';
END;
$$;
CREATE TRIGGER transaction_reporting_fx_snapshots_reject_mutation
BEFORE UPDATE OR DELETE ON public.transaction_reporting_fx_snapshots
FOR EACH ROW EXECUTE FUNCTION private.reject_reporting_fx_snapshot_mutation();
REVOKE ALL ON FUNCTION private.reject_reporting_fx_snapshot_mutation() FROM PUBLIC, anon, authenticated;
CREATE FUNCTION public.get_cached_reporting_fx_rate(
  p_base_currency text,
  p_requested_on date
)
RETURNS TABLE (
  rate text,
  effective_on date,
  fetched_at timestamptz,
  provider_metadata jsonb
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
  IF p_base_currency IS NULL OR p_base_currency !~ '^[A-Z]{3}$'
     OR p_base_currency = 'JPY' OR p_requested_on IS NULL THEN
    RAISE EXCEPTION 'a foreign currency and economic date are required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT cache.rate::text, cache.effective_on, cache.fetched_at, cache.provider_metadata
  FROM public.fx_rate_cache AS cache
  WHERE cache.user_id = v_user_id
    AND cache.provider_code = 'frankfurter'
    AND cache.base_currency = p_base_currency
    AND cache.quote_currency = 'JPY'
    AND cache.effective_on >= p_requested_on - 7
    AND cache.effective_on <= p_requested_on
    AND cache.requested_from <= p_requested_on - 7
    AND cache.requested_through >= p_requested_on
  ORDER BY cache.effective_on DESC, cache.fetched_at DESC
  LIMIT 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_cached_reporting_fx_rate(text, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_cached_reporting_fx_rate(text, date) TO authenticated;


CREATE FUNCTION public.record_transaction_reporting_fx_snapshot(
  p_transaction_id uuid,
  p_idempotency_key uuid,
  p_status text,
  p_rate_to_jpy numeric,
  p_source_kind text,
  p_provider_code text,
  p_rate_effective_on date,
  p_fetched_at timestamptz,
  p_provider_metadata jsonb,
  p_resolution_reason text,
  p_cache_rates jsonb,
  p_cache_requested_from date,
  p_cache_requested_through date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_transaction public.transactions%ROWTYPE;
  v_existing public.transaction_reporting_fx_snapshots%ROWTYPE;
  v_latest public.transaction_reporting_fx_snapshots%ROWTYPE;
  v_fingerprint text;
  v_snapshot_id uuid;
  v_revision integer;
  v_today date := (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date;
  v_cache_row jsonb;
  v_cache_effective_on date;
  v_cache_rate numeric;
  v_cache_providers jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_idempotency_key IS NULL
     OR p_status NOT IN ('resolved', 'pending_future', 'unavailable', 'unresolved')
     OR p_source_kind NOT IN ('frankfurter_blended', 'identity', 'unresolved')
     OR p_provider_metadata IS NULL OR jsonb_typeof(p_provider_metadata) <> 'object'
     OR p_cache_rates IS NULL OR jsonb_typeof(p_cache_rates) <> 'array' THEN
    RAISE EXCEPTION 'invalid reporting FX snapshot request' USING ERRCODE = '22023';
  END IF;

  SELECT transaction_row.* INTO v_transaction
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id AND transaction_row.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'income or expense transaction was not found' USING ERRCODE = '23503';
  END IF;
  IF v_transaction.transaction_kind NOT IN ('income', 'expense') THEN
    RAISE EXCEPTION 'only income and expense transactions have reporting FX snapshots' USING ERRCODE = '22023';
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'operation', 'automatic',
    'transaction_id', p_transaction_id,
    'status', p_status,
    'rate_to_jpy', p_rate_to_jpy::text,
    'source_kind', p_source_kind,
    'provider_code', p_provider_code,
    'rate_effective_on', p_rate_effective_on,
    'fetched_at', p_fetched_at,
    'provider_metadata', p_provider_metadata,
    'resolution_reason', pg_catalog.btrim(COALESCE(p_resolution_reason, '')),
    'cache_rates', p_cache_rates,
    'cache_requested_from', p_cache_requested_from,
    'cache_requested_through', p_cache_requested_through
  )::text;

  SELECT snapshot.* INTO v_existing
  FROM public.transaction_reporting_fx_snapshots AS snapshot
  WHERE snapshot.user_id = v_user_id AND snapshot.transaction_id = p_transaction_id
    AND snapshot.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'reporting FX idempotency key was reused with a different request' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT snapshot.* INTO v_latest
  FROM public.transaction_reporting_fx_snapshots AS snapshot
  WHERE snapshot.user_id = v_user_id AND snapshot.transaction_id = p_transaction_id
  ORDER BY snapshot.revision DESC
  LIMIT 1;
  IF FOUND AND v_latest.source_kind = 'manual' THEN
    RETURN v_latest.id;
  END IF;

  IF FOUND AND v_latest.request_fingerprint = v_fingerprint THEN
    RETURN v_latest.id;
  END IF;

  IF p_status = 'pending_future' THEN
    IF v_transaction.currency_code = 'JPY' OR v_transaction.occurred_on <= v_today
       OR p_rate_to_jpy IS NOT NULL OR p_source_kind <> 'unresolved'
       OR p_provider_code IS NOT NULL OR p_rate_effective_on IS NOT NULL OR p_fetched_at IS NOT NULL
       OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_resolution_reason, ''))) = 0
       OR pg_catalog.jsonb_array_length(p_cache_rates) <> 0 THEN
      RAISE EXCEPTION 'pending-future snapshots require a future-dated foreign-currency transaction and no rate lookup' USING ERRCODE = '22023';
    END IF;
  ELSIF p_status = 'resolved' AND p_source_kind = 'identity' THEN
    IF v_transaction.currency_code <> 'JPY' OR p_rate_to_jpy IS DISTINCT FROM 1::numeric
       OR p_rate_effective_on IS DISTINCT FROM v_transaction.occurred_on
       OR p_provider_code IS NOT NULL OR p_fetched_at IS NOT NULL
       OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_resolution_reason, ''))) <> 0
       OR pg_catalog.jsonb_array_length(p_cache_rates) <> 0 THEN
      RAISE EXCEPTION 'identity snapshots are only valid for JPY-native transactions at rate one' USING ERRCODE = '22023';
    END IF;
  ELSIF p_status = 'resolved' AND p_source_kind = 'frankfurter_blended' THEN
    IF v_transaction.currency_code = 'JPY' OR v_transaction.occurred_on > v_today
       OR p_rate_to_jpy IS NULL OR p_rate_to_jpy <= 0 OR p_rate_to_jpy >= 'Infinity'::numeric
       OR p_provider_code <> 'frankfurter' OR p_fetched_at IS NULL
       OR p_rate_effective_on IS NULL
       OR p_rate_effective_on < v_transaction.occurred_on - 7
       OR p_rate_effective_on > v_transaction.occurred_on
       OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_resolution_reason, ''))) <> 0 THEN
      RAISE EXCEPTION 'Frankfurter snapshots require a positive eligible historical rate for the transaction date' USING ERRCODE = '22023';
    END IF;
  ELSIF p_status IN ('unavailable', 'unresolved') THEN
    IF p_source_kind <> 'unresolved' OR v_transaction.occurred_on > v_today
       OR p_rate_to_jpy IS NOT NULL OR p_rate_effective_on IS NOT NULL
       OR pg_catalog.length(pg_catalog.btrim(COALESCE(p_resolution_reason, ''))) = 0
       OR (p_provider_code IS NOT NULL AND p_provider_code <> 'frankfurter') THEN
      RAISE EXCEPTION 'unresolved snapshots require an eligible transaction and a recorded reason' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid reporting FX source and status combination' USING ERRCODE = '22023';
  END IF;

  IF p_provider_code = 'frankfurter' AND pg_catalog.jsonb_array_length(p_cache_rates) > 0 THEN
    IF p_cache_requested_from IS DISTINCT FROM v_transaction.occurred_on - 7
       OR p_cache_requested_through IS DISTINCT FROM v_transaction.occurred_on
       OR p_fetched_at IS NULL THEN
      RAISE EXCEPTION 'cached rate observations must cover the exact seven-day historical lookup window' USING ERRCODE = '22023';
    END IF;
    FOR v_cache_row IN SELECT pg_catalog.jsonb_array_elements(p_cache_rates)
    LOOP
      IF jsonb_typeof(v_cache_row) <> 'object'
         OR NOT (v_cache_row ? 'effective_on') OR NOT (v_cache_row ? 'rate')
         OR NOT (v_cache_row ? 'providers') OR jsonb_typeof(v_cache_row->'providers') <> 'array' THEN
        RAISE EXCEPTION 'malformed Frankfurter cache observation' USING ERRCODE = '22023';
      END IF;
      v_cache_effective_on := (v_cache_row->>'effective_on')::date;
      v_cache_rate := (v_cache_row->>'rate')::numeric;
      v_cache_providers := v_cache_row->'providers';
      IF v_cache_effective_on < p_cache_requested_from OR v_cache_effective_on > p_cache_requested_through
         OR v_cache_rate <= 0 OR v_cache_rate >= 'Infinity'::numeric
         OR EXISTS (SELECT 1 FROM pg_catalog.jsonb_array_elements(v_cache_providers) AS provider(value) WHERE jsonb_typeof(provider.value) <> 'string') THEN
        RAISE EXCEPTION 'Frankfurter cache observation is outside the requested pair or date window' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.fx_rate_cache (
        user_id, base_currency, quote_currency, rate, provider_code, effective_on,
        requested_from, requested_through, fetched_at, provider_metadata
      ) VALUES (
        v_user_id, v_transaction.currency_code, 'JPY', v_cache_rate, 'frankfurter',
        v_cache_effective_on, p_cache_requested_from, p_cache_requested_through,
        p_fetched_at, pg_catalog.jsonb_build_object('providers', v_cache_providers)
      )
      ON CONFLICT (user_id, provider_code, base_currency, quote_currency, effective_on)
      DO UPDATE SET rate = EXCLUDED.rate,
                    requested_from = EXCLUDED.requested_from,
                    requested_through = EXCLUDED.requested_through,
                    fetched_at = EXCLUDED.fetched_at,
                    provider_metadata = EXCLUDED.provider_metadata;
    END LOOP;
  ELSIF pg_catalog.jsonb_array_length(p_cache_rates) <> 0
     OR p_cache_requested_from IS NOT NULL OR p_cache_requested_through IS NOT NULL THEN
    RAISE EXCEPTION 'cache observations require a Frankfurter lookup' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'resolved' AND p_source_kind = 'frankfurter_blended'
     AND (
       jsonb_typeof(p_provider_metadata->'providers') <> 'array'
       OR pg_catalog.jsonb_array_length(p_provider_metadata->'providers') = 0
       OR NOT EXISTS (
         SELECT 1
         FROM public.fx_rate_cache AS selected_rate
         WHERE selected_rate.user_id = v_user_id
           AND selected_rate.provider_code = 'frankfurter'
           AND selected_rate.base_currency = v_transaction.currency_code
           AND selected_rate.quote_currency = 'JPY'
           AND selected_rate.effective_on = p_rate_effective_on
           AND selected_rate.effective_on >= v_transaction.occurred_on - 7
           AND selected_rate.effective_on <= v_transaction.occurred_on
           AND selected_rate.rate = p_rate_to_jpy
           AND selected_rate.fetched_at = p_fetched_at
           AND selected_rate.provider_metadata->'providers' = p_provider_metadata->'providers'
           AND selected_rate.requested_from <= v_transaction.occurred_on - 7
           AND selected_rate.requested_through >= v_transaction.occurred_on
       )
     ) THEN
    RAISE EXCEPTION 'Frankfurter snapshots must match a cached provider observation for this transaction date' USING ERRCODE = '22023';
  END IF;


  v_revision := COALESCE(v_latest.revision, 0) + 1;
  INSERT INTO public.transaction_reporting_fx_snapshots (
    user_id, transaction_id, revision, status, rate_to_jpy, converted_amount_jpy,
    source_kind, provider_code, provider_metadata, requested_on, rate_effective_on,
    fetched_at, resolution_reason, idempotency_key, request_fingerprint
  ) VALUES (
    v_user_id, p_transaction_id, v_revision, p_status, p_rate_to_jpy,
    CASE WHEN p_status = 'resolved' THEN pg_catalog.round(v_transaction.amount * p_rate_to_jpy, 0) END,
    p_source_kind, p_provider_code, p_provider_metadata, v_transaction.occurred_on,
    p_rate_effective_on, p_fetched_at,
    NULLIF(pg_catalog.btrim(COALESCE(p_resolution_reason, '')), ''),
    p_idempotency_key, v_fingerprint
  ) RETURNING id INTO v_snapshot_id;
  RETURN v_snapshot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.record_transaction_reporting_fx_snapshot(
  uuid, uuid, text, numeric, text, text, date, timestamptz, jsonb, text, jsonb, date, date
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_transaction_reporting_fx_snapshot(
  uuid, uuid, text, numeric, text, text, date, timestamptz, jsonb, text, jsonb, date, date
) TO authenticated;

CREATE FUNCTION public.override_transaction_reporting_fx(
  p_transaction_id uuid,
  p_idempotency_key uuid,
  p_rate_to_jpy numeric,
  p_rate_effective_on date,
  p_override_note text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_transaction public.transactions%ROWTYPE;
  v_existing public.transaction_reporting_fx_snapshots%ROWTYPE;
  v_latest public.transaction_reporting_fx_snapshots%ROWTYPE;
  v_fingerprint text;
  v_snapshot_id uuid;
  v_revision integer;
  v_note text := pg_catalog.btrim(COALESCE(p_override_note, ''));
  v_today date := (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_transaction_id IS NULL OR p_idempotency_key IS NULL
     OR p_rate_to_jpy IS NULL OR p_rate_to_jpy <= 0 OR p_rate_to_jpy >= 'Infinity'::numeric
     OR p_rate_effective_on IS NULL OR pg_catalog.length(v_note) = 0 OR pg_catalog.length(v_note) > 500 THEN
    RAISE EXCEPTION 'a positive reporting rate, effective date, and non-empty explanation are required' USING ERRCODE = '22023';
  END IF;

  SELECT transaction_row.* INTO v_transaction
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = v_user_id AND transaction_row.id = p_transaction_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'income or expense transaction was not found' USING ERRCODE = '23503';
  END IF;

  v_fingerprint := pg_catalog.jsonb_build_object(
    'operation', 'manual_override',
    'transaction_id', p_transaction_id,
    'rate_to_jpy', p_rate_to_jpy::text,
    'rate_effective_on', p_rate_effective_on,
    'override_note', v_note
  )::text;
  SELECT snapshot.* INTO v_existing
  FROM public.transaction_reporting_fx_snapshots AS snapshot
  WHERE snapshot.user_id = v_user_id AND snapshot.transaction_id = p_transaction_id
    AND snapshot.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'reporting FX idempotency key was reused with a different request' USING ERRCODE = '23505';
    END IF;
    RETURN v_existing.id;
  END IF;
  IF v_transaction.transaction_kind NOT IN ('income', 'expense') OR v_transaction.status <> 'posted'
     OR v_transaction.currency_code = 'JPY' OR v_transaction.occurred_on > v_today
     OR p_rate_effective_on < v_transaction.occurred_on - 7
     OR p_rate_effective_on > v_transaction.occurred_on THEN
    RAISE EXCEPTION 'manual reporting rates require an eligible posted foreign-currency transaction and a rate no more than seven days old' USING ERRCODE = '22023';
  END IF;

  SELECT snapshot.* INTO v_latest
  FROM public.transaction_reporting_fx_snapshots AS snapshot
  WHERE snapshot.user_id = v_user_id AND snapshot.transaction_id = p_transaction_id
  ORDER BY snapshot.revision DESC
  LIMIT 1;
  v_revision := COALESCE(v_latest.revision, 0) + 1;
  INSERT INTO public.transaction_reporting_fx_snapshots (
    user_id, transaction_id, revision, status, rate_to_jpy, converted_amount_jpy,
    source_kind, provider_metadata, requested_on, rate_effective_on,
    override_note, idempotency_key, request_fingerprint
  ) VALUES (
    v_user_id, p_transaction_id, v_revision, 'resolved', p_rate_to_jpy,
    pg_catalog.round(v_transaction.amount * p_rate_to_jpy, 0),
    'manual', '{}'::jsonb, v_transaction.occurred_on, p_rate_effective_on,
    v_note, p_idempotency_key, v_fingerprint
  ) RETURNING id INTO v_snapshot_id;
  RETURN v_snapshot_id;
END;
$$;
REVOKE ALL ON FUNCTION public.override_transaction_reporting_fx(uuid, uuid, numeric, date, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.override_transaction_reporting_fx(uuid, uuid, numeric, date, text)
  TO authenticated;

-- Existing foreign-currency events remain unresolved; no provider is called during migration.
-- JPY-native events can be represented exactly without an external rate.
INSERT INTO public.transaction_reporting_fx_snapshots (
  user_id, transaction_id, revision, status, rate_to_jpy, converted_amount_jpy,
  source_kind, provider_metadata, requested_on, rate_effective_on,
  resolution_reason, idempotency_key, request_fingerprint
)
SELECT transaction_row.user_id,
       transaction_row.id,
       1,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN 'resolved'
            WHEN transaction_row.occurred_on > (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date THEN 'pending_future'
            ELSE 'unresolved' END,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN 1::numeric END,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN pg_catalog.round(transaction_row.amount, 0) END,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN 'identity' ELSE 'unresolved' END,
       '{}'::jsonb,
       transaction_row.occurred_on,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN transaction_row.occurred_on END,
       CASE WHEN transaction_row.currency_code = 'JPY' THEN NULL
            WHEN transaction_row.occurred_on > (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date
            THEN 'Future-effective transaction is not yet eligible for historical FX lookup.'
            ELSE 'Historical FX snapshot is not available yet; use the on-demand resolver or manual override.' END,
       transaction_row.id,
       pg_catalog.jsonb_build_object(
         'operation', 'migration_backfill',
         'transaction_id', transaction_row.id,
         'status', CASE WHEN transaction_row.currency_code = 'JPY' THEN 'resolved'
                        WHEN transaction_row.occurred_on > (pg_catalog.statement_timestamp() AT TIME ZONE 'Asia/Tokyo')::date THEN 'pending_future'
                        ELSE 'unresolved' END,
         'amount', transaction_row.amount::text,
         'currency_code', transaction_row.currency_code,
         'occurred_on', transaction_row.occurred_on
       )::text
FROM public.transactions AS transaction_row
WHERE transaction_row.transaction_kind IN ('income', 'expense');

DROP FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer);
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
  total_count bigint,
  source text,
  adjustment_reason text,
  voided_by uuid,
  account_movements jsonb,
  reporting_fx jsonb,
  reporting_fx_history jsonb
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
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('income', 'expense', 'card_settlement', 'transfer', 'balance_adjustment'))
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
      ORDER BY CASE WHEN entry.amount < 0 THEN 0 ELSE 1 END, entry.recorded_at, entry.id
      LIMIT 1
    ) AS funding ON true
    LEFT JOIN public.transaction_corrections AS original_link
      ON original_link.user_id = transaction_row.user_id
     AND original_link.replacement_transaction_id = transaction_row.id
    LEFT JOIN public.transaction_corrections AS replacement_link
      ON replacement_link.user_id = transaction_row.user_id
     AND replacement_link.original_transaction_id = transaction_row.id
    WHERE transaction_row.user_id = v_user_id
      AND transaction_row.transaction_kind IN ('income', 'expense', 'card_settlement', 'transfer', 'balance_adjustment')
      AND (p_kind IS NULL OR transaction_row.transaction_kind::text = p_kind)
      AND (p_status IS NULL OR transaction_row.status::text = p_status)
      AND (p_occurred_from IS NULL OR transaction_row.occurred_on >= p_occurred_from)
      AND (p_occurred_through IS NULL OR transaction_row.occurred_on <= p_occurred_through)
      AND (p_transaction_id IS NULL OR transaction_row.id = p_transaction_id)
      AND (p_search IS NULL OR pg_catalog.length(pg_catalog.btrim(p_search)) = 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.merchant, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.note, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(category.name, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(method.name, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.adjustment_reason, '')), pg_catalog.lower(p_search)) > 0
        OR pg_catalog.strpos(pg_catalog.lower(COALESCE(transaction_row.void_reason, '')), pg_catalog.lower(p_search)) > 0
        OR EXISTS (
          SELECT 1
          FROM public.account_entries AS search_entry
          JOIN public.accounts AS search_account
            ON search_account.user_id = search_entry.user_id AND search_account.id = search_entry.account_id
          WHERE search_entry.user_id = transaction_row.user_id
            AND search_entry.transaction_id = transaction_row.id
            AND pg_catalog.strpos(pg_catalog.lower(search_account.name), pg_catalog.lower(p_search)) > 0
        ))
  )
  SELECT filtered.id, filtered.transaction_kind::text, filtered.occurred_at, filtered.occurred_on,
         filtered.amount::text, filtered.currency_code, filtered.category_id, filtered.category_name,
         filtered.payment_method_id, filtered.payment_method_name, filtered.payment_method_kind,
         filtered.funding_account_id, filtered.funding_account_name, funding_status.funding_status,
         filtered.status::text, filtered.merchant, filtered.note, filtered.void_reason, filtered.voided_at,
         filtered.created_at, filtered.corrected_from_transaction_id, filtered.corrected_by_transaction_id,
         filtered.correction_reason, pg_catalog.count(*) OVER (), filtered.source::text,
         filtered.adjustment_reason, filtered.voided_by,
         COALESCE(movements.account_movements, '[]'::jsonb),
         current_fx.reporting_fx,
         COALESCE(history.reporting_fx_history, '[]'::jsonb)
  FROM filtered
  LEFT JOIN LATERAL (
    SELECT CASE WHEN filtered.transaction_kind IN ('card_settlement', 'transfer', 'balance_adjustment') THEN 'funded'
                WHEN filtered.payment_method_id IS NULL THEN 'unassigned'
                WHEN filtered.payment_method_kind = 'credit_card' THEN 'credit_card'
                ELSE 'funded' END AS funding_status
  ) AS funding_status ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'account_id', movement.account_id,
        'account_name', movement_account.name,
        'amount', movement.amount::text,
        'currency_code', movement.currency_code,
        'recorded_at', movement.recorded_at
      ) ORDER BY CASE WHEN movement.amount < 0 THEN 0 ELSE 1 END, movement.recorded_at, movement.id
    ) AS account_movements
    FROM public.account_entries AS movement
    JOIN public.accounts AS movement_account
      ON movement_account.user_id = movement.user_id AND movement_account.id = movement.account_id
    WHERE movement.user_id = filtered.user_id AND movement.transaction_id = filtered.id
  ) AS movements ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_build_object(
      'id', snapshot.id,
      'revision', snapshot.revision,
      'status', snapshot.status,
      'rate_to_jpy', snapshot.rate_to_jpy::text,
      'converted_amount_jpy', snapshot.converted_amount_jpy::text,
      'source_kind', snapshot.source_kind,
      'provider_code', snapshot.provider_code,
      'provider_metadata', snapshot.provider_metadata,
      'requested_on', snapshot.requested_on,
      'rate_effective_on', snapshot.rate_effective_on,
      'fetched_at', snapshot.fetched_at,
      'override_note', snapshot.override_note,
      'resolution_reason', snapshot.resolution_reason,
      'created_at', snapshot.created_at
    ) AS reporting_fx
    FROM public.transaction_reporting_fx_snapshots AS snapshot
    WHERE snapshot.user_id = filtered.user_id AND snapshot.transaction_id = filtered.id
    ORDER BY snapshot.revision DESC
    LIMIT 1
  ) AS current_fx ON true
  LEFT JOIN LATERAL (
    SELECT pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', snapshot.id,
        'revision', snapshot.revision,
        'status', snapshot.status,
        'rate_to_jpy', snapshot.rate_to_jpy::text,
        'converted_amount_jpy', snapshot.converted_amount_jpy::text,
        'source_kind', snapshot.source_kind,
        'provider_code', snapshot.provider_code,
        'provider_metadata', snapshot.provider_metadata,
        'requested_on', snapshot.requested_on,
        'rate_effective_on', snapshot.rate_effective_on,
        'fetched_at', snapshot.fetched_at,
        'override_note', snapshot.override_note,
        'resolution_reason', snapshot.resolution_reason,
        'created_at', snapshot.created_at
      ) ORDER BY snapshot.revision DESC
    ) AS reporting_fx_history
    FROM public.transaction_reporting_fx_snapshots AS snapshot
    WHERE snapshot.user_id = filtered.user_id AND snapshot.transaction_id = filtered.id
  ) AS history ON true
  ORDER BY filtered.occurred_on DESC, filtered.occurred_at DESC, filtered.created_at DESC, filtered.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;
REVOKE ALL ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  TO authenticated;

DROP FUNCTION public.transaction_totals(date);
CREATE FUNCTION public.transaction_totals(p_month_start date DEFAULT NULL)
RETURNS TABLE (
  transaction_kind text,
  currency_code text,
  total_amount text,
  transaction_count bigint,
  resolved_total_jpy text,
  resolved_transaction_count bigint,
  unresolved_transaction_count bigint,
  included_transaction_count bigint
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
  v_as_of timestamptz := pg_catalog.statement_timestamp();
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
    pg_catalog.date_trunc('month', v_as_of AT TIME ZONE v_timezone)::date);
  RETURN QUERY
  WITH included AS (
    SELECT transaction_row.id,
           transaction_row.transaction_kind,
           transaction_row.amount,
           transaction_row.currency_code,
           snapshot.status AS fx_status,
           snapshot.converted_amount_jpy
    FROM public.transactions AS transaction_row
    LEFT JOIN LATERAL (
      SELECT current_snapshot.status, current_snapshot.converted_amount_jpy
      FROM public.transaction_reporting_fx_snapshots AS current_snapshot
      WHERE current_snapshot.user_id = transaction_row.user_id
        AND current_snapshot.transaction_id = transaction_row.id
      ORDER BY current_snapshot.revision DESC
      LIMIT 1
    ) AS snapshot ON true
    WHERE transaction_row.user_id = v_user_id
      AND transaction_row.status = 'posted'
      AND transaction_row.transaction_kind IN ('income', 'expense')
      AND transaction_row.occurred_on >= v_month_start
      AND transaction_row.occurred_on < (v_month_start + INTERVAL '1 month')::date
      AND transaction_row.occurred_at <= v_as_of
  ),
  native AS (
    SELECT included.transaction_kind,
           included.currency_code,
           pg_catalog.sum(included.amount)::text AS total_amount,
           pg_catalog.count(*) AS transaction_count
    FROM included
    GROUP BY included.transaction_kind, included.currency_code
  ),
  reporting AS (
    SELECT included.transaction_kind,
           pg_catalog.sum(included.converted_amount_jpy) FILTER (WHERE included.fx_status = 'resolved') AS resolved_total_jpy,
           pg_catalog.count(*) FILTER (WHERE included.fx_status = 'resolved') AS resolved_transaction_count,
           pg_catalog.count(*) FILTER (WHERE included.fx_status IS DISTINCT FROM 'resolved') AS unresolved_transaction_count,
           pg_catalog.count(*) AS included_transaction_count
    FROM included
    GROUP BY included.transaction_kind
  )
  SELECT native.transaction_kind::text,
         native.currency_code,
         native.total_amount,
         native.transaction_count,
         CASE WHEN reporting.resolved_transaction_count > 0 THEN reporting.resolved_total_jpy::text END,
         reporting.resolved_transaction_count,
         reporting.unresolved_transaction_count,
         reporting.included_transaction_count
  FROM native
  JOIN reporting ON reporting.transaction_kind = native.transaction_kind
  ORDER BY native.transaction_kind, native.currency_code;
END;
$$;
REVOKE ALL ON FUNCTION public.transaction_totals(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transaction_totals(date) TO authenticated;

COMMIT;
