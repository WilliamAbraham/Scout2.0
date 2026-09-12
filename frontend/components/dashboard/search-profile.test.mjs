import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSearchProfile,
  profileSummary,
  splitPreferenceList,
} from "../../lib/search-profile.ts";
import { executeProfileSave } from "../../lib/search-profile.ts";

function form(patch = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries({
    budget_min: "",
    budget_max: "3500",
    bedrooms_min: "1",
    bedrooms_max: "1",
    bathrooms_min: "1.5",
    neighborhoods: "Astoria",
    must_haves: "Elevator",
    dealbreakers: "Ground floor",
    preferences: "Move in October",
    availability: "[]",
    ...patch,
  }))
    result.set(key, value);
  return result;
}

test("blank limits remain unrestricted, zero is a studio, and decimals are preserved", () => {
  const { profile } = parseSearchProfile(
    form({ budget_max: "", bedrooms_min: "0", bedrooms_max: "0" }),
  );
  assert.equal(profile.budget_min, null);
  assert.equal(profile.budget_max, null);
  assert.equal(profile.bedrooms_min, 0);
  assert.equal(profile.bedrooms_max, 0);
  assert.equal(profile.bathrooms_min, 1.5);
  assert.equal(profileSummary(profile), "Studio · Budget not set");
  assert.equal(
    parseSearchProfile(form({ budget_min: "2500.25" })).profile.budget_min,
    2500.25,
  );
});

test("malformed, inverted and out-of-schema limits fail at the relevant field", () => {
  for (const [field, value] of [
    ["budget_max", "3000usd"],
    ["budget_max", "-1"],
    ["budget_max", "Infinity"],
    ["budget_max", "0.001"],
    ["bedrooms_min", "1.25"],
    ["bathrooms_min", "1000"],
  ]) {
    const parsed = parseSearchProfile(form({ [field]: value }));
    assert.equal(parsed.profile, null);
    assert.equal(parsed.field, field);
  }
  assert.equal(
    parseSearchProfile(form({ budget_min: "4000" })).field,
    "budget_max",
  );
  assert.equal(
    parseSearchProfile(form({ bedrooms_min: "2" })).field,
    "bedrooms_max",
  );
});

test("custom preferences retain text while duplicate suggestions normalize once", () => {
  assert.deepEqual(
    splitPreferenceList(" Elevator, elevator, , PETS allowed, Pets allowed "),
    ["Elevator", "PETS allowed"],
  );
  const { profile } = parseSearchProfile(
    form({
      neighborhoods: " Astoria, astoria, Jackson Heights ",
      preferences: "  October move-in  ",
    }),
  );
  assert.deepEqual(profile.neighborhoods, ["Astoria", "Jackson Heights"]);
  assert.equal(profile.preferences, "October move-in");
  assert.deepEqual(profile.must_haves, ["Elevator"]);
});

test("availability preserves Sunday and rejects malformed, overnight or incomplete windows", () => {
  const sunday = [{ day: 0, start: "09:00", end: "12:30" }];
  assert.deepEqual(
    parseSearchProfile(form({ availability: JSON.stringify(sunday) })).profile
      .availability,
    sunday,
  );
  for (const availability of [
    "null",
    "not json",
    "{}",
    '[{"day":7,"start":"09:00","end":"10:00"}]',
    '[{"day":1,"start":"19:00","end":"09:00"}]',
    '[{"day":1,"start":"09:00","end":"09:00"}]',
    '[{"day":1,"start":"","end":"10:00"}]',
  ]) {
    assert.equal(
      parseSearchProfile(form({ availability })).field,
      "availability",
    );
  }
});

test("missing fields are rejected rather than clearing saved criteria", () => {
  const data = form();
  data.delete("neighborhoods");
  assert.equal(parseSearchProfile(data).field, "neighborhoods");
});

function client(
  result = { data: { user_id: "owner" }, error: null },
  sub = "owner",
) {
  const writes = [];
  return {
    writes,
    auth: {
      getClaims: async () => ({ data: { claims: { sub } }, error: null }),
    },
    from(table) {
      assert.equal(table, "search_profiles");
      return {
        upsert(payload, options) {
          writes.push({ payload, options });
          return {
            select(columns) {
              assert.equal(columns, "user_id");
              return {
                maybeSingle: async () => {
                  if (result instanceof Error) throw result;
                  return result;
                },
              };
            },
          };
        },
      };
    },
  };
}

test("profile saves require a session and valid criteria before any write", async () => {
  const anonymous = client(undefined, null);
  assert.match((await executeProfileSave(anonymous, form())).error, /Sign in/);
  assert.equal(anonymous.writes.length, 0);
  const db = client();
  assert.equal(
    (await executeProfileSave(db, form({ budget_min: "5000" }))).field,
    "budget_max",
  );
  assert.equal(db.writes.length, 0);
});

test("profile writes use the session owner and exclude worker-owned columns", async () => {
  const db = client();
  const result = await executeProfileSave(
    db,
    form({
      user_id: "other",
      paused_at: "forged",
      answers: "forged",
      max_initial_sends_per_day: "999",
    }),
  );
  assert.ok(result.savedAt);
  const { payload, options } = db.writes[0];
  assert.equal(payload.user_id, "owner");
  assert.equal(payload.budget_max, 3500);
  assert.equal(payload.bathrooms_min, 1.5);
  assert.deepEqual(options, { onConflict: "user_id" });
  for (const field of ["paused_at", "answers", "max_initial_sends_per_day"])
    assert.equal(field in payload, false);
});

test("failed, missing, wrong-owner and uncertain save receipts never report success", async () => {
  for (const response of [
    { data: null, error: null },
    { data: null, error: { message: "denied" } },
    { data: { user_id: "other" }, error: null },
    new Error("network"),
  ]) {
    const result = await executeProfileSave(client(response), form());
    assert.equal(result.savedAt, null);
    assert.match(result.error, /could not be confirmed/);
  }
});
