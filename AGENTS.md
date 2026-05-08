# AGENTS.md

## Scope

This repository is `nomi-desktop`.

- Desktop owner: `/Users/lixinlv/Doing/nomi-desktop`
- Core owner: `/Users/lixinlv/Doing/nomi-core`
- Protocol owner: core owner (`nomi-protocol` is owned by core by default)

Default rule:

- Do not modify `/Users/lixinlv/Doing/nomi-core` from work scoped to this repository unless the user explicitly asks for it.
- Do not implement cross-boundary fixes by directly patching core code.
- If a requirement spans desktop and core, align the protocol and acceptance first, then each side changes its own repository.
- Do not directly modify `nomi-protocol` from desktop work; protocol changes are proposed by desktop but landed by core owner.

## Desktop Ownership

The desktop side owns:

- Tauri shell, window lifecycle, window behavior, desktop packaging, desktop build/release integration
- React UI, view composition, interaction flows, markdown rendering, debug panels, sidebar presentation
- Desktop transport wiring and connection management in this repo, including WebSocket client behavior and Tauri/browser runtime adaptation
- Desktop state management and event-to-UI reduction
- Desktop-local persistence, profile storage, client ID persistence, and desktop-only cached state
- Invocation of desktop-native commands exposed by the Tauri shell

In the current codebase, this primarily includes:

- `src/ui/`
- `src/state/`
- `src/transport/`
- `src/lib/` for desktop-local storage and UI-facing types
- `src-tauri/`

## Core Ownership

`nomi-core` owns:

- Python runtime
- CLI
- agent/session/provider/channel
- remote server
- config
- protocol implementation

Desktop must treat those as external dependencies and integration contracts, not as local implementation detail.

## Shared Contract Boundary

Desktop consumes, but does not unilaterally redefine:

- remote commands
- remote events
- event field names and payload shapes
- error categories and error semantics
- auth/handshake expectations
- session binding semantics

Current desktop integration points that depend on shared/core contracts include:

- `src/protocol/remote.ts`
- `src/transport/remoteClient.ts`
- `src/state/reducer.ts`
- any dependency pulled from `nomi-protocol`

Protocol change ownership is fixed as:

- `nomi-protocol` is owned by the core owner
- desktop owner has proposal rights and acceptance rights for protocol changes
- there is no separate long-lived protocol owner
- any change to `nomi-protocol` requires explicit user approval before implementation

## When Desktop Needs Core Changes

Do not ask core for a vague “support this feature”.

Provide a concrete handoff containing:

- goal: what desktop user behavior is blocked
- command/event: exact remote command names and event names needed
- payload: required request/response fields, types, optionality, defaults
- state semantics: ordering, idempotency, retries, streaming rules, session ownership assumptions
- error semantics: explicit failure cases and how desktop should distinguish them
- compatibility: whether the change is additive, breaking, or version-gated
- acceptance: a short end-to-end verification flow that proves desktop can integrate correctly

Recommended format:

```md
Need from core:
- Command/Event:
- Request fields:
- Response/Event fields:
- Error cases:
- Ordering/streaming rules:
- Acceptance:
```

Protocol change flow is fixed as:

1. Desktop writes a precise handoff for the needed contract change.
2. Core owner decides whether:
   - the issue can stay desktop-local
   - `nomi-protocol` needs to change
   - `protocol + core + desktop` all need changes
3. If the protocol must change:
   - core and desktop must first obtain explicit user approval
   - core owner updates `nomi-protocol`
   - core owner updates `nomi-core`
   - desktop upgrades the protocol dependency and adapts consumption

## When Core Requests Desktop Changes

Desktop should ask for clarification before implementation if any of these are ambiguous:

- exact event/command schema
- field stability and nullability
- whether ordering is guaranteed
- whether a new error is transport-level or business-level
- whether compatibility with older protocol versions is required

## Local Guardrails

- Prefer changing desktop adapters/reducers/UI before assuming a core change is required.
- Keep desktop-only derived state out of the shared protocol when it can be computed locally.
- Do not encode desktop presentation concerns into shared protocol fields unless both sides align first.
- If a protocol change is needed, update the agreed contract first, then implement desktop consumption in this repo.

## Repo Notes

As of the current desktop implementation:

- `src/transport/remoteClient.ts` owns runtime-specific socket connection behavior
- `src/state/reducer.ts` owns remote event reduction into desktop app state
- `src/lib/store.ts` owns desktop-local profile/default persistence and desktop-side bootstrap helpers
- `src/protocol/remote.ts` re-exports the shared protocol package and should remain a thin boundary

Any change that alters the meaning of remote events, command payloads, session semantics, auth behavior, or remote resource actions should be treated as a cross-repo coordination item.
