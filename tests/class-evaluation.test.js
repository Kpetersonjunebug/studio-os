const assert = require("node:assert/strict");
const StudioOSApp = require("../app.js");

const app = Object.create(StudioOSApp.prototype);

assert.deepEqual(app.normalizeClassEvaluation({
    classStatus: "Mixed",
    overallUnderstanding: "Needs Reinforcement",
    conceptsToReview: "Drawing proportions",
    projectChanges: "Add a demonstration",
}), {
    classPace: "Slightly Behind",
    overallUnderstanding: "Needs Reinforcement",
    conceptsToReview: "Drawing proportions",
    projectChanges: "Add a demonstration",
});

const cls = {
    dates: [
        { dateISO: "2026-10-05", isInstructional: true, classEvaluation: { conceptsToReview: "Value studies" } },
        { dateISO: "2026-10-06", isInstructional: false },
        { dateISO: "2026-10-07", isInstructional: true, classEvaluation: { conceptsToReview: "Proportions" } },
        { dateISO: "2026-10-09", isInstructional: true, classEvaluation: { conceptsToReview: "Composition" } },
    ],
};

assert.equal(
    app.getPreviousInstructionalDateRecord(cls, "2026-10-09").classEvaluation.conceptsToReview,
    "Proportions"
);
assert.equal(app.getPreviousInstructionalDateRecord(cls, "2026-10-05"), null);

assert.equal(
    app.lastClassNoteText({ outsideWork: "Partial", classNote: "Review thumbnails" }),
    "Homework: Partial · Review thumbnails"
);
assert.equal(
    app.lastClassNoteText({ outsideWork: "Not Done", classNote: "" }),
    "Homework: Not Done"
);
assert.equal(
    app.lastClassNoteText({ outsideWork: "Done", classNote: "" }),
    "—"
);
assert.equal(
    app.lastClassNoteText({ outsideWork: "Done", classNote: "Strong progress" }),
    "Strong progress"
);

console.log("Studio OS per-class-date evaluation tests passed.");
