-- =============================================================================
-- Adding or changing one's phone number, step 1 of 2 (0046): the verification
-- purpose 'phone_change'.
--
-- A file of its own: PostgreSQL cannot use a new value in the same run that
-- adds it. Run this file by itself, then 0047.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

alter type public.phone_verify_purpose add value if not exists 'phone_change';
