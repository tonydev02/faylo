BEGIN;

-- The existing post_transaction RPC already validates, writes, and retries transfers and
-- balance adjustments atomically. Expand the owner-scoped history read contract so those
-- immutable events retain their native account legs and audit metadata in the application.
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
  account_movements jsonb
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
         filtered.funding_account_id, filtered.funding_account_name,
         CASE WHEN filtered.transaction_kind IN ('card_settlement', 'transfer', 'balance_adjustment') THEN 'funded'
              WHEN filtered.payment_method_id IS NULL THEN 'unassigned'
              WHEN filtered.payment_method_kind = 'credit_card' THEN 'credit_card'
              ELSE 'funded' END,
         filtered.status::text, filtered.merchant, filtered.note, filtered.void_reason, filtered.voided_at,
         filtered.created_at, filtered.corrected_from_transaction_id, filtered.corrected_by_transaction_id,
         filtered.correction_reason, pg_catalog.count(*) OVER (), filtered.source::text,
         filtered.adjustment_reason, filtered.voided_by,
         COALESCE((
           SELECT pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'account_id', movement.account_id,
               'account_name', movement_account.name,
               'amount', movement.amount::text,
               'currency_code', movement.currency_code,
               'recorded_at', movement.recorded_at
             ) ORDER BY CASE WHEN movement.amount < 0 THEN 0 ELSE 1 END, movement.recorded_at, movement.id
           )
           FROM public.account_entries AS movement
           JOIN public.accounts AS movement_account
             ON movement_account.user_id = movement.user_id AND movement_account.id = movement.account_id
           WHERE movement.user_id = filtered.user_id AND movement.transaction_id = filtered.id
         ), '[]'::jsonb)
  FROM filtered
  ORDER BY filtered.occurred_on DESC, filtered.occurred_at DESC, filtered.created_at DESC, filtered.id DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$;

REVOKE ALL ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_transactions(text, text, text, date, date, uuid, integer, integer)
  TO authenticated;

COMMIT;
