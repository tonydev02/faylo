BEGIN;

CREATE TABLE public.category_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL,
  category_kind public.category_kind NOT NULL DEFAULT 'expense' CHECK (category_kind = 'expense'),
  month_start date NOT NULL,
  limit_jpy numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT category_budgets_month_start CHECK (
    pg_catalog.date_trunc('month', month_start::timestamp)::date = month_start
  ),
  CONSTRAINT category_budgets_limit_jpy CHECK (
    limit_jpy >= 0 AND limit_jpy < 'Infinity'::numeric AND limit_jpy = pg_catalog.trunc(limit_jpy)
  ),
  CONSTRAINT category_budgets_owner_month_category_key UNIQUE (user_id, month_start, category_id),
  CONSTRAINT category_budgets_category_fk FOREIGN KEY (user_id, category_id, category_kind)
    REFERENCES public.categories(user_id, id, kind) ON DELETE RESTRICT
);

CREATE INDEX category_budgets_owner_month_idx ON public.category_budgets(user_id, month_start);
CREATE TRIGGER category_budgets_touch_updated_at
BEFORE UPDATE ON public.category_budgets
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
ALTER TABLE public.category_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.category_budgets FORCE ROW LEVEL SECURITY;
CREATE POLICY category_budgets_owner_only ON public.category_budgets
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
REVOKE ALL ON TABLE public.category_budgets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.category_budgets TO authenticated;
GRANT EXECUTE ON FUNCTION private.touch_updated_at() TO authenticated;

