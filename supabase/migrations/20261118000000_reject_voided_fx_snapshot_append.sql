BEGIN;

CREATE FUNCTION private.require_posted_transaction_for_reporting_fx_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_transaction_status text;
BEGIN
  -- Serialize snapshot appends with voiding; idempotent replays return before INSERT.
  SELECT transaction_row.status::text
  INTO v_transaction_status
  FROM public.transactions AS transaction_row
  WHERE transaction_row.user_id = NEW.user_id
    AND transaction_row.id = NEW.transaction_id
  FOR UPDATE;

  IF NOT FOUND OR v_transaction_status <> 'posted' THEN
    RAISE EXCEPTION 'reporting FX snapshots can only be appended for posted transactions'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.require_posted_transaction_for_reporting_fx_snapshot() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER transaction_reporting_fx_snapshots_require_posted_transaction
BEFORE INSERT ON public.transaction_reporting_fx_snapshots
FOR EACH ROW
EXECUTE FUNCTION private.require_posted_transaction_for_reporting_fx_snapshot();

COMMIT;
