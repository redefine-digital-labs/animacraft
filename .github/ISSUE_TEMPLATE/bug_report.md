---
name: Product regression / bug
about: Reproduce a user-visible failure and track it through deployed verification
title: "[Bug] "
---

## Scope and owner
- Milestone / Sprint / acceptance card:
- Owner / independent verifier:
- Severity and user impact (P0/P1/P2):

## Reproduction
- Site URL, deployment ID / commit, device/browser/wallet versions:
- Preconditions and minimal test data (no secrets or signed transaction bytes):
- Exact user actions:
- Expected result:
- Actual result and error code:
- Sanitized screenshot / trace / public transaction digest:

## Safety and recovery
- Has a transaction already succeeded? What must NOT be repeated?
- Authorized operation and cumulative cost boundary:
- Existing saved progress and safe recovery step:

## Root cause and linked scope
- Observed facts vs hypotheses:
- Failing boundary and required callers / sibling paths:
- Pre-fix failing regression and command:
- Fix PR / exact commit:

## Verification (keep evidence classes separate)
- [ ] Reproduced on the affected real site
- [ ] Regression failed before the fix and passes after it
- [ ] Relevant sibling paths and rejection/recovery checks pass
- [ ] Independent review passed
- [ ] Required release gates pass for the exact candidate
- [ ] Deployed artifacts match the verified candidate
- [ ] Original actions retested on the real deployed site and original saved operation
- [ ] No duplicate payment, quota use, mint or lost progress

## Closure
- Real-site outcome and evidence:
- Unmet acceptance / residual risk:
- Rollback boundary (frontend rollback does not undo chain transactions):
- Close only after deployed retest; otherwise leave Open / Awaiting production verification.
