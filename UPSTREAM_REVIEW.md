# Upstream issue and pull request review

Reviewed on 2026-09-30 against upstream main `8a3de2f3b0c178fdd6f73f2f94172dfc3943e466`. GitHub showed seven open issues and fourteen total pull requests. Status below is the status at review time.

| Report or PR | Status | Relation to this fork |
| --- | --- | --- |
| [Issue #17](https://github.com/algal/pi-openai-server-compaction/issues/17), [PR #18](https://github.com/algal/pi-openai-server-compaction/pull/18) | Open | Custom context and unanswered turns are lost during replay/reconstruction. Adapted kunchenguid's conversion and trailing-turn fix; Pi 0.99's exported entry converter replaces the PR's handwritten mapping. |
| [PR #19](https://github.com/algal/pi-openai-server-compaction/pull/19) | Closed, unmerged | Extends #18 by reconciling idle custom messages from the persisted branch. Adapted Christian-Martensson's reconciliation before normal requests and compaction. Pi 0.99 emits events for idle custom messages, but branch reconciliation also covers missing/stale runtime state. |
| [Issue #16](https://github.com/algal/pi-openai-server-compaction/issues/16) | Open | HTTP fallback sends full input alongside previous_response_id, producing duplicate-item errors. The tested native/stateless mode avoids this path and sends no previous_response_id. The optional legacy custom mode has not been live-validated by this fork. |
| [Issue #14](https://github.com/algal/pi-openai-server-compaction/issues/14), [PR #15](https://github.com/algal/pi-openai-server-compaction/pull/15) | Open | Compaction usage is only in extension details. Adapted ronind's top-level combined-usage reporting so Pi 0.99 can account for summary and remote requests. |
| [Issue #5](https://github.com/algal/pi-openai-server-compaction/issues/5), [PR #6](https://github.com/algal/pi-openai-server-compaction/pull/6), [PR #10](https://github.com/algal/pi-openai-server-compaction/pull/10) | Open | Stale peer version range. These proposals cover older Pi versions through 0.83.x; this fork targets and tests 0.99.1. |
| [PR #20](https://github.com/algal/pi-openai-server-compaction/pull/20), [PR #21](https://github.com/algal/pi-openai-server-compaction/pull/21) | Closed, unmerged | Describe Pi 0.86+ TranscriptContext replacing direct systemPrompt/tools fields. This fork defaults to native Pi transport and adapts the optional legacy stream at its boundary. The PRs' retry and warning changes were not imported. |
| [Issue #2](https://github.com/algal/pi-openai-server-compaction/issues/2) | Open | Custom WebSocket partial rendering on Pi 0.81.1. Native Pi transport is the default here. |
| [PR #7](https://github.com/algal/pi-openai-server-compaction/pull/7), [PR #9](https://github.com/algal/pi-openai-server-compaction/pull/9) | Closed unmerged / open, respectively | Transient retries and durable failure notices. These are follow-up improvements, not implemented in this fork. |

Other reviewed proposals concern custom providers (#3/#13), Grok (#4), runtime configuration (#8), and earlier compatibility ranges (#11/#12). They were not needed for the direct OpenAI subscription installation repaired here.

No reviewed upstream report addressed the exact direct-OpenAI subscription capability errors reproduced in this installation (`subscription_sharing_unsupported_capability` for compaction_trigger and `hardened_oauth_rule_missing` for /responses/compact). The inline context_management workaround is based on our live synthetic requests, separate from the upstream PRs above.

The fork keeps upstream's MIT license and history. Adapted fixes are credited above; their authors' reported test results are not presented as this fork's verification. See README.md and compatibility-results.json for the checks actually run here. No issue, comment, or PR was submitted to the upstream project during this review.
