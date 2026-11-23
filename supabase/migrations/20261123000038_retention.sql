-- =============================================================================
-- Old notifications and old audit entries are cleared away, daily.
--
-- Both tables only ever grew. Nobody reads a notification from last year, yet
-- every one stays in the table and its indexes, which grow with them and slow
-- down cleanup work (vacuum) and backups. Kept now:
-- - notifications: until 180 days after they were sent once read, 365 days if
--   never read;
-- - audit log: 730 days (two years), enough to look back on any incident.
-- Administrators can change each period (Administration > Settings):
-- retention.read_notifications_days (30 to 3650), retention.unread_notifications_days
-- (30 to 3650), retention.audit_log_days (365 to 3650).
--
-- run_retention_cleanup() deletes at most 20,000 rows of each per call, so a
-- daily run never holds the tables for long; the scheduled job (/api/cron)
-- calls it. Only the service role may call it.
--
-- Deletes rows only once they are past these periods. Safe to run twice.
-- =============================================================================

insert into public.platform_settings (key, value, description, is_public) values
  ('retention.read_notifications_days', '180', 'Read notifications are deleted this many days after they were sent (30 to 3650).', false),
  ('retention.unread_notifications_days', '365', 'Unread notifications are deleted this many days after they were sent (30 to 3650).', false),
  ('retention.audit_log_days', '730', 'Audit log entries are deleted this many days after they were written (365 to 3650).', false)
on conflict (key) do nothing;

-- The cleanup finds old notifications by their date (the existing indexes start with the member).
create index if not exists notifications_created_idx on public.notifications (created_at);

create or replace function public.run_retention_cleanup(p_batch int default 20000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_read int := greatest(30, least(3650, private.setting_int('retention.read_notifications_days', 180)));
  v_unread int := greatest(30, least(3650, private.setting_int('retention.unread_notifications_days', 365)));
  v_audit int := greatest(365, least(3650, private.setting_int('retention.audit_log_days', 730)));
  v_batch int := greatest(1, least(coalesce(p_batch, 20000), 100000));
  v_notifications int;
  v_audit_rows int;
begin
  with doomed as (
    select id from public.notifications
     where created_at < now() - make_interval(days => v_unread)
        or (read_at is not null and created_at < now() - make_interval(days => v_read))
     limit v_batch)
  delete from public.notifications n using doomed d where n.id = d.id;
  get diagnostics v_notifications = row_count;

  with doomed as (
    select id from public.audit_logs where created_at < now() - make_interval(days => v_audit) limit v_batch)
  delete from public.audit_logs a using doomed d where a.id = d.id;
  get diagnostics v_audit_rows = row_count;

  return jsonb_build_object('notifications', v_notifications, 'audit_logs', v_audit_rows);
end $$;
revoke all on function public.run_retention_cleanup(int) from public, anon, authenticated;
grant execute on function public.run_retention_cleanup(int) to service_role;
