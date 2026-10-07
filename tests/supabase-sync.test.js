const assert = require("node:assert/strict");
const StudioOSCloudSync = require("../supabase-sync.js");

const state = {
    classes: [{
        id: "dsn100",
        code: "DSN 100",
        name: "Foundations",
        meetingDays: ["Mon", "Wed"],
        roster: [{ id: 1, name: "A Student" }],
        projects: [{ id: "keep-me" }],
        dates: [{ students: [{ id: 1, name: "A Student", critique: "preserve" }] }],
    }],
};

const snapshot = StudioOSCloudSync.buildSnapshot(state);
assert.deepEqual(snapshot, [{
    id: "dsn100",
    code: "DSN 100",
    name: "Foundations",
    meetingDays: ["Mon", "Wed"],
    sortOrder: 0,
    students: [{ id: 1, name: "A Student", sortOrder: 0 }],
}]);

StudioOSCloudSync.mergeSnapshot(state, [{
    id: "dsn100",
    code: "DSN 100A",
    name: "Foundations Studio",
    meetingDays: ["Tue"],
    sortOrder: 0,
    students: [{ id: 1, name: "Renamed Student", sortOrder: 0 }, { id: 2, name: "New Student", sortOrder: 1 }],
}], () => { throw new Error("Existing class should be reused"); });

assert.equal(state.classes[0].code, "DSN 100A");
assert.equal(state.classes[0].projects[0].id, "keep-me");
assert.equal(state.classes[0].dates[0].students[0].critique, "preserve");
assert.deepEqual(state.classes[0].roster, [
    { id: 1, name: "Renamed Student" },
    { id: 2, name: "New Student" },
]);

console.log("Studio OS Classes + Students sync mapping tests passed.");
