-- FOLD Motion: brand fonts live in the brand kit.
-- Run once in the Supabase SQL Editor. Safe to run again.
alter table public.brand_kits add column if not exists font jsonb;
