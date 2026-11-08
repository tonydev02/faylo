BEGIN;

CREATE FUNCTION public.account_balances_as_of(
  p_as_of timestamptz DEFAULT pg_catalog.statement_timestamp()
)
RETURNS TABLE (
  account_id uuid,
  name text,
  account_kind text,
  currency_code text,
  opening_balance text,
  opening_as_of date,
  include_in_assets boolean,
  status text,
  balance text,
  as_of timestamptz
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
  IF p_as_of IS NULL THEN
    RAISE EXCEPTION 'balance as-of instant is required' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT account.id,
         account.name,
         account.account_kind::text,
         account.currency_code,
         account.opening_balance::text,
         account.opening_as_of,
         account.include_in_assets,
         account.status::text,
         (
           account.opening_balance + COALESCE(
             pg_catalog.sum(entry.amount) FILTER (
               WHERE transaction_row.status = 'posted'
                 AND transaction_row.occurred_on >= account.opening_as_of
                 AND transaction_row.occurred_at <= p_as_of
             ),
             0::numeric
           )
         )::text,
         p_as_of
  FROM public.accounts AS account
  LEFT JOIN public.account_entries AS entry
    ON entry.user_id = account.user_id AND entry.account_id = account.id
  LEFT JOIN public.transactions AS transaction_row
    ON transaction_row.user_id = entry.user_id AND transaction_row.id = entry.transaction_id
  WHERE account.user_id = v_user_id
  GROUP BY account.id, account.name, account.account_kind, account.currency_code,
           account.opening_balance, account.opening_as_of, account.include_in_assets, account.status
  ORDER BY account.status, pg_catalog.lower(account.name), account.id;
END;
$$;

REVOKE ALL ON FUNCTION public.account_balances_as_of(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_balances_as_of(timestamptz) TO authenticated;

COMMIT;
