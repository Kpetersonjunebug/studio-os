class StudioOSApp {
    constructor() {
        this.storageKey = "studioOS_pilot_v1";
        this.legacyStorageKey = "studioOS_students";
        this.state = null;
        this.selectedStudentByClassDate = {};
        this.init();
    }

    init() {
        this.loadState();
        this.bindTopControls();
        this.renderAll();
    }

    loadState() {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) {
            this.state = this.createInitialState();
            this.tryMigrateLegacyData();
            this.saveState();
            return;
        }
        try {
            const parsed = JSON.parse(raw);
            this.state = this.normalizeState(parsed);
        } catch (err) {
            console.error("Failed to load pilot data. Resetting.", err);
            this.state = this.createInitialState();
            this.tryMigrateLegacyData();
            this.saveState();
        }
    }

    saveState() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    }

    normalizeState(state) {
        const fallback = this.createInitialState();
        const byId = Object.fromEntries(fallback.classes.map((c) => [c.id, c]));
        const classes = (state.classes || fallback.classes).map((c) => {
            const f = byId[c.id] || byId[fallback.classes[0].id];
            return {
                ...f,
                ...c,
                dates: (c.dates || f.dates).map((d, index) => ({
                    ...f.dates[index % f.dates.length],
                    ...d,
                    students: (d.students || []).map((s, sIndex) => this.normalizeStudent(s, sIndex)),
                })),
            };
        });
        return {
            selectedClassId: state.selectedClassId || classes[0].id,
            selectedDateIndexByClass: state.selectedDateIndexByClass || fallback.selectedDateIndexByClass,
            classes,
        };
    }

    normalizeStudent(student, index) {
        const base = createDefaultStudent({
            id: student.id ?? index + 1,
            name: student.name ?? `Student ${index + 1}`,
        });
        return {
            ...base,
            ...student,
            evaluation: {
                ...base.evaluation,
                ...(student.evaluation || {}),
            },
        };
    }

    createInitialState() {
        const classDefs = [
            {
                id: "dsn100",
                code: "DSN 100",
                name: "Foundations",
                meetingDays: "Mon / Wed",
                currentProject: "Tape Mural",
                nextMilestone: "Reflection due Monday",
                dates: [
                    { date: "Wednesday, Aug. 26", week: 2, classNumber: 4 },
                    { date: "Friday, Aug. 28", week: 2, classNumber: 5 },
                    { date: "Monday, Aug. 31", week: 3, classNumber: 6 },
                ],
                roster: [
                    "Maya Chen", "Jordan Lee", "Ava Martinez", "Noah Williams", "Sofia Patel",
                    "Liam O'Connor", "Emma Thompson", "Oliver Grant", "Isabella Rodriguez",
                    "Ethan Kim", "Charlotte Lewis", "Mason Brown", "Amelia Johnson",
                    "Logan Davis", "Harper White", "Benjamin Taylor", "Evelyn Jackson", "Aiden Anderson",
                ],
            },
            {
                id: "dsni125",
                code: "DSNI 125",
                name: "Design Drawing",
                meetingDays: "Tue / Thu",
                currentProject: "Observed Object Series",
                nextMilestone: "Thumbnail critique Thursday",
                dates: [
                    { date: "Tuesday, Sept. 1", week: 1, classNumber: 1 },
                    { date: "Thursday, Sept. 3", week: 1, classNumber: 2 },
                    { date: "Tuesday, Sept. 8", week: 2, classNumber: 3 },
                ],
                roster: [
                    "Elena Park", "Marcus Hill", "Priya Shah", "Caleb Reed", "Lucy Bennett",
                    "Daniel Ortiz", "Nora Price", "Hugo Alvarez", "Grace Miller", "Theo Carter",
                ],
            },
            {
                id: "dsni225",
                code: "DSNI 225",
                name: "Communication Technology",
                meetingDays: "Mon / Thu",
                currentProject: "Micro Publication",
                nextMilestone: "Draft spread review next class",
                dates: [
                    { date: "Monday, Sept. 7", week: 1, classNumber: 1 },
                    { date: "Thursday, Sept. 10", week: 1, classNumber: 2 },
                    { date: "Monday, Sept. 14", week: 2, classNumber: 3 },
                ],
                roster: [
                    "Riley Nguyen", "Seth Cooper", "Mina Abbas", "Jonah Ellis", "Talia Brooks",
                    "Victor Gomez", "Skyler Ross", "Ivy Morgan", "Nolan Green", "Paige Foster", "Aria Sanders", "Milo Wood",
                ],
            },
            {
                id: "dsn402",
                code: "DSN 402",
                name: "Design Thinking",
                meetingDays: "Wed",
                currentProject: "Community Wayfinding Sprint",
                nextMilestone: "Testing plan due Wednesday",
                dates: [
                    { date: "Wednesday, Sept. 2", week: 1, classNumber: 1 },
                    { date: "Wednesday, Sept. 9", week: 2, classNumber: 2 },
                    { date: "Wednesday, Sept. 16", week: 3, classNumber: 3 },
                ],
                roster: [
                    "Zoe Phillips", "Cole Jenkins", "Mara Simpson", "Dev Patel", "Lena Watson",
                    "Samir Khan", "Olive Hughes", "Finn Parker", "Jade Flores",
                ],
            },
        ];

        const classes = classDefs.map((def) => ({
            id: def.id,
            code: def.code,
            name: def.name,
            meetingDays: def.meetingDays,
            currentProject: def.currentProject,
            nextMilestone: def.nextMilestone,
            dates: def.dates.map((d, dateIndex) => ({
                id: `${def.id}-d${dateIndex + 1}`,
                date: d.date,
                week: d.week,
                classNumber: d.classNumber,
                students: def.roster.map((name, i) => {
                    const student = createDefaultStudent({ id: i + 1, name });
                    if (i % 7 === 1) student.overallStatus = "Needs Help";
                    if (i % 7 === 2) student.overallStatus = "Strong";
                    if (i % 8 === 3) student.followUp = "Next Class";
                    if (i % 9 === 4) student.attendance = "Tardy";
                    if (i % 10 === 5) student.attendance = "Absent";
                    if (i % 3 === 0) student.projectStage = "Planning";
                    if (i % 4 === 0) student.classNote = "Check process sketches.";
                    return student;
                }),
            })),
        }));

        return {
            selectedClassId: classes[0].id,
            selectedDateIndexByClass: Object.fromEntries(classes.map((c) => [c.id, 1])),
            classes,
        };
    }

    tryMigrateLegacyData() {
        const legacyRaw = localStorage.getItem(this.legacyStorageKey);
        if (!legacyRaw) return;
        try {
            const legacyStudents = JSON.parse(legacyRaw);
            const firstClass = this.state.classes[0];
            const dateIndex = this.state.selectedDateIndexByClass[firstClass.id] ?? 1;
            const dateRecord = firstClass.dates[dateIndex];
            dateRecord.students = dateRecord.students.map((student) => {
                const match = legacyStudents.find((s) => s.name === student.name || s.StudentName === student.name);
                if (!match) return student;
                return this.normalizeStudent({
                    ...student,
                    attendance: match.attendance ?? match.Attendance ?? student.attendance,
                    projectStage: match.projectStage ?? match.ProjectStage ?? student.projectStage,
                    overallStatus: match.overallStatus ?? match.Status ?? student.overallStatus,
                    classNote: match.classNote ?? match.ClassNote ?? student.classNote,
                    followUp: match.followUp ?? match.FollowUp ?? student.followUp,
                    followUpNote: match.followUpNote ?? match.FollowUpNote ?? student.followUpNote,
                    evaluationNote: match.evaluationNote ?? match.EvaluationNote ?? student.evaluationNote,
                    evaluation: {
                        concept: match.evaluation?.concept ?? match.EvalConcept ?? student.evaluation.concept,
                        craft: match.evaluation?.craft ?? match.EvalCraft ?? student.evaluation.craft,
                        presentation: match.evaluation?.presentation ?? match.EvalPresentation ?? student.evaluation.presentation,
                        technical: match.evaluation?.technical ?? match.EvalTechnical ?? student.evaluation.technical,
                    },
                });
            });
        } catch (err) {
            console.warn("Legacy migration skipped due to parse failure.", err);
        }
    }

    bindTopControls() {
        document.getElementById("classSelect").addEventListener("change", (e) => {
            this.state.selectedClassId = e.target.value;
            this.ensureSelectedStudent();
            this.saveState();
            this.renderAll();
        });

        document.getElementById("prevDateBtn").addEventListener("click", () => {
            this.shiftDate(-1);
        });
        document.getElementById("nextDateBtn").addEventListener("click", () => {
            this.shiftDate(1);
        });
        document.getElementById("todayDateBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            this.state.selectedDateIndexByClass[cls.id] = Math.min(1, cls.dates.length - 1);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.renderAll();
        });

        document.getElementById("resetCurrentClassBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            if (!window.confirm(`Reset all test data for ${cls.code} · ${cls.name}?`)) return;
            const fresh = this.createInitialState();
            const freshClass = fresh.classes.find((c) => c.id === cls.id);
            const idx = this.state.classes.findIndex((c) => c.id === cls.id);
            this.state.classes[idx] = freshClass;
            this.state.selectedDateIndexByClass[cls.id] = 1;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.renderAll();
        });

        document.getElementById("resetAllDataBtn").addEventListener("click", () => {
            if (!window.confirm("Reset ALL pilot test data for all classes and dates?")) return;
            this.state = this.createInitialState();
            this.selectedStudentByClassDate = {};
            this.ensureSelectedStudent(true);
            this.saveState();
            this.renderAll();
        });
    }

    currentClass() {
        return this.state.classes.find((c) => c.id === this.state.selectedClassId) || this.state.classes[0];
    }

    currentDateIndex() {
        const cls = this.currentClass();
        return this.state.selectedDateIndexByClass[cls.id] ?? 1;
    }

    currentDateRecord() {
        const cls = this.currentClass();
        const idx = this.currentDateIndex();
        return cls.dates[idx];
    }

    currentStudents() {
        return this.currentDateRecord().students;
    }

    selectedKey() {
        return `${this.currentClass().id}:${this.currentDateRecord().id}`;
    }

    currentStudent() {
        const key = this.selectedKey();
        const id = this.selectedStudentByClassDate[key];
        return this.currentStudents().find((s) => s.id === id) || null;
    }

    ensureSelectedStudent(forceFirst = false) {
        const key = this.selectedKey();
        const students = this.currentStudents();
        if (students.length === 0) return;
        const current = this.selectedStudentByClassDate[key];
        const exists = students.some((s) => s.id === current);
        if (forceFirst || !exists) this.selectedStudentByClassDate[key] = students[0].id;
    }

    shiftDate(delta) {
        const cls = this.currentClass();
        const current = this.currentDateIndex();
        const next = Math.max(0, Math.min(cls.dates.length - 1, current + delta));
        this.state.selectedDateIndexByClass[cls.id] = next;
        this.ensureSelectedStudent(true);
        this.saveState();
        this.renderAll();
    }

    renderAll() {
        this.ensureSelectedStudent();
        this.renderTopControls();
        this.renderSummary();
        this.renderFollowUps();
        this.renderTable();
        this.renderPanel();
    }

    renderTopControls() {
        const select = document.getElementById("classSelect");
        const cls = this.currentClass();
        select.innerHTML = this.state.classes
            .map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${c.code} · ${c.name}</option>`)
            .join("");

        const idx = this.currentDateIndex();
        const dates = cls.dates;
        const prev = dates[Math.max(0, idx - 1)];
        const cur = dates[idx];
        const next = dates[Math.min(dates.length - 1, idx + 1)];
        document.getElementById("dateContext").textContent =
            `${prev.date} (prev) · ${cur.date} (today) · ${next.date} (next)`;

        document.getElementById("courseTitle").textContent = `${cls.code} · ${cls.name}`;
        document.getElementById("classDate").textContent = cur.date;
        document.getElementById("classWeek").textContent = `Week ${cur.week} · Class ${cur.classNumber} · ${cls.meetingDays}`;
        document.getElementById("projectTitle").textContent = cls.currentProject;
        document.getElementById("projectMilestone").textContent = cls.nextMilestone;
    }

    renderSummary() {
        const students = this.currentStudents();
        const needHelp = students.filter((s) => s.overallStatus === "Needs Help").length;
        const atRisk = students.filter((s) => (s.attendance !== "Present") && (s.overallStatus === "Needs Help" || s.followUp === "Next Class")).length;
        const followUps = students.filter((s) => s.followUp === "Next Class").length;

        document.getElementById("metricStudents").textContent = String(students.length);
        document.getElementById("metricNeedHelp").textContent = String(needHelp);
        document.getElementById("metricAtRisk").textContent = String(atRisk);
        document.getElementById("metricFollowUps").textContent = String(followUps);
    }

    renderFollowUps() {
        const due = this.currentStudents().filter((s) => s.followUp === "Next Class");
        const host = document.getElementById("followUpsDue");
        host.innerHTML = "";
        if (due.length === 0) {
            host.innerHTML = '<span class="project-subtitle">No follow-ups due for this class date.</span>';
            return;
        }
        due.forEach((student) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip-btn";
            btn.textContent = student.name;
            btn.addEventListener("click", () => {
                this.selectedStudentByClassDate[this.selectedKey()] = student.id;
                this.renderTable();
                this.renderPanel();
            });
            host.appendChild(btn);
        });
    }

    statusTagClass(status) {
        if (status === "Strong") return "tag tag-strong";
        if (status === "Needs Help") return "tag tag-needs-help";
        return "tag tag-developing";
    }

    followTagClass(status) {
        if (status === "Next Class") return "tag tag-followup";
        if (status === "Complete") return "tag tag-strong";
        return "tag tag-developing";
    }

    attendanceTagClass(value) {
        if (value === "Absent") return "tag tag-absent";
        if (value === "Tardy") return "tag tag-tardy";
        return "tag tag-strong";
    }

    escapeHtml(text) {
        return String(text || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    renderTable() {
        const tbody = document.getElementById("studentTableBody");
        const key = this.selectedKey();
        const selectedId = this.selectedStudentByClassDate[key];
        tbody.innerHTML = "";

        this.currentStudents().forEach((s) => {
            const note = s.classNote?.trim() ? s.classNote.trim() : "—";
            const tr = document.createElement("tr");
            tr.className = `student-row ${s.id === selectedId ? "selected" : ""}`;
            tr.innerHTML = `
                <td><strong>${this.escapeHtml(s.name)}</strong></td>
                <td><span class="${this.attendanceTagClass(s.attendance)}">${s.attendance}</span></td>
                <td><span class="${this.statusTagClass(s.overallStatus)}">${s.overallStatus}</span></td>
                <td>${s.projectStage}</td>
                <td><span class="${this.statusTagClass(s.overallStatus)}">${s.overallStatus}</span></td>
                <td class="last-note">${this.escapeHtml(note)}</td>
                <td><span class="${this.followTagClass(s.followUp)}">${s.followUp}</span></td>
            `;
            tr.addEventListener("click", () => {
                this.selectedStudentByClassDate[key] = s.id;
                this.renderTable();
                this.renderPanel();
            });
            tbody.appendChild(tr);
        });
    }

    options(list, selected) {
        return list.map((option) =>
            `<option value="${this.escapeHtml(option)}" ${option === selected ? "selected" : ""}>${this.escapeHtml(option)}</option>`
        ).join("");
    }

    renderPanel() {
        const panel = document.getElementById("studentPanel");
        const student = this.currentStudent();
        if (!student) {
            panel.innerHTML = '<div class="panel-placeholder">Select a student from the table.</div>';
            return;
        }
        const classDate = this.currentDateRecord();
        const lastNote = student.classNote?.trim() || "No note";

        panel.innerHTML = `
            <div class="panel-header">
                <h3>${this.escapeHtml(student.name)}</h3>
                <div class="context-grid">
                    <div>Current standing: <strong>${student.overallStatus}</strong></div>
                    <div>Absences: <strong>${student.attendance === "Absent" ? 1 : 0}</strong></div>
                    <div>Current project stage: <strong>${student.projectStage}</strong></div>
                    <div>Follow-up status: <strong>${student.followUp}</strong></div>
                    <div>Class date: <strong>${classDate.date}</strong></div>
                    <div>Week/Class: <strong>${classDate.week} / ${classDate.classNumber}</strong></div>
                    <div style="grid-column: 1 / -1;">Last note: <strong>${this.escapeHtml(lastNote)}</strong></div>
                </div>
            </div>
            <div class="form-stack">
                <div class="row-two">
                    <div>
                        <label for="attendance">Attendance</label>
                        <select id="attendance" data-field="attendance">${this.options(ATTENDANCE_OPTIONS, student.attendance)}</select>
                    </div>
                    <div>
                        <label for="overallStatus">Overall Status</label>
                        <select id="overallStatus" data-field="overallStatus">${this.options(OVERALL_STATUS, student.overallStatus)}</select>
                    </div>
                </div>
                <div>
                    <label for="projectStage">Project Stage</label>
                    <select id="projectStage" data-field="projectStage">${this.options(PROJECT_STAGES, student.projectStage)}</select>
                </div>
                <div>
                    <label for="classNote">Class Note</label>
                    <textarea id="classNote" data-field="classNote">${this.escapeHtml(student.classNote || "")}</textarea>
                </div>
                <div>
                    <label for="followUp">Follow-up</label>
                    <select id="followUp" data-field="followUp">${this.options(FOLLOW_UP_STATUS, student.followUp)}</select>
                </div>
                <div>
                    <label for="followUpNote">Follow-up Note</label>
                    <textarea id="followUpNote" data-field="followUpNote">${this.escapeHtml(student.followUpNote || "")}</textarea>
                </div>
                <div class="evaluation-grid">
                    <div>
                        <label for="evalConcept">Concept</label>
                        <select id="evalConcept" data-field="evaluation.concept">${this.options(EVALUATION_LEVELS, student.evaluation.concept)}</select>
                    </div>
                    <div>
                        <label for="evalCraft">Craft / Execution</label>
                        <select id="evalCraft" data-field="evaluation.craft">${this.options(EVALUATION_LEVELS, student.evaluation.craft)}</select>
                    </div>
                    <div>
                        <label for="evalPresentation">Presentation / Graphics</label>
                        <select id="evalPresentation" data-field="evaluation.presentation">${this.options(EVALUATION_LEVELS, student.evaluation.presentation)}</select>
                    </div>
                    <div>
                        <label for="evalTechnical">Technical Deliverables</label>
                        <select id="evalTechnical" data-field="evaluation.technical">${this.options(EVALUATION_LEVELS, student.evaluation.technical)}</select>
                    </div>
                </div>
                <div>
                    <label for="evaluationNote">Evaluation Note</label>
                    <textarea id="evaluationNote" data-field="evaluationNote">${this.escapeHtml(student.evaluationNote || "")}</textarea>
                </div>
            </div>
        `;
        this.bindPanelInputs();
    }

    bindPanelInputs() {
        const panel = document.getElementById("studentPanel");
        panel.querySelectorAll("select[data-field]").forEach((element) => {
            element.addEventListener("change", (event) => {
                this.updateField(event.target.getAttribute("data-field"), event.target.value);
                this.renderAll();
            });
        });
        panel.querySelectorAll("textarea[data-field]").forEach((element) => {
            element.addEventListener("input", (event) => {
                this.updateField(event.target.getAttribute("data-field"), event.target.value, false);
            });
            element.addEventListener("blur", () => this.renderAll());
        });
    }

    updateField(path, value, rerender = true) {
        const student = this.currentStudent();
        if (!student) return;
        if (path.includes(".")) {
            const [keyA, keyB] = path.split(".");
            student[keyA][keyB] = value;
        } else {
            student[path] = value;
        }
        this.saveState();
        if (rerender) this.renderAll();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.studioOSApp = new StudioOSApp();
});
