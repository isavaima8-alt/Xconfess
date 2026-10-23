# Issue 186-189 resolution summary

This branch consolidates the frontend auth-token standardization and the backend anonymous-identity ownership fixes associated with issues #186 through #189.

## Included fixes
- Standardized frontend token handling to a single canonical auth flow and consistent session-based auth checks.
- Removed duplicate or conflicting auth hook usage so the header and protected pages respond to the same user state.
- Aligned reaction creation with the actual `Reaction` and `AnonymousUser` schema instead of invalid `user`/`confession.user` assumptions.
- Updated message ownership checks to validate against the anonymous-user model used by confession records.

## Issue references
- Closes #186
- Closes #187
- Closes #188
- Closes #189
