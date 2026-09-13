import assert from "node:assert/strict";
import test from "node:test";
import {
  executePursuitCommand,
  executeRefreshListings,
  executeSearchPause,
} from "../../lib/inbox-command.ts";

const id = "11111111-1111-4111-8111-111111111111";
const version = "2026-09-12T12:00:00+00:00";
const pursuit = {
  id,
  stage: "matched",
  needs_human_reason: "no_contact",
  thread_id: null,
  enriched_at: version,
  updated_at: version,
};
function form(patch = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({
    command: "supply_contact",
    pursuit_id: id,
    expected_updated_at: version,
    contact_email: "broker@example.com",
    contact_name: "Broker",
    source_url: "https://broker.example/listing",
    authorize_contact: "yes",
    ...patch,
  }))
    data.set(key, value);
  return data;
}
// Simulates request outcomes, including a row disappearing between read/update.
// Inspect the real query operations to check ownership and concurrency filters.
function client(responses, userId = "session-owner") {
  const queries = [];
  return {
    queries,
    auth: {
      getClaims: async () => ({
        data: { claims: { sub: userId } },
        error: null,
      }),
    },
    from(table) {
      const query = { table, operations: [] };
      queries.push(query);
      const builder = {};
      for (const method of [
        "select",
        "eq",
        "neq",
        "is",
        "not",
        "limit",
        "update",
      ])
        builder[method] = (...args) => {
          query.operations.push([method, ...args]);
          return builder;
        };
      builder.maybeSingle = async () => {
        assert.ok(responses.length, "unexpected extra query");
        const result = responses.shift();
        if (result instanceof Error) throw result;
        return result;
      };
      return builder;
    },
  };
}
const found = (data) => ({ data, error: null });
const has = (query, operation) =>
  query.operations.some(
    (item) => JSON.stringify(item) === JSON.stringify(operation),
  );

test("anonymous commands cannot reach the database", async () => {
  const db = client([], undefined);
  db.auth.getClaims = async () => ({ data: { claims: {} }, error: null });
  assert.match((await executePursuitCommand(db, form())).error, /Sign in/);
  assert.match(
    (
      await executeSearchPause(
        db,
        form({ intent: "pause", expected_paused: "false" }),
      )
    ).error,
    /Sign in/,
  );
  assert.equal(db.queries.length, 0);
});

test("invalid contacts and unapproved recipients are rejected before reads", async () => {
  for (const patch of [
    { contact_email: "one@example.com,two@example.com" },
    { contact_email: "one@example.com\r\nBcc:other@example.com" },
    { contact_email: "not-an-email" },
    { authorize_contact: "no" },
    { source_url: "javascript:alert(1)" },
    { source_url: "https://name:password@broker.example/" },
  ]) {
    const db = client([]);
    assert.ok((await executePursuitCommand(db, form(patch))).error);
    assert.equal(db.queries.length, 0);
  }
});

test("an unavailable or other-owner pursuit cannot be changed", async () => {
  const db = client([found(null)]);
  const result = await executePursuitCommand(
    db,
    form({ user_id: "forged-owner" }),
  );
  assert.ok(result.error);
  assert.equal(db.queries.length, 1);
  assert.ok(has(db.queries[0], ["eq", "user_id", "session-owner"]));
  assert.ok(has(db.queries[0], ["eq", "id", id]));
});

test("supplied contact is authorized, attributed and atomic without stage or event fabrication", async () => {
  const db = client([found(pursuit), found(null), found({ id })]);
  const result = await executePursuitCommand(
    db,
    form({
      user_id: "forged-owner",
      stage: "contacted",
      paused_at: "",
      learned_answers: "[]",
    }),
  );
  assert.equal(result.error, null);
  assert.match(result.message, /No message was sent/);
  const write = db.queries[2];
  for (const operation of [
    ["eq", "user_id", "session-owner"],
    ["eq", "id", id],
    ["eq", "updated_at", version],
    ["eq", "stage", "matched"],
    ["eq", "needs_human_reason", "no_contact"],
    ["is", "thread_id", null],
    ["not", "enriched_at", "is", null],
  ])
    assert.ok(has(write, operation));
  const patch = write.operations.find(([name]) => name === "update")[1];
  assert.deepEqual(
    Object.keys(patch).sort(),
    [
      "contact_snapshot",
      "needs_human_at",
      "needs_human_note",
      "needs_human_reason",
      "updated_at",
    ].sort(),
  );
  assert.equal(patch.needs_human_at, null);
  assert.equal(patch.needs_human_note, null);
  assert.equal(patch.needs_human_reason, null);
  assert.equal(patch.contact_snapshot.providedBy, "user");
  assert.equal(patch.contact_snapshot.contacts[0].email, "broker@example.com");
  assert.equal(patch.contact_snapshot.contacts[0].role, "unspecified");
  assert.ok(has(db.queries[1], ["eq", "user_id", "session-owner"]));
  assert.equal(
    db.queries.some(
      (query) =>
        query.table === "pursuit_events" &&
        query.operations.some(([name]) => name === "update"),
    ),
    false,
  );
});

