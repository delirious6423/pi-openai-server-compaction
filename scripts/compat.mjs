import assert from "node:assert/strict";
import { test } from "node:test";
import extension from "../src/index.ts";
import { applyPayloadPatch, applyRemoteHistoryPayloadPatch, modelKey } from "../src/openai.ts";
import { loadConfig } from "../src/config.ts";
import { generatePortableSummary, parseInlineCompactionEvents, extractRemoteCompactionDetails, buildRemoteCompactionDetails, messageToResponseItems, reconstructRemoteCompactionStateFromBranch, combineCompactionUsage } from "../src/remote-compaction.ts";
import { setRemoteCompactionState, clearAllContinuationState } from "../src/state.ts";

process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = "1";
process.env.PI_OPENAI_SERVER_COMPACTION_CUSTOM_TRANSPORT = "0";
const model = {
  provider: "openai", api: "openai-responses", id: "gpt-5.5",
  baseUrl: "https://api.openai.com/v1", contextWindow: 272000, input: ["text"],
};
const cfg = loadConfig(process.cwd());
const developer = { role: "developer", content: [{ type: "input_text", text: "Keep the project rules." }] };
const question = { type: "message", role: "user", content: [{ type: "input_text", text: "Next step?" }] };
const history = [{ type: "compaction", encrypted_content: "synthetic-test-blob" }, question];
const compactionEntry = { type: "compaction", id: "c1", details: { remoteCompaction: buildRemoteCompactionDetails(model, history) } };

function harness(oauth = true) {
  const handlers = new Map();
  const providers = [];
  extension({ on: (name, fn) => handlers.set(name, fn), registerCommand: () => {}, registerProvider: (...args) => providers.push(args) });
  const ctx = {
    cwd: process.cwd(), model, hasUI: false,
    modelRegistry: { isUsingOAuth: () => oauth },
    sessionManager: { getSessionId: () => "compat-test", getBranch: () => [] },
  };
  return { handlers, providers, ctx };
}

test("default extension leaves the native provider transport registered", () => {
  assert.equal(cfg.useCustomTransport, false);
  assert.deepEqual(harness().providers, []);
});

test("stateless patch overrides store=true and removes previous_response_id", () => {
  const payload = { store: true, previous_response_id: "old", input: [question] };
  const patched = applyPayloadPatch({ payload, model, cfg, stateless: true, previousResponseId: "new" });
  assert.equal(patched.store, false);
  assert.equal(patched.previous_response_id, undefined);
  assert.deepEqual(patched.input, [question]);
  assert.equal(payload.store, true);
});

test("OAuth requests use stateless payloads", () => {
  const { handlers, ctx } = harness();
  const payload = handlers.get("before_provider_request")({ payload: { store: true, input: [developer, question] } }, ctx);
  assert.equal(payload.store, false);
  assert.equal(payload.previous_response_id, undefined);
  assert.equal(payload.context_management, undefined);
});

test("inline compaction accepts multiple artifacts and selects the latest", () => {
  const last = { type: "compaction", encrypted_content: "last" };
  const parsed = parseInlineCompactionEvents([
    { type: "response.output_item.done", item: { type: "compaction", encrypted_content: "first" } },
    { type: "response.output_item.done", item: { type: "message", role: "assistant", content: [] } },
    { type: "response.output_item.done", item: last },
    { type: "response.completed", response: { usage: { total_tokens: 100 } } },
  ]);
  assert.deepEqual(parsed.compactionItem, last);
  assert.equal(parsed.usage.total_tokens, 100);
});

test("inline compaction rejects missing artifacts and incomplete streams", () => {
  assert.throws(() => parseInlineCompactionEvents([{ type: "response.completed", response: {} }]), /no encrypted artifact/);
  assert.throws(() => parseInlineCompactionEvents([]), /before response.completed/);
  assert.throws(() => parseInlineCompactionEvents([{ type: "error", message: "provider rejected" }]), /provider rejected/);
});

test("inline compaction protocol is preserved in persisted details", () => {
  const details = buildRemoteCompactionDetails(model, history, undefined, "responses_inline_compaction");
  assert.equal(extractRemoteCompactionDetails({ remoteCompaction: details }).implementation, "responses_inline_compaction");
});

test("native API-key transport also sends full stateless history", () => {
  const { handlers, ctx } = harness(false);
  assert.equal(handlers.get("before_provider_request")({ payload: { input: [question] } }, ctx).store, false);
});

test("remote replay preserves native developer instructions and tool declarations", () => {
  const tools = [{ type: "function", name: "read", parameters: { type: "object" } }];
  const patched = applyRemoteHistoryPayloadPatch({ payload: { input: [developer, question], tools, previous_response_id: "old" }, explicitHistory: history });
  assert.deepEqual(patched.input, [developer, ...history]);
  assert.deepEqual(patched.tools, tools);
  assert.equal(patched.previous_response_id, undefined);
});

test("direct OpenAI native transport replays encrypted remote history", () => {
  const { handlers, ctx } = harness();
  ctx.sessionManager.getBranch = () => [compactionEntry];
  setRemoteCompactionState("compat-test", { modelKey: modelKey(model), compactionEntryId: "c1", replacementHistory: history, explicitHistory: history });
  const patched = handlers.get("before_provider_request")({ payload: { input: [developer, question], store: false } }, ctx);
  assert.deepEqual(patched.input, [developer, ...history]);
  assert.equal(patched.store, false);
  handlers.get("session_before_switch")({}, ctx);
});

