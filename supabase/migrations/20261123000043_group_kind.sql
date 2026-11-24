-- =============================================================================
-- Group conversations, step 1 of 2 (0043): the conversation kind 'group'.
--
-- A file of its own: PostgreSQL cannot use a new kind in the same run that
-- adds it. Run this file by itself, then 0044.
--
-- Changes no data. Safe to run twice.
-- =============================================================================

alter type public.conversation_kind add value if not exists 'group';
