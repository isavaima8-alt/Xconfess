# Contributor Guide: Redacting Logs Safely

When sharing error logs, stack traces, or debugging output in issues or pull requests, always redact sensitive information. This guide shows what to redact and how.

## What to Redact

### Always Redact
- **API keys and tokens** (JWT, OAuth, private keys)
- `Authorization`, `Cookie`, and `X-API-Key` request headers
- **Database credentials** (passwords, connection strings)
- `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STELLAR_SECRET_KEY`, and any `*_SECRET* / *_TOKEN* / *_PASSWORD*F environment variables
- **User emails and phone numbers**
- **Private keys** (PE files, seed phrases)
- **Session IDs and cookies** (sensitive auth tokens)
- **Credit card or payment information**
- `authorEmail`, `content`, `ipAddress`, and other request/response body fields that carry PII or secrets
- **Private user data** (real names, addresses, IDs)
- **Raw search queries** (`q`, `query`, `searchTerm`, `searchQuery`) — see [Raw Search Query Retention](#raw-search-query-retention)

### Safe to Keep
- **Request IDs** (useful for tracing logs)
- **Timestamps** (help correlate events)
- **Error types and messages** (error class names, message text)
- `code`, `status`, `subsystem`, `userRole`, `duration`, and other non-identifying structured fields
- **Stack trace function names** (don't contain sensitive data)
- `authorId` and other opaque identifiers that are not emails, tokens, or secrets
- **Port numbers** (5000, 3000, 55432 are fine)
- **Localhost references** (http://localhost:5000 is fine)
- -**Generic line numbers** (line 42, column 10 are fine)

## Examples

### Example 1: Authentication Error

```
❌ BAD - Contains email and token:
Error: Authentication failed for user@xconfess.com
  at verifyToken (auth.ts:42)
  at middleware (jwt.ts:18)
Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.[UNREDACTED_TOKEN_EXPOSED]

✓ GOOD - Token and email redacted:
Error: Authentication failed for [REDACTED_EMAIL]
  at verifyToken (auth.ts:42)
  at middleware (jwt.ts:18)
Token: [REDACTED_JWT_TOKEN]
```

### Example 2: Database Connection Error

```
✌ BAD - Contains credentials:
Error: connect ECONNREFUSED 127.0.0.1:55432
PostgreSQL connection failed
User: admin
Password: SuperSecret123!
Connection string: postgresql://admin:SuperSecret123!@localhost:55432/xconfess_dev

ℓ GOOD - Credentials redacted:
Error: connect ECONNREFUSED 127.0.0.1:55432
PostgreSQL connection failed
Connection string: postgresql://[REDACTED_USER]:[REDACTED_PASS]@localhost:55432/xconfess_dev
```

### Example 3: API Response with User Data

```
✌ BAD - Contains user information:
Response from GET /api/confessions
{
  "id": "c123abc",
  "userId": "user_550e8400e29b41d4a716446655440000",
  "content": "My confession...",
  "authorEmail": "john.doe@company.com",
  "ipAddress": "192.168.1.100",
  "timestamp": "2026-05-30T18:43:15Z"}

✓ GOOD - PII redacted, request ID kept:
Response from GET /api/confessions (request_id: req_abc123)
{
  "id": "c123abc",
  "userId": "[REDACTED_USER_ID]",
  "content": "[REDACTED]",
  "authorEmail": "[REDACTED_EMAIL]",
  "ipAddress": "[REDACTED_IP],
  "timestamp": "2026-05-30T18:43:15Z"}
```

### Example 4: Environment Variables

```
✌ BAD - Contains all secrets:
.env file:
DATABASE_URL=postgresql://admin:mypassword@localhost:55432/xconfess_dev
REDIS_URL=redis://:secretpass@localhost:6379
JWT_SECRET=my_super_secret_key_12345
STELLAR_SECRET_KEY=SBQJQQKXO3ZYTR3QYVB2ORMZPYVVV...

✓ GOOD - Secrets redacted, URLs kept:
.env file (redacted):
DATABASE_URL=postgresql://[REDACTED]@localhost:55432/xconfess_dev
REDIS_URL=redis://[REDACTED]@localhost:6379
JWT_SECRET=[REDACTED]
STELLAR_SECRET_KEY=[REDACTED]
```

### Example 5: Error Stack Trace

```
✌ BAD - Contains JWT in error details:
Error: Failed to process payment
  at processPayment (payments.ts:123)
  at handleCheckout (checkout.ts:456)
  Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

ℓ GOOD - Token redacted, function names kept:
Error: Failed to process payment
  at processPayment (payments.ts:123)
  at handleCheckout (checkout.ts:456)
  Authorization: Bearer [REDACTED_TOKEN]
```

### Example 6: Search Request Logs

```
✌ BAD - Contains the raw query and the searcher's identity:
GET /api/search?q=my+therapist+name+and+my+diagnosis
{"route":"/api/search","status":200,"requestId":"req-123","userId":"user_550e8400e29b41d4a716446655440000","query":"my therapist name and my diagnosis"}