CREATE FUNCTION private.monthly_reporting_transactions(
  p_occurred_from date,
  p_occurred_before date,
  p_as_of timestamptz
)
RETURNS TABLE (
  transaction_id uuid,
  transaction_kind text,
  occurred_on date,
  amount numeric,
  currency_code text,
  category_id uuid,
  fx_status text,
  converted_amount_jpy numeric
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
  IF p_occurred_from IS NULL OR p_occurred_before IS NULL OR p_occurred_from >= p_occurred_before OR p_as_of IS NULL THEN
    RAISE EXCEPTION 'valid reporting date range and as-of instant are required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT transaction_row.id,
         transaction_row.transaction_kind::text,
         transaction_row.occurred_on,
         transaction_row.amount,
         transaction_row.currency_code,
         transaction_row.category_id,
         latest_snapshot.status,
         latest_snapshot.converted_amount_jpy
  FROM public.transactions AS transaction_row
  LEFT JOIN LATERAL (
    SELECT snapshot.status, snapshot.converted_amount_jpy
    FROM public.transaction_reporting_fx_snapshots AS snapshot
    WHERE snapshot.user_id = transaction_row.user_id
      AND snapshot.transaction_id = transaction_row.id
    ORDER BY snapshot.revision DESC
    LIMIT 1
  ) AS latest_snapshot ON true
  WHERE transaction_row.user_id = v_user_id
    AND transaction_row.status = 'posted'
    AND transaction_row.transaction_kind IN ('income', 'expense')
    AND transaction_row.occurred_on >= p_occurred_from
    AND transaction_row.occurred_on < p_occurred_before
    AND transaction_row.occurred_at <= p_as_of;
END;
$$;
REVOKE ALL ON FUNCTION private.monthly_reporting_transactions(date, date, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.monthly_reporting_transactions(date, date, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.transaction_totals(p_month_start date DEFAULT NULL)
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
    SELECT *
    FROM private.monthly_reporting_transactions(
      v_month_start,
      (v_month_start + INTERVAL '1 month')::date,
      v_as_of
    )
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
  SELECT native.transaction_kind,
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

CREATE FUNCTION public.monthly_dashboard_totals(
  p_month_start date DEFAULT NULL,
  p_month_count integer DEFAULT 6
)
RETURNS TABLE (
  month_start date,
  transaction_kind text,
  currency_code text,
  total_amount text,
  transaction_count bigint,
  resolved_total_jpy text,
  resolved_transaction_count bigint,
  unresolved_transaction_count bigint,
  included_transaction_count bigint,
  coverage_status text,
  comparable_to_previous boolean,
  as_of timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_as_of timestamptz := pg_catalog.statement_timestamp();
  v_current_month date;
  v_month_start date;
  v_first_month date;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_month_count IS NULL OR p_month_count < 1 OR p_month_count > 12 THEN
    RAISE EXCEPTION 'month count must be between 1 and 12' USING ERRCODE = '22023';
  END IF;
  IF p_month_start IS NOT NULL
     AND pg_catalog.date_trunc('month', p_month_start::timestamp)::date <> p_month_start THEN
    RAISE EXCEPTION 'month start must be the first calendar day' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    (SELECT preference.timezone FROM public.user_preferences AS preference WHERE preference.user_id = v_user_id),
    'Asia/Tokyo'
  ) INTO v_timezone;
  v_current_month := pg_catalog.date_trunc('month', v_as_of AT TIME ZONE v_timezone)::date;
  v_month_start := COALESCE(p_month_start, v_current_month);
  IF v_month_start > v_current_month THEN
    RAISE EXCEPTION 'future months are not available in historical reporting' USING ERRCODE = '22023';
  END IF;
  v_first_month := (v_month_start - ((p_month_count - 1) * INTERVAL '1 month'))::date;

  RETURN QUERY
  WITH month_grid AS (
    SELECT generated.month_start::date AS month_start
    FROM pg_catalog.generate_series(
      (v_first_month - INTERVAL '1 month')::date,
      v_month_start,
      INTERVAL '1 month'
    ) AS generated(month_start)
  ),
  coverage_raw AS (
    SELECT month_grid.month_start,
           pg_catalog.count(account.id)::integer AS account_count,
           pg_catalog.count(account.id) FILTER (WHERE account.opening_as_of <= month_grid.month_start)::integer AS open_at_start_count,
           pg_catalog.count(account.id) FILTER (
             WHERE account.opening_as_of <= ((month_grid.month_start + INTERVAL '1 month')::date - 1)
           )::integer AS open_by_end_count,
           COALESCE(
             pg_catalog.string_agg(
               account.id::text || ':' || CASE
                 WHEN account.opening_as_of <= month_grid.month_start THEN 'open_full_month'
                 WHEN account.opening_as_of <= ((month_grid.month_start + INTERVAL '1 month')::date - 1) THEN 'opened_during_month'
                 ELSE 'not_open'
               END,
               ',' ORDER BY account.id
             ) FILTER (WHERE account.id IS NOT NULL),
             ''
           ) AS coverage_signature
    FROM month_grid
    LEFT JOIN public.accounts AS account ON account.user_id = v_user_id
    GROUP BY month_grid.month_start
  ),
  coverage_classified AS (
    SELECT coverage_raw.month_start,
           CASE
             WHEN coverage_raw.account_count = 0 OR coverage_raw.open_by_end_count = 0 THEN 'insufficient_history'
             WHEN coverage_raw.open_at_start_count = coverage_raw.account_count THEN 'fully_tracked'
             ELSE 'partial_account_coverage'
           END AS coverage_status,
           coverage_raw.coverage_signature
    FROM coverage_raw
  ),
  coverage_lagged AS (
    SELECT coverage_classified.month_start,
           coverage_classified.coverage_status,
           coverage_classified.coverage_signature,
           pg_catalog.lag(coverage_classified.month_start) OVER (ORDER BY coverage_classified.month_start) AS previous_month_start,
           pg_catalog.lag(coverage_classified.coverage_status) OVER (ORDER BY coverage_classified.month_start) AS previous_coverage_status,
           pg_catalog.lag(coverage_classified.coverage_signature) OVER (ORDER BY coverage_classified.month_start) AS previous_coverage_signature
    FROM coverage_classified
  ),
  report_months AS (
    SELECT coverage_lagged.month_start,
           coverage_lagged.coverage_status,
           (
             coverage_lagged.month_start < v_current_month
             AND coverage_lagged.previous_month_start = (coverage_lagged.month_start - INTERVAL '1 month')::date
             AND coverage_lagged.coverage_status <> 'insufficient_history'
             AND coverage_lagged.previous_coverage_status <> 'insufficient_history'
             AND coverage_lagged.coverage_signature = coverage_lagged.previous_coverage_signature
           ) AS comparable_to_previous
    FROM coverage_lagged
    WHERE coverage_lagged.month_start >= v_first_month
  ),
  included AS (
    SELECT (pg_catalog.date_trunc('month', reportable.occurred_on::timestamp))::date AS month_start,
           reportable.transaction_kind,
           reportable.currency_code,
           reportable.amount,
           reportable.fx_status,
           reportable.converted_amount_jpy
    FROM private.monthly_reporting_transactions(
      v_first_month,
      (v_month_start + INTERVAL '1 month')::date,
      v_as_of
    ) AS reportable
  ),
  native AS (
    SELECT included.month_start,
           included.transaction_kind,
           included.currency_code,
           pg_catalog.sum(included.amount)::text AS total_amount,
           pg_catalog.count(*) AS transaction_count
    FROM included
    GROUP BY included.month_start, included.transaction_kind, included.currency_code
  ),
  reporting AS (
    SELECT included.month_start,
           included.transaction_kind,
           pg_catalog.sum(included.converted_amount_jpy) FILTER (WHERE included.fx_status = 'resolved') AS resolved_total_jpy,
           pg_catalog.count(*) FILTER (WHERE included.fx_status = 'resolved') AS resolved_transaction_count,
           pg_catalog.count(*) FILTER (WHERE included.fx_status IS DISTINCT FROM 'resolved') AS unresolved_transaction_count,
           pg_catalog.count(*) AS included_transaction_count
    FROM included
    GROUP BY included.month_start, included.transaction_kind
  ),
  report_kinds AS (
    SELECT report_months.month_start, kinds.transaction_kind, report_months.coverage_status,
           report_months.comparable_to_previous
    FROM report_months
    CROSS JOIN (VALUES ('income'::text), ('expense'::text)) AS kinds(transaction_kind)
  ),
  populated_rows AS (
    SELECT native.month_start,
           native.transaction_kind,
           native.currency_code,
           native.total_amount,
           native.transaction_count,
           CASE WHEN reporting.resolved_transaction_count > 0 THEN reporting.resolved_total_jpy::text END AS resolved_total_jpy,
           reporting.resolved_transaction_count,
           reporting.unresolved_transaction_count,
           reporting.included_transaction_count
    FROM native
    JOIN reporting USING (month_start, transaction_kind)
  ),
  empty_rows AS (
    SELECT report_kinds.month_start,
           report_kinds.transaction_kind,
           NULL::text AS currency_code,
           NULL::text AS total_amount,
           0::bigint AS transaction_count,
           NULL::text AS resolved_total_jpy,
           0::bigint AS resolved_transaction_count,
           0::bigint AS unresolved_transaction_count,
           0::bigint AS included_transaction_count
    FROM report_kinds
    WHERE NOT EXISTS (
      SELECT 1 FROM native
      WHERE native.month_start = report_kinds.month_start
        AND native.transaction_kind = report_kinds.transaction_kind
    )
  ),
  all_rows AS (
    SELECT * FROM populated_rows
    UNION ALL
    SELECT * FROM empty_rows
  )
  SELECT all_rows.month_start,
         all_rows.transaction_kind,
         all_rows.currency_code,
         all_rows.total_amount,
         all_rows.transaction_count,
         all_rows.resolved_total_jpy,
         all_rows.resolved_transaction_count,
         all_rows.unresolved_transaction_count,
         all_rows.included_transaction_count,
         report_kinds.coverage_status,
         report_kinds.comparable_to_previous,
         v_as_of
  FROM all_rows
  JOIN report_kinds USING (month_start, transaction_kind)
  ORDER BY all_rows.month_start, all_rows.transaction_kind, all_rows.currency_code NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.monthly_dashboard_totals(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monthly_dashboard_totals(date, integer) TO authenticated;

CREATE FUNCTION public.monthly_category_spending(p_month_start date)
RETURNS TABLE (
  category_id uuid,
  category_name text,
  parent_category_name text,
  currency_code text,
  native_total text,
  transaction_count bigint,
  resolved_total_jpy text,
  resolved_transaction_count bigint,
  unresolved_transaction_count bigint,
  included_transaction_count bigint,
  budget_limit_jpy text,
  as_of timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_timezone text;
  v_as_of timestamptz := pg_catalog.statement_timestamp();
  v_current_month date;
  v_month_start date;
BEGIN
  IF v_user_id IS NULL OR NOT private.is_faylo_owner() THEN
    RAISE EXCEPTION 'database owner authorization required' USING ERRCODE = '42501';
  END IF;
  IF p_month_start IS NULL
     OR pg_catalog.date_trunc('month', p_month_start::timestamp)::date <> p_month_start THEN
    RAISE EXCEPTION 'month start must be the first calendar day' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    (SELECT preference.timezone FROM public.user_preferences AS preference WHERE preference.user_id = v_user_id),
    'Asia/Tokyo'
  ) INTO v_timezone;
  v_current_month := pg_catalog.date_trunc('month', v_as_of AT TIME ZONE v_timezone)::date;
  IF p_month_start > v_current_month THEN
    RAISE EXCEPTION 'future months are not available in historical reporting' USING ERRCODE = '22023';
  END IF;
  v_month_start := p_month_start;

  RETURN QUERY
  WITH included AS (
    SELECT reportable.category_id,
           reportable.currency_code,
           reportable.amount,
           reportable.fx_status,
           reportable.converted_amount_jpy
    FROM private.monthly_reporting_transactions(
      v_month_start,
      (v_month_start + INTERVAL '1 month')::date,
      v_as_of
    ) AS reportable
    WHERE reportable.transaction_kind = 'expense'
  ),
  native AS (
    SELECT included.category_id,
           included.currency_code,
           pg_catalog.sum(included.amount)::text AS native_total,
           pg_catalog.count(*) AS transaction_count
    FROM included
    GROUP BY included.category_id, included.currency_code
  ),
  reporting AS (
    SELECT included.category_id,
           pg_catalog.sum(included.converted_amount_jpy) FILTER (WHERE included.fx_status = 'resolved') AS resolved_total_jpy,
           pg_catalog.count(*) FILTER (WHERE included.fx_status = 'resolved') AS resolved_transaction_count,
           pg_catalog.count(*) FILTER (WHERE included.fx_status IS DISTINCT FROM 'resolved') AS unresolved_transaction_count,
           pg_catalog.count(*) AS included_transaction_count
    FROM included
    GROUP BY included.category_id
  ),
  candidates AS (
    SELECT native.category_id FROM native
    UNION
    SELECT budget.category_id
    FROM public.category_budgets AS budget
    WHERE budget.user_id = v_user_id AND budget.month_start = v_month_start
  )
  SELECT category.id,
         category.name,
         parent.name,
         native.currency_code,
         native.native_total,
         COALESCE(native.transaction_count, 0::bigint),
         CASE WHEN reporting.resolved_transaction_count > 0 THEN reporting.resolved_total_jpy::text END,
         COALESCE(reporting.resolved_transaction_count, 0::bigint),
         COALESCE(reporting.unresolved_transaction_count, 0::bigint),
         COALESCE(reporting.included_transaction_count, 0::bigint),
         budget.limit_jpy::text,
         v_as_of
  FROM candidates
  JOIN public.categories AS category
    ON category.user_id = v_user_id AND category.id = candidates.category_id
  LEFT JOIN public.categories AS parent
    ON parent.user_id = category.user_id AND parent.id = category.parent_id
  LEFT JOIN native ON native.category_id = category.id
  LEFT JOIN reporting ON reporting.category_id = category.id
  LEFT JOIN public.category_budgets AS budget
    ON budget.user_id = category.user_id
   AND budget.category_id = category.id
   AND budget.month_start = v_month_start
  ORDER BY parent.name NULLS FIRST, category.name, native.currency_code NULLS FIRST;
END;
$$;
REVOKE ALL ON FUNCTION public.monthly_category_spending(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.monthly_category_spending(date) TO authenticated;

COMMIT;
