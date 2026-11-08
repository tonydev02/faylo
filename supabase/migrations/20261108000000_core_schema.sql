BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TYPE public.account_kind AS ENUM ('bank', 'cash', 'investment');
CREATE TYPE public.account_status AS ENUM ('active', 'archived');
CREATE TYPE public.payment_method_kind AS ENUM ('cash', 'debit_card', 'credit_card', 'bank_transfer', 'other');
CREATE TYPE public.category_kind AS ENUM ('income', 'expense');
CREATE TYPE public.transaction_kind AS ENUM ('income', 'expense', 'transfer', 'card_settlement', 'balance_adjustment');
CREATE TYPE public.transaction_source AS ENUM ('manual', 'telegram', 'import');
CREATE TYPE public.transaction_status AS ENUM ('posted', 'voided');

CREATE TABLE private.owner_allowlist (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE RESTRICT,
  provisioned_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE FUNCTION private.is_faylo_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM private.owner_allowlist AS allowed_owner
    WHERE allowed_owner.owner_user_id = auth.uid()
  );
$$;

CREATE FUNCTION private.currency_fraction_digits(p_currency_code text)
RETURNS smallint
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_currency_code IN ('BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF') THEN 0
    WHEN p_currency_code IN ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') THEN 3
    WHEN p_currency_code IN ('CLF', 'UYW') THEN 4
    ELSE 2
  END::smallint;
$$;

CREATE FUNCTION private.amount_uses_currency_scale(p_amount numeric, p_currency_code text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_amount > '-Infinity'::numeric
     AND p_amount < 'Infinity'::numeric
     AND p_amount = pg_catalog.round(
       p_amount,
       private.currency_fraction_digits(p_currency_code)::integer
     );
$$;

CREATE FUNCTION private.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_account_baseline()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF ROW(NEW.id, NEW.user_id, NEW.account_kind, NEW.currency_code, NEW.opening_balance, NEW.opening_as_of, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.user_id, OLD.account_kind, OLD.currency_code, OLD.opening_balance, OLD.opening_as_of, OLD.created_at) THEN
    RAISE EXCEPTION 'account identity, currency, type, and opening baseline are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.guard_transaction_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'financial transactions are append-only; void the event instead';
  END IF;

  IF ROW(NEW.id, NEW.user_id, NEW.idempotency_key, NEW.transaction_kind, NEW.occurred_on,
         NEW.amount, NEW.currency_code, NEW.category_id, NEW.payment_method_id, NEW.source,
         NEW.merchant, NEW.note, NEW.adjustment_reason, NEW.created_at)
     IS DISTINCT FROM
     ROW(OLD.id, OLD.user_id, OLD.idempotency_key, OLD.transaction_kind, OLD.occurred_on,
         OLD.amount, OLD.currency_code, OLD.category_id, OLD.payment_method_id, OLD.source,
         OLD.merchant, OLD.note, OLD.adjustment_reason, OLD.created_at) THEN
    RAISE EXCEPTION 'posted financial transaction details are immutable';
  END IF;

  IF OLD.status <> 'posted' OR NEW.status <> 'voided'
     OR NEW.voided_at IS NULL OR NEW.voided_by IS DISTINCT FROM NEW.user_id
     OR NEW.void_reason IS NULL OR pg_catalog.length(pg_catalog.btrim(NEW.void_reason)) = 0 THEN
    RAISE EXCEPTION 'the only transaction update allowed is a reasoned posted-to-voided transition';
  END IF;

  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE FUNCTION private.reject_account_entry_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'account entries are immutable; void the parent transaction instead';
END;
$$;

CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  base_currency text NOT NULL DEFAULT 'JPY' CHECK (base_currency ~ '^[A-Z]{3}$'),
  timezone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK (pg_catalog.length(pg_catalog.btrim(timezone)) > 0),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE public.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) > 0),
  account_kind public.account_kind NOT NULL,
  currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  opening_balance numeric NOT NULL,
  opening_as_of date NOT NULL,
  include_in_assets boolean NOT NULL DEFAULT true,
  status public.account_status NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT accounts_currency_scale CHECK (private.amount_uses_currency_scale(opening_balance, currency_code)),
  CONSTRAINT accounts_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT accounts_user_id_id_currency_key UNIQUE (user_id, id, currency_code)
);

