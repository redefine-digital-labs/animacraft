## Summary

What changed?

## Type

- [ ] Product / UX
- [ ] Frontend
- [ ] Move protocol
- [ ] Documentation
- [ ] Operations

## Review Notes

What should reviewers pay attention to?

## Validation

- [ ] Checked locally in browser
- [ ] Ran `sui move build` for protocol changes
- [ ] No generated build artifacts or retired product fixtures are committed to the delivery surface
- [ ] Screenshots attached for UI changes

## On-chain / Creator Impact

Does this affect Maker v8 publication, typed Market custody, payment, wallet, or recovery flows?

## User result and scope

- Milestone / Sprint / card / linked bug:
- Original real-site failure and reproduction evidence:
- Root cause and linked changes (including similar downstream paths):
- Explicit non-goals:
- Existing accepted behavior/data preserved; why this is an incremental fix rather than a rebuild:
- Any architecture/product-semantic change and its explicit user decision (otherwise none):

## Verification evidence

- Pre-fix regression failure → post-fix result:
- Relevant integration / persistence / cold-recovery checks:
- Independent reviewer and findings disposition:
- Exact candidate commit / build / CI run:
- Deployment ID and artifact verification (pending until deployed):
- Original real-site flow retest (pending until actually observed):

## Safety and recovery

- Existing successful operations preserved; duplicate execution prevention:
- Permissions, fees, irreversible effects and authorization boundary:
- Rollback command/target and limitations:
- Outstanding acceptance and next step:

Merging this PR does not close the bug or product card. Close only after the
original deployed user flow passes with evidence; local green tests are not
production acceptance. Never attach credentials, wallet recovery material,
serialized signatures, or private WAL exports.
