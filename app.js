class StudioOSApp {
    constructor() {
        this.storageKey = "studioOS_students";
        this.students = [];
        this.selectedStudentId = null;
        this.init();
    }

    init() {
        this.loadStudents();
        if (!this.selectedStudentId && this.students.length > 0) {
            this.selectedStudentId = this.students[0].id;
        }
        this.renderAll();
    }

    loadStudents() {
        const raw = localStorage.getItem(this.storageKey);
        if (!raw) {
            this.students = this.createSeedStudents();
            this.saveStudents();
            return;
        }

        try {
            const parsed = JSON.parse(raw);
            this.students = parsed.map((student, i) => this.normalizeStudent(student, i));
        } catch (err) {
            console.error("Failed to parse stored data, using defaults.", err);
            this.students = this.createSeedStudents();
            this.saveStudents();
        }
    }

    createSeedStudents() {
        const seeded = JSON.parse(JSON.stringify(DEFAULT_STUDENTS));
        const byName = Object.fromEntries(seeded.map((s) => [s.name, s]));

        byName["Maya Chen"].overallStatus = "Needs Help";
        byName["Maya Chen"].followUp = "Next Class";
        byName["Maya Chen"].projectStage = "Planning";
        byName["Maya Chen"].classNote = "Revision needed on mural composition.";
        byName["Maya Chen"].followUpNote = "Check alignment studies next class.";

        byName["Jordan Lee"].overallStatus = "Needs Help";
        byName["Jordan Lee"].attendance = "Tardy";
        byName["Jordan Lee"].followUp = "Next Class";
        byName["Jordan Lee"].projectStage = "Ideation";
        byName["Jordan Lee"].classNote = "Still searching for clear visual direction.";

        byName["Noah Williams"].followUp = "Next Class";
        byName["Noah Williams"].attendance = "Absent";
        byName["Noah Williams"].overallStatus = "Developing";
        byName["Noah Williams"].classNote = "Needs make-up critique notes.";

        return seeded;
    }

    normalizeStudent(student, fallbackIndex) {
        const base = createDefaultStudent({
            id: student.id ?? fallbackIndex + 1,
            name: student.name ?? `Student ${fallbackIndex + 1}`,
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

    saveStudents() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.students));
    }

    renderAll() {
        this.renderSummary();
        this.renderFollowUpsDue();
        this.renderStudentTable();
        this.renderStudentPanel();
    }

    getCounts() {
        const total = this.students.length;
        const needHelp = this.students.filter((s) => s.overallStatus === "Needs Help").length;
        const followUps = this.students.filter((s) => s.followUp === "Next Class").length;
        const atRisk = this.students.filter(
            (s) => s.attendance !== "Present" && (s.overallStatus === "Needs Help" || s.followUp === "Next Class")
        ).length;
        return { total, needHelp, atRisk, followUps };
    }

    renderSummary() {
        const counts = this.getCounts();
        document.getElementById("metricStudents").textContent = String(counts.total);
        document.getElementById("metricNeedHelp").textContent = String(counts.needHelp);
        document.getElementById("metricAtRisk").textContent = String(counts.atRisk);
        document.getElementById("metricFollowUps").textContent = String(counts.followUps);
    }

    renderFollowUpsDue() {
        const host = document.getElementById("followUpsDue");
        const due = this.students.filter((s) => s.followUp === "Next Class");
        host.innerHTML = "";

        if (due.length === 0) {
            host.innerHTML = '<span class="project-subtitle">No follow-ups due today.</span>';
            return;
        }

        due.forEach((student) => {
            const btn = document.createElement("button");
            btn.className = "chip-btn";
            btn.type = "button";
            btn.textContent = student.name;
            btn.addEventListener("click", () => this.selectStudent(student.id));
            host.appendChild(btn);
        });
    }

    statusTagClass(status) {
        if (status === "Strong") return "tag tag-strong";
        if (status === "Needs Help") return "tag tag-needs-help";
        return "tag tag-developing";
    }

    followUpTagClass(status) {
        if (status === "Next Class") return "tag tag-followup";
        if (status === "Complete") return "tag tag-strong";
        return "tag tag-developing";
    }

    attendanceTagClass(attendance) {
        if (attendance === "Absent") return "tag tag-absent";
        if (attendance === "Tardy") return "tag tag-tardy";
        return "tag tag-strong";
    }

    renderStudentTable() {
        const tbody = document.getElementById("studentTableBody");
        tbody.innerHTML = "";

        this.students.forEach((student) => {
            const tr = document.createElement("tr");
            tr.className = "student-row";
            if (student.id === this.selectedStudentId) tr.classList.add("selected");

            const note = student.classNote && student.classNote.trim().length > 0 ? student.classNote.trim() : "—";

            tr.innerHTML = `
                <td><strong>${student.name}</strong></td>
                <td><span class="${this.attendanceTagClass(student.attendance)}">${student.attendance}</span></td>
                <td><span class="${this.statusTagClass(student.overallStatus)}">${student.overallStatus}</span></td>
                <td>${student.projectStage}</td>
                <td><span class="${this.statusTagClass(student.overallStatus)}">${student.overallStatus}</span></td>
                <td class="last-note">${this.escapeHtml(note)}</td>
                <td><span class="${this.followUpTagClass(student.followUp)}">${student.followUp}</span></td>
            `;

            tr.addEventListener("click", () => this.selectStudent(student.id));
            tbody.appendChild(tr);
        });
    }

    selectStudent(studentId) {
        this.selectedStudentId = studentId;
        this.renderStudentTable();
        this.renderStudentPanel();
    }

    escapeHtml(text) {
        return text
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    currentStudent() {
        return this.students.find((s) => s.id === this.selectedStudentId) || null;
    }

    countAbsences(student) {
        return student.attendance === "Absent" ? 1 : 0;
    }

    renderStudentPanel() {
        const panel = document.getElementById("studentPanel");
        const student = this.currentStudent();
        if (!student) {
            panel.innerHTML = '<div class="panel-placeholder">Select a student from the table.</div>';
            return;
        }

        const lastNote = student.classNote && student.classNote.trim().length > 0 ? student.classNote.trim() : "No note";
        const absences = this.countAbsences(student);

        panel.innerHTML = `
            <div class="panel-header">
                <h3>${student.name}</h3>
                <div class="context-grid">
                    <div>Current standing: <strong>${student.overallStatus}</strong></div>
                    <div>Absences: <strong>${absences}</strong></div>
                    <div>Project stage: <strong>${student.projectStage}</strong></div>
                    <div>Follow-up: <strong>${student.followUp}</strong></div>
                    <div style="grid-column: 1 / -1;">Last note: <strong>${this.escapeHtml(lastNote)}</strong></div>
                </div>
            </div>

            <div class="form-stack">
                <div class="row-two">
                    <div>
                        <label for="attendance">Attendance</label>
                        <select id="attendance" data-field="attendance">
                            ${this.options(ATTENDANCE_OPTIONS, student.attendance)}
                        </select>
                    </div>
                    <div>
                        <label for="overallStatus">Overall Status</label>
                        <select id="overallStatus" data-field="overallStatus">
                            ${this.options(OVERALL_STATUS, student.overallStatus)}
                        </select>
                    </div>
                </div>

                <div>
                    <label for="projectStage">Project Stage</label>
                    <select id="projectStage" data-field="projectStage">
                        ${this.options(PROJECT_STAGES, student.projectStage)}
                    </select>
                </div>

                <div>
                    <label for="classNote">Class Note</label>
                    <textarea id="classNote" data-field="classNote">${this.escapeHtml(student.classNote || "")}</textarea>
                </div>

                <div>
                    <label for="followUp">Follow-up</label>
                    <select id="followUp" data-field="followUp">
                        ${this.options(FOLLOW_UP_STATUS, student.followUp)}
                    </select>
                </div>

                <div>
                    <label for="followUpNote">Follow-up Note</label>
                    <textarea id="followUpNote" data-field="followUpNote">${this.escapeHtml(student.followUpNote || "")}</textarea>
                </div>

                <div class="evaluation-grid">
                    <div>
                        <label for="evalConcept">Concept</label>
                        <select id="evalConcept" data-field="evaluation.concept">
                            ${this.options(EVALUATION_LEVELS, student.evaluation.concept)}
                        </select>
                    </div>
                    <div>
                        <label for="evalCraft">Craft / Execution</label>
                        <select id="evalCraft" data-field="evaluation.craft">
                            ${this.options(EVALUATION_LEVELS, student.evaluation.craft)}
                        </select>
                    </div>
                    <div>
                        <label for="evalPresentation">Presentation / Graphics</label>
                        <select id="evalPresentation" data-field="evaluation.presentation">
                            ${this.options(EVALUATION_LEVELS, student.evaluation.presentation)}
                        </select>
                    </div>
                    <div>
                        <label for="evalTechnical">Technical Deliverables</label>
                        <select id="evalTechnical" data-field="evaluation.technical">
                            ${this.options(EVALUATION_LEVELS, student.evaluation.technical)}
                        </select>
                    </div>
                </div>

                <div>
                    <label for="evaluationNote">Evaluation Note</label>
                    <textarea id="evaluationNote" data-field="evaluationNote">${this.escapeHtml(student.evaluationNote || "")}</textarea>
                </div>
            </div>
        `;

        this.bindPanelEvents();
    }

    options(options, selected) {
        return options
            .map((opt) => `<option value="${opt}" ${opt === selected ? "selected" : ""}>${opt}</option>`)
            .join("");
    }

    bindPanelEvents() {
        const panel = document.getElementById("studentPanel");
        panel.querySelectorAll("select[data-field]").forEach((el) => {
            el.addEventListener("change", (event) => {
                this.updateField(event.target.getAttribute("data-field"), event.target.value);
                this.renderAll();
            });
        });

        panel.querySelectorAll("textarea[data-field]").forEach((el) => {
            el.addEventListener("input", (event) => {
                this.updateField(event.target.getAttribute("data-field"), event.target.value, false);
            });
            el.addEventListener("blur", () => {
                this.renderAll();
            });
        });
    }

    updateField(path, value, rerender = true) {
        const student = this.currentStudent();
        if (!student) return;

        if (path.includes(".")) {
            const [a, b] = path.split(".");
            student[a][b] = value;
        } else {
            student[path] = value;
        }

        this.saveStudents();
        if (rerender) this.renderAll();
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.studioOSApp = new StudioOSApp();
});
