const assert = require("node:assert/strict");
const StudioOSCloudSync = require("../supabase-sync.js");

const state = {
    classes: [{
        id: "dsn100",
        code: "DSN 100",
        name: "Foundations",
        meetingDays: ["Mon", "Wed"],
        roster: [{ id: 1, name: "A Student" }],
        currentProjectId: "keep-me",
        projects: [{
            id: "keep-me",
            name: "Project One",
            startDate: "2026-08-24",
            dueDate: "2026-09-30",
            nextMilestone: "Draft review",
            notes: "Keep these notes",
            brief: {
                storagePath: "user/dsn100/keep-me/brief.pdf",
                fileName: "brief.pdf",
                contentType: "application/pdf",
                size: 1234,
                uploadedAt: "2026-10-08T12:00:00.000Z",
            },
        }],
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
    projectSyncVersion: 1,
    currentProjectId: "keep-me",
    students: [{ id: 1, name: "A Student", sortOrder: 0 }],
    projects: [{
        id: "keep-me",
        name: "Project One",
        startDate: "2026-08-24",
        dueDate: "2026-09-30",
        nextMilestone: "Draft review",
        notes: "Keep these notes",
        sortOrder: 0,
        brief: {
            storagePath: "user/dsn100/keep-me/brief.pdf",
            fileName: "brief.pdf",
            contentType: "application/pdf",
            size: 1234,
            uploadedAt: "2026-10-08T12:00:00.000Z",
        },
    }],
}]);

StudioOSCloudSync.mergeSnapshot(state, [{
    id: "dsn100",
    code: "DSN 100A",
    name: "Foundations Studio",
    meetingDays: ["Tue"],
    sortOrder: 0,
    projectSyncVersion: 1,
    currentProjectId: "remote-project",
    students: [{ id: 1, name: "Renamed Student", sortOrder: 0 }, { id: 2, name: "New Student", sortOrder: 1 }],
    projects: [{
        id: "remote-project",
        name: "Remote Project",
        startDate: "2026-10-01",
        dueDate: "2026-11-01",
        nextMilestone: "Critique",
        notes: "Remote notes",
        sortOrder: 0,
        brief: null,
    }],
}], () => { throw new Error("Existing class should be reused"); });

assert.equal(state.classes[0].code, "DSN 100A");
assert.equal(state.classes[0].projects[0].id, "remote-project");
assert.equal(state.classes[0].currentProjectId, "remote-project");
assert.equal(state.classes[0].dates[0].students[0].critique, "preserve");
assert.deepEqual(state.classes[0].roster, [
    { id: 1, name: "Renamed Student" },
    { id: 2, name: "New Student" },
]);

assert.equal(
    StudioOSCloudSync.prototype.safeStorageSegment.call({}, "DSNI 125 / Project #1"),
    "DSNI-125-Project-1"
);

console.log("Studio OS Classes, Students + Projects sync mapping tests passed.");
