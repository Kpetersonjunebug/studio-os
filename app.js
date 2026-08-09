class StudioOSApp {
    constructor() {
        this.storageKey = "studioOS_pilot_v2_setup";
        this.legacyStorageKeys = ["studioOS_pilot_v1", "studioOS_students"];
        this.state = null;
        this.selectedStudentByClassDate = {};
        this.page = "today";
        this.setupOpenSection = "classes";
        this.init();
    }

    init() {
        this.loadState();
        this.bindGlobalControls();
        this.render();
    }

    loadState() {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
            try {
                this.state = this.normalizeState(JSON.parse(raw));
                this.regenerateAllClassDates();
                this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
                this.saveState();
                return;
            } catch (err) {
                console.error("Failed to parse setup state; rebuilding defaults.", err);
            }
        }

        this.state = this.createInitialState();
        this.regenerateAllClassDates();
        this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
        this.tryMigrateLegacyData();
        this.saveState();
    }

    saveState() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.state));
    }

    createInitialState() {
        const classDefs = [
            {
                id: "dsn100",
                code: "DSN 100",
                name: "Foundations",
                meetingDays: ["Mon", "Wed"],
                semesterStartDate: "2026-08-24",
                semesterEndDate: "2026-12-11",
                currentProject: "Tape Mural",
                nextMilestone: "Reflection due Monday",
                syllabus: {
                    title: "DSN 100 Studio Syllabus",
                    notes: "Intro studio. Focus on process, critique, and material exploration.",
                },
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
                meetingDays: ["Tue", "Thu"],
                semesterStartDate: "2026-09-01",
                semesterEndDate: "2026-12-10",
                currentProject: "Observed Object Series",
                nextMilestone: "Thumbnail critique Thursday",
                syllabus: {
                    title: "DSNI 125 Syllabus",
                    notes: "Drawing as design inquiry. Weekly process checks and sketchbook iterations.",
                },
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
                meetingDays: ["Mon", "Thu"],
                semesterStartDate: "2026-09-07",
                semesterEndDate: "2026-12-14",
                currentProject: "Micro Publication",
                nextMilestone: "Draft spread review next class",
                syllabus: {
                    title: "DSNI 225 Syllabus",
                    notes: "Publication systems and communication workflows.",
                },
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
                meetingDays: ["Wed"],
                semesterStartDate: "2026-09-02",
                semesterEndDate: "2026-12-16",
                currentProject: "Community Wayfinding Sprint",
                nextMilestone: "Testing plan due Wednesday",
                syllabus: {
                    title: "DSN 402 Syllabus",
                    notes: "Applied design thinking in collaborative studio settings.",
                },
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

        const classes = classDefs.map((def) => {
            const roster = def.roster.map((name, i) => ({ id: i + 1, name }));
            const projects = [
                {
                    id: `${def.id}-p1`,
                    name: def.currentProject,
                    startDate: def.semesterStartDate,
                    dueDate: def.semesterEndDate,
                    nextMilestone: def.nextMilestone,
                    notes: "",
                },
            ];
            const dates = def.dates.map((d, dateIndex) => ({
                id: `${def.id}-d${dateIndex + 1}`,
                date: d.date,
                week: d.week,
                classNumber: d.classNumber,
                students: roster.map((r, i) => {
                    const student = createDefaultStudent({ id: r.id, name: r.name });
                    if (i % 7 === 1) student.overallStatus = "Needs Help";
                    if (i % 7 === 2) student.overallStatus = "Strong";
                    if (i % 8 === 3) student.followUp = "Next Class";
                    if (i % 9 === 4) student.attendance = "Tardy";
                    if (i % 10 === 5) student.attendance = "Absent";
                    if (i % 3 === 0) student.projectStage = "Planning";
                    if (i % 4 === 0) student.classNote = "Check process sketches.";
                    return student;
                }),
            }));

            return {
                id: def.id,
                code: def.code,
                name: def.name,
                meetingDays: def.meetingDays,
                semesterStartDate: def.semesterStartDate,
                semesterEndDate: def.semesterEndDate,
                roster,
                nextStudentId: roster.length + 1,
                syllabus: def.syllabus,
                projects,
                currentProjectId: projects[0].id,
                dates,
            };
        });

        return {
            selectedClassId: classes[0].id,
            selectedDateIndexByClass: Object.fromEntries(classes.map((c) => [c.id, 1])),
            academicCalendar: {
                semesterName: "Fall 2026",
                semesterStartDate: "2026-08-24",
                semesterEndDate: "2026-12-18",
                exceptions: [
                    { id: "ex1", date: "2026-09-07", type: "University Holiday", description: "Labor Day" },
                    { id: "ex2", date: "2026-11-25", type: "Break", description: "Thanksgiving break" },
                ],
                nextExceptionId: 3,
            },
            classes,
        };
    }

    normalizeState(state) {
        const fallback = this.createInitialState();
        const byId = Object.fromEntries(fallback.classes.map((c) => [c.id, c]));
        const classes = (state.classes || fallback.classes).map((c) => {
            const f = byId[c.id] || fallback.classes[0];
            const normalizedRoster = this.normalizeRoster(c.roster, c.dates, f.roster);
            const classObj = {
                ...f,
                ...c,
                meetingDays: this.normalizeMeetingDays(c.meetingDays ?? f.meetingDays),
                roster: normalizedRoster,
                nextStudentId: c.nextStudentId || (Math.max(...normalizedRoster.map((r) => r.id), 0) + 1),
                syllabus: { ...f.syllabus, ...(c.syllabus || {}) },
                projects: this.normalizeProjects(c.projects, c, f),
            };
            classObj.currentProjectId = classObj.currentProjectId || (classObj.projects[0] ? classObj.projects[0].id : null);
            classObj.dates = this.normalizeDates(c.dates, f.dates, classObj.roster);
            this.syncClassRosterWithDates(classObj);
            return classObj;
        });

        return {
            selectedClassId: state.selectedClassId || classes[0].id,
            selectedDateIndexByClass: state.selectedDateIndexByClass || fallback.selectedDateIndexByClass,
            academicCalendar: {
                ...fallback.academicCalendar,
                ...(state.academicCalendar || {}),
                exceptions: (state.academicCalendar?.exceptions || fallback.academicCalendar.exceptions).map((e, i) => ({
                    id: e.id || `ex${i + 1}`,
                    date: e.date || "",
                    type: e.type || "No Class",
                    description: e.description || "",
                })),
                nextExceptionId: state.academicCalendar?.nextExceptionId || ((state.academicCalendar?.exceptions?.length || fallback.academicCalendar.exceptions.length) + 1),
            },
            classes,
        };
    }

    normalizeMeetingDays(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === "string") return value.split("/").map((d) => d.trim()).filter(Boolean);
        return [];
    }

    normalizeProjects(projects, legacyClass, fallbackClass) {
        const legacyCurrent = legacyClass.currentProject || fallbackClass.currentProject;
        const legacyMilestone = legacyClass.nextMilestone || fallbackClass.nextMilestone;
        const normalized = (projects && projects.length > 0 ? projects : fallbackClass.projects).map((p, i) => ({
            id: p.id || `${legacyClass.id || fallbackClass.id}-p${i + 1}`,
            name: p.name || legacyCurrent || `Project ${i + 1}`,
            startDate: p.startDate || "",
            dueDate: p.dueDate || "",
            nextMilestone: p.nextMilestone || legacyMilestone || "",
            notes: p.notes || "",
        }));
        if (!normalized.some((p) => p.id === legacyClass.currentProjectId) && normalized.length > 0) {
            legacyClass.currentProjectId = normalized[0].id;
        }
        return normalized;
    }

    normalizeDates(dates, fallbackDates, roster) {
        const base = dates && dates.length > 0 ? dates : fallbackDates;
        return base.map((d, index) => ({
            ...fallbackDates[index % fallbackDates.length],
            ...d,
            dateISO: d.dateISO || "",
            isInstructional: d.isInstructional !== false,
            exceptionType: d.exceptionType || "",
            exceptionDescription: d.exceptionDescription || "",
            students: (d.isInstructional === false ? [] : (d.students || []).map((s, i) => this.normalizeStudentRecord(s, i, roster))),
        }));
    }

    dayToIndex(day) {
        const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return map[day];
    }

    toISO(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, "0");
        const d = String(dateObj.getDate()).padStart(2, "0");
        return `${y}-${m}-${d}`;
    }

    formatDisplayDate(dateObj) {
        const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        const months = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "June", "July", "Aug.", "Sept.", "Oct.", "Nov.", "Dec."];
        return `${weekdays[dateObj.getDay()]}, ${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
    }

    parseDisplayDateToISO(displayDate, fallbackYear) {
        if (!displayDate) return null;
        const monthMap = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, June: 6, July: 7, Aug: 8, Sept: 9, Oct: 10, Nov: 11, Dec: 12 };
        const m = String(displayDate).match(/,\s*([A-Za-z]+)\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/);
        if (!m) return null;
        const month = monthMap[m[1].replace(".", "")];
        if (!month) return null;
        const day = Number(m[2]);
        const year = Number(m[3] || fallbackYear);
        const mm = String(month).padStart(2, "0");
        const dd = String(day).padStart(2, "0");
        return `${year}-${mm}-${dd}`;
    }

    getRecordISO(record, cls) {
        if (record.dateISO) return record.dateISO;
        const fallbackYear = cls.semesterStartDate ? Number(cls.semesterStartDate.slice(0, 4)) : new Date().getFullYear();
        return this.parseDisplayDateToISO(record.date, fallbackYear);
    }

    regenerateClassDates(cls, preserveRecords = true) {
        const start = cls.semesterStartDate ? new Date(`${cls.semesterStartDate}T12:00:00`) : null;
        const end = cls.semesterEndDate ? new Date(`${cls.semesterEndDate}T12:00:00`) : null;
        const meetingDayIndexes = (cls.meetingDays || []).map((d) => this.dayToIndex(d)).filter((n) => Number.isInteger(n));
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || meetingDayIndexes.length === 0 || end < start) {
            cls.dates = [];
            this.state.selectedDateIndexByClass[cls.id] = 0;
            return;
        }

        const excludedTypes = new Set(["No Class", "University Holiday", "Break"]);
        const exceptionByIso = new Map(
            (this.state.academicCalendar.exceptions || [])
                .filter((e) => excludedTypes.has(e.type) && e.date)
                .map((e) => [e.date, { type: e.type, description: e.description || "" }])
        );

        const existingByIso = new Map();
        if (preserveRecords) {
            (cls.dates || []).forEach((record) => {
                if (record.isInstructional === false) return;
                const iso = this.getRecordISO(record, cls);
                if (iso) existingByIso.set(iso, record);
            });
        }

        const instructionalDates = [];
        const exceptionDates = [];
        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
            const iso = this.toISO(cursor);
            const day = cursor.getDay();
            const isMeetingDay = meetingDayIndexes.includes(day);
            const exception = exceptionByIso.get(iso);
            if (exception) {
                exceptionDates.push({
                    id: `${cls.id}-${iso}-exception`,
                    dateISO: iso,
                    date: this.formatDisplayDate(cursor),
                    week: Math.floor((cursor - start) / (7 * 24 * 60 * 60 * 1000)) + 1,
                    classNumber: null,
                    isInstructional: false,
                    exceptionType: exception.type,
                    exceptionDescription: exception.description,
                    students: [],
                });
            }
            if (!isMeetingDay) continue;
            if (exception) continue;
            instructionalDates.push({
                id: `${cls.id}-${iso}`,
                dateISO: iso,
                date: this.formatDisplayDate(cursor),
                isInstructional: true,
                exceptionType: "",
                exceptionDescription: "",
            });
        }

        let classNumber = 0;
        const instructionalWithNumbers = instructionalDates.map((entry) => {
            const cursor = new Date(`${entry.dateISO}T12:00:00`);
            classNumber += 1;
            const instructionalWeek = Math.floor((cursor - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
            const existing = existingByIso.get(entry.dateISO);
            return {
                ...entry,
                week: instructionalWeek,
                classNumber,
                students: existing ? existing.students : cls.roster.map((r) => createDefaultStudent({ id: r.id, name: r.name })),
            };
        });

        const generated = [...instructionalWithNumbers, ...exceptionDates]
            .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

        cls.dates = generated;
        const currentIdx = this.state.selectedDateIndexByClass[cls.id] ?? 0;
        if (generated.length === 0) {
            this.state.selectedDateIndexByClass[cls.id] = 0;
        } else {
            this.state.selectedDateIndexByClass[cls.id] = Math.max(0, Math.min(currentIdx, generated.length - 1));
        }
    }

    regenerateAllClassDates() {
        this.state.classes.forEach((cls) => this.regenerateClassDates(cls, true));
    }

    normalizeRoster(roster, dates, fallbackRoster) {
        if (Array.isArray(roster) && roster.length > 0) {
            return roster.map((r, i) => ({ id: Number(r.id) || i + 1, name: r.name || `Student ${i + 1}` }));
        }
        const fromDates = [];
        (dates || []).forEach((d) => {
            (d.students || []).forEach((s) => {
                if (!fromDates.some((r) => r.id === s.id)) fromDates.push({ id: Number(s.id), name: s.name });
            });
        });
        if (fromDates.length > 0) return fromDates;
        return fallbackRoster.map((r) => ({ ...r }));
    }

    normalizeStudentRecord(student, index, roster) {
        const rosterMatch = roster.find((r) => r.id === Number(student.id));
        const base = createDefaultStudent({
            id: Number(student.id) || (rosterMatch ? rosterMatch.id : index + 1),
            name: rosterMatch ? rosterMatch.name : (student.name || `Student ${index + 1}`),
        });
        return {
            ...base,
            ...student,
            id: base.id,
            name: base.name,
            evaluation: { ...base.evaluation, ...(student.evaluation || {}) },
        };
    }

    tryMigrateLegacyData() {
        let legacyStudents = null;
        for (const key of this.legacyStorageKeys) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    legacyStudents = parsed;
                    break;
                }
            } catch (_) {
                continue;
            }
        }
        if (!legacyStudents) return;
        const cls = this.state.classes[0];
        const dateIndex = this.state.selectedDateIndexByClass[cls.id] ?? 1;
        const dateRecord = cls.dates[dateIndex];
        if (!dateRecord) return;
        dateRecord.students = dateRecord.students.map((student) => {
            const match = legacyStudents.find((s) => s.name === student.name || s.StudentName === student.name);
            if (!match) return student;
            return this.normalizeStudentRecord({
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
            }, 0, cls.roster);
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
        if (!cls || !cls.dates || cls.dates.length === 0) return null;
        return cls.dates[Math.max(0, Math.min(idx, cls.dates.length - 1))];
    }

    currentStudents() {
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) return [];
        return date.students || [];
    }

    selectedKey() {
        const date = this.currentDateRecord();
        return `${this.currentClass().id}:${date ? date.id : "no-date"}`;
    }

    currentStudent() {
        const id = this.selectedStudentByClassDate[this.selectedKey()];
        return this.currentStudents().find((s) => s.id === id) || null;
    }

    ensureSelectedStudent(forceFirst = false) {
        const key = this.selectedKey();
        const students = this.currentStudents();
        if (students.length === 0) return;
        const id = this.selectedStudentByClassDate[key];
        if (forceFirst || !students.some((s) => s.id === id)) {
            this.selectedStudentByClassDate[key] = students[0].id;
        }
    }

    currentProject(cls = this.currentClass()) {
        return cls.projects.find((p) => p.id === cls.currentProjectId) || cls.projects[0] || null;
    }

    bindGlobalControls() {
        document.getElementById("navToday").addEventListener("click", () => this.switchPage("today"));
        document.getElementById("navSetup").addEventListener("click", () => this.switchPage("setup"));
        document.getElementById("setupHeaderCalendar").addEventListener("click", () => this.toggleSetupSection("calendar"));
        document.getElementById("setupHeaderClasses").addEventListener("click", () => this.toggleSetupSection("classes"));
        document.getElementById("setupHeaderRoster").addEventListener("click", () => this.toggleSetupSection("roster"));
        document.getElementById("setupHeaderSyllabus").addEventListener("click", () => this.toggleSetupSection("syllabus"));
        document.getElementById("setupHeaderProjects").addEventListener("click", () => this.toggleSetupSection("projects"));

        document.getElementById("classSelect").addEventListener("change", (e) => {
            this.state.selectedClassId = e.target.value;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        document.getElementById("prevDateBtn").addEventListener("click", () => this.shiftDate(-1));
        document.getElementById("nextDateBtn").addEventListener("click", () => this.shiftDate(1));
        document.getElementById("todayDateBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            this.state.selectedDateIndexByClass[cls.id] = Math.min(1, cls.dates.length - 1);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        document.getElementById("resetCurrentClassBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            if (!window.confirm(`Reset all test data for ${cls.code} · ${cls.name}?`)) return;
            const fresh = this.createInitialState();
            const replacement = fresh.classes.find((c) => c.id === cls.id);
            const idx = this.state.classes.findIndex((c) => c.id === cls.id);
            this.state.classes[idx] = replacement;
            this.state.selectedDateIndexByClass[cls.id] = 1;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        document.getElementById("resetAllDataBtn").addEventListener("click", () => {
            if (!window.confirm("Reset ALL pilot test data for all classes and dates?")) return;
            this.state = this.createInitialState();
            this.selectedStudentByClassDate = {};
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });
    }

    switchPage(page) {
        this.page = page;
        this.render();
    }

    toggleSetupSection(section) {
        this.setupOpenSection = this.setupOpenSection === section ? null : section;
        this.renderSetupSectionState();
    }

    shiftDate(delta) {
        const cls = this.currentClass();
        if (!cls.dates || cls.dates.length === 0) return;
        const next = Math.max(0, Math.min(cls.dates.length - 1, this.currentDateIndex() + delta));
        this.state.selectedDateIndexByClass[cls.id] = next;
        this.ensureSelectedStudent(true);
        this.saveState();
        this.render();
    }

    render() {
        this.ensureSelectedStudent();
        const todayScreen = document.getElementById("todayScreen");
        const setupScreen = document.getElementById("setupScreen");
        const navToday = document.getElementById("navToday");
        const navSetup = document.getElementById("navSetup");

        if (this.page === "setup") {
            todayScreen.classList.add("hidden");
            setupScreen.classList.remove("hidden");
            navToday.classList.remove("active");
            navSetup.classList.add("active");
            this.renderSetup();
        } else {
            setupScreen.classList.add("hidden");
            todayScreen.classList.remove("hidden");
            navSetup.classList.remove("active");
            navToday.classList.add("active");
            this.renderToday();
        }
    }

    renderToday() {
        this.renderTopControls();
        this.renderSummary();
        this.renderFollowUps();
        this.renderTable();
        this.renderPanel();
    }

    renderTopControls() {
        const cls = this.currentClass();
        const select = document.getElementById("classSelect");
        select.innerHTML = this.state.classes
            .map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${c.code} · ${c.name}</option>`)
            .join("");

        const idx = this.currentDateIndex();
        const dates = cls.dates || [];
        const cur = dates.length > 0 ? dates[Math.max(0, Math.min(idx, dates.length - 1))] : null;
        const prev = cur ? dates[Math.max(0, Math.min(idx - 1, dates.length - 1))] : null;
        const next = cur ? dates[Math.max(0, Math.min(idx + 1, dates.length - 1))] : null;
        const curLabel = cur
            ? (cur.isInstructional === false
                ? `${cur.date} (today · NO CLASS)`
                : `${cur.date} (today)`)
            : "No generated class meetings in selected range.";
        document.getElementById("dateContext").textContent = cur
            ? `${prev.date} (prev) · ${curLabel} · ${next.date} (next)`
            : "No generated class meetings in selected range.";

        const project = this.currentProject(cls);
        document.getElementById("courseTitle").textContent = `${cls.code} · ${cls.name}`;
        document.getElementById("classDate").textContent = cur
            ? (cur.isInstructional === false
                ? `${cur.date}`
                : cur.date)
            : "No class date available";
        document.getElementById("classWeek").textContent = cur
            ? (cur.isInstructional === false
                ? `NO CLASS — ${cur.exceptionDescription || cur.exceptionType} · ${cls.meetingDays.join(" / ")}`
                : `Week ${cur.week} · Class ${cur.classNumber} · ${cls.meetingDays.join(" / ")}`)
            : `No meeting dates · ${cls.meetingDays.join(" / ")}`;
        document.getElementById("projectTitle").textContent = project ? project.name : "No active project";
        document.getElementById("projectMilestone").textContent = project?.nextMilestone || "Not set";
    }

    renderSummary() {
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) {
            document.getElementById("metricStudents").textContent = "—";
            document.getElementById("metricNeedHelp").textContent = "—";
            document.getElementById("metricAtRisk").textContent = "—";
            document.getElementById("metricFollowUps").textContent = "—";
            return;
        }
        const students = this.currentStudents();
        const needHelp = students.filter((s) => s.overallStatus === "Needs Help").length;
        const atRisk = students.filter((s) => s.attendance !== "Present" && (s.overallStatus === "Needs Help" || s.followUp === "Next Class")).length;
        const followUps = students.filter((s) => s.followUp === "Next Class").length;
        document.getElementById("metricStudents").textContent = String(students.length);
        document.getElementById("metricNeedHelp").textContent = String(needHelp);
        document.getElementById("metricAtRisk").textContent = String(atRisk);
        document.getElementById("metricFollowUps").textContent = String(followUps);
    }

    renderFollowUps() {
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) {
            const hostNoClass = document.getElementById("followUpsDue");
            hostNoClass.innerHTML = `<span class="project-subtitle">NO CLASS — ${this.escapeHtml(date?.exceptionDescription || date?.exceptionType || "")}</span>`;
            return;
        }
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
        const date = this.currentDateRecord();
        if (!date) {
            tbody.innerHTML = '<tr><td colspan="7">No class date available.</td></tr>';
            return;
        }
        if (date.isInstructional === false) {
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px 8px;">${this.escapeHtml(date.date)}<br><strong>NO CLASS — ${this.escapeHtml(date.exceptionDescription || date.exceptionType || "Scheduled exception")}</strong></td></tr>`;
            return;
        }
        const selectedId = this.selectedStudentByClassDate[this.selectedKey()];
        tbody.innerHTML = "";
        this.currentStudents().forEach((s) => {
            const tr = document.createElement("tr");
            tr.className = `student-row ${s.id === selectedId ? "selected" : ""}`;
            const note = s.classNote?.trim() ? s.classNote.trim() : "—";
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
                this.selectedStudentByClassDate[this.selectedKey()] = s.id;
                this.renderTable();
                this.renderPanel();
            });
            tbody.appendChild(tr);
        });
    }

    options(list, selected) {
        return list.map((o) => `<option value="${this.escapeHtml(o)}" ${o === selected ? "selected" : ""}>${this.escapeHtml(o)}</option>`).join("");
    }

    renderPanel() {
        const panel = document.getElementById("studentPanel");
        const student = this.currentStudent();
        const classDate = this.currentDateRecord();
        if (!classDate) {
            panel.innerHTML = '<div class="panel-placeholder">No class date generated. Update semester dates and meeting days in Setup.</div>';
            return;
        }
        if (classDate.isInstructional === false) {
            panel.innerHTML = `<div class="panel-placeholder" style="text-align:center;padding-top:50px;">${this.escapeHtml(classDate.date)}<br><strong>NO CLASS — ${this.escapeHtml(classDate.exceptionDescription || classDate.exceptionType || "Scheduled exception")}</strong></div>`;
            return;
        }
        if (!student) {
            panel.innerHTML = '<div class="panel-placeholder">Select a student from the table.</div>';
            return;
        }
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
                    <div style="grid-column: 1 / -1;">Last note: <strong>${this.escapeHtml(student.classNote || "No note")}</strong></div>
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
        panel.querySelectorAll("select[data-field]").forEach((el) => {
            el.addEventListener("change", (e) => {
                this.updateField(e.target.getAttribute("data-field"), e.target.value);
                this.renderToday();
            });
        });
        panel.querySelectorAll("textarea[data-field]").forEach((el) => {
            el.addEventListener("input", (e) => {
                this.updateField(e.target.getAttribute("data-field"), e.target.value, false);
            });
            el.addEventListener("blur", () => this.renderToday());
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
        this.saveState();
        if (rerender) this.render();
    }

    // Setup
    renderSetup() {
        this.renderSetupSectionState();
        const cls = this.currentClass();
        document.getElementById("setupEditingContext").textContent = `${cls.code} · ${cls.name}`;
        this.renderSetupCalendar();
        this.renderSetupClassEditor();
        this.renderSetupRoster();
        this.renderSetupSyllabus();
        this.renderSetupProjects();
    }

    renderSetupSectionState() {
        const sectionMap = [
            { key: "calendar", header: "setupHeaderCalendar", body: "setupBodyCalendar" },
            { key: "classes", header: "setupHeaderClasses", body: "setupBodyClasses" },
            { key: "roster", header: "setupHeaderRoster", body: "setupBodyRoster" },
            { key: "syllabus", header: "setupHeaderSyllabus", body: "setupBodySyllabus" },
            { key: "projects", header: "setupHeaderProjects", body: "setupBodyProjects" },
        ];
        sectionMap.forEach((item) => {
            const header = document.getElementById(item.header);
            const body = document.getElementById(item.body);
            const expanded = this.setupOpenSection === item.key;
            body.classList.toggle("hidden", !expanded);
            header.setAttribute("aria-expanded", expanded ? "true" : "false");
            const indicator = header.querySelector(".setup-indicator");
            if (indicator) indicator.textContent = expanded ? "−" : "+";
        });
    }

    renderSetupCalendar() {
        const cal = this.state.academicCalendar;
        document.getElementById("semesterName").value = cal.semesterName || "";
        document.getElementById("semesterStart").value = cal.semesterStartDate || "";
        document.getElementById("semesterEnd").value = cal.semesterEndDate || "";

        const host = document.getElementById("calendarExceptionsList");
        host.innerHTML = "";
        cal.exceptions.forEach((ex) => {
            const item = document.createElement("div");
            item.className = "exception-item";
            item.innerHTML = `
                <div class="setup-grid setup-grid-3">
                    <div><input data-ex-id="${ex.id}" data-ex-field="date" type="date" value="${this.escapeHtml(ex.date)}"></div>
                    <div>
                        <select data-ex-id="${ex.id}" data-ex-field="type">
                            ${["No Class", "University Holiday", "Break"].map((t) => `<option value="${t}" ${t === ex.type ? "selected" : ""}>${t}</option>`).join("")}
                        </select>
                    </div>
                    <div><input data-ex-id="${ex.id}" data-ex-field="description" type="text" value="${this.escapeHtml(ex.description)}"></div>
                </div>
                <div class="setup-actions">
                    <button type="button" data-delete-ex="${ex.id}">Delete</button>
                </div>
            `;
            host.appendChild(item);
        });

        document.querySelectorAll("[data-ex-field]").forEach((el) => {
            el.addEventListener("change", (e) => {
                const id = e.target.getAttribute("data-ex-id");
                const field = e.target.getAttribute("data-ex-field");
                const ex = this.state.academicCalendar.exceptions.find((x) => x.id === id);
                if (!ex) return;
                ex[field] = e.target.value;
                this.regenerateAllClassDates();
                this.saveState();
                this.renderToday();
            });
        });

        document.querySelectorAll("[data-delete-ex]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-delete-ex");
                this.state.academicCalendar.exceptions = this.state.academicCalendar.exceptions.filter((x) => x.id !== id);
                this.regenerateAllClassDates();
                this.saveState();
                this.renderSetupCalendar();
                this.renderToday();
            });
        });

        document.getElementById("semesterName").oninput = (e) => {
            this.state.academicCalendar.semesterName = e.target.value;
            this.saveState();
        };
        document.getElementById("semesterStart").onchange = (e) => {
            this.state.academicCalendar.semesterStartDate = e.target.value;
            this.saveState();
        };
        document.getElementById("semesterEnd").onchange = (e) => {
            this.state.academicCalendar.semesterEndDate = e.target.value;
            this.saveState();
        };
        document.getElementById("addExceptionBtn").onclick = () => {
            const date = document.getElementById("newExceptionDate").value;
            const type = document.getElementById("newExceptionType").value;
            const description = document.getElementById("newExceptionDescription").value.trim();
            if (!date || !description) return;
            const id = `ex${this.state.academicCalendar.nextExceptionId++}`;
            this.state.academicCalendar.exceptions.push({ id, date, type, description });
            document.getElementById("newExceptionDescription").value = "";
            this.regenerateAllClassDates();
            this.saveState();
            this.renderSetupCalendar();
            this.renderToday();
        };
    }

    renderSetupClassEditor() {
        const cls = this.currentClass();
        const select = document.getElementById("setupClassSelect");
        select.innerHTML = this.state.classes
            .map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${c.code} · ${c.name}</option>`)
            .join("");
        select.onchange = (e) => {
            this.state.selectedClassId = e.target.value;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };

        document.getElementById("setupCourseCode").value = cls.code;
        document.getElementById("setupCourseName").value = cls.name;
        document.getElementById("setupClassStart").value = cls.semesterStartDate || "";
        document.getElementById("setupClassEnd").value = cls.semesterEndDate || "";

        const dayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri"];
        const dayHost = document.getElementById("meetingDaysGroup");
        dayHost.innerHTML = dayOptions.map((d) => `
            <label><input type="checkbox" data-day="${d}" ${cls.meetingDays.includes(d) ? "checked" : ""}>${d}</label>
        `).join("");
        dayHost.querySelectorAll("[data-day]").forEach((el) => {
            el.addEventListener("change", () => {
                cls.meetingDays = Array.from(dayHost.querySelectorAll("[data-day]:checked")).map((x) => x.getAttribute("data-day"));
                this.regenerateClassDates(cls, true);
                this.ensureSelectedStudent(true);
                this.saveState();
                this.render();
            });
        });

        document.getElementById("setupCourseCode").oninput = (e) => {
            cls.code = e.target.value;
            this.saveState();
            this.renderToday();
        };
        document.getElementById("setupCourseName").oninput = (e) => {
            cls.name = e.target.value;
            this.saveState();
            this.renderToday();
        };
        document.getElementById("setupClassStart").onchange = (e) => {
            cls.semesterStartDate = e.target.value;
            this.regenerateClassDates(cls, true);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };
        document.getElementById("setupClassEnd").onchange = (e) => {
            cls.semesterEndDate = e.target.value;
            this.regenerateClassDates(cls, true);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };

        document.getElementById("addClassBtn").onclick = () => {
            const id = `class${Date.now()}`;
            const newClass = {
                id,
                code: "NEW 000",
                name: "New Class",
                meetingDays: ["Mon"],
                semesterStartDate: this.state.academicCalendar.semesterStartDate || "",
                semesterEndDate: this.state.academicCalendar.semesterEndDate || "",
                roster: [],
                nextStudentId: 1,
                syllabus: { title: "", notes: "" },
                projects: [{
                    id: `${id}-p1`,
                    name: "New Project",
                    startDate: "",
                    dueDate: "",
                    nextMilestone: "",
                    notes: "",
                }],
                currentProjectId: `${id}-p1`,
                dates: [],
            };
            this.regenerateClassDates(newClass, true);
            this.state.classes.push(newClass);
            this.state.selectedClassId = id;
            this.state.selectedDateIndexByClass[id] = 0;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };
    }

    syncClassRosterWithDates(cls) {
        cls.dates.forEach((dateRecord) => {
            const existingById = Object.fromEntries(dateRecord.students.map((s) => [Number(s.id), s]));
            dateRecord.students = cls.roster.map((r) => {
                const existing = existingById[Number(r.id)];
                if (!existing) return createDefaultStudent({ id: r.id, name: r.name });
                return { ...existing, id: r.id, name: r.name };
            });
        });
    }

    renderSetupRoster() {
        const cls = this.currentClass();
        this.syncClassRosterWithDates(cls);
        const host = document.getElementById("rosterList");
        host.innerHTML = "";
        cls.roster.forEach((r) => {
            const item = document.createElement("div");
            item.className = "roster-item";
            item.innerHTML = `
                <div class="setup-grid setup-grid-2">
                    <div><input type="text" value="${this.escapeHtml(r.name)}" data-roster-id="${r.id}"></div>
                    <div class="setup-actions"><button type="button" data-remove-roster="${r.id}">Remove</button></div>
                </div>
            `;
            host.appendChild(item);
        });

        host.querySelectorAll("[data-roster-id]").forEach((el) => {
            el.addEventListener("input", (e) => {
                const id = Number(e.target.getAttribute("data-roster-id"));
                const student = cls.roster.find((s) => s.id === id);
                if (!student) return;
                student.name = e.target.value;
                this.syncClassRosterWithDates(cls);
                this.saveState();
                this.renderToday();
            });
        });

        host.querySelectorAll("[data-remove-roster]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = Number(el.getAttribute("data-remove-roster"));
                cls.roster = cls.roster.filter((s) => s.id !== id);
                this.syncClassRosterWithDates(cls);
                this.ensureSelectedStudent(true);
                this.saveState();
                this.render();
            });
        });

        document.getElementById("addStudentBtn").onclick = () => {
            const name = document.getElementById("newStudentName").value.trim();
            if (!name) return;
            const student = { id: cls.nextStudentId++, name };
            cls.roster.push(student);
            this.syncClassRosterWithDates(cls);
            document.getElementById("newStudentName").value = "";
            this.saveState();
            this.render();
        };
    }

    renderSetupSyllabus() {
        const cls = this.currentClass();
        const title = document.getElementById("syllabusTitle");
        const notes = document.getElementById("syllabusNotes");
        title.value = cls.syllabus.title || "";
        notes.value = cls.syllabus.notes || "";
        title.oninput = (e) => {
            cls.syllabus.title = e.target.value;
            this.saveState();
        };
        notes.oninput = (e) => {
            cls.syllabus.notes = e.target.value;
            this.saveState();
        };
    }

    renderSetupProjects() {
        const cls = this.currentClass();
        const host = document.getElementById("projectsList");
        host.innerHTML = "";
        cls.projects.forEach((p) => {
            const item = document.createElement("div");
            item.className = `project-item ${p.id === cls.currentProjectId ? "current-project" : ""}`;
            item.innerHTML = `
                <div class="setup-grid setup-grid-5">
                    <div><input type="text" value="${this.escapeHtml(p.name)}" data-proj-id="${p.id}" data-proj-field="name"></div>
                    <div><input type="date" value="${this.escapeHtml(p.startDate)}" data-proj-id="${p.id}" data-proj-field="startDate"></div>
                    <div><input type="date" value="${this.escapeHtml(p.dueDate)}" data-proj-id="${p.id}" data-proj-field="dueDate"></div>
                    <div><input type="text" value="${this.escapeHtml(p.nextMilestone)}" data-proj-id="${p.id}" data-proj-field="nextMilestone"></div>
                    <div class="setup-actions">
                        <button type="button" data-current-proj="${p.id}">Set as Current</button>
                        <button type="button" data-delete-proj="${p.id}">Delete</button>
                    </div>
                </div>
                <div class="setup-grid setup-grid-1">
                    <div><textarea data-proj-id="${p.id}" data-proj-field="notes">${this.escapeHtml(p.notes || "")}</textarea></div>
                </div>
            `;
            host.appendChild(item);
        });

        host.querySelectorAll("[data-proj-field]").forEach((el) => {
            const evt = el.tagName === "TEXTAREA" ? "input" : "change";
            el.addEventListener(evt, (e) => {
                const id = e.target.getAttribute("data-proj-id");
                const field = e.target.getAttribute("data-proj-field");
                const proj = cls.projects.find((x) => x.id === id);
                if (!proj) return;
                proj[field] = e.target.value;
                this.saveState();
                this.renderToday();
            });
        });

        host.querySelectorAll("[data-current-proj]").forEach((el) => {
            el.addEventListener("click", () => {
                cls.currentProjectId = el.getAttribute("data-current-proj");
                this.saveState();
                this.render();
            });
        });

        host.querySelectorAll("[data-delete-proj]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-delete-proj");
                cls.projects = cls.projects.filter((p) => p.id !== id);
                if (cls.currentProjectId === id) cls.currentProjectId = cls.projects[0] ? cls.projects[0].id : null;
                this.saveState();
                this.render();
            });
        });

        document.getElementById("addProjectBtn").onclick = () => {
            const name = document.getElementById("projectName").value.trim();
            if (!name) return;
            const id = `${cls.id}-p${Date.now()}`;
            cls.projects.push({
                id,
                name,
                startDate: document.getElementById("projectStart").value,
                dueDate: document.getElementById("projectDue").value,
                nextMilestone: document.getElementById("projectMilestoneInput").value.trim(),
                notes: document.getElementById("projectNotes").value,
            });
            if (!cls.currentProjectId) cls.currentProjectId = id;
            document.getElementById("projectName").value = "";
            document.getElementById("projectStart").value = "";
            document.getElementById("projectDue").value = "";
            document.getElementById("projectMilestoneInput").value = "";
            document.getElementById("projectNotes").value = "";
            this.saveState();
            this.render();
        };
    }
}

document.addEventListener("DOMContentLoaded", () => {
    window.studioOSApp = new StudioOSApp();
});