CREATE TABLE public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) > 0),
  method_kind public.payment_method_kind NOT NULL,
  linked_account_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT payment_methods_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT payment_methods_linked_account_fk FOREIGN KEY (user_id, linked_account_id)
    REFERENCES public.accounts(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT credit_cards_are_not_linked_accounts CHECK (method_kind <> 'credit_card' OR linked_account_id IS NULL)
);

CREATE TABLE public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  kind public.category_kind NOT NULL,
  name text NOT NULL CHECK (pg_catalog.length(pg_catalog.btrim(name)) > 0),
  parent_id uuid,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT categories_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT categories_user_id_id_kind_key UNIQUE (user_id, id, kind),
  CONSTRAINT categories_parent_same_owner_and_kind_fk FOREIGN KEY (user_id, parent_id, kind)
    REFERENCES public.categories(user_id, id, kind) ON DELETE RESTRICT,
  CONSTRAINT categories_cannot_parent_themselves CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  idempotency_key uuid NOT NULL,
  transaction_kind public.transaction_kind NOT NULL,
  occurred_on date NOT NULL,
  amount numeric,
  currency_code text,
  category_id uuid,
  payment_method_id uuid,
  source public.transaction_source NOT NULL DEFAULT 'manual',
  merchant text,
  note text,
  adjustment_reason text,
  status public.transaction_status NOT NULL DEFAULT 'posted',
  voided_at timestamptz,
  voided_by uuid,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT transactions_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT transactions_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key),
  CONSTRAINT transactions_category_fk FOREIGN KEY (user_id, category_id)
    REFERENCES public.categories(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transactions_payment_method_fk FOREIGN KEY (user_id, payment_method_id)
    REFERENCES public.payment_methods(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT transactions_currency_code_format CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$'),
  CONSTRAINT transactions_amount_currency_pair CHECK ((amount IS NULL) = (currency_code IS NULL)),
  CONSTRAINT transactions_currency_scale CHECK (amount IS NULL OR private.amount_uses_currency_scale(amount, currency_code)),
  CONSTRAINT transactions_kind_fields CHECK (
    (transaction_kind IN ('income', 'expense') AND amount IS NOT NULL AND amount > 0 AND category_id IS NOT NULL AND adjustment_reason IS NULL)
    OR (transaction_kind = 'card_settlement' AND amount IS NOT NULL AND amount > 0 AND category_id IS NULL AND adjustment_reason IS NULL)
    OR (transaction_kind = 'transfer' AND amount IS NULL AND category_id IS NULL AND payment_method_id IS NULL AND adjustment_reason IS NULL)
    OR (transaction_kind = 'balance_adjustment' AND amount IS NOT NULL AND amount <> 0 AND category_id IS NULL AND payment_method_id IS NULL
        AND adjustment_reason IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(adjustment_reason)) > 0)
  ),
  CONSTRAINT transactions_void_audit CHECK (
    (status = 'posted' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND voided_by = user_id
        AND void_reason IS NOT NULL AND pg_catalog.length(pg_catalog.btrim(void_reason)) > 0)
  )
);

CREATE TABLE public.account_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  transaction_id uuid NOT NULL,
  account_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount <> 0),
  currency_code text NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
  posted_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT account_entries_user_id_id_key UNIQUE (user_id, id),
  CONSTRAINT account_entries_one_entry_per_account UNIQUE (user_id, transaction_id, account_id),
  CONSTRAINT account_entries_currency_scale CHECK (private.amount_uses_currency_scale(amount, currency_code)),
  CONSTRAINT account_entries_transaction_fk FOREIGN KEY (user_id, transaction_id)
    REFERENCES public.transactions(user_id, id) ON DELETE RESTRICT,
  CONSTRAINT account_entries_account_fk FOREIGN KEY (user_id, account_id, currency_code)
    REFERENCES public.accounts(user_id, id, currency_code) ON DELETE RESTRICT
);