✓ GOOD - Query dropped, request ID kept:
{"route":"/api/search","status":200,"requestId":"req-123","userId":"user_a3f9c2d1b5e7","query":"[REDACTED_SEARCH_QUERY]"}
```

## Quick Checklist

Before posting logs in an issue or PR, verify:
- [ ] No API keys, tokens, or JWTs are visible
- [ ] No database passwords or connection strings with credentials
- [ ] No user emails, phone numbers, or personal data
- [ ] No private keys or seed phrases
- [ ] No session IDs or sensitive cookies
- [ ] No raw request or response bodies that contain PII or secrets
- [ ] No raw search queries or search terms
- [ ] Request IDs, timestamps, and error messages are kept for context

## Redaction Format

Use a consistent redaction format for clarity:
- `[REDACTED]` — for single values
- `[REDACTED_TOKEN]` — for specific types
- `[REDACTED_EMAIL]` — for specific types
- `[REDACTED_PASSWORD]` — for specific types
- `[REDACTED_SEARCH_QUERY]` — for raw search queries

Or use markers that are clearly placeholder text:
- `***` (simple placeholder)
- `XXXXXX` (for shorter values)

Pick one style and use it consistently throughout your log snippet.

## Structured Logs

All backend logs are emitted through the shared structured logger, which applies the same redaction rules to every serialized payload. When sharing structured logs, the same redaction rules apply.

### Structured log format

Every request produces a line like:

```json
{
  "method": "POST",
  "route": "/api/confessions",
  "status": 201,
  "duration": 42,
  "requestId": "a1b2c3d4me5f6-7890-abcd-ef1234567890",
  "userId": "user_a3f9c2d1b5e7",
  "userRole": "user",
  "subsystem": "confession",
  "timestamp": "2026-08-30T12:00:00.000Z",
  "ip": "192.168.x.x"
}
```

### What is automatically redacted

The structured logger automatically redacts:
- Any field named `password`, `token`, `secret`, `apiKey`, `authorization`, `cookie`, `authorEmail`, `ipAddress`, `query`, `searchTerm`, etc.
- JWT-shaped strings (three base64url segments separated by dots)
- Long hex strings (40+ characters)
- Long base64 strings (80+ characters)
- Email addresses and IP addresses in free-text values

### What is always preserved

- `requestId` / `correlationId` — essential for tracing
- `timestamp` — essential for timeline
- `method`, `route`, `status` — essential for identifying the request
- `userId` (masked form) — useful for scoping without exposing identity
- `userRole` — useful for authorization debugging
- `subsystem` — useful for identifying the affected module
- `duration` — useful for performance debugging

### Sharing a structured log in an issue

```
✌ BAD - Contains raw user ID and IP:
{"method":"POST","route":"/api/confessions","status":500,"requestId":"req-123","userId":"user_550e8400e29b41d4a716446655440000","ip":"192.168.1.100"}

✓ GOOD - Request ID kept, IP masked:
{"method":"POST","route":"/api/confessions","status":500,"requestId":"req-123","userId":"user_a3f9c2d1b5e7","ip":"192.168.x.x"}
```

## Raw Search Query Retention

Raw search queries can reveal sensitive intent (health, relationships, identity) even when they are not tied to a public profile. The search boundary therefore treats raw queries as sensitive data with a bounded lifetime.

### What is stored and why

| Data | Stored? | Purpose |
| --- | --- | --- |
| Raw query text | Yes, bounded | Relevance tuning and abuse detection |
| Normalized query (lowercased, trimmed) | Yes, bounded | Deduplication of the same query |
| Query hash (salted, one-way) | Yes, bounded | Grouping identical queries without keeping the text |
| Searcher user ID | No — replaced by a salted hash | Prevent linking queries to a public profile |
| IP address, email, session ID | No | Not needed for relevance or abuse detection |
| Result count, latency, timestamp | Yes, bounded | Operational metrics |

### Minimizing identifiers

- Raw queries are never joined to a public profile. The searcher is recorded only as a salted hash so repeated searches can be grouped without identifying the person.
- IP addresses, emails, and session IDs are never persisted alongside a query.
- Logs and analytics emit the query hash and result metadata, never the raw query text.

### Bounded expiry

- Stored raw queries expire after a bounded retention window (default 30 days, configurable via `SEARCH_QUERY_RETENTION_DAYS`).
- Expiry is enforced at the storage boundary: reads and exports filter out records older than the window, and a scheduled purge deletes them.
- The retention window is capped by configuration; it cannot be set to unlimited.

### Access rules

- Raw query records are readable only by operators with the search-analytics role; ordinary support and contributor access is denied.
- Access is audited: every read of raw query data records the actor, the reason, and the time.
- Analytics and dashboards consume aggregated counts and hashes only, never raw text.

### Logs and analytics follow the same policy

- The structured logger redacts `query`, `searchTerm`, and `searchQuery` fields, so raw queries never reach log storage.
- Analytics events carry the query hash, result count, and latency — not the raw text — and are subject to the same retention window.
- When sharing search-related logs in an issue or PR, replace the query with `[REDACTED_SEARCH_QUERY]` and keep the `requestId` for tracing.

## Tracing a Request End-to-End

When debugging an issue, use the `requestId` (correlation ID) to trace the same request across frontend and backend:

1. **Frontend error response**: Look for `correlationId` or `requestId` in the JSON body.
2. **Backend logs**: Search for the same ID: `grep 'a1b2c3d4' logs.txt`
3. **Backend error response**: The `requestId` field in the response body matches.

```
Frontend error → { "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890" }
Backend log    → { "requestId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890", ... }
Backend error  → { "requestId": "a1b2c3d4me5f6-7890-abcd-ef1234567890", ... }
```

## Still Unsure?

When in doubt, redact it. It's better to redact too much than to leak sensitive information. If you're not sure whether something is sensitive, ask in the issue or PR comments.
