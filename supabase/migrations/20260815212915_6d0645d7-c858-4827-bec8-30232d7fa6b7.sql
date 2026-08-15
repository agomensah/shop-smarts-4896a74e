------------------------------------------------------------------------------
-- 5. adjust_stock — restocks and corrections, logged and race-free
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.adjust_stock(
  _product_id UUID,
  _delta INTEGER,
  _movement_type public.stock_movement_type DEFAULT 'restock',
  _note TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor UUID := auth.uid();
  _new_balance INTEGER;
BEGIN
  IF _actor IS NULL THEN
    RAISE EXCEPTION 'You are signed out. Sign in again to adjust stock.';
  END IF;

  IF _delta = 0 THEN
    RAISE EXCEPTION 'Enter an amount to add or remove.';
  END IF;

  IF _movement_type = 'sale' THEN
    RAISE EXCEPTION 'Sales are recorded from the till, not from stock.';
  END IF;

  -- Increment in place rather than writing a total read earlier by the client,
  -- so two people restocking at once cannot overwrite each other.
  UPDATE public.products
  SET stock_quantity = stock_quantity + _delta,
      updated_at = now()
  WHERE id = _product_id
  RETURNING stock_quantity INTO _new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That product no longer exists.';
  END IF;

  IF _new_balance < 0 THEN
    RAISE EXCEPTION 'That would take stock below zero.';
  END IF;

  INSERT INTO public.stock_movements (
    product_id, movement_type, delta, balance_after, note, created_by
  )
  VALUES (_product_id, _movement_type, _delta, _new_balance, _note, _actor);

  RETURN _new_balance;
END;
$$;

------------------------------------------------------------------------------
-- 6. void_sale — admin-only reversal that returns the stock
------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_sale(
  _sale_id UUID,
  _reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _actor UUID := auth.uid();
  _sale public.sales%ROWTYPE;
  _item RECORD;
  _new_balance INTEGER;
BEGIN
  IF NOT public.has_role(_actor, 'admin') THEN
    RAISE EXCEPTION 'Only an admin can void a sale.';
  END IF;

  SELECT * INTO _sale FROM public.sales WHERE id = _sale_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That sale no longer exists.';
  END IF;

  IF _sale.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'That sale is already voided.';
  END IF;

  FOR _item IN
    SELECT product_id, quantity
    FROM public.sale_items
    WHERE sale_id = _sale_id AND product_id IS NOT NULL
  LOOP
    UPDATE public.products
    SET stock_quantity = stock_quantity + _item.quantity,
        updated_at = now()
    WHERE id = _item.product_id
    RETURNING stock_quantity INTO _new_balance;

    INSERT INTO public.stock_movements (
      product_id, movement_type, delta, balance_after, sale_id, note, created_by
    )
    VALUES (_item.product_id, 'void', _item.quantity, _new_balance, _sale_id, _reason, _actor);
  END LOOP;

  UPDATE public.sales
  SET voided_at = now(),
      voided_by = _actor,
      void_reason = _reason
  WHERE id = _sale_id;
END;
$$;

------------------------------------------------------------------------------
-- 7. Close the direct write paths
------------------------------------------------------------------------------

-- Sales and sale items: RPC only.
DROP POLICY IF EXISTS "Staff can record sales" ON public.sales;
DROP POLICY IF EXISTS "Admins can delete sales" ON public.sales;
DROP POLICY IF EXISTS "Staff can add sale items" ON public.sale_items;
DROP POLICY IF EXISTS "Admins can delete sale items" ON public.sale_items;

REVOKE INSERT, UPDATE, DELETE ON public.sales FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.sale_items FROM authenticated;

-- Products: sellers may no longer rewrite prices or names. Quantity changes go
-- through adjust_stock; everything else is admin-only.
DROP POLICY IF EXISTS "Staff can update stock" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
CREATE POLICY "Admins can update products" ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

------------------------------------------------------------------------------
-- 8. Function grants
------------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.record_sale(TEXT, JSONB) FROM anon, public;
REVOKE ALL ON FUNCTION public.adjust_stock(UUID, INTEGER, public.stock_movement_type, TEXT) FROM anon, public;
REVOKE ALL ON FUNCTION public.void_sale(UUID, TEXT) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.record_sale(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_stock(UUID, INTEGER, public.stock_movement_type, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_sale(UUID, TEXT) TO authenticated;