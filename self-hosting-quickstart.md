# Running Tollgate on your own servers

Send this along with the license key. No coding needed — just follow the
steps in order.

---

## What you need first

- A server (or your own computer, to try it out) with **Docker** installed.
  Don't have it? Get it here: [docs.docker.com/get-docker](https://docs.docker.com/get-docker/)
- The three files we sent you: `docker-compose.selfhost.yml`,
  `.env.example`, and `setup-selfhost.sh`. Put all three in one folder.
  That's everything you need — no other files, no code.
- Your **license key** (it's in the same email as this guide).
- A **GitHub account** — this is just how you'll be allowed to download our
  software. **Use one shared account for your whole team, not a personal
  one** (e.g. `yourcompany-tollgate`, not `jane.smith`) — we grant access
  per account, so a shared one means anyone on your team can deploy or
  update this without us needing to add each person individually. Free
  account is fine. Make one at [github.com/join](https://github.com/join)
  and send us the username so we can grant it access. Whoever needs to run
  the commands below can then use that same account's login token.

## Step 1 — Get a download key

1. Go to GitHub → click your profile picture → **Settings**.
2. Scroll down to **Developer settings** → **Personal access tokens** →
   **Tokens (classic)**.
3. Click **Generate new token**.
4. Check the box labeled **`read:packages`**. Leave everything else unchecked.
5. Click Generate, then copy the code it shows you (you won't see it again).

Now open a terminal and type:

```bash
docker login ghcr.io -u YOUR_GITHUB_USERNAME
```

When it asks for a password, paste the code you just copied.

## Step 2 — Answer a few questions

In the folder with the three files, run:

```bash
chmod +x setup-selfhost.sh
./setup-selfhost.sh
```

It'll ask a few simple questions and set everything up for you — you don't
need to edit any files by hand.

Just testing this out on your own computer first? You can press Enter to
skip most questions and use the defaults.

## Step 3 — Download and start it

```bash
docker compose -f docker-compose.selfhost.yml pull
docker compose -f docker-compose.selfhost.yml up -d
```

The first command downloads everything. The second starts it running.

To check it worked:

```bash
docker compose -f docker-compose.selfhost.yml ps
```

Every line should say **healthy**. If something doesn't, run:
```bash
docker compose -f docker-compose.selfhost.yml logs api
```
and check whether your license key was entered correctly — that's the
most common cause.

## Step 4 — Open it up

Go to the web address you entered during setup (`http://localhost:3000` if
you just used the defaults). Create your account, and you're done.

## Before real people use it

Two things to handle before this goes live for your team:

- **Add a lock (HTTPS).** This setup doesn't include one by default — put
  it behind whatever tool your company normally uses for that (a reverse
  proxy or your cloud provider's load balancer). Skipping this means
  passwords and tokens travel unprotected.
- **Keep the "proxy" part private if you can.** The piece your AI agents
  actually talk to doesn't need to be reachable from the public internet —
  only from wherever your agents run. Keeping it internal-only is safer
  and one of the real benefits of running this yourself.

## Stopping it

```bash
docker compose -f docker-compose.selfhost.yml down
```
Stops everything, keeps your data for next time.

```bash
docker compose -f docker-compose.selfhost.yml down -v
```
Stops everything AND deletes all data — use this if you want a totally
fresh start.

## Need help?

Just reply to the email this came with, or use the contact form on our
site.
