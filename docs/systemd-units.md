# TARS systemd units

This page documents the systemd units that keep TARS running on VM 102 and
explains the user-scope vs. system-scope split, so incident response is not
a guessing game.

## Scope split — why it matters

| Unit                            | Scope  | Reason                                                                                                              |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `tars-app.service`              | user   | Runs `next start` from Shaun's home dir; needs access to `~/.tars-app-brief.env`, `~/.config`, project node_modules. |
| `tars-worker.service`           | user   | Runs the TARS worker (`tars-worker/`) which polls `tars_jobs` and dispatches Codex/Claude review jobs. Needs the same home-dir secrets. |
| `tars-brief-morning.timer`      | user   | Oneshot trigger that POSTs `/api/tars/briefs` at 06:10 UTC. Loads `~/.tars-app-brief.env`.                          |
| `tars-brief-evening.timer`      | user   | Same as morning, at 16:10 UTC.                                                                                       |
| `tars-retention-archive.timer`  | user   | Oneshot trigger that POSTs `/api/tars/retention-archive` daily at 03:00 UTC. See `workflows/retention-archive.ts`.   |
| `cloudflared-tars.service`      | system | Runs as root because it binds to privileged network resources and needs to be alive even when Shaun is not logged in. Token is configured via the system unit's `ExecStart` argument. |

**The pattern:** anything that hits TARS' Postgres / home dir / Infisical
runs in user scope. Anything that brokers ingress for the public tunnel
runs in system scope.

## Status — operations cheat sheet

User-scope units:

```bash
# Service state
systemctl --user status tars-app
systemctl --user status tars-worker
systemctl --user list-timers          # all user timers

# Logs (tail = -f, --since accepts journald time spec)
journalctl --user -u tars-app --since "1 hour ago" -f
journalctl --user -u tars-worker -n 200
journalctl --user -u tars-brief-morning --since today

# Restart
systemctl --user restart tars-app
systemctl --user restart tars-worker

# Stop / start
systemctl --user stop tars-app
systemctl --user start tars-app
```

System-scope units:

```bash
# Service state — note: NO --user
systemctl status cloudflared-tars

# Logs
journalctl -u cloudflared-tars --since "1 hour ago" -f
journalctl -u cloudflared-tars -n 200

# Restart (requires sudo for system scope)
sudo systemctl restart cloudflared-tars
```

## Common gotchas

- `systemctl status tars-app` (without `--user`) returns "Unit tars-app.service could not be found." — that's because the unit is user-scope. Add `--user`.
- `journalctl -u tars-app` (without `--user`) returns nothing — same reason.
- The brief / retention triggers are oneshot units, so `status` shows them as `inactive (dead)` between fires. That's normal. Check the corresponding `.timer` unit's `LAST` column in `list-timers` to confirm the last invocation.
- The Cloudflare tunnel token is embedded in the system unit's `ExecStart` line — `systemctl cat cloudflared-tars` shows it. Treat the unit file as a secret.
