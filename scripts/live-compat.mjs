// Opt-in live regression. Uses only a new synthetic conversation, never a user's session.
import assert from "node:assert/strict";
import { copyFile, mkdir, mkdtemp, readFile, writeFile, chmod } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.ts";

const sourceAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const cwd = await mkdtemp(join(tmpdir(), "pi-compaction-live-"));
const agentDir = join(cwd, "agent");
await mkdir(agentDir);
for (const name of ["auth.json", "models-store.json"]) await copyFile(join(sourceAgentDir, name), join(agentDir, name));
await chmod(join(agentDir, "auth.json"), 0o600);
await writeFile(join(cwd, "fixture.txt"), "SYNTHETIC_LAUNCH_CODE=ORCHID-731\n");
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";
process.env.PI_TELEMETRY = "0";
process.env.PI_OPENAI_SERVER_COMPACTION_ENABLED = "1";
process.env.PI_OPENAI_SERVER_COMPACTION_CUSTOM_TRANSPORT = "0";
const modelId = process.env.PI_OPENAI_SERVER_COMPACTION_TEST_MODEL ?? "gpt-5.5";
const settingsManager = SettingsManager.inMemory({
  defaultProvider: "openai", defaultModel: modelId, packages: [],
  compaction: { enabled: false, keepRecentTokens: 256, reserveTokens: 2048 },
});
const requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const response = await originalFetch(...args);
  const body = args[1]?.body;
  if (typeof body === "string" && body.includes("compaction_trigger") && !response.ok) {
    console.log("REMOTE_COMPACTION_ERROR", response.status, (await response.clone().text()).slice(0,2000));
  }
  return response;
};
const capture = (pi) => pi.on("before_provider_request", (event) => {
  const p = event.payload;
  requests.push({ store: p.store, previousResponse: !!p.previous_response_id,
    remoteHistory: p.input?.some((item) => item.type === "compaction") ?? false,
    systemMessages: p.input?.filter((item) => ["developer", "system"].includes(item.role)).length ?? 0,
    tools: p.tools?.map((tool) => tool.name) ?? [] });
});
async function makeSession(manager) {
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
    noExtensions: true, noSkills: true, noPromptTemplates: true, noContextFiles: true,
    systemPrompt: "You are running a synthetic regression test. Follow the user's exact requested output. Use read when asked.",
    extensionFactories: [extension, capture] });
  await loader.reload();
  const result = await createAgentSession({ cwd, agentDir, resourceLoader: loader,
    sessionManager: manager, settingsManager, thinkingLevel: "off", tools: ["read"] });
  assert.deepEqual(result.extensionsResult.errors, []);
  return result.session;
}
function lastAssistant(session) {
  const message = session.messages.filter((m) => m.role === "assistant").at(-1);
  assert.ok(message, "No assistant response");
  assert.ok(!["error", "aborted"].includes(message.stopReason), message.errorMessage);
  return message.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}
let session;
try {
  const manager = SessionManager.create(cwd, join(cwd, "sessions"));
  session = await makeSession(manager);
  console.log("LIVE: synthetic tool and normal-turn test starting");
  await session.prompt("Read fixture.txt using the read tool. Remember the launch code. Reply exactly INITIAL_OK.\n" + "background context ".repeat(1000));
  assert.match(lastAssistant(session), /INITIAL_OK/);
  assert.ok(session.messages.some((m) => m.role === "toolResult"), "The read tool was not executed");
  await session.prompt("Keep the previously read launch code in mind. Reply exactly PRE_COMPACT_OK. Do not use tools.\n" + "additional background ".repeat(400));
  assert.match(lastAssistant(session), /PRE_COMPACT_OK/);
  console.log("LIVE: read tool passed; requesting remote compaction");
  const compacted = await session.compact("Preserve the launch code from fixture.txt and the user's instructions.");
  assert.ok(compacted.details?.remoteCompaction, "Remote compaction did not return an encrypted artifact");
  assert.ok(compacted.summary.length > 50, "Portable summary is missing");
  assert.ok(compacted.usage?.totalTokens > 0, "Top-level compaction usage is missing");
  console.log("LIVE: encrypted remote compaction and portable summary passed");
  await session.prompt("Reply with only the launch code from the file you read. Do not use any tools.");
  assert.equal(lastAssistant(session).trim(), "ORCHID-731");
  await session.sendCustomMessage({ customType: "regression-note", content: "The synthetic extension note code is LILAC-482.", display: false }, { triggerTurn: false });
  await session.prompt("Reply with only the extension note code. Do not use tools.");
  assert.equal(lastAssistant(session).trim(), "LILAC-482");
  await session.sendCustomMessage({ customType: "regression-note", content: "The second synthetic note code is CEDAR-926.\n" + "synthetic note context ".repeat(600), display: false }, { triggerTurn: false });
  const recompacted = await session.compact("Preserve both extension note codes and the original launch code.");
  assert.ok(recompacted.details?.remoteCompaction, "Second remote compaction failed");
  await session.prompt("Reply with only the second synthetic note code. Do not use tools.");
  assert.equal(lastAssistant(session).trim(), "CEDAR-926");
  const sessionFile = manager.getSessionFile();
  session.dispose();
  session = await makeSession(SessionManager.open(sessionFile));
  await session.prompt("What was that launch code? Reply with only the code. Do not use tools.");
  assert.equal(lastAssistant(session).trim(), "ORCHID-731");
  await session.prompt("Reply with only the second synthetic note code. Do not use tools.");
  assert.equal(lastAssistant(session).trim(), "CEDAR-926");
  assert.ok(requests.every((r) => r.store === false && !r.previousResponse));
  assert.ok(requests.some((r) => r.remoteHistory && r.systemMessages > 0 && r.tools.includes("read")));
  const report = { status: "passed", model: modelId, checks: ["normal turn", "read tool", "encrypted remote compaction", "portable summary", "post-compaction recall", "session resume", "system prompt and tools retained", "stateless requests", "extension note after compaction", "idle note before second compaction", "extension note after resume", "top-level compaction usage"], requests };
  await writeFile(join(cwd, "result.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  console.log("LIVE_REPORT=" + join(cwd, "result.json"));
} finally {
  session?.dispose();
  // Delete the temporary credential copy after every run, including failures.
  const { unlink } = await import("node:fs/promises");
  await unlink(join(agentDir, "auth.json")).catch(() => {});
}
