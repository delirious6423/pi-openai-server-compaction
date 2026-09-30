# pi-openai-server-compaction — Pi 0.99 compatibility fork

A compatibility patch for [algal/pi-openai-server-compaction](https://github.com/algal/pi-openai-server-compaction), based on upstream commit `8a3de2f3b0c178fdd6f73f2f94172dfc3943e466`.

## What changes

- Normal requests retain Pi's built-in transport and use `store: false`.
- OpenAI ChatGPT subscription OAuth uses inline `context_management` compaction through `/v1/responses`. It sends no `compaction_trigger` and does not call `/responses/compact`.
- API-key and legacy `openai-codex` compaction retain upstream's v2 path. These paths were not live-tested by this patch.
- Encrypted compaction state is replayed through Pi's native request hook. Current system instructions and tool definitions are retained.
- Portable summaries use Pi's authenticated model registry. Provider errors are treated as failures rather than successful empty summaries.
- `/openai-compaction-status` shows readiness and whether remote history has been loaded.
- Extension notes, bash context, branch summaries, and unanswered turns survive remote history replay. The persisted branch is reconciled before requests and compaction.
- Pi receives combined summary and remote-compaction usage for its session statistics.

## Why the original failed in this installation

The installed Pi version was 0.99.1; upstream declares `>=0.80.9 <0.81.0`. Session logs recorded custom WebSocket errors and HTTP 400 `Store must be set to false`. Direct synthetic probes with the installation's OpenAI subscription login returned:

- `compaction_trigger`: HTTP 400, `subscription_sharing_unsupported_capability`.
- `/responses/compact`: HTTP 401, `hardened_oauth_rule_missing`.
- Inline `context_management`: HTTP 200 with encrypted `compaction` output items.

These are observations from this installation on 2026-09-30, not a claim about every OpenAI authentication method.

## Install

```sh
pi install git:github.com/delirious6423/pi-openai-server-compaction
```

Remove any earlier upstream or local installation of this extension before loading the fork, so only one copy is active. Requirements: Node 22 or newer and Pi `>=0.99.1 <0.100.0`; Pi 0.99.1 is the tested version.

For a local checkout:

Unpack the source archive, then run:

```sh
cd /path/to/pi-openai-server-compaction
npm install --omit=dev --ignore-scripts
pi remove git:github.com/algal/pi-openai-server-compaction
pi install /absolute/path/to/pi-openai-server-compaction
```

Use this configuration in `~/.pi/agent/openai-server-compaction.json`:

```json
{
  "enabled": true,
  "useCustomTransport": false,
  "usePreviousResponseId": false,
  "notify": true
}
```

Restart Pi, then run `/openai-compaction-status`. `/compact` requests compaction for a sufficiently long session. Pi also uses the same hook for its normal automatic compaction.

`PI_CODING_AGENT_DIR` is respected. Project `.pi/openai-server-compaction.json` and environment overrides take precedence.

## Validation

Validated against Pi 0.99.1, Node 22.23.3, and `openai/gpt-5.5` with a ChatGPT subscription OAuth login on 2026-09-30:

- TypeScript type checking passed.
- Upstream offline smoke suite passed.
- 17 compatibility tests passed.
- A live synthetic conversation passed normal replies, a `read` tool call, encrypted remote compaction, a portable summary, exact code recall after compaction, and resume from a persisted session.
- Captured ordinary requests used `store: false`, no `previous_response_id`, and retained system messages and `read` tool definitions after compaction and resume.
- A second live compaction retained an idle extension note; extension note recall passed after both compaction and resume. Top-level compaction usage was present.

This is a functional regression test, not a benchmark of long-session recall quality or a validation of all models and providers. Inline compaction may emit more than one artifact; this patch replays the latest one together with upstream's retained user-message policy. If no artifact is returned, the portable summary remains available.

```sh
npm install --ignore-scripts
npm test
# Makes real provider requests, using only a new synthetic session:
npm run test:live:compat
```

The live test copies credentials into a private temporary agent directory and removes that credential copy in its cleanup. It never loads an existing user conversation.

The legacy custom WebSocket path is an optional API-key-only mode (`useCustomTransport: true`). The default and tested configuration is Pi native transport.

## References

- [Upstream issue and PR review](UPSTREAM_REVIEW.md), including attribution for the context-preservation fixes from kunchenguid and Christian-Martensson and usage reporting from ronind.
- [OpenAI compaction guide](https://developers.openai.com/api/docs/guides/compaction)
- `README.upstream.md` and the benchmark directories retain upstream documentation and historical results. Their transport defaults describe the original version.
- MIT license: `LICENSE.md`.
