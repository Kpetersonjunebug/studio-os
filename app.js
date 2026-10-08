class StudioOSApp {
    constructor() {
        this.storageKey = "studioOS_pilot_v3_followups";
        this.backupStorageKey = "studioOS_pilot_backup_latest";
        this.backupSchema = "studio-os-pilot-backup-v1";
        this.legacyStorageKeys = ["studioOS_pilot_v2_setup", "studioOS_pilot_v1", "studioOS_students"];
        this.state = null;
        this.selectedStudentByClassDate = {};
        this.rosterCsvDraft = null;
        this.rosterImportResult = null;
        this.rosterCollapsed = false;
        this.classEvalCollapsed = true;
        this.classEvalBodyMarkup = document.getElementById("classEvalBody")?.innerHTML || "";
        this.page = "today";
        this.setupOpenSection = "classes";
        this.cloudSync = null;
        this.cloudSyncTimer = null;
        this.cloudSyncBusy = false;
        this.init();
    }

    init() {
        this.loadState();
        this.bindGlobalControls();
        this.render();
        this.initializeCloudSync();
    }

    loadState() {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
            try {
                const parsedState = JSON.parse(raw);
                const preservePreMigration = (Number(parsedState.followUpReconciliationVersion) || 0) < 1;
                if (preservePreMigration) this.saveBackupSnapshot(parsedState, "pre-migration");
                this.state = this.normalizeState(parsedState);
                this.regenerateAllClassDates();
                this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
                this.reconcileLegacyFollowUps();
                this.saveState(!preservePreMigration);
                return;
            } catch (err) {
                console.error("Failed to parse current state, attempting legacy migration.", err);
            }
        }
        this.state = this.createInitialState();
        this.tryMigrateLegacyData();
        this.regenerateAllClassDates();
        this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
        this.reconcileLegacyFollowUps();
        this.saveState();
    }

    saveState(updateBackup = true, scheduleCloudSync = true) {
        const serialized = JSON.stringify(this.state);
        localStorage.setItem(this.storageKey, serialized);
        if (updateBackup) this.saveBackupSnapshot(this.state, "automatic");
        if (scheduleCloudSync) this.scheduleCloudRosterSync();
    }

    cloudSyncMetaKey() {
        return this.cloudSync?.user ? `studioOS_classes_students_projects_sync_v2_${this.cloudSync.user.id}` : "";
    }

    readCloudSyncFingerprint() {
        const key = this.cloudSyncMetaKey();
        if (!key) return "";
        try {
            return JSON.parse(localStorage.getItem(key) || "{}").fingerprint || "";
        } catch (_) {
            return "";
        }
    }

    saveCloudSyncFingerprint(fingerprint) {
        const key = this.cloudSyncMetaKey();
        if (!key) return;
        localStorage.setItem(key, JSON.stringify({ fingerprint, syncedAt: new Date().toISOString() }));
    }

    updateCloudSyncStatus(kind, message) {
        const status = document.getElementById("cloudSyncStatus");
        if (status) {
            status.className = `cloud-sync-status status-${kind}`;
            status.textContent = message;
        }
        this.renderCloudSyncControls();
    }

    renderCloudSyncControls() {
        const configured = Boolean(this.cloudSync?.isConfigured());
        const signedIn = Boolean(this.cloudSync?.user);
        const emailInput = document.getElementById("cloudSyncEmail");
        const signInButton = document.getElementById("cloudSyncSignInBtn");
        const syncButton = document.getElementById("cloudSyncNowBtn");
        const signOutButton = document.getElementById("cloudSyncSignOutBtn");
        if (!emailInput || !signInButton || !syncButton || !signOutButton) return;
        emailInput.disabled = !configured || signedIn;
        signInButton.classList.toggle("hidden", signedIn);
        signInButton.disabled = !configured;
        syncButton.classList.toggle("hidden", !signedIn);
        syncButton.disabled = this.cloudSyncBusy;
        signOutButton.classList.toggle("hidden", !signedIn);
    }

    async initializeCloudSync() {
        if (!window.StudioOSCloudSync) return;
        this.cloudSync = new window.StudioOSCloudSync({
            config: window.STUDIO_OS_SUPABASE,
            supabaseLibrary: window.supabase,
            onStatus: (kind, message) => this.updateCloudSyncStatus(kind, message),
        });
        try {
            const user = await this.cloudSync.initialize();
            this.renderCloudSyncControls();
            if (user) await this.syncClassesAndStudents();
        } catch (err) {
            console.error("Studio OS cloud initialization failed; continuing locally.", err);
            this.updateCloudSyncStatus("error", "Cloud unavailable — working locally");
        }
    }

    scheduleCloudRosterSync() {
        if (!this.cloudSync?.user || this.cloudSyncBusy) return;
        window.clearTimeout(this.cloudSyncTimer);
        this.cloudSyncTimer = window.setTimeout(() => this.syncClassesAndStudents(), 900);
    }

    createCloudClassShell(id) {
        return {
            id,
            code: "NEW 000",
            name: "New Class",
            meetingDays: ["Mon"],
            roster: [],
            nextStudentId: 1,
            syllabus: { title: "", notes: "" },
            classEvaluation: {
                classPace: "On Schedule",
                overallUnderstanding: "Adequate",
                conceptsToReview: "",
                projectChanges: "",
            },
            projects: [{ id: `${id}-p1`, name: "New Project", startDate: "", dueDate: "", nextMilestone: "", notes: "" }],
            currentProjectId: `${id}-p1`,
            dates: [],
        };
    }

    applyCloudRosterSnapshot(snapshot) {
        const previousSelectedClassId = this.state.selectedClassId;
        this.saveBackupSnapshot(this.state, "pre-cloud-classes-students-merge");
        window.StudioOSCloudSync.mergeSnapshot(this.state, snapshot, (id) => this.createCloudClassShell(id));
        this.regenerateAllClassDates();
        this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
        this.state.selectedClassId = this.state.classes.some((cls) => cls.id === previousSelectedClassId)
            ? previousSelectedClassId
            : (this.state.classes[0]?.id || "");
        this.ensureSelectedStudent(true);
        this.saveState(false, false);
        this.render();
    }

    async syncClassesAndStudents() {
        if (!this.cloudSync?.user || this.cloudSyncBusy) return;
        this.cloudSyncBusy = true;
        this.updateCloudSyncStatus("syncing", "Syncing Classes, Students + Projects…");
        try {
            const localSnapshot = window.StudioOSCloudSync.buildSnapshot(this.state);
            const remoteSnapshot = await this.cloudSync.fetchSnapshot();
            const localFingerprint = window.StudioOSCloudSync.canonicalSnapshot(localSnapshot);
            const remoteFingerprint = window.StudioOSCloudSync.canonicalSnapshot(remoteSnapshot);
            const lastFingerprint = this.readCloudSyncFingerprint();

            const remoteProjectsInitialized = remoteSnapshot.some((cls) => Number(cls.projectSyncVersion) >= 1);
            if (remoteSnapshot.length === 0) {
                await this.cloudSync.pushSnapshot(localSnapshot);
                this.saveCloudSyncFingerprint(localFingerprint);
                this.updateCloudSyncStatus("synced", "Classes, Students + Projects synced");
                return true;
            }

            if (!remoteProjectsInitialized) {
                const bootstrapSnapshot = window.StudioOSCloudSync.buildProjectBootstrapSnapshot(localSnapshot, remoteSnapshot);
                await this.cloudSync.pushSnapshot(bootstrapSnapshot);
                this.applyCloudRosterSnapshot(bootstrapSnapshot);
                this.saveCloudSyncFingerprint(window.StudioOSCloudSync.canonicalSnapshot(bootstrapSnapshot));
                this.updateCloudSyncStatus("synced", "Classes, Students + Projects synced");
                return true;
            }

            if (!lastFingerprint || localFingerprint === lastFingerprint) {
                this.applyCloudRosterSnapshot(remoteSnapshot);
                this.saveCloudSyncFingerprint(remoteFingerprint);
                this.updateCloudSyncStatus("synced", "Classes, Students + Projects synced");
                return true;
            }

            if (remoteFingerprint === lastFingerprint) {
                await this.cloudSync.pushSnapshot(localSnapshot);
                this.saveCloudSyncFingerprint(localFingerprint);
                this.updateCloudSyncStatus("synced", "Classes, Students + Projects synced");
                return true;
            }

            if (localFingerprint === remoteFingerprint) {
                this.saveCloudSyncFingerprint(localFingerprint);
                this.updateCloudSyncStatus("synced", "Classes, Students + Projects synced");
                return true;
            }

            this.updateCloudSyncStatus("conflict", "Sync paused — cloud data changed on two devices");
            return false;
        } catch (err) {
            console.error("Studio OS cloud sync failed; local data is still saved.", err);
            this.updateCloudSyncStatus("error", "Cloud sync failed — local data is safe");
            return false;
        } finally {
            this.cloudSyncBusy = false;
            this.renderCloudSyncControls();
        }
    }

    isValidPilotState(state) {
        return !!state && typeof state === "object" &&
            !!state.academicCalendar && typeof state.academicCalendar === "object" &&
            Array.isArray(state.classes) &&
            Array.isArray(state.followUps) &&
            state.classes.every((cls) => cls && typeof cls.id === "string" && Array.isArray(cls.roster) && Array.isArray(cls.dates));
    }

    createBackupEnvelope(state, reason = "manual") {
        return {
            schema: this.backupSchema,
            createdAt: new Date().toISOString(),
            reason,
            state,
        };
    }

    saveBackupSnapshot(state, reason = "automatic") {
        if (!this.isValidPilotState(state)) return false;
        try {
            const envelope = this.createBackupEnvelope(state, reason);
            localStorage.setItem(this.backupStorageKey, JSON.stringify(envelope));
            return true;
        } catch (err) {
            console.error("Unable to save Studio OS backup snapshot.", err);
            return false;
        }
    }

    parseBackupEnvelope(value) {
        const envelope = typeof value === "string" ? JSON.parse(value) : value;
        if (!envelope || envelope.schema !== this.backupSchema || !this.isValidPilotState(envelope.state)) {
            throw new Error("This file is not a valid Studio OS pilot backup.");
        }
        return envelope;
    }

    backupFilename() {
        const now = new Date();
        const pad = (value) => String(value).padStart(2, "0");
        return `Studio-OS-Pilot-Backup_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}.json`;
    }

    exportPilotBackup() {
        if (!this.isValidPilotState(this.state)) {
            window.alert("The current Studio OS pilot state is not valid and cannot be exported.");
            return;
        }
        const json = JSON.stringify(this.createBackupEnvelope(this.state, "manual-export"), null, 2);
        const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = this.backupFilename();
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    restorePilotState(backupState) {
        if (!this.isValidPilotState(backupState)) throw new Error("The backup does not contain a valid Studio OS pilot state.");
        this.saveBackupSnapshot(this.state, "pre-restore");
        this.state = this.normalizeState(JSON.parse(JSON.stringify(backupState)));
        this.regenerateAllClassDates();
        this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
        this.reconcileLegacyFollowUps();
        this.selectedStudentByClassDate = {};
        this.ensureSelectedStudent(true);
        this.saveState(false);
        this.render();
    }
    createInitialState() {
        const classDefs = [
            {
                id: "dsn100",
                code: "DSN 100",
                name: "Foundations",
                meetingDays: ["Mon", "Wed", "Fri"],
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
            const projects = [{
                id: `${def.id}-p1`,
                name: def.currentProject,
                startDate: "2026-08-24",
                dueDate: "2026-12-18",
                nextMilestone: def.nextMilestone,
                notes: "",
            }];
            const dates = def.dates.map((d, dateIndex) => ({
                id: `${def.id}-d${dateIndex + 1}`,
                dateISO: "",
                date: d.date,
                week: d.week,
                classNumber: d.classNumber,
                isInstructional: true,
                exceptionType: "",
                exceptionDescription: "",
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
                roster,
                nextStudentId: roster.length + 1,
                syllabus: def.syllabus,
                classEvaluation: {
                    classPace: "On Schedule",
                    overallUnderstanding: "Adequate",
                    conceptsToReview: "",
                    projectChanges: "",
                },
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
            followUps: [],
            nextFollowUpId: 1,
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
            delete classObj.semesterStartDate;
            delete classObj.semesterEndDate;
            delete classObj.firstClassDate;
            classObj.currentProjectId = classObj.currentProjectId || (classObj.projects[0] ? classObj.projects[0].id : null);
            classObj.dates = this.normalizeDates(c.dates, f.dates, classObj.roster);
            classObj.classEvaluation = this.normalizeStickyClassEvaluation(c.classEvaluation, classObj.dates);
            this.syncClassRosterWithDates(classObj);
            return classObj;
        });

        const followUps = (state.followUps || []).map((f) => {
            const cls = classes.find((c) => c.id === (f.classId || ""));
            const originRecord = cls?.dates.find((d) => d.id === f.originDateId || d.dateISO === f.originDateISO);
            const dueRecord = cls?.dates.find((d) => d.id === f.dueDateId || d.dateISO === f.dueDateISO);
            const rawStatus = String(f.status || "open").toLowerCase();
            return {
                id: Number(f.id),
                classId: f.classId || "",
                studentId: Number(f.studentId),
                originDateId: f.originDateId || originRecord?.id || "",
                originDateISO: f.originDateISO || f.originDate || originRecord?.dateISO || "",
                originDateText: f.originDateText || originRecord?.date || "",
                originNote: f.originNote || f.followUpNote || "",
                dueDateId: f.dueDateId || dueRecord?.id || "",
                dueDateISO: f.dueDateISO || f.dueDate || dueRecord?.dateISO || "",
                status: rawStatus === "complete" || rawStatus === "completed"
                    ? "complete"
                    : (rawStatus === "cancelled" || rawStatus === "canceled" ? "cancelled" : "open"),
                completionDateISO: f.completionDateISO || "",
                completionDateText: f.completionDateText || "",
            };
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
            followUps,
            nextFollowUpId: Math.max(Number(state.nextFollowUpId) || 1, ...followUps.map((f) => (Number(f.id) || 0) + 1)),
            followUpReconciliationVersion: Number(state.followUpReconciliationVersion) || 0,
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
            brief: p.brief?.storagePath ? {
                storagePath: String(p.brief.storagePath),
                fileName: String(p.brief.fileName || "Project brief"),
                contentType: String(p.brief.contentType || "application/octet-stream"),
                size: Number(p.brief.size) || 0,
                uploadedAt: String(p.brief.uploadedAt || ""),
            } : null,
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
            classEvaluation: this.normalizeClassEvaluation(d.classEvaluation),
            students: (d.isInstructional === false ? [] : (d.students || []).map((s, i) => this.normalizeStudentRecord(s, i, roster))),
        }));
    }

    normalizeClassEvaluation(existing) {
        return {
            classStatus: existing?.classStatus || "",
            overallUnderstanding: existing?.overallUnderstanding || "",
            conceptsToReview: existing?.conceptsToReview || "",
            projectChanges: existing?.projectChanges || "",
        };
    }

    normalizeStickyClassEvaluation(existing, dates = []) {
        const historical = dates
            .filter((d) => d.isInstructional !== false && d.classEvaluation)
            .filter((d) => Object.values(d.classEvaluation).some((value) => String(value || "").trim()))
            .sort((a, b) => String(b.dateISO || "").localeCompare(String(a.dateISO || "")))[0]?.classEvaluation || null;
        const source = existing && typeof existing === "object" ? existing : null;
        const has = (key) => !!source && Object.prototype.hasOwnProperty.call(source, key);
        const legacyPace = has("classStatus") ? source.classStatus : historical?.classStatus;
        const paceMap = {
            Excellent: "Ahead of Schedule",
            Good: "On Schedule",
            Mixed: "Slightly Behind",
            Challenging: "Behind Schedule",
        };

        return {
            classPace: has("classPace")
                ? source.classPace
                : (paceMap[legacyPace] || legacyPace || "On Schedule"),
            overallUnderstanding: has("overallUnderstanding")
                ? source.overallUnderstanding
                : (historical?.overallUnderstanding || "Adequate"),
            conceptsToReview: has("conceptsToReview")
                ? source.conceptsToReview
                : (historical?.conceptsToReview || ""),
            projectChanges: has("projectChanges")
                ? source.projectChanges
                : (historical?.projectChanges || ""),
        };
    }

    normalizeRoster(roster, dates, fallbackRoster) {
        if (Array.isArray(roster) && roster.length > 0) {
            return roster.map((r, i) => ({ id: Number(r.id) || i + 1, name: r.name || `Student ${i + 1}` }));
        }
        const fromDates = [];
        (dates || []).forEach((d) => {
            (d.students || []).forEach((s) => {
                if (!fromDates.some((r) => r.id === Number(s.id))) fromDates.push({ id: Number(s.id), name: s.name });
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

    dayToIndex(day) {
        return { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[day];
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
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    getRecordISO(record, cls) {
        if (record.dateISO) return record.dateISO;
        const fallbackYear = this.state?.academicCalendar?.semesterStartDate
            ? Number(this.state.academicCalendar.semesterStartDate.slice(0, 4))
            : new Date().getFullYear();
        return this.parseDisplayDateToISO(record.date, fallbackYear);
    }

    regenerateClassDates(cls, preserveRecords = true) {
        const semesterStart = this.state.academicCalendar?.semesterStartDate;
        const semesterEnd = this.state.academicCalendar?.semesterEndDate;
        const start = semesterStart ? new Date(`${semesterStart}T12:00:00`) : null;
        const end = semesterEnd ? new Date(`${semesterEnd}T12:00:00`) : null;
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
            if (!meetingDayIndexes.includes(cursor.getDay())) continue;
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
            const existing = existingByIso.get(entry.dateISO);
            return {
                ...entry,
                week: Math.floor((cursor - start) / (7 * 24 * 60 * 60 * 1000)) + 1,
                classNumber,
                classEvaluation: this.normalizeClassEvaluation(existing?.classEvaluation),
                students: existing ? existing.students : cls.roster.map((r) => createDefaultStudent({ id: r.id, name: r.name })),
            };
        });

        cls.dates = [...instructionalWithNumbers, ...exceptionDates].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
        const currentIdx = this.state.selectedDateIndexByClass[cls.id] ?? 0;
        this.state.selectedDateIndexByClass[cls.id] = cls.dates.length === 0 ? 0 : Math.max(0, Math.min(currentIdx, cls.dates.length - 1));
    }

    regenerateAllClassDates() {
        this.state.classes.forEach((cls) => this.regenerateClassDates(cls, true));
    }

    tryMigrateLegacyData() {
        let legacyState = null;
        for (const key of this.legacyStorageKeys) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === "object") {
                    legacyState = parsed;
                    break;
                }
            } catch (_) { continue; }
        }
        if (!legacyState) return;

        // migrate from v2 setup if present
        if (legacyState.classes && legacyState.academicCalendar) {
            this.state = this.normalizeState(legacyState);
            return;
        }

        // migrate from simple student array to first class/current date
        if (!Array.isArray(legacyState)) return;
        const cls = this.state.classes[0];
        const dateRecord = cls.dates[this.state.selectedDateIndexByClass[cls.id] ?? 1];
        if (!dateRecord) return;
        dateRecord.students = dateRecord.students.map((student) => {
            const match = legacyState.find((s) => s.name === student.name || s.StudentName === student.name);
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
        if (!this.state.classes || this.state.classes.length === 0) return null;
        return this.state.classes.find((c) => c.id === this.state.selectedClassId) || this.state.classes[0];
    }

    currentDateIndex() {
        const cls = this.currentClass();
        if (!cls) return 0;
        return this.state.selectedDateIndexByClass[cls.id] ?? 1;
    }

    currentDateRecord() {
        const cls = this.currentClass();
        const idx = this.currentDateIndex();
        if (!cls || !cls.dates || cls.dates.length === 0) return null;
        return cls.dates[Math.max(0, Math.min(idx, cls.dates.length - 1))];
    }

    todayDateIndexForClass(cls) {
        const dates = cls?.dates || [];
        if (dates.length === 0) return 0;

        const todayISO = this.toISO(new Date());
        const exactTodayIndex = dates.findIndex((date) => date.dateISO === todayISO);
        if (exactTodayIndex >= 0) return exactTodayIndex;

        const nextClassIndex = dates.findIndex((date) => date.isInstructional !== false && date.dateISO > todayISO);
        if (nextClassIndex >= 0) return nextClassIndex;

        for (let index = dates.length - 1; index >= 0; index -= 1) {
            if (dates[index].isInstructional !== false && dates[index].dateISO < todayISO) return index;
        }
        return 0;
    }

    selectTodayDateForClass(cls) {
        if (!cls) return;
        this.state.selectedDateIndexByClass[cls.id] = this.todayDateIndexForClass(cls);
    }

    currentStudents() {
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) return [];
        return date.students || [];
    }

    selectedKey() {
        const date = this.currentDateRecord();
        const cls = this.currentClass();
        if (!cls) return "no-class";
        return `${cls.id}:${date ? date.id : "no-date"}`;
    }

    currentStudent() {
        const id = this.selectedStudentByClassDate[this.selectedKey()];
        return this.currentStudents().find((s) => s.id === id) || null;
    }

    ensureSelectedStudent(forceFirst = false) {
        const students = this.currentStudents();
        if (students.length === 0) return;
        const key = this.selectedKey();
        const id = this.selectedStudentByClassDate[key];
        if (forceFirst || !students.some((s) => s.id === id)) this.selectedStudentByClassDate[key] = students[0].id;
    }

    currentProject(cls = this.currentClass()) {
        if (!cls) return null;
        return cls.projects.find((p) => p.id === cls.currentProjectId) || cls.projects[0] || null;
    }

    getFollowUpForStudent(classId, studentId, referenceDateISO = this.currentDateRecord()?.dateISO || "") {
        return this.state.followUps.find((f) =>
            f.classId === classId &&
            f.studentId === studentId &&
            f.status === "open" &&
            (!referenceDateISO || !f.originDateISO || f.originDateISO <= referenceDateISO)
        ) || null;
    }

    getDateByISO(cls, dateISO) {
        return cls.dates.find((d) => d.dateISO === dateISO) || null;
    }

    getNextInstructionalDate(cls, fromISO) {
        return cls.dates.find((d) => d.isInstructional !== false && d.dateISO > fromISO) || null;
    }

    getPreviousInstructionalDateRecord(cls, currentDateISO) {
        if (!cls || !currentDateISO) return null;
        let prev = null;
        cls.dates.forEach((d) => {
            if (d.isInstructional === false) return;
            if (d.dateISO < currentDateISO && (!prev || d.dateISO > prev.dateISO)) prev = d;
        });
        return prev;
    }

    reconcileLegacyFollowUps() {
        if (this.state.followUpReconciliationVersion >= 1) return;

        this.state.classes.forEach((cls) => {
            const selectedIndex = this.state.selectedDateIndexByClass[cls.id] ?? 0;
            const displayedDate = cls.dates[Math.max(0, Math.min(selectedIndex, Math.max(cls.dates.length - 1, 0)))];
            if (!displayedDate || displayedDate.isInstructional === false) return;

            cls.roster.forEach((rosterStudent) => {
                const studentId = rosterStudent.id;
                const openRecords = this.state.followUps.filter((f) =>
                    f.classId === cls.id && f.studentId === studentId && f.status === "open"
                );
                const validRecords = openRecords.filter((f) => {
                    const origin = this.getDateByISO(cls, f.originDateISO);
                    const due = this.getDateByISO(cls, f.dueDateISO);
                    return origin?.isInstructional !== false && !!origin &&
                        due?.isInstructional !== false && !!due &&
                        origin.dateISO <= displayedDate.dateISO &&
                        due.dateISO > origin.dateISO;
                });
                let canonical = validRecords
                    .slice()
                    .sort((a, b) => a.originDateISO.localeCompare(b.originDateISO))[0] || null;
                const displayedStudent = (displayedDate.students || []).find((s) => s.id === studentId);

                if (!canonical && displayedStudent?.followUp === "Next Class") {
                    const originDate = cls.dates
                        .filter((d) => d.isInstructional !== false && d.dateISO <= displayedDate.dateISO)
                        .filter((d) => (d.students || []).some((s) => s.id === studentId && s.followUp === "Next Class"))
                        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0] || displayedDate;
                    const originStudent = (originDate.students || []).find((s) => s.id === studentId) || displayedStudent;
                    const dueDate = this.getNextInstructionalDate(cls, originDate.dateISO) || originDate;
                    canonical = openRecords[0] || {
                        id: this.state.nextFollowUpId++,
                        classId: cls.id,
                        studentId,
                        completionDateISO: "",
                        completionDateText: "",
                    };
                    if (!openRecords.includes(canonical)) this.state.followUps.push(canonical);
                    Object.assign(canonical, {
                        originDateId: originDate.id,
                        originDateISO: originDate.dateISO,
                        originDateText: originDate.date,
                        originNote: originStudent?.followUpNote || canonical.originNote || "",
                        dueDateId: dueDate.id,
                        dueDateISO: dueDate.dateISO,
                        status: "open",
                    });
                }

                openRecords.forEach((record) => {
                    if (record !== canonical) record.status = "cancelled";
                });
                if (displayedStudent) displayedStudent.followUp = canonical ? "Next Class" : "None";
            });
        });

        this.state.followUpReconciliationVersion = 1;
    }

    processCarryForwardFollowUps(cls, referenceDateISO) {
        if (!referenceDateISO) return;
        const open = this.state.followUps.filter((f) => f.classId === cls.id && f.status === "open");
        open.forEach((fu) => {
            let guard = 0;
            while (fu.dueDateISO && fu.dueDateISO < referenceDateISO && guard < 200) {
                guard += 1;
                const dueRecord = this.getDateByISO(cls, fu.dueDateISO);
                if (!dueRecord || dueRecord.isInstructional === false) {
                    const next = this.getNextInstructionalDate(cls, fu.dueDateISO);
                    if (!next) break;
                    fu.dueDateISO = next.dateISO;
                    fu.dueDateId = next.id;
                    continue;
                }
                break;
            }
        });
    }

    openFollowUpForCurrentStudent() {
        const cls = this.currentClass();
        const date = this.currentDateRecord();
        const student = this.currentStudent();
        if (!cls || !date || !student || date.isInstructional === false) return;
        this.openFollowUpForStudent(cls, date, student);
        this.saveState();
    }

    openFollowUpForStudent(cls, date, student) {
        const allOpen = this.state.followUps.filter((f) => f.classId === cls.id && f.studentId === student.id && f.status === "open");
        let open = allOpen[0] || null;
        const nextDate = this.getNextInstructionalDate(cls, date.dateISO) || date;
        if (!open) {
            open = {
                id: this.state.nextFollowUpId++,
                classId: cls.id,
                studentId: student.id,
                originDateId: date.id,
                originDateISO: date.dateISO,
                originDateText: date.date,
                originNote: student.followUpNote || "",
                dueDateId: nextDate.id,
                dueDateISO: nextDate.dateISO,
                status: "open",
                completionDateISO: "",
                completionDateText: "",
            };
            this.state.followUps.push(open);
        } else {
            Object.assign(open, {
                originDateId: date.id,
                originDateISO: date.dateISO,
                originDateText: date.date,
                originNote: student.followUpNote || open.originNote || "",
                dueDateId: nextDate.id,
                dueDateISO: nextDate.dateISO,
                status: "open",
                completionDateISO: "",
                completionDateText: "",
            });
        }
        allOpen.slice(1).forEach((record) => { record.status = "cancelled"; });
        student.followUp = "Next Class";
    }

    cancelFollowUpForStudent(cls, student) {
        this.state.followUps
            .filter((f) => f.classId === cls.id && f.studentId === student.id && f.status === "open")
            .forEach((f) => { f.status = "cancelled"; });
        student.followUp = "None";
    }

    completeFollowUpForCurrentStudent() {
        const cls = this.currentClass();
        const student = this.currentStudent();
        if (!cls || !student) return;
        const open = this.getFollowUpForStudent(cls.id, student.id);
        if (!open) return;
        const now = new Date();
        open.status = "complete";
        open.completionDateISO = this.toISO(now);
        open.completionDateText = this.formatDisplayDate(now);
        student.followUp = "Complete";
        this.saveState();
    }

    // Navigation and page behavior
    bindGlobalControls() {
        document.getElementById("navToday").addEventListener("click", () => this.switchPage("today"));
        document.getElementById("navFollowups")?.addEventListener("click", () => this.switchPage("followups"));
        document.getElementById("navSetup").addEventListener("click", () => this.switchPage("setup"));

        document.getElementById("cloudSyncSignInBtn").addEventListener("click", async () => {
            const email = document.getElementById("cloudSyncEmail").value.trim();
            if (!email || !this.cloudSync) return;
            try {
                await this.cloudSync.sendMagicLink(email);
                this.updateCloudSyncStatus("pending", "Check your email for the Studio OS sign-in link");
            } catch (err) {
                console.error("Unable to send Studio OS sign-in link.", err);
                this.updateCloudSyncStatus("error", "Could not send sign-in link");
            }
        });
        document.getElementById("cloudSyncNowBtn").addEventListener("click", () => this.syncClassesAndStudents());
        document.getElementById("cloudSyncSignOutBtn").addEventListener("click", async () => {
            if (!this.cloudSync) return;
            try {
                await this.cloudSync.signOut();
                this.updateCloudSyncStatus("signed-out", "Signed out — local data remains available");
            } catch (err) {
                console.error("Unable to sign out of Studio OS cloud sync.", err);
                this.updateCloudSyncStatus("error", "Could not sign out");
            }
        });

        document.getElementById("rosterToggleBtn").addEventListener("click", () => {
            this.rosterCollapsed = !this.rosterCollapsed;
            this.renderRosterSection();
        });

        document.getElementById("classEvalToggleBtn").addEventListener("click", () => {
            this.classEvalCollapsed = !this.classEvalCollapsed;
            this.renderClassEvalSection();
        });
        document.getElementById("setupHeaderCalendar").addEventListener("click", () => this.toggleSetupSection("calendar"));
        document.getElementById("setupHeaderClasses").addEventListener("click", () => this.toggleSetupSection("classes"));
        document.getElementById("setupHeaderRoster").addEventListener("click", () => this.toggleSetupSection("roster"));
        document.getElementById("setupHeaderSyllabus").addEventListener("click", () => this.toggleSetupSection("syllabus"));
        document.getElementById("setupHeaderProjects").addEventListener("click", () => this.toggleSetupSection("projects"));

        document.getElementById("classSelect").addEventListener("change", (e) => {
            this.state.selectedClassId = e.target.value;
            this.selectTodayDateForClass(this.currentClass());
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        document.getElementById("prevDateBtn").addEventListener("click", () => this.shiftDate(-1));
        document.getElementById("nextDateBtn").addEventListener("click", () => this.shiftDate(1));
        document.getElementById("todayDateBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            if (!cls) return;
            this.selectTodayDateForClass(cls);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        const restoreInput = document.getElementById("restorePilotBackupInput");
        document.getElementById("exportPilotBackupBtn").addEventListener("click", () => this.exportPilotBackup());
        document.getElementById("restorePilotBackupBtn").addEventListener("click", () => restoreInput.click());
        restoreInput.addEventListener("change", () => {
            const file = restoreInput.files?.[0];
            restoreInput.value = "";
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const envelope = this.parseBackupEnvelope(String(reader.result || ""));
                    if (!window.confirm("Restore this Studio OS backup?\n\nThis will replace the CURRENT local pilot data on this browser.")) return;
                    this.restorePilotState(envelope.state);
                    window.alert("Studio OS pilot backup restored.");
                } catch (err) {
                    window.alert(err.message || "This file is not a valid Studio OS pilot backup.");
                }
            };
            reader.onerror = () => window.alert("The selected backup file could not be read.");
            reader.readAsText(file);
        });
        document.getElementById("restoreLatestBackupBtn").addEventListener("click", () => {
            try {
                const rawBackup = localStorage.getItem(this.backupStorageKey);
                if (!rawBackup) {
                    window.alert("No valid automatic Studio OS backup is available.");
                    return;
                }
                const envelope = this.parseBackupEnvelope(rawBackup);
                if (!window.confirm("Restore the latest automatic Studio OS backup?\n\nThis will replace the CURRENT local pilot data on this browser.")) return;
                this.restorePilotState(envelope.state);
                window.alert("Latest automatic Studio OS backup restored.");
            } catch (_) {
                window.alert("No valid automatic Studio OS backup is available.");
            }
        });

        document.getElementById("resetCurrentClassBtn").addEventListener("click", () => {
            const cls = this.currentClass();
            if (!cls) return;
            if (!window.confirm(`Reset all test data for ${cls.code} · ${cls.name}?`)) return;
            const fresh = this.createInitialState();
            const replacement = fresh.classes.find((c) => c.id === cls.id);
            const idx = this.state.classes.findIndex((c) => c.id === cls.id);
            const retainedFollowUps = this.state.followUps.filter((f) => f.classId !== cls.id);
            this.state.classes[idx] = replacement;
            this.regenerateClassDates(this.state.classes[idx], true);
            this.state.followUps = retainedFollowUps;
            this.selectTodayDateForClass(this.state.classes[idx]);
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        });

        document.getElementById("resetAllDataBtn").addEventListener("click", () => {
            if (!window.confirm("Reset ALL pilot test data for all classes and dates?")) return;
            this.state = this.createInitialState();
            this.regenerateAllClassDates();
            this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
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
        if (!cls) return;
        if (!cls.dates || cls.dates.length === 0) return;
        const next = Math.max(0, Math.min(cls.dates.length - 1, this.currentDateIndex() + delta));
        this.state.selectedDateIndexByClass[cls.id] = next;
        this.ensureSelectedStudent(true);
        this.saveState();
        this.render();
    }

    render() {
        const todayScreen = document.getElementById("todayScreen");
        const setupScreen = document.getElementById("setupScreen");
        const followupsScreen = document.getElementById("followupsScreen");
        const navToday = document.getElementById("navToday");
        const navSetup = document.getElementById("navSetup");
        const navFollowups = document.getElementById("navFollowups");

        [todayScreen, setupScreen, followupsScreen].forEach((s) => s && s.classList.add("hidden"));
        [navToday, navSetup, navFollowups].forEach((n) => n && n.classList.remove("active"));

        if (this.page === "setup") {
            setupScreen.classList.remove("hidden");
            navSetup.classList.add("active");
            this.renderSetup();
            return;
        }
        if (this.page === "followups") {
            followupsScreen.classList.remove("hidden");
            navFollowups?.classList.add("active");
            this.renderFollowupsPage();
            return;
        }

        this.page = "today";
        todayScreen.classList.remove("hidden");
        navToday.classList.add("active");
        this.renderToday();
    }

    // Today
    renderToday() {
        const cls = this.currentClass();
        if (!cls) {
            this.renderTopControls();
            this.renderSummary();
            this.renderFollowUpsDueToday();
            this.renderRosterSection();
            this.renderPanel();
            this.renderClassEvalSection();
            return;
        }
        const cur = this.currentDateRecord();
        if (cur && cur.isInstructional !== false) {
            this.processCarryForwardFollowUps(cls, cur.dateISO);
        }
        const dueFollowUps = this.getDueFollowUpsForTodayCurrentClass();
        this.ensureSelectedStudent();
        this.renderTopControls();
        this.renderSummary(dueFollowUps);
        this.renderFollowUpsDueToday(dueFollowUps);
        this.renderRosterSection();
        this.renderPanel();
        this.renderClassEvalSection();
    }

    renderRosterSection() {
        const cls = this.currentClass();
        const rosterCount = cls ? cls.roster.length : 0;
        const titleEl = document.getElementById("rosterHeaderTitle");
        const wrapEl = document.getElementById("rosterTableWrap");
        const toggleBtn = document.getElementById("rosterToggleBtn");
        if (titleEl) titleEl.textContent = `Student Roster · ${rosterCount} Student${rosterCount !== 1 ? "s" : ""}`;
        if (wrapEl) wrapEl.classList.toggle("collapsed", this.rosterCollapsed);
        if (toggleBtn) toggleBtn.textContent = this.rosterCollapsed ? "Expand" : "Collapse";
        this.renderTable();
    }

    renderTopControls() {
        const cls = this.currentClass();
        const select = document.getElementById("classSelect");
        if (!cls) {
            select.innerHTML = "";
            document.getElementById("dateContext").textContent = "No classes configured. Add a class in Setup.";
            document.getElementById("courseTitle").textContent = "No class selected";
            document.getElementById("classDate").textContent = "No class date available";
            document.getElementById("classWeek").textContent = "No meeting dates";
            document.getElementById("projectTitle").textContent = "No active project";
            document.getElementById("projectMilestone").textContent = "Not set";
            document.getElementById("previousOverallUnderstanding").textContent = "—";
            document.getElementById("previousConceptsToReview").textContent = "—";
            document.getElementById("railReminderProject").textContent = "No active project";
            document.getElementById("railReminderChanges").textContent = "No project changes";
            return;
        }
        select.innerHTML = this.state.classes.map((c) => `<option value="${c.id}" ${c.id === cls.id ? "selected" : ""}>${c.code} · ${c.name}</option>`).join("");

        const idx = this.currentDateIndex();
        const dates = cls.dates || [];
        const cur = dates.length ? dates[Math.max(0, Math.min(idx, dates.length - 1))] : null;
        const prev = cur ? dates[Math.max(0, Math.min(idx - 1, dates.length - 1))] : null;
        const next = cur ? dates[Math.max(0, Math.min(idx + 1, dates.length - 1))] : null;
        const isToday = cur?.dateISO === this.toISO(new Date());
        const curLabel = cur
            ? `${cur.date} (${isToday ? "today" : "current"}${cur.isInstructional === false ? " · NO CLASS" : ""})`
            : "No generated class meetings in selected range.";
        const prevText = prev ? prev.date : "None";
        const nextText = next ? next.date : "None";
        document.getElementById("dateContext").textContent = cur ? `${prevText} (prev) · ${curLabel} · ${nextText} (next)` : "No generated class meetings in selected range.";

        const project = this.currentProject(cls);
        document.getElementById("courseTitle").textContent = `${cls.code} · ${cls.name}`;
        document.getElementById("classDate").textContent = cur ? cur.date : "No class date available";
        document.getElementById("classWeek").textContent = cur
            ? (cur.isInstructional === false
                ? `NO CLASS — ${cur.exceptionDescription || cur.exceptionType} · ${cls.meetingDays.join(" / ")}`
                : `Week ${cur.week} · Class ${cur.classNumber} · ${cls.meetingDays.join(" / ")}`)
            : `No meeting dates · ${cls.meetingDays.join(" / ")}`;
        document.getElementById("projectTitle").textContent = project ? project.name : "No active project";
        document.getElementById("projectMilestone").textContent = project?.nextMilestone || "Not set";
        const currentEvaluation = cls.classEvaluation || this.normalizeStickyClassEvaluation(null);
        document.getElementById("previousOverallUnderstanding").textContent = currentEvaluation.overallUnderstanding || "—";
        document.getElementById("previousConceptsToReview").textContent = currentEvaluation.conceptsToReview || "—";
        document.getElementById("railReminderProject").textContent = project?.name || "No active project";
        document.getElementById("railReminderChanges").textContent = currentEvaluation.projectChanges || "No project changes";
    }

    renderSummary(dueFollowUps = this.getDueFollowUpsForTodayCurrentClass()) {
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
        document.getElementById("metricStudents").textContent = String(students.length);
        document.getElementById("metricNeedHelp").textContent = String(needHelp);
        document.getElementById("metricAtRisk").textContent = String(atRisk);
        document.getElementById("metricFollowUps").textContent = String(dueFollowUps.length);
    }

    getDueFollowUpsForTodayCurrentClass() {
        const cls = this.currentClass();
        if (!cls) return [];
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) return [];
        this.processCarryForwardFollowUps(cls, date.dateISO);
        return this.state.followUps.filter((f) =>
            f.classId === cls.id &&
            f.status === "open" &&
            f.dueDateISO &&
            f.dueDateISO <= date.dateISO
        );
    }

    renderFollowUpsDueToday(due = this.getDueFollowUpsForTodayCurrentClass()) {
        const host = document.getElementById("followUpsDue");
        if (!this.currentClass()) {
            host.innerHTML = '<span class="project-subtitle">No class selected.</span>';
            return;
        }
        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) {
            host.innerHTML = `<span class="project-subtitle">NO CLASS — ${this.escapeHtml(date?.exceptionDescription || date?.exceptionType || "")}</span>`;
            return;
        }
        host.innerHTML = "";
        if (due.length === 0) {
            host.innerHTML = '<span class="project-subtitle">No follow-ups due for this class date.</span>';
            return;
        }
        const studentsById = Object.fromEntries(this.currentStudents().map((s) => [s.id, s]));
        due
            .slice()
            .sort((a, b) => this.compareStudentNames(studentsById[a.studentId]?.name || "", studentsById[b.studentId]?.name || ""))
            .forEach((fu) => {
            const student = studentsById[fu.studentId];
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "chip-btn";
            btn.textContent = student ? this.rosterDisplayName(student.name) : `Student ${fu.studentId}`;
            btn.addEventListener("click", () => {
                this.selectedStudentByClassDate[this.selectedKey()] = fu.studentId;
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

    homeworkTagClass(status) {
        if (status === "Done") return "tag tag-strong";
        if (status === "Not Done") return "tag tag-needs-help";
        return "tag tag-developing";
    }

    nextHomeworkValue(value) {
        if (value === "Done") return "Partial";
        if (value === "Partial") return "Not Done";
        return "Done";
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

    nextAttendanceValue(value) {
        if (value === "Present") return "Tardy";
        if (value === "Tardy") return "Absent";
        return "Present";
    }

    nextOverallStatusValue(value) {
        if (value === "Strong") return "Developing";
        if (value === "Developing") return "Needs Help";
        return "Strong";
    }

    nextFollowUpValue(value) {
        return value === "Next Class" ? "None" : "Next Class";
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
        const cls = this.currentClass();
        const previousInstructional = this.getPreviousInstructionalDateRecord(this.currentClass(), date.dateISO);
        const previousStudentsById = Object.fromEntries((previousInstructional?.students || []).map((s) => [s.id, s]));
        tbody.innerHTML = "";
        this.currentStudents().slice().sort((a, b) => this.compareStudentNames(a.name, b.name)).forEach((s) => {
            const tr = document.createElement("tr");
            tr.className = `student-row ${s.id === selectedId ? "selected" : ""}`;
            const previousNote = previousStudentsById[s.id]?.classNote?.trim() || "—";
            const followStatus = this.getFollowUpForStudent(cls.id, s.id, date.dateISO) ? "Next Class" : (s.followUp === "Complete" ? "Complete" : "None");
            tr.innerHTML = `
                <td><strong>${this.escapeHtml(this.rosterDisplayName(s.name))}</strong></td>
                <td><button type="button" class="${this.attendanceTagClass(s.attendance)} attendance-pill-btn" data-table-attendance-id="${s.id}">${s.attendance}</button></td>
                <td>
                    <select class="table-edit-select" data-table-stage-id="${s.id}">
                        ${this.options(PROJECT_STAGES, s.projectStage)}
                    </select>
                </td>
                <td><button type="button" class="${this.statusTagClass(s.overallStatus)} table-chip-btn" data-table-status-id="${s.id}">${this.escapeHtml(s.overallStatus)}</button></td>
                <td class="homework-status"><button type="button" class="${this.homeworkTagClass(s.outsideWork)} table-chip-btn" data-table-homework-id="${s.id}" title="Click to change homework status" aria-label="Change homework status for ${this.escapeHtml(this.rosterDisplayName(s.name))}">${this.escapeHtml(s.outsideWork || "—")}</button></td>
                <td class="last-note">${this.escapeHtml(previousNote)}</td>
                <td><button type="button" class="${this.followTagClass(followStatus)} table-chip-btn" data-table-followup-id="${s.id}">${this.escapeHtml(followStatus)}</button></td>
            `;
            tr.addEventListener("click", () => {
                this.selectedStudentByClassDate[this.selectedKey()] = s.id;
                this.renderTable();
                this.renderPanel();
            });
            tbody.appendChild(tr);
        });

        const applyAndRefresh = (studentId, updater) => {
            const cls = this.currentClass();
            const date = this.currentDateRecord();
            const targetStudent = this.currentStudents().find((st) => st.id === studentId);
            if (!cls || !date || !targetStudent) return;
            updater(targetStudent, cls, date);
            this.saveState();
            this.renderSummary();
            this.renderFollowUpsDueToday();
            this.renderTable();
            if (this.currentStudent()?.id === studentId) this.renderPanel();
        };

        tbody.querySelectorAll("[data-table-attendance-id]").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.stopPropagation();
                const studentId = Number(el.getAttribute("data-table-attendance-id"));
                applyAndRefresh(studentId, (student) => {
                    student.attendance = this.nextAttendanceValue(student.attendance);
                });
            });
        });

        tbody.querySelectorAll("[data-table-status-id]").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.stopPropagation();
                const studentId = Number(el.getAttribute("data-table-status-id"));
                applyAndRefresh(studentId, (student) => {
                    student.overallStatus = this.nextOverallStatusValue(student.overallStatus);
                });
            });
        });

        tbody.querySelectorAll("[data-table-homework-id]").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.stopPropagation();
                const studentId = Number(el.getAttribute("data-table-homework-id"));
                applyAndRefresh(studentId, (student) => {
                    student.outsideWork = this.nextHomeworkValue(student.outsideWork);
                });
            });
        });

        tbody.querySelectorAll("[data-table-stage-id]").forEach((el) => {
            el.addEventListener("click", (event) => event.stopPropagation());
            el.addEventListener("change", (event) => {
                event.stopPropagation();
                const studentId = Number(el.getAttribute("data-table-stage-id"));
                const nextValue = event.target.value;
                applyAndRefresh(studentId, (student) => {
                    student.projectStage = nextValue;
                });
            });
        });

        tbody.querySelectorAll("[data-table-followup-id]").forEach((el) => {
            el.addEventListener("click", (event) => {
                event.stopPropagation();
                const studentId = Number(el.getAttribute("data-table-followup-id"));
                applyAndRefresh(studentId, (student, cls, date) => {
                    const next = this.nextFollowUpValue(this.getFollowUpForStudent(cls.id, student.id, date.dateISO) ? "Next Class" : "None");
                    if (next === "Next Class") {
                        this.openFollowUpForStudent(cls, date, student);
                        return;
                    }
                    this.cancelFollowUpForStudent(cls, student);
                });
            });
        });
    }

    options(list, selected) {
        return list.map((o) => `<option value="${this.escapeHtml(o)}" ${o === selected ? "selected" : ""}>${this.escapeHtml(o)}</option>`).join("");
    }

    renderPanel() {
        const panel = document.getElementById("studentPanel");
        const date = this.currentDateRecord();
        if (!date) {
            panel.innerHTML = '<div class="panel-placeholder">No class date generated. Update semester dates and meeting days in Setup.</div>';
            return;
        }
        if (date.isInstructional === false) {
            panel.innerHTML = `<div class="panel-placeholder" style="text-align:center;padding-top:50px;">${this.escapeHtml(date.date)}<br><strong>NO CLASS — ${this.escapeHtml(date.exceptionDescription || date.exceptionType || "Scheduled exception")}</strong></div>`;
            return;
        }
        const student = this.currentStudent();
        if (!student) {
            panel.innerHTML = '<div class="panel-placeholder">Select a student from the table.</div>';
            return;
        }

        const cls = this.currentClass();
        const fu = this.getFollowUpForStudent(cls.id, student.id, date.dateISO);
        const previousInstructional = this.getPreviousInstructionalDateRecord(cls, date.dateISO);
        const previousStudent = previousInstructional
            ? (previousInstructional.students || []).find((s) => s.id === student.id) || null
            : null;
        const prevFollowStatus = previousStudent ? previousStudent.followUp : "None";

        const lastClassBlock = previousInstructional && previousStudent
            ? `<div class="panel-section panel-section-last-class">
                <div class="panel-section-label">Last Class — ${this.escapeHtml(previousInstructional.date)}</div>
                <div class="context-grid">
                    <div>Attendance: <strong>${this.escapeHtml(previousStudent.attendance)}</strong></div>
                    <div>Stage: <strong>${this.escapeHtml(previousStudent.projectStage)}</strong></div>
                    <div>Status: <strong>${this.escapeHtml(previousStudent.overallStatus)}</strong></div>
                    <div>Progress: <strong>${this.escapeHtml(previousStudent.progress || "—")}</strong></div>
                    <div>Follow-up: <strong>${this.escapeHtml(prevFollowStatus)}</strong></div>
                    <div style="grid-column: 1 / -1;">Note: <strong>${this.escapeHtml(previousStudent.classNote || "—")}</strong></div>
                </div>
               </div>`
            : `<div class="panel-section panel-section-last-class"><div class="panel-section-label">Last Class</div><div style="font-size:12px;color:var(--muted);">No previous class record.</div></div>`;

        const fuBlock = fu
            ? `<div class="panel-section panel-section-followup-due">
                <div class="panel-section-label">Follow-up Due Today</div>
                <div style="font-size:12px;color:var(--muted);">Origin: <strong style="color:var(--text)">${this.escapeHtml(fu.originDateText)}</strong></div>
                <div class="panel-followup-note">${this.escapeHtml(fu.originNote || "—")}</div>
                <button type="button" id="completeFollowupBtn" class="panel-complete-btn">Mark Complete</button>
               </div>`
            : "";

        panel.innerHTML = `
            <div class="panel-student-name">${this.escapeHtml(student.name)}</div>
            ${lastClassBlock}
            ${fuBlock}
            <div class="panel-section">
                <div class="panel-section-label">Today</div>
                <div class="form-stack">
                    <div>
                        <label for="classNote">Class Note</label>
                        <textarea id="classNote" data-field="classNote" rows="4">${this.escapeHtml(student.classNote || "")}</textarea>
                    </div>
                </div>
            </div>
            <div class="panel-section">
                <div class="panel-section-label">Follow-up</div>
                <div class="form-stack">
                    <div>
                        <label for="panelFollowUp">Set Follow-up</label>
                        <select id="panelFollowUp" data-field="followUp">
                            <option value="None" ${!fu ? "selected" : ""}>None</option>
                            <option value="Next Class" ${fu ? "selected" : ""}>Next Class</option>
                        </select>
                    </div>
                    <div>
                        <label for="followUpNote">Follow-up Note</label>
                        <textarea id="followUpNote" data-field="followUpNote">${this.escapeHtml(student.followUpNote || "")}</textarea>
                    </div>
                </div>
            </div>
        `;

        this.bindPanelInputs();
        const completeBtn = document.getElementById("completeFollowupBtn");
        if (completeBtn) {
            completeBtn.addEventListener("click", () => {
                this.completeFollowUpForCurrentStudent();
                this.renderToday();
            });
        }
    }

    bindPanelInputs() {
        const panel = document.getElementById("studentPanel");

        // Select fields
        panel.querySelectorAll("select[data-field]").forEach((el) => {
            el.addEventListener("change", (e) => {
                const field = e.target.getAttribute("data-field");
                const value = e.target.value;
                if (field === "followUp") {
                    const cls = this.currentClass();
                    const student = this.currentStudent();
                    if (!student) return;
                    if (value === "Next Class") {
                        this.openFollowUpForCurrentStudent();
                    } else {
                        this.cancelFollowUpForStudent(cls, student);
                        this.saveState();
                    }
                    this.renderToday();
                    return;
                }
                this.updateField(field, value);
                this.renderToday();
            });
        });

        // Textarea fields
        panel.querySelectorAll("textarea[data-field]").forEach((el) => {
            el.addEventListener("input", (e) => {
                const field = e.target.getAttribute("data-field");
                this.updateField(field, e.target.value, false);
                if (field === "followUpNote") {
                    const cls = this.currentClass();
                    const student = this.currentStudent();
                    const open = student ? this.getFollowUpForStudent(cls.id, student.id) : null;
                    if (open) {
                        open.originNote = e.target.value;
                        this.saveState();
                    }
                }
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

    renderClassEvalSection() {
        const bodyEl = document.getElementById("classEvalBody");
        const toggleBtn = document.getElementById("classEvalToggleBtn");
        const sectionEl = document.getElementById("classEvalSection");
        if (!bodyEl || !toggleBtn) return;

        toggleBtn.textContent = this.classEvalCollapsed ? "Expand" : "Collapse";
        bodyEl.classList.toggle("hidden", this.classEvalCollapsed);

        if (this.classEvalCollapsed) return;

        const date = this.currentDateRecord();
        if (!date || date.isInstructional === false) {
            bodyEl.innerHTML = '<div style="font-size:12px;color:var(--muted);">No class evaluation for non-instructional dates.</div>';
            return;
        }

        if (!document.getElementById("evalClassStatus")) {
            bodyEl.innerHTML = this.classEvalBodyMarkup;
        }

        const cls = this.currentClass();
        if (!cls) return;
        if (!cls.classEvaluation) cls.classEvaluation = this.normalizeStickyClassEvaluation(null);
        const eval_ = cls.classEvaluation;

        document.getElementById("evalClassStatus").value = eval_.classPace || "On Schedule";
        document.getElementById("evalOverallUnderstanding").value = eval_.overallUnderstanding || "";
        document.getElementById("evalConceptsToReview").value = eval_.conceptsToReview || "";
        document.getElementById("evalProjectChanges").value = eval_.projectChanges || "";

        const saveEval = () => {
            const currentClass = this.currentClass();
            if (!currentClass) return;
            if (!currentClass.classEvaluation) currentClass.classEvaluation = this.normalizeStickyClassEvaluation(null);
            currentClass.classEvaluation.classPace = document.getElementById("evalClassStatus").value;
            currentClass.classEvaluation.overallUnderstanding = document.getElementById("evalOverallUnderstanding").value;
            currentClass.classEvaluation.conceptsToReview = document.getElementById("evalConceptsToReview").value;
            currentClass.classEvaluation.projectChanges = document.getElementById("evalProjectChanges").value;
            this.saveState();
        };

        ["evalClassStatus", "evalOverallUnderstanding"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) { el.onchange = saveEval; }
        });
        ["evalConceptsToReview", "evalProjectChanges"].forEach((id) => {
            const el = document.getElementById(id);
            if (el) { el.oninput = saveEval; }
        });
    }

    // Follow-ups page
    renderFollowupsPage() {
        const host = document.getElementById("followupsContent");
        if (!host) return;

        // keep carry-forward current for all classes against their latest viewed date
        this.state.classes.forEach((cls) => {
            const idx = this.state.selectedDateIndexByClass[cls.id] ?? 0;
            const rec = cls.dates[Math.max(0, Math.min(idx, Math.max(cls.dates.length - 1, 0)))];
            if (rec && rec.isInstructional !== false) this.processCarryForwardFollowUps(cls, rec.dateISO);
        });
        this.saveState();

        const open = this.state.followUps.filter((f) => f.status === "open");
        if (open.length === 0) {
            host.innerHTML = '<div class="panel-placeholder">No active follow-ups across classes.</div>';
            return;
        }

        const allCurrentDateISO = this.state.classes
            .map((cls) => cls.dates[this.state.selectedDateIndexByClass[cls.id] || 0]?.dateISO)
            .filter(Boolean)
            .sort()
            .at(-1) || "";

        const grouped = { overdue: [], due: [] };
        open.forEach((fu) => {
            if (fu.dueDateISO && allCurrentDateISO && fu.dueDateISO < allCurrentDateISO) grouped.overdue.push(fu);
            else grouped.due.push(fu);
        });

        const renderGroup = (title, list) => {
            if (list.length === 0) return "";
            const sortedList = list.slice().sort((a, b) => {
                const classCmp = (a.classId || "").localeCompare(b.classId || "", undefined, { sensitivity: "base" });
                if (classCmp !== 0) return classCmp;
                const aCls = this.state.classes.find((c) => c.id === a.classId);
                const bCls = this.state.classes.find((c) => c.id === b.classId);
                const aName = aCls?.roster.find((r) => r.id === a.studentId)?.name || "";
                const bName = bCls?.roster.find((r) => r.id === b.studentId)?.name || "";
                return this.compareStudentNames(aName, bName);
            });
            return `
                <section class="setup-section">
                    <h3>${title}</h3>
                    ${sortedList.map((fu) => {
                        const cls = this.state.classes.find((c) => c.id === fu.classId);
                        const dueRecord = cls?.dates.find((d) => d.dateISO === fu.dueDateISO);
                        const dateRef = dueRecord?.date || fu.dueDateISO;
                        const studentName = cls?.roster.find((r) => r.id === fu.studentId)?.name || `Student ${fu.studentId}`;
                        const attendance = dueRecord?.students?.find((s) => s.id === fu.studentId)?.attendance || "—";
                        return `
                            <div class="project-item">
                                <div><strong>${this.escapeHtml(this.rosterDisplayName(studentName))}</strong> · ${this.escapeHtml(cls ? `${cls.code} · ${cls.name}` : fu.classId)}</div>
                                <div style="font-size:12px;color:#5c685e;">Origin: ${this.escapeHtml(fu.originDateText)} · Due/Carry: ${this.escapeHtml(dateRef)} · Attendance: ${this.escapeHtml(attendance)}</div>
                                <div style="font-size:12px;">Note: ${this.escapeHtml(fu.originNote || "—")}</div>
                                <div class="setup-actions">
                                    <button type="button" data-open-followup="${fu.id}">Open in Today</button>
                                    <button type="button" data-complete-followup="${fu.id}">Complete</button>
                                </div>
                            </div>
                        `;
                    }).join("")}
                </section>
            `;
        };

        host.innerHTML = `${renderGroup("Overdue", grouped.overdue)}${renderGroup("Due", grouped.due)}`;

        host.querySelectorAll("[data-open-followup]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = Number(el.getAttribute("data-open-followup"));
                const fu = this.state.followUps.find((f) => f.id === id);
                if (!fu) return;
                const cls = this.state.classes.find((c) => c.id === fu.classId);
                if (!cls) return;
                const idx = cls.dates.findIndex((d) => d.dateISO === fu.dueDateISO);
                this.state.selectedClassId = cls.id;
                this.state.selectedDateIndexByClass[cls.id] = idx >= 0 ? idx : 0;
                const key = `${cls.id}:${cls.dates[this.state.selectedDateIndexByClass[cls.id]]?.id || "no-date"}`;
                this.selectedStudentByClassDate[key] = fu.studentId;
                this.page = "today";
                this.saveState();
                this.render();
            });
        });

        host.querySelectorAll("[data-complete-followup]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = Number(el.getAttribute("data-complete-followup"));
                const fu = this.state.followUps.find((f) => f.id === id && f.status === "open");
                if (!fu) return;
                const now = new Date();
                fu.status = "complete";
                fu.completionDateISO = this.toISO(now);
                fu.completionDateText = this.formatDisplayDate(now);
                this.saveState();
                this.renderFollowupsPage();
            });
        });
    }

    // Setup
    renderSetup() {
        this.renderSetupSectionState();
        const cls = this.currentClass();
        document.getElementById("setupEditingContext").textContent = cls ? `${cls.code} · ${cls.name}` : "No class selected";
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
                <div class="setup-actions"><button type="button" data-delete-ex="${ex.id}">Delete</button></div>
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
                if (!window.confirm("Delete this calendar exception?")) return;
                this.state.academicCalendar.exceptions = this.state.academicCalendar.exceptions.filter((x) => x.id !== id);
                this.regenerateAllClassDates();
                this.saveState();
                this.renderSetupCalendar();
                this.renderToday();
            });
        });

        document.getElementById("semesterName").oninput = (e) => { this.state.academicCalendar.semesterName = e.target.value; this.saveState(); };
        document.getElementById("semesterStart").onchange = (e) => {
            this.state.academicCalendar.semesterStartDate = e.target.value;
            this.regenerateAllClassDates();
            this.ensureSelectedStudent(true);
            this.saveState();
            this.renderToday();
        };
        document.getElementById("semesterEnd").onchange = (e) => {
            this.state.academicCalendar.semesterEndDate = e.target.value;
            this.regenerateAllClassDates();
            this.ensureSelectedStudent(true);
            this.saveState();
            this.renderToday();
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
        document.getElementById("resetAcademicCalendarBtn").onclick = () => {
            if (!window.confirm("Reset Academic Calendar to Fall 2026 defaults and clear all exceptions?")) return;
            this.state.academicCalendar = {
                semesterName: "Fall 2026",
                semesterStartDate: "2026-08-24",
                semesterEndDate: "2026-12-18",
                exceptions: [],
                nextExceptionId: 1,
            };
            this.regenerateAllClassDates();
            this.state.classes.forEach((cls) => this.syncClassRosterWithDates(cls));
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };
    }

    renderSetupClassEditor() {
        const cls = this.currentClass();
        const select = document.getElementById("setupClassSelect");
        select.innerHTML = this.state.classes
            .map((c) => `<option value="${c.id}" ${cls && c.id === cls.id ? "selected" : ""}>${c.code} · ${c.name}</option>`)
            .join("");
        select.onchange = (e) => {
            this.state.selectedClassId = e.target.value;
            this.ensureSelectedStudent(true);
            this.saveState();
            this.render();
        };

        const codeInput = document.getElementById("setupCourseCode");
        const nameInput = document.getElementById("setupCourseName");
        const removeClassBtn = document.getElementById("removeClassBtn");
        const dayHost = document.getElementById("meetingDaysGroup");
        const hasClass = !!cls;

        codeInput.value = cls ? cls.code : "";
        nameInput.value = cls ? cls.name : "";
        codeInput.disabled = !hasClass;
        nameInput.disabled = !hasClass;
        removeClassBtn.disabled = !hasClass;

        const dayOptions = ["Mon", "Tue", "Wed", "Thu", "Fri"];
        dayHost.innerHTML = dayOptions.map((d) => `<label><input type="checkbox" data-day="${d}" ${cls && cls.meetingDays.includes(d) ? "checked" : ""} ${hasClass ? "" : "disabled"}>${d}</label>`).join("");
        if (!hasClass) {
            codeInput.oninput = null;
            nameInput.oninput = null;
            removeClassBtn.onclick = null;
            return;
        }
        dayHost.querySelectorAll("[data-day]").forEach((el) => {
            el.addEventListener("change", () => {
                cls.meetingDays = Array.from(dayHost.querySelectorAll("[data-day]:checked")).map((x) => x.getAttribute("data-day"));
                this.regenerateClassDates(cls, true);
                this.ensureSelectedStudent(true);
                this.saveState();
                this.render();
            });
        });

        document.getElementById("setupCourseCode").oninput = (e) => { cls.code = e.target.value; this.saveState(); this.renderToday(); };
        document.getElementById("setupCourseName").oninput = (e) => { cls.name = e.target.value; this.saveState(); this.renderToday(); };
        removeClassBtn.onclick = () => {
            if (!window.confirm(`Remove class ${cls.code} · ${cls.name}? This will delete all local class data for this class.`)) return;
            const removedId = cls.id;
            this.state.classes = this.state.classes.filter((c) => c.id !== removedId);
            this.state.followUps = this.state.followUps.filter((f) => f.classId !== removedId);
            delete this.state.selectedDateIndexByClass[removedId];
            Object.keys(this.selectedStudentByClassDate).forEach((k) => {
                if (k.startsWith(`${removedId}:`)) delete this.selectedStudentByClassDate[k];
            });
            const nextClass = this.state.classes[0] || null;
            this.state.selectedClassId = nextClass ? nextClass.id : "";
            if (nextClass && !this.state.selectedDateIndexByClass[nextClass.id]) {
                this.state.selectedDateIndexByClass[nextClass.id] = 0;
            }
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
                roster: [],
                nextStudentId: 1,
                syllabus: { title: "", notes: "" },
                classEvaluation: {
                    classPace: "On Schedule",
                    overallUnderstanding: "Adequate",
                    conceptsToReview: "",
                    projectChanges: "",
                },
                projects: [{ id: `${id}-p1`, name: "New Project", startDate: "", dueDate: "", nextMilestone: "", notes: "" }],
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
            if (dateRecord.isInstructional === false) {
                dateRecord.students = [];
                return;
            }
            const existingById = Object.fromEntries(dateRecord.students.map((s) => [Number(s.id), s]));
            dateRecord.students = cls.roster.map((r) => {
                const existing = existingById[Number(r.id)];
                if (!existing) return createDefaultStudent({ id: r.id, name: r.name });
                return { ...existing, id: r.id, name: r.name };
            });
        });
    }

    normalizeImportedName(name) {
        return String(name || "").replace(/\s+/g, " ").trim();
    }

    normalizeCompareName(name) {
        return this.normalizeImportedName(name).toLowerCase();
    }

    splitStudentName(name) {
        const cleaned = this.normalizeImportedName(name);
        if (!cleaned) return { first: "", last: "" };
        const parts = cleaned.split(" ");
        if (parts.length === 1) return { first: parts[0], last: parts[0] };
        return {
            first: parts.slice(0, -1).join(" "),
            last: parts[parts.length - 1],
        };
    }

    rosterDisplayName(name) {
        const parsed = this.splitStudentName(name);
        if (!parsed.first || parsed.first === parsed.last) return parsed.last || this.normalizeImportedName(name);
        return `${parsed.last}, ${parsed.first}`;
    }

    compareStudentNames(aName, bName) {
        const a = this.splitStudentName(aName);
        const b = this.splitStudentName(bName);
        const lastCmp = a.last.localeCompare(b.last, undefined, { sensitivity: "base" });
        if (lastCmp !== 0) return lastCmp;
        return a.first.localeCompare(b.first, undefined, { sensitivity: "base" });
    }

    parseCsvText(csvText) {
        const rows = [];
        let row = [];
        let cell = "";
        let inQuotes = false;
        for (let i = 0; i < csvText.length; i += 1) {
            const ch = csvText[i];
            if (inQuotes) {
                if (ch === "\"") {
                    const next = csvText[i + 1];
                    if (next === "\"") {
                        cell += "\"";
                        i += 1;
                    } else {
                        inQuotes = false;
                    }
                } else {
                    cell += ch;
                }
                continue;
            }
            if (ch === "\"") {
                inQuotes = true;
                continue;
            }
            if (ch === ",") {
                row.push(cell);
                cell = "";
                continue;
            }
            if (ch === "\n") {
                row.push(cell);
                rows.push(row);
                row = [];
                cell = "";
                continue;
            }
            if (ch === "\r") continue;
            cell += ch;
        }
        if (cell.length > 0 || row.length > 0) {
            row.push(cell);
            rows.push(row);
        }
        return rows;
    }

    nameMappingOptions(headers) {
        const normalized = headers.map((h) => this.normalizeCompareName(h).replace(/[^a-z]/g, ""));
        const options = [];
        const seen = new Set();

        const addOption = (key, label, mapping, preferred = false) => {
            if (seen.has(key)) return;
            seen.add(key);
            options.push({ key, label, mapping, preferred });
        };

        const singlePatterns = new Set(["name", "studentname", "fullname"]);
        headers.forEach((header, index) => {
            const token = normalized[index];
            const preferred = singlePatterns.has(token);
            addOption(`single:${index}`, `Name column: ${header || `(Column ${index + 1})`}`, { mode: "single", index }, preferred);
        });

        const firstPatterns = new Set(["firstname", "first", "givenname", "given"]);
        const lastPatterns = new Set(["lastname", "last", "surname", "familyname", "family"]);
        const firstIndexes = [];
        const lastIndexes = [];
        normalized.forEach((token, index) => {
            if (firstPatterns.has(token)) firstIndexes.push(index);
            if (lastPatterns.has(token)) lastIndexes.push(index);
        });
        firstIndexes.forEach((fi) => {
            lastIndexes.forEach((li) => {
                if (fi === li) return;
                addOption(
                    `pair:${fi}:${li}`,
                    `First + Last: ${(headers[fi] || `Column ${fi + 1}`)} + ${(headers[li] || `Column ${li + 1}`)}`,
                    { mode: "pair", firstIndex: fi, lastIndex: li },
                    true
                );
            });
        });

        return options;
    }

    extractNameFromRow(row, mapping) {
        if (!mapping) return "";
        if (mapping.mode === "single") return this.normalizeImportedName(row[mapping.index] || "");
        if (mapping.mode === "pair") {
            const first = this.normalizeImportedName(row[mapping.firstIndex] || "");
            const last = this.normalizeImportedName(row[mapping.lastIndex] || "");
            return this.normalizeImportedName(`${first} ${last}`);
        }
        return "";
    }

    previewCsvImportForClass(cls, csvText) {
        const parsedRows = this.parseCsvText(csvText || "");
        const nonEmptyRows = parsedRows.filter((r) => r.some((cell) => this.normalizeImportedName(cell) !== ""));
        if (nonEmptyRows.length === 0) {
            return {
                error: "CSV is empty or contains only blank rows.",
                headers: [],
                dataRows: [],
                mappingOptions: [],
                selectedMappingKey: "",
                entries: [],
                counts: { newCount: 0, duplicateCount: 0, invalidCount: 0 },
            };
        }

        const headers = nonEmptyRows[0].map((h) => this.normalizeImportedName(h));
        const dataRows = nonEmptyRows.slice(1);
        if (dataRows.length === 0) {
            return {
                error: "CSV contains headers only and no student rows.",
                headers,
                dataRows: [],
                mappingOptions: [],
                selectedMappingKey: "",
                entries: [],
                counts: { newCount: 0, duplicateCount: 0, invalidCount: 0 },
            };
        }

        const mappingOptions = this.nameMappingOptions(headers);
        const preferredOptions = mappingOptions.filter((o) => o.preferred);
        const selectedMappingKey = preferredOptions.length === 1 ? preferredOptions[0].key : "";
        const draft = {
            error: "",
            headers,
            dataRows,
            mappingOptions,
            selectedMappingKey,
            entries: [],
            counts: { newCount: 0, duplicateCount: 0, invalidCount: 0 },
        };
        return this.computeImportPreviewEntries(cls, draft);
    }

    computeImportPreviewEntries(cls, draft) {
        const option = draft.mappingOptions.find((o) => o.key === draft.selectedMappingKey) || null;
        if (!option) {
            return {
                ...draft,
                error: draft.mappingOptions.length === 0 ? "No columns were detected in the CSV." : "Select which column(s) contain student names.",
                entries: [],
                counts: { newCount: 0, duplicateCount: 0, invalidCount: 0 },
            };
        }

        const existing = new Set((cls.roster || []).map((s) => this.normalizeCompareName(s.name)));
        const seenInImport = new Set();
        const entries = draft.dataRows.map((row) => {
            const name = this.extractNameFromRow(row, option.mapping);
            const normalized = this.normalizeCompareName(name);
            if (!normalized) return { name: "(blank)", status: "invalid" };
            if (existing.has(normalized) || seenInImport.has(normalized)) return { name, status: "duplicate" };
            seenInImport.add(normalized);
            return { name, status: "new" };
        }).sort((a, b) => this.compareStudentNames(a.name, b.name));

        const counts = {
            newCount: entries.filter((e) => e.status === "new").length,
            duplicateCount: entries.filter((e) => e.status === "duplicate").length,
            invalidCount: entries.filter((e) => e.status === "invalid").length,
        };
        return { ...draft, error: "", entries, counts };
    }

    renderSetupRoster() {
        const cls = this.currentClass();
        const csvInput = document.getElementById("rosterCsvFileInput");
        const importBtn = document.getElementById("importRosterCsvBtn");
        const previewHost = document.getElementById("rosterCsvPreview");
        const resultHost = document.getElementById("rosterImportResult");
        if (!cls) {
            document.getElementById("rosterList").innerHTML = '<div class="panel-placeholder">No class selected.</div>';
            document.getElementById("newStudentName").value = "";
            document.getElementById("newStudentName").disabled = true;
            document.getElementById("addStudentBtn").disabled = true;
            importBtn.disabled = true;
            previewHost.classList.add("hidden");
            resultHost.classList.add("hidden");
            return;
        }
        document.getElementById("newStudentName").disabled = false;
        document.getElementById("addStudentBtn").disabled = false;
        importBtn.disabled = false;
        this.syncClassRosterWithDates(cls);
        const host = document.getElementById("rosterList");
        host.innerHTML = "";
        cls.roster.slice().sort((a, b) => this.compareStudentNames(a.name, b.name)).forEach((r) => {
            const item = document.createElement("div");
            item.className = "roster-item";
            item.innerHTML = `
                <div class="setup-grid setup-grid-2">
                    <div>
                        <div class="project-subtitle" style="margin-bottom:4px;">${this.escapeHtml(this.rosterDisplayName(r.name))}</div>
                        <input type="text" value="${this.escapeHtml(r.name)}" data-roster-id="${r.id}">
                    </div>
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
                if (!window.confirm("Remove this student from the roster?")) return;
                cls.roster = cls.roster.filter((s) => s.id !== id);
                this.state.followUps = this.state.followUps.filter((f) => !(f.classId === cls.id && f.studentId === id && f.status === "open"));
                this.syncClassRosterWithDates(cls);
                this.ensureSelectedStudent(true);
                this.saveState();
                this.render();
            });
        });

        document.getElementById("addStudentBtn").onclick = () => {
            const name = document.getElementById("newStudentName").value.trim();
            if (!name) return;
            cls.roster.push({ id: cls.nextStudentId++, name });
            this.syncClassRosterWithDates(cls);
            document.getElementById("newStudentName").value = "";
            this.saveState();
            this.render();
        };

        if (!this.rosterCsvDraft || this.rosterCsvDraft.classId !== cls.id) {
            this.rosterCsvDraft = null;
        }

        importBtn.onclick = () => {
            csvInput.value = "";
            csvInput.click();
        };
        csvInput.onchange = () => {
            const file = csvInput.files && csvInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const text = typeof reader.result === "string" ? reader.result : "";
                this.rosterCsvDraft = {
                    classId: cls.id,
                    fileName: file.name,
                    ...this.previewCsvImportForClass(cls, text),
                };
                this.rosterImportResult = null;
                this.renderSetupRoster();
            };
            reader.readAsText(file);
        };

        if (this.rosterImportResult && this.rosterImportResult.classId === cls.id) {
            resultHost.classList.remove("hidden");
            resultHost.textContent = `Imported: ${this.rosterImportResult.imported} · Duplicates skipped: ${this.rosterImportResult.duplicates} · Invalid rows skipped: ${this.rosterImportResult.invalid}`;
        } else {
            resultHost.classList.add("hidden");
            resultHost.textContent = "";
        }

        if (!this.rosterCsvDraft || this.rosterCsvDraft.classId !== cls.id) {
            previewHost.classList.add("hidden");
            previewHost.innerHTML = "";
            return;
        }

        const draft = this.rosterCsvDraft;
        previewHost.classList.remove("hidden");
        const mappingOptionsHtml = draft.mappingOptions.map((opt) => (
            `<option value="${this.escapeHtml(opt.key)}" ${opt.key === draft.selectedMappingKey ? "selected" : ""}>${this.escapeHtml(opt.label)}</option>`
        )).join("");
        const entriesHtml = draft.entries.map((entry) => (
            `<div class="import-row"><span>${this.escapeHtml(entry.status === "invalid" ? entry.name : this.rosterDisplayName(entry.name))}</span><span class="import-badge ${entry.status}">${entry.status === "new" ? "New" : entry.status === "duplicate" ? "Possible Duplicate" : "Invalid/blank"}</span></div>`
        )).join("");
        previewHost.innerHTML = `
            <h4>CSV Roster Import</h4>
            <div class="import-meta">Detected: ${draft.dataRows.length} students${draft.fileName ? ` · File: ${this.escapeHtml(draft.fileName)}` : ""}</div>
            ${draft.mappingOptions.length > 1 || !draft.selectedMappingKey ? `
                <div class="setup-grid setup-grid-1">
                    <div>
                        <label for="rosterImportMappingSelect">Name column mapping</label>
                        <select id="rosterImportMappingSelect">
                            <option value="">Select name column(s)</option>
                            ${mappingOptionsHtml}
                        </select>
                    </div>
                </div>
            ` : ""}
            ${draft.error ? `<div class="import-meta">${this.escapeHtml(draft.error)}</div>` : `
                <div class="import-meta">New: ${draft.counts.newCount} · Possible Duplicates: ${draft.counts.duplicateCount} · Invalid/blank: ${draft.counts.invalidCount}</div>
                <div class="import-list">${entriesHtml || '<div class="import-meta">No rows available.</div>'}</div>
            `}
            <div class="setup-actions">
                <button type="button" id="cancelRosterImportBtn">Cancel</button>
                <button type="button" id="confirmRosterImportBtn" ${draft.error ? "disabled" : ""}>Import Students</button>
            </div>
        `;

        const mappingSelect = document.getElementById("rosterImportMappingSelect");
        if (mappingSelect) {
            mappingSelect.onchange = (e) => {
                this.rosterCsvDraft.selectedMappingKey = e.target.value;
                this.rosterCsvDraft = this.computeImportPreviewEntries(cls, this.rosterCsvDraft);
                this.renderSetupRoster();
            };
        }

        document.getElementById("cancelRosterImportBtn").onclick = () => {
            this.rosterCsvDraft = null;
            this.renderSetupRoster();
        };

        document.getElementById("confirmRosterImportBtn").onclick = () => {
            const finalDraft = this.rosterCsvDraft;
            if (!finalDraft || finalDraft.error) return;
            const toImport = finalDraft.entries.filter((e) => e.status === "new");
            toImport.forEach((entry) => {
                cls.roster.push({ id: cls.nextStudentId++, name: entry.name });
            });
            this.syncClassRosterWithDates(cls);
            this.rosterImportResult = {
                classId: cls.id,
                imported: toImport.length,
                duplicates: finalDraft.counts.duplicateCount,
                invalid: finalDraft.counts.invalidCount,
            };
            this.rosterCsvDraft = null;
            this.saveState();
            this.render();
        };
    }

    renderSetupSyllabus() {
        const cls = this.currentClass();
        const title = document.getElementById("syllabusTitle");
        const notes = document.getElementById("syllabusNotes");
        if (!cls) {
            title.value = "";
            notes.value = "";
            title.disabled = true;
            notes.disabled = true;
            return;
        }
        title.disabled = false;
        notes.disabled = false;
        title.value = cls.syllabus.title || "";
        notes.value = cls.syllabus.notes || "";
        title.oninput = (e) => { cls.syllabus.title = e.target.value; this.saveState(); };
        notes.oninput = (e) => { cls.syllabus.notes = e.target.value; this.saveState(); };
    }

    renderSetupProjects() {
        const cls = this.currentClass();
        if (!cls) {
            document.getElementById("projectsList").innerHTML = '<div class="panel-placeholder">No class selected.</div>';
            ["projectName", "projectStart", "projectDue", "projectMilestoneInput", "projectNotes", "addProjectBtn"].forEach((id) => {
                document.getElementById(id).disabled = true;
            });
            return;
        }
        ["projectName", "projectStart", "projectDue", "projectMilestoneInput", "projectNotes", "addProjectBtn"].forEach((id) => {
            document.getElementById(id).disabled = false;
        });
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
                <div class="project-brief-row">
                    <div class="project-brief-name">${p.brief ? `Project brief: ${this.escapeHtml(p.brief.fileName)}` : "No project brief attached"}</div>
                    <div class="setup-actions">
                        <input class="hidden" type="file" data-project-brief-input="${p.id}" accept=".pdf,.doc,.docx,.rtf,.txt,.odt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/plain,application/vnd.oasis.opendocument.text">
                        <button type="button" data-attach-project-brief="${p.id}" ${this.cloudSync?.user ? "" : "disabled"}>${p.brief ? "Replace" : "Attach"} Project Brief</button>
                        ${p.brief ? `<button type="button" data-open-project-brief="${p.id}" ${this.cloudSync?.user ? "" : "disabled"}>Open Brief</button><button type="button" data-remove-project-brief="${p.id}" ${this.cloudSync?.user ? "" : "disabled"}>Remove Brief</button>` : ""}
                    </div>
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
                if (!window.confirm("Delete this project?")) return;
                cls.projects = cls.projects.filter((p) => p.id !== id);
                if (cls.currentProjectId === id) cls.currentProjectId = cls.projects[0] ? cls.projects[0].id : null;
                this.saveState();
                this.render();
            });
        });

        host.querySelectorAll("[data-attach-project-brief]").forEach((el) => {
            el.addEventListener("click", () => {
                const id = el.getAttribute("data-attach-project-brief");
                host.querySelector(`[data-project-brief-input="${CSS.escape(id)}"]`)?.click();
            });
        });

        host.querySelectorAll("[data-project-brief-input]").forEach((input) => {
            input.addEventListener("change", async () => {
                const id = input.getAttribute("data-project-brief-input");
                const project = cls.projects.find((item) => item.id === id);
                const file = input.files?.[0];
                input.value = "";
                if (!project || !file) return;
                const previousBrief = project.brief ? { ...project.brief } : null;
                this.updateCloudSyncStatus("syncing", "Uploading project brief…");
                try {
                    project.brief = await this.cloudSync.uploadProjectBrief(cls.id, project.id, file);
                    this.saveState(true, false);
                    const synced = await this.syncClassesAndStudents();
                    if (!synced) {
                        window.alert("The brief was uploaded and saved locally, but cloud sync is paused. Your previous brief was kept as a safety copy.");
                        this.renderSetupProjects();
                        return;
                    }
                    if (previousBrief?.storagePath && previousBrief.storagePath !== project.brief.storagePath) {
                        try {
                            await this.cloudSync.removeProjectBrief(previousBrief.storagePath);
                        } catch (cleanupError) {
                            console.warn("The replacement brief is synced, but the previous stored file could not be deleted.", cleanupError);
                        }
                    }
                    this.renderSetupProjects();
                } catch (err) {
                    console.error("Unable to attach project brief.", err);
                    project.brief = previousBrief;
                    this.saveState(true, false);
                    this.updateCloudSyncStatus("error", "Project brief upload failed — local data is safe");
                    window.alert(err.message || "The project brief could not be attached.");
                    this.renderSetupProjects();
                }
            });
        });

        host.querySelectorAll("[data-open-project-brief]").forEach((el) => {
            el.addEventListener("click", async () => {
                const id = el.getAttribute("data-open-project-brief");
                const project = cls.projects.find((item) => item.id === id);
                if (!project?.brief?.storagePath) return;
                const preview = window.open("", "_blank");
                try {
                    const signedUrl = await this.cloudSync.createProjectBriefUrl(project.brief.storagePath);
                    if (preview) preview.location.href = signedUrl;
                    else window.location.href = signedUrl;
                } catch (err) {
                    if (preview) preview.close();
                    console.error("Unable to open project brief.", err);
                    window.alert(err.message || "The project brief could not be opened.");
                }
            });
        });

        host.querySelectorAll("[data-remove-project-brief]").forEach((el) => {
            el.addEventListener("click", async () => {
                const id = el.getAttribute("data-remove-project-brief");
                const project = cls.projects.find((item) => item.id === id);
                if (!project?.brief?.storagePath || !window.confirm(`Remove ${project.brief.fileName}?`)) return;
                const previousBrief = { ...project.brief };
                project.brief = null;
                this.saveState(true, false);
                const synced = await this.syncClassesAndStudents();
                if (!synced) {
                    project.brief = previousBrief;
                    this.saveState(true, false);
                    window.alert("The brief was not removed because cloud sync is paused.");
                    this.renderSetupProjects();
                    return;
                }
                try {
                    await this.cloudSync.removeProjectBrief(previousBrief.storagePath);
                } catch (err) {
                    console.warn("Project brief metadata was removed, but the stored file could not be deleted.", err);
                }
                this.renderSetupProjects();
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
                brief: null,
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