test("stale or changed worker state blocks contact replacement", async () => {
  for (const row of [
    { ...pursuit, updated_at: "2026-09-12T12:01:00+00:00" },
    { ...pursuit, stage: "contacted" },
    { ...pursuit, needs_human_reason: "decision" },
    { ...pursuit, thread_id: "existing-thread" },
    { ...pursuit, enriched_at: null },
  ]) {
    const db = client([found(row)]);
    assert.ok((await executePursuitCommand(db, form())).error);
    assert.equal(db.queries.length, 1);
  }
});

test("existing opening drafts cannot be silently retargeted or regenerated", async () => {
  const db = client([found(pursuit), found({ id: "draft" })]);
  assert.match(
    (await executePursuitCommand(db, form())).error,
    /draft already exists/,
  );
  assert.equal(db.queries.length, 2);
});

test("a zero-row or uncertain write never reports success", async () => {
  for (const outcome of [
    found(null),
    { data: null, error: { message: "connection lost" } },
    new Error("connection lost"),
  ]) {
    const db = client([found(pursuit), found(null), outcome]);
    const result = await executePursuitCommand(db, form());
    assert.ok(result.error);
    assert.equal(result.message, null);
  }
});

test("closing preserves conversation history and uses owner/version guards", async () => {
  const db = client([
    found({ ...pursuit, stage: "contacted", thread_id: "thread" }),
    found({ id }),
  ]);
  const result = await executePursuitCommand(
    db,
    form({ command: "close", contact_email: "", authorize_contact: "" }),
  );
  assert.equal(result.error, null);
  assert.match(result.message, /in progress may finish/);
  const write = db.queries[1];
  const patch = write.operations.find(([name]) => name === "update")[1];
  assert.deepEqual(
    Object.keys(patch).sort(),
    ["stage", "next_follow_up_at", "updated_at"].sort(),
  );
  assert.equal(patch.stage, "dead");
  assert.equal(patch.next_follow_up_at, null);
  assert.ok(has(write, ["eq", "user_id", "session-owner"]));
  assert.ok(has(write, ["eq", "updated_at", version]));
});

test("pause only updates the signed-in profile's pause state and version", async () => {
  const db = client([
    found({ paused_at: null, updated_at: version }),
    found({ user_id: "session-owner" }),
  ]);
  const result = await executeSearchPause(
    db,
    form({
      intent: "pause",
      expected_paused: "false",
      user_id: "forged-owner",
    }),
  );
  assert.equal(result.error, null);
  const write = db.queries[1];
  assert.ok(has(write, ["eq", "user_id", "session-owner"]));
  assert.ok(has(write, ["eq", "updated_at", version]));
  assert.ok(has(write, ["is", "paused_at", null]));
  assert.deepEqual(
    Object.keys(write.operations.find(([name]) => name === "update")[1]).sort(),
    ["paused_at", "updated_at"],
  );
});

test("retries are idempotent and a pause update race remains visible", async () => {
  const already = client([found({ paused_at: version, updated_at: version })]);
  assert.equal(
    (
      await executeSearchPause(
        already,
        form({ intent: "pause", expected_paused: "false" }),
      )
    ).error,
    null,
  );
  assert.equal(already.queries.length, 1);
  const race = client([
    found({ paused_at: version, updated_at: version }),
    found(null),
  ]);
  assert.ok(
    (
      await executeSearchPause(
        race,
        form({ intent: "resume", expected_paused: "true" }),
      )
    ).error,
  );
  assert.ok(has(race.queries[1], ["eq", "paused_at", version]));
});

test("pause cannot create a profile or overwrite a failed profile read", async () => {
  for (const response of [
    found(null),
    { data: null, error: { message: "unavailable" } },
  ]) {
    const db = client([response]);
    assert.ok(
      (
        await executeSearchPause(
          db,
          form({ intent: "pause", expected_paused: "false" }),
        )
      ).error,
    );
    assert.equal(db.queries.length, 1);
  }
});

test("refresh listings requires a session and reports the stored-alert result", async () => {
  const anonymous = client([]);
  anonymous.auth.getClaims = async () => ({ data: null, error: null });
  assert.equal(
    (
      await executeRefreshListings(anonymous, async () => {
        throw new Error("should not call the refresh API unsigned");
      })
    ).error,
    "Sign in to refresh listings.",
  );

  const posted = [];
  const result = await executeRefreshListings(client([]), async (userId) => {
    posted.push(userId);
    return {
      ok: true,
      status: 200,
      body: { messages: 4, newMatches: 1, enriched: 1, skippedExisting: 3 },
    };
  });
  assert.deepEqual(posted, ["session-owner"]);
  assert.equal(result.error, null);
  assert.match(result.message ?? "", /1 new match/i);
  assert.match(result.message ?? "", /enrich/i);
});
