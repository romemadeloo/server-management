# Deploying

`server.js` is a long-lived Node process. It holds state in memory, writes it
to disk, pushes updates to open tabs over Server-Sent Events, and polls Jira
on a timer. It needs a host that runs a **persistent process** — Render,
Railway, Fly.io, or any VPS.

It will not work on Vercel, Netlify Functions, or Cloudflare Workers without
being rewritten: those run per-request on a read-only disk with nothing alive
in between, which breaks the disk writes, the SSE stream, and all three
`setInterval` loops (Jira sync, health checks, expiry checks).

## Credentials

Never commit `jira-config.json` — it holds a real API token and is gitignored.
On a host, supply these three environment variables instead. They take
precedence over the file, and Settings will show the fields read-only rather
than trying to overwrite them.

| Variable | Example | Where to get it |
| --- | --- | --- |
| `JIRA_BASE_URL` | `your-team.atlassian.net` | Your Jira site, with or without `https://` |
| `JIRA_EMAIL` | `you@company.com` | The Atlassian account the token belongs to |
| `JIRA_API_TOKEN` | `ATATT…` (all Atlassian tokens start this way) | [id.atlassian.com → Security → API tokens](https://id.atlassian.com/manage-profile/security/api-tokens) |

One optional variable controls persistence:

| Variable | Effect |
| --- | --- |
| `STATE_FILE` | Absolute path for `shared-state.json`. Point it at a mounted disk so bookings and configured environments survive a restart. Unset, state lives next to `server.js` and resets whenever the container is replaced. |

You do **not** need GitHub Actions secrets. Render and Railway both build
straight from GitHub; the values live in the host's dashboard.

## Render

1. **New → Blueprint**, pick this repo. It reads `render.yaml` and fills in
   the runtime, start command, disk, and which env vars to ask for.
2. Paste the three Jira values when prompted.
3. Deploy. First boot takes about a minute.

To do it without the blueprint: **New → Web Service** → connect the repo →
Runtime `Node`, Build Command empty (there is nothing to build), Start Command
`node server.js` → add the env vars under **Environment**.

**Two things to know about the free plan.** It has no persistent disk, so
delete the `disk:` block and the `STATE_FILE` variable from `render.yaml` if
you use it — the app runs fine, but accounts, environments and users reset to
the seed data in `js/data.js` on every restart. It also sleeps after 15
minutes of inactivity, and a sleeping process runs no Jira polling, so the
board can be stale until someone opens it. The `starter` plan in `render.yaml`
fixes both.

## Railway

1. **New Project → Deploy from GitHub repo**.
2. Railway detects `package.json` and runs `npm start`. No build command.
3. **Variables** → add the three Jira values.
4. For persistence: **Volumes** → add one, mount at `/var/data`, then set
   `STATE_FILE=/var/data/shared-state.json`.

Railway does not sleep, so polling keeps running. It bills by usage rather
than a flat plan.

## After deploying

- Open the URL and go to **Settings**. The Jira fields should show your site
  and email, read-only, with a note that the host supplies them.
- Hit **Test connection**. It should name the authenticated account.
- Hit **Refresh** on the dashboard. Tickets at an occupying status should
  populate; anything that could not be matched appears under "not tracked"
  with a reason.

If the board stays empty, the usual causes are: the account name on the
ticket not matching a configured account, the branch not matching an
environment name, or the ticket's status not being in **Occupies a server**
under Settings → Status rules.

## Rotate the token first

The token currently in your local `jira-config.json` has been on screen and
in terminal output. Generate a fresh one, put the new value in the host's env
vars, and revoke the old one.
