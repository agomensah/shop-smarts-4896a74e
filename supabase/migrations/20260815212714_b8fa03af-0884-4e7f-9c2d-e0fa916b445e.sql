REVOKE ALL ON FUNCTION public.record_sale(TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_sale(TEXT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_sale(TEXT, JSONB) TO authenticated;