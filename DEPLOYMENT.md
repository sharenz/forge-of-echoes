# Deployment

Crafty deliberately uses different local and production infrastructure.

## Local development

`npm run dev` remains fully local:

- vinext frontend: `http://localhost:3001`
- authoritative Colyseus server: `ws://127.0.0.1:2567`
- PostgreSQL 16 in Docker: `127.0.0.1:5434`

Supabase is not contacted during local development. `.env.example` documents optional local overrides.

## Production topology

Production is a single hardened VM running four Docker Compose services:

- Caddy owns public ports 80/443 and automatic TLS.
- vinext serves the browser client.
- Node/Colyseus owns authoritative multiplayer rooms and HTTP APIs.
- PostgreSQL persists accounts, characters, items, and trades on a named volume.

The application and game server use separate hostnames. PostgreSQL and both application containers are reachable only through the private Compose network.

The first server initialization is intentionally manual:

```bash
make setup-prod
```

This creates the locked `crafty` runtime account, installs Docker, creates server-only secrets, adds swap, enables unattended security updates, and configures the firewall. By default the scripts use temporary `sslip.io` hostnames derived from the VM address. Copy `.env.deploy.example` to `.env.deploy` to use real domains.

Every subsequent release is one command:

```bash
make deploy
```

The deploy script uploads the current working tree into an immutable release directory, builds versioned images on the VM, starts the release, waits for container health checks, and restores the previous release if activation fails. CI deployment is deliberately postponed.

## Super-admin CLI

Install the repository's operator command once from the project directory:

```bash
npm link
```

Then open the interactive console against either realm:

```bash
crafty-cli dev
crafty-cli prod
```

The console uses arrow-key menus to list accounts and enable or disable the debug merchant for an account. Development commands connect to the local Compose PostgreSQL service. Production commands use `DEPLOY_HOST` from the environment or `.env.deploy`, connect over SSH, and execute inside the private production PostgreSQL container as the locked `crafty` runtime user.

Merchant access is an account entitlement, so it affects every existing and future character. Players must log out and back in after a change. The CLI only grants the stable merchant ID; every purchase remains validated by the authoritative game server against merchant config.
