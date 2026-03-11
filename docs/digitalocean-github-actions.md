# DigitalOcean Deploy With GitHub Actions

This repository now includes a production deploy workflow at `.github/workflows/deploy-production.yml`.

## What the workflow does

On every push to `main` or on manual trigger, GitHub Actions:

1. Builds the client bundle.
2. Verifies the Go game server build.
3. Verifies the Node.js services install correctly.
4. Connects to your DigitalOcean Droplet over SSH.
5. Runs `scripts/deploy.sh` on the server.

The remote deploy script:

1. Updates the repo with `git fetch` + `git reset --hard origin/<branch>`.
2. Runs `npm ci` for the services.
3. Builds the client.
4. Builds `server/bin/game-server`.
5. Restarts the systemd services you specify.

## GitHub secrets

Create these repository secrets:

- `DO_HOST`: public IP or hostname of the Droplet.
- `DO_USER`: SSH user used by the workflow.
- `DO_SSH_PRIVATE_KEY`: private key for that SSH user.
- `DO_SSH_PORT`: optional SSH port. Leave unset to use `22`.

## GitHub variables

Create these repository variables:

- `APP_DIR`: absolute path of the app on the server. Example: `/opt/infinity.io`
- `DEPLOY_BRANCH`: optional. Defaults to `main`.
- `SYSTEMD_SERVICES`: space-separated services to restart.
- `DEPLOY_DISCORD_BOT`: `true` or `false`.

Example `SYSTEMD_SERVICES` value:

```text
infinity-auth infinity-loadbalancer infinity-game nginx
```

## Droplet requirements

The target server needs:

- `git`
- `node` and `npm`
- `go`
- `nginx`
- `sudo` permission for `systemctl restart` on the chosen services
- a clone of this repository already present in `APP_DIR`

If the repository is private, the Droplet also needs credentials to `git fetch` from GitHub.

## Suggested deployment layout

Suggested application directory:

```text
/opt/infinity.io
```

Suggested service split:

- `infinity-auth`: runs `auth-server/server.js`
- `infinity-loadbalancer`: runs `loadbalancer/server.js`
- `infinity-game`: runs `server/bin/game-server`
- `infinity-discord-bot`: runs `discord-bot/src/index.js`

## First-time server prep

Minimal first-time bootstrap on the Droplet:

```bash
sudo mkdir -p /opt/infinity.io
sudo chown -R $USER:$USER /opt/infinity.io
git clone <your-repo-url> /opt/infinity.io
```

Then add your `.env` files on the server and create the systemd services before the first deploy.

## Important note about the client worker

The client no longer needs a manual source edit before production builds. The worker now uses the bundled Webpack worker automatically when built through the production pipeline.