CREATE INDEX accounts_owner_status_idx ON public.accounts(user_id, status);
CREATE INDEX payment_methods_owner_archived_idx ON public.payment_methods(user_id, archived_at);
CREATE INDEX payment_methods_linked_account_idx ON public.payment_methods(user_id, linked_account_id) WHERE linked_account_id IS NOT NULL;
CREATE INDEX categories_owner_kind_archived_idx ON public.categories(user_id, kind, archived_at);
CREATE INDEX categories_parent_idx ON public.categories(user_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX transactions_owner_date_idx ON public.transactions(user_id, occurred_on DESC);
CREATE INDEX transactions_category_date_idx ON public.transactions(user_id, category_id, occurred_on DESC) WHERE category_id IS NOT NULL;
CREATE INDEX transactions_payment_method_date_idx ON public.transactions(user_id, payment_method_id, occurred_on DESC) WHERE payment_method_id IS NOT NULL;
CREATE INDEX transactions_owner_status_date_idx ON public.transactions(user_id, status, occurred_on DESC);
CREATE INDEX account_entries_account_posted_idx ON public.account_entries(user_id, account_id, posted_at DESC);

CREATE TRIGGER user_preferences_touch_updated_at
BEFORE UPDATE ON public.user_preferences
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER accounts_guard_baseline
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION private.guard_account_baseline();
CREATE TRIGGER accounts_touch_updated_at
BEFORE UPDATE ON public.accounts
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER payment_methods_touch_updated_at
BEFORE UPDATE ON public.payment_methods
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER categories_touch_updated_at
BEFORE UPDATE ON public.categories
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
CREATE TRIGGER transactions_guard_mutation
BEFORE UPDATE OR DELETE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION private.guard_transaction_mutation();
CREATE TRIGGER account_entries_reject_mutation
BEFORE UPDATE OR DELETE ON public.account_entries
FOR EACH ROW EXECUTE FUNCTION private.reject_account_entry_mutation();

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences FORCE ROW LEVEL SECURITY;
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_methods FORCE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_entries FORCE ROW LEVEL SECURITY;

CREATE POLICY user_preferences_owner_only ON public.user_preferences
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
CREATE POLICY accounts_owner_only ON public.accounts
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
CREATE POLICY payment_methods_owner_only ON public.payment_methods
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
CREATE POLICY categories_owner_only ON public.categories
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
CREATE POLICY transactions_owner_only ON public.transactions
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));
CREATE POLICY account_entries_owner_only ON public.account_entries
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()))
  WITH CHECK (user_id = (SELECT auth.uid()) AND (SELECT private.is_faylo_owner()));

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA private TO authenticated;
REVOKE ALL ON TABLE private.owner_allowlist FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.is_faylo_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION private.amount_uses_currency_scale(numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.touch_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION private.guard_account_baseline() TO authenticated;
GRANT EXECUTE ON FUNCTION private.guard_transaction_mutation() TO authenticated;
GRANT EXECUTE ON FUNCTION private.reject_account_entry_mutation() TO authenticated;

REVOKE ALL ON TYPE public.account_kind, public.account_status, public.payment_method_kind,
  public.category_kind, public.transaction_kind, public.transaction_source, public.transaction_status
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON TYPE public.account_kind, public.account_status, public.payment_method_kind,
  public.category_kind, public.transaction_kind, public.transaction_source, public.transaction_status
  TO authenticated;

REVOKE ALL ON TABLE public.user_preferences, public.accounts, public.payment_methods, public.categories,
  public.transactions, public.account_entries FROM PUBLIC, anon, authenticated;
GRANT SELECT, DELETE ON public.user_preferences, public.accounts, public.payment_methods, public.categories TO authenticated;
GRANT UPDATE (base_currency, timezone) ON public.user_preferences TO authenticated;
GRANT UPDATE (name, include_in_assets, status) ON public.accounts TO authenticated;
GRANT UPDATE (name, archived_at) ON public.payment_methods, public.categories TO authenticated;
GRANT SELECT ON public.transactions, public.account_entries TO authenticated;
GRANT INSERT (user_id, base_currency, timezone) ON public.user_preferences TO authenticated;
GRANT INSERT (user_id, name, account_kind, currency_code, opening_balance, opening_as_of, include_in_assets) ON public.accounts TO authenticated;
GRANT INSERT (user_id, name, method_kind, linked_account_id) ON public.payment_methods TO authenticated;
GRANT INSERT (user_id, kind, name, parent_id) ON public.categories TO authenticated;

COMMIT;
