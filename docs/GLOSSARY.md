# xConfess Glossary

## A

### Anchoring

The process of recording a cryptographic hash (SHA-256) of a confession on the Stellar blockchain via Soroban smart contracts. Once anchored, the confession's existence and content can be independently verified at a specific point in time without revealing the author's identity. See the [Anchoring section](DEMO_SCRIPT.md#4-stellar-flow--confession-anchoring) of the demo script, the [contract ABI reference](contract-abi-reference.md#confession-anchor-contract), and the [Soroban setup guide](SOROBAN_SETUP.md) for contract deployment and interaction details.

### Anonymous Tipping

A Stellar-based feature that allows users to send tips to confession authors without revealing their identity. Users sign and submit tip transactions through their wallet, then send the transaction hash to the backend for verification. The system validates the transaction on-chain and records tip amounts idempotently, ensuring no double-crediting even with replayed verification requests. Supports optional settlement proof metadata for off-chain reconciliation. See the [Anonymous Tipping contract reference](contract-abi-reference.md#anonymous-tipping-contract) and the [Stellar anchoring and tipping runbook](stellar-anchor-and-tipping-runbook.md) for operational details.

## H

### Health Endpoints

Three backend endpoints for monitoring system status: `GET /api/health/live` (liveness - process responsive, no dependency checks), `GET /api/health/ready` (readiness - checks Postgres, Redis, BullMQ queues, and schema), and `GET /api/health` (legacy alias for `/ready`). Use `/live` for quick smoke tests and `/ready` for pre-deployment verification. See the [Health Check Documentation](../xconfess-backend/src/health/HEALTH_CHECK_DOCUMENTATION.md) for detailed troubleshooting and response schemas.

## P

### Personalized Ranking Explanation

A privacy-safe, user-visible explanation of why a feed item was selected or ordered for the requesting user. Explanations are expressed with a stable vocabulary of **reason codes** (machine-readable identifiers) paired with **user-facing labels** (human-readable text). Each explanation is derived only from the requesting user's own signals or from aggregate, non-identifying signals — never from another user's private activity.

Reason codes are stable identifiers that clients may rely on for rendering, analytics, or control mapping; labels may be localized without changing the code. Example reason codes include:

- `followed_author` — the item's author is someone the requesting user follows.
- `similar_to_engaged` — the item resembles content the requesting user previously engaged with.
- `trending_global` — the item is trending based on aggregate, non-identifying activity.
- `recent_activity` — the item is recent relative to the requesting user's feed window.
- `personalization_disabled` — personalization is off for the requesting user; ordering is chronological or default.

Explanations are returned at the owning boundary (the feed/ranking API) alongside each item, subject to explicit authorization: a request may only receive explanations computed for the authenticated requesting user. If personalization is disabled, the API returns the `personalization_disabled` reason rather than omitting explanations silently. If an explanation cannot be produced, the item is still returned with an explicit `unavailable` reason so clients can render a defined fallback instead of guessing.

Users can act on these signals through personalization controls (for example, muting a signal or resetting personalization), which update only the requesting user's own signal state. See the feed/ranking API documentation for the explanation payload schema and control endpoints.