test("model switches do not receive another model's encrypted history", () => {
  const { handlers, ctx } = harness();
  ctx.sessionManager.getBranch = () => [{ ...compactionEntry, details: { remoteCompaction: buildRemoteCompactionDetails({ ...model, id: "other" }, history) } }];
  setRemoteCompactionState("compat-test", { modelKey: "openai:openai-responses:other", compactionEntryId: "c1", replacementHistory: history, explicitHistory: history });
  const patched = handlers.get("before_provider_request")({ payload: { input: [developer, question] } }, ctx);
  assert.deepEqual(patched.input, [developer, question]);
  handlers.get("session_before_switch")({}, ctx);
});

test("non-OpenAI providers keep their normal payload", () => {
  const { handlers, ctx } = harness();
  ctx.model = { ...model, provider: "anthropic", api: "anthropic-messages" };
  assert.equal(handlers.get("before_provider_request")({ payload: { messages: [question] } }, ctx), undefined);
});

test("portable summaries use the authenticated registry completion", async () => {
  let called = false;
  const result = await generatePortableSummary({
    messages: [], model, apiKey: "synthetic", firstKeptEntryId: "m1", tokensBefore: 100,
    completeFn: async () => { called = true; return { stopReason: "stop", content: [{ type: "text", text: "Portable state." }] }; },
  });
  assert.equal(called, true);
  assert.equal(result.summary, "Portable state.");
});

test("failed summary requests cannot be recorded as successful summaries", async () => {
  await assert.rejects(generatePortableSummary({
    messages: [], model, apiKey: "synthetic", firstKeptEntryId: "m1", tokensBefore: 100,
    completeFn: async () => ({ stopReason: "error", errorMessage: "summary request failed", content: [] }),
  }), /summary request failed/);
  clearAllContinuationState();
});

test("Pi context kinds survive replay and excluded bash output stays excluded", () => {
  const messages = [
    { role: "custom", customType: "note", content: "EXTENSION_NOTE", display: false, timestamp: 0 },
    { role: "bashExecution", command: "echo hello", output: "BASH_OUTPUT", exitCode: 0, timestamp: 0 },
    { role: "branchSummary", summary: "BRANCH_NOTE", fromId: "b1", timestamp: 0 },
    { role: "compactionSummary", summary: "COMPACTION_NOTE", tokensBefore: 100, timestamp: 0 },
  ];
  for (const [index, marker] of ["EXTENSION_NOTE", "BASH_OUTPUT", "BRANCH_NOTE", "COMPACTION_NOTE"].entries()) {
    const items = messageToResponseItems(messages[index]);
    assert.equal(items[0].role, "user");
    assert.ok(JSON.stringify(items).includes(marker));
  }
  assert.deepEqual(messageToResponseItems({ ...messages[1], excludeFromContext: true }), []);
});

test("resume retains persisted custom entries and unanswered turns", () => {
  const state = reconstructRemoteCompactionStateFromBranch({ branchEntries: [compactionEntry,
    { type: "custom_message", id: "n1", customType: "note", content: "PERSISTED_NOTE", display: false },
    { type: "branch_summary", id: "b1", summary: "BRANCH_CONTEXT", fromId: "old" },
    { type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "UNANSWERED" }] } },
  ] });
  for (const marker of ["PERSISTED_NOTE", "BRANCH_CONTEXT", "UNANSWERED"]) assert.ok(JSON.stringify(state.explicitHistory).includes(marker));
});

test("provider request reconciles idle branch context without a message_end event", () => {
  const { handlers, ctx } = harness();
  ctx.sessionManager.getBranch = () => [compactionEntry,
    { type: "custom_message", id: "n1", customType: "note", content: "IDLE_NOTE", display: false },
    { type: "message", id: "u1", message: { role: "user", content: [{ type: "text", text: "CURRENT_TURN" }] } },
  ];
  const patched = handlers.get("before_provider_request")({ payload: { input: [developer, question] } }, ctx);
  const input = JSON.stringify(patched.input);
  assert.ok(input.includes("IDLE_NOTE"));
  assert.ok(input.includes("CURRENT_TURN"));
  assert.equal(patched.input[0].role, "developer");
  handlers.get("session_before_switch")({}, ctx);
});

test("summary and remote usage combine for Pi session statistics", async () => {
  const local = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, totalTokens: 10, reasoning: 1,
    cost: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 } };
  const remote = { ...local, cacheWrite1h: 2 };
  const result = await generatePortableSummary({
    messages: [], model, apiKey: "synthetic", firstKeptEntryId: "m1", tokensBefore: 100,
    completeFn: async () => ({ stopReason: "stop", content: [{ type: "text", text: "Summary" }], usage: local }),
  });
  assert.deepEqual(result.usage, local);
  assert.deepEqual(combineCompactionUsage(result.usage, remote), {
    input: 2, output: 4, cacheRead: 6, cacheWrite: 8, totalTokens: 20, reasoning: 2, cacheWrite1h: 2,
    cost: { input: 2, output: 4, cacheRead: 6, cacheWrite: 8, total: 20 },
  });
  assert.equal(combineCompactionUsage(undefined), undefined);
});
