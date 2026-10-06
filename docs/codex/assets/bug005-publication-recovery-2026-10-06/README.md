# BUG-005: signed publication wait / recovery

DEV-002 / S13-F02. Existing Slack row Rec0C6DE3D15M remains open.

## Observed production state

- Original author Chrome, fresh Maker `maker-1791260539005`, revision 73.
- All 11 resources certified; UI showed Maker content / Signed and Preparing review with disabled recovery controls.
- Exact digest `3p7FG4UxUP9J9hsEJiT7BVRvVKGxRrGdVXVQt6wtt9B1` independently read from Mainnet: execution success, 19 created objects. This is not final Maker activation.
- Subsequent UI inspection reached Activation / Ready, publication revision 37, preceding digest `2RNAbPfzyCdiPzxV2S33iorkp6gLevPWbVMrZydWztX5`, gas budget 53820516 MIST. No reupload or agent signature was used for that inspection. User has operated the wallet during this journey; signature counts are not inferred.
- Therefore the observation does not prove a permanently stuck transaction. The exact earlier slow await is unproven. The confirmed product deficiencies are an unbounded production RPC wait and an indistinguishable busy label during signed continuation.

## Incremental repair

The official gRPC unary transport now aborts the actual request after 30 seconds, including a stalled response body. It returns DEADLINE_EXCEEDED, preserves explicit caller cancellation, removes timers after completion, and rejects a late response after expiration. The existing publication controller retains the same signed WAL on uncertainty and queries that digest before any replay. No timeout is interpreted as failed execution, and no automatic retry/signature is introduced.

The SDK 2.26.2 default client constructor forwards only baseUrl/fetchInit to its transport. Passing an interceptor to the client would silently omit it. The production factory therefore passes the official GrpcWebFetchTransport explicitly; tests exercise that exact factory and actual SDK framing, not a substitute client.

Signed continuation uses a distinct localized busy label and shows the current stage. Refresh stays disabled only while the operation is active; the existing error path releases it after request cancellation. This does not impose a deadline on the wallet prompt or promise that the entire multi-request operation finishes in 30 seconds. GraphQL/Walrus requests are outside this change.

## Validation / release boundary

- Initial focused suites: 394 passing; subsequently added late-response regression.
- Deadline tests: five passing on pinned Node 22.23.2.
- Read-only production transport Mainnet identity check passed.
- Full local check, exact candidate CI, deployment and original browser retest are recorded on the same Bug row as they complete.
- No contract, permission, publication semantics or wallet authority change. Handbook v1.0 sections 1–5, 9, 12 apply. Existing chain objects, uploads and signed checkpoints remain intact.
- Full F02 acceptance remains pending: final ACTIVE, Complete/new Soul, Soulidity receive and refresh. Neither tests nor this PR close BUG-005.
