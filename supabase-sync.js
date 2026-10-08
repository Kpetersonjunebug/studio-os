class StudioOSCloudSync {
    constructor({ config, supabaseLibrary, onStatus }) {
        this.config = config || {};
        this.supabaseLibrary = supabaseLibrary;
        this.onStatus = onStatus || (() => {});
        this.client = null;
        this.user = null;
    }

    isConfigured() {
        return Boolean(this.config.url && this.config.publishableKey && this.supabaseLibrary?.createClient);
    }

    async initialize() {
        if (!this.isConfigured()) {
            this.onStatus("local", "Local only — Supabase is not configured");
            return null;
        }

        this.client = this.supabaseLibrary.createClient(this.config.url, this.config.publishableKey);
        const { data, error } = await this.client.auth.getSession();
        if (error) throw error;
        this.user = data.session?.user || null;
        this.client.auth.onAuthStateChange((_event, session) => {
            this.user = session?.user || null;
            this.onStatus(this.user ? "ready" : "signed-out", this.user ? `Signed in as ${this.user.email}` : "Sign in to sync");
        });
        this.onStatus(this.user ? "ready" : "signed-out", this.user ? `Signed in as ${this.user.email}` : "Sign in to sync");
        return this.user;
    }

    async sendMagicLink(email) {
        if (!this.client) throw new Error("Supabase is not configured.");
        const redirectUrl = window.location.protocol === "file:"
            ? undefined
            : `${window.location.origin}${window.location.pathname}`;
        const { error } = await this.client.auth.signInWithOtp({
            email,
            options: {
                shouldCreateUser: true,
                ...(redirectUrl ? { emailRedirectTo: redirectUrl } : {}),
            },
        });
        if (error) throw error;
    }

    async signOut() {
        if (!this.client) return;
        const { error } = await this.client.auth.signOut();
        if (error) throw error;
        this.user = null;
    }

    static buildSnapshot(state) {
        return (state.classes || []).map((cls, classIndex) => ({
            id: String(cls.id),
            code: String(cls.code || ""),
            name: String(cls.name || ""),
            meetingDays: Array.isArray(cls.meetingDays) ? cls.meetingDays.map(String) : [],
            sortOrder: classIndex,
            projectSyncVersion: 1,
            currentProjectId: cls.currentProjectId ? String(cls.currentProjectId) : null,
            students: (cls.roster || []).map((student, studentIndex) => ({
                id: Number(student.id),
                name: String(student.name || ""),
                sortOrder: studentIndex,
            })),
            projects: (cls.projects || []).map((project, projectIndex) => ({
                id: String(project.id),
                name: String(project.name || ""),
                startDate: String(project.startDate || ""),
                dueDate: String(project.dueDate || ""),
                nextMilestone: String(project.nextMilestone || ""),
                notes: String(project.notes || ""),
                sortOrder: projectIndex,
                brief: project.brief?.storagePath ? {
                    storagePath: String(project.brief.storagePath),
                    fileName: String(project.brief.fileName || "Project brief"),
                    contentType: String(project.brief.contentType || "application/octet-stream"),
                    size: Number(project.brief.size) || 0,
                    uploadedAt: String(project.brief.uploadedAt || ""),
                } : null,
            })),
        }));
    }

    static canonicalSnapshot(snapshot) {
        return JSON.stringify((snapshot || []).map((cls) => ({
            id: cls.id,
            code: cls.code,
            name: cls.name,
            meetingDays: cls.meetingDays,
            sortOrder: cls.sortOrder,
            projectSyncVersion: cls.projectSyncVersion,
            currentProjectId: cls.currentProjectId,
            students: cls.students,
            projects: cls.projects,
        })));
    }

    static buildProjectBootstrapSnapshot(localSnapshot, remoteSnapshot) {
        const localByClassId = new Map((localSnapshot || []).map((cls) => [cls.id, cls]));
        return (remoteSnapshot || []).map((remoteClass) => {
            const localClass = localByClassId.get(remoteClass.id);
            const localProjects = localClass?.projects || [];
            const localCurrentProjectId = localProjects.some((project) => project.id === localClass?.currentProjectId)
                ? localClass.currentProjectId
                : (localProjects[0]?.id || null);
            return {
                ...remoteClass,
                projectSyncVersion: 1,
                currentProjectId: localCurrentProjectId,
                projects: localProjects.map((project) => ({
                    ...project,
                    brief: project.brief ? { ...project.brief } : null,
                })),
            };
        });
    }

    static mergeSnapshot(state, snapshot, createClass) {
        const localById = new Map((state.classes || []).map((cls) => [String(cls.id), cls]));
        const mergedClasses = [];

        (snapshot || []).forEach((remoteClass) => {
            const cls = localById.get(remoteClass.id) || createClass(remoteClass.id);
            cls.id = remoteClass.id;
            cls.code = remoteClass.code;
            cls.name = remoteClass.name;
            cls.meetingDays = remoteClass.meetingDays.slice();
            cls.roster = remoteClass.students.map((student) => ({ id: student.id, name: student.name }));
            cls.nextStudentId = Math.max(0, ...cls.roster.map((student) => Number(student.id) || 0)) + 1;
            if (Array.isArray(remoteClass.projects)) {
                cls.projects = remoteClass.projects.map((project) => ({
                    id: project.id,
                    name: project.name,
                    startDate: project.startDate,
                    dueDate: project.dueDate,
                    nextMilestone: project.nextMilestone,
                    notes: project.notes,
                    brief: project.brief ? { ...project.brief } : null,
                }));
                cls.currentProjectId = cls.projects.some((project) => project.id === remoteClass.currentProjectId)
                    ? remoteClass.currentProjectId
                    : (cls.projects[0]?.id || null);
            }
            mergedClasses.push(cls);
            localById.delete(remoteClass.id);
        });

        // This phase intentionally does not cloud-delete classes. Keeping a local-only
        // class protects projects, critiques, and other records that are not migrated yet.
        localById.forEach((cls) => mergedClasses.push(cls));
        state.classes = mergedClasses;
        return state;
    }

    async fetchSnapshot() {
        if (!this.client || !this.user) throw new Error("Sign in before syncing.");
        const [classesResult, studentsResult, projectsResult] = await Promise.all([
            this.client.from("studio_classes").select("local_id, code, name, meeting_days, sort_order, project_sync_version, current_project_local_id, updated_at").order("sort_order"),
            this.client.from("studio_students").select("class_local_id, local_id, name, sort_order, updated_at").order("sort_order"),
            this.client.from("studio_projects").select("class_local_id, local_id, name, start_date, due_date, next_milestone, notes, sort_order, brief_storage_path, brief_file_name, brief_content_type, brief_size, brief_uploaded_at, updated_at").order("sort_order"),
        ]);
        if (classesResult.error) throw classesResult.error;
        if (studentsResult.error) throw studentsResult.error;
        if (projectsResult.error) throw projectsResult.error;

        const studentsByClass = new Map();
        (studentsResult.data || []).forEach((row) => {
            if (!studentsByClass.has(row.class_local_id)) studentsByClass.set(row.class_local_id, []);
            studentsByClass.get(row.class_local_id).push({
                id: Number(row.local_id),
                name: row.name,
                sortOrder: Number(row.sort_order) || 0,
            });
        });

        const projectsByClass = new Map();
        (projectsResult.data || []).forEach((row) => {
            if (!projectsByClass.has(row.class_local_id)) projectsByClass.set(row.class_local_id, []);
            projectsByClass.get(row.class_local_id).push({
                id: row.local_id,
                name: row.name,
                startDate: row.start_date || "",
                dueDate: row.due_date || "",
                nextMilestone: row.next_milestone || "",
                notes: row.notes || "",
                sortOrder: Number(row.sort_order) || 0,
                brief: row.brief_storage_path ? {
                    storagePath: row.brief_storage_path,
                    fileName: row.brief_file_name || "Project brief",
                    contentType: row.brief_content_type || "application/octet-stream",
                    size: Number(row.brief_size) || 0,
                    uploadedAt: row.brief_uploaded_at || "",
                } : null,
            });
        });

        return (classesResult.data || []).map((row) => ({
            id: row.local_id,
            code: row.code,
            name: row.name,
            meetingDays: Array.isArray(row.meeting_days) ? row.meeting_days : [],
            sortOrder: Number(row.sort_order) || 0,
            projectSyncVersion: Number(row.project_sync_version) || 0,
            currentProjectId: row.current_project_local_id || null,
            students: studentsByClass.get(row.local_id) || [],
            projects: projectsByClass.get(row.local_id) || [],
        }));
    }

    async pushSnapshot(snapshot) {
        if (!this.client || !this.user) throw new Error("Sign in before syncing.");
        const now = new Date().toISOString();
        const classRows = snapshot.map((cls) => ({
            user_id: this.user.id,
            local_id: cls.id,
            code: cls.code,
            name: cls.name,
            meeting_days: cls.meetingDays,
            sort_order: cls.sortOrder,
            project_sync_version: 1,
            current_project_local_id: cls.currentProjectId,
            updated_at: now,
        }));

        if (classRows.length > 0) {
            const { error } = await this.client.from("studio_classes").upsert(classRows, { onConflict: "user_id,local_id" });
            if (error) throw error;
        }

        const studentRows = snapshot.flatMap((cls) => cls.students.map((student) => ({
            user_id: this.user.id,
            class_local_id: cls.id,
            local_id: student.id,
            name: student.name,
            sort_order: student.sortOrder,
            updated_at: now,
        })));
        if (studentRows.length > 0) {
            const { error } = await this.client.from("studio_students").upsert(studentRows, { onConflict: "user_id,class_local_id,local_id" });
            if (error) throw error;
        }

        const projectRows = snapshot.flatMap((cls) => cls.projects.map((project) => ({
            user_id: this.user.id,
            class_local_id: cls.id,
            local_id: project.id,
            name: project.name,
            start_date: project.startDate || null,
            due_date: project.dueDate || null,
            next_milestone: project.nextMilestone,
            notes: project.notes,
            sort_order: project.sortOrder,
            brief_storage_path: project.brief?.storagePath || null,
            brief_file_name: project.brief?.fileName || null,
            brief_content_type: project.brief?.contentType || null,
            brief_size: project.brief?.size || null,
            brief_uploaded_at: project.brief?.uploadedAt || null,
            updated_at: now,
        })));
        if (projectRows.length > 0) {
            const { error } = await this.client.from("studio_projects").upsert(projectRows, { onConflict: "user_id,class_local_id,local_id" });
            if (error) throw error;
        }

        // Roster removals are safe to propagate because Students are in this phase.
        // Class removals are deliberately deferred until the rest of a class is cloud-backed.
        const { data: remoteStudents, error: remoteStudentsError } = await this.client
            .from("studio_students")
            .select("class_local_id, local_id");
        if (remoteStudentsError) throw remoteStudentsError;
        for (const cls of snapshot) {
            const localIds = new Set(cls.students.map((student) => Number(student.id)));
            const staleIds = (remoteStudents || [])
                .filter((row) => row.class_local_id === cls.id && !localIds.has(Number(row.local_id)))
                .map((row) => Number(row.local_id));
            if (staleIds.length > 0) {
                const { error } = await this.client.from("studio_students")
                    .delete()
                    .eq("class_local_id", cls.id)
                    .in("local_id", staleIds);
                if (error) throw error;
            }
        }


        const { data: remoteProjects, error: remoteProjectsError } = await this.client
            .from("studio_projects")
            .select("class_local_id, local_id, brief_storage_path");
        if (remoteProjectsError) throw remoteProjectsError;
        for (const cls of snapshot) {
            const localIds = new Set(cls.projects.map((project) => project.id));
            const staleProjects = (remoteProjects || [])
                .filter((row) => row.class_local_id === cls.id && !localIds.has(row.local_id));
            const stalePaths = staleProjects.map((row) => row.brief_storage_path).filter(Boolean);
            if (stalePaths.length > 0) {
                const { error } = await this.client.storage.from("studio-project-briefs").remove(stalePaths);
                if (error) throw error;
            }
            const staleIds = staleProjects.map((row) => row.local_id);
            if (staleIds.length > 0) {
                const { error } = await this.client.from("studio_projects")
                    .delete()
                    .eq("class_local_id", cls.id)
                    .in("local_id", staleIds);
                if (error) throw error;
            }
        }
    }

    safeStorageSegment(value, fallback = "item") {
        const safe = String(value || "")
            .normalize("NFKD")
            .replace(/[^a-zA-Z0-9._-]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 100);
        return safe || fallback;
    }

    async uploadProjectBrief(classId, projectId, file) {
        if (!this.client || !this.user) throw new Error("Sign in before attaching a project brief.");
        if (!file) throw new Error("Choose a project brief first.");
        const maxBytes = 15 * 1024 * 1024;
        if (file.size > maxBytes) throw new Error("Project briefs must be 15 MB or smaller.");

        const allowedExtensions = new Set(["pdf", "doc", "docx", "rtf", "txt", "odt"]);
        const extension = String(file.name || "").split(".").pop().toLowerCase();
        if (!allowedExtensions.has(extension)) {
            throw new Error("Use a PDF, Word document, RTF, text, or ODT project brief.");
        }

        const path = [
            this.user.id,
            this.safeStorageSegment(classId, "class"),
            this.safeStorageSegment(projectId, "project"),
            `${Date.now()}-${this.safeStorageSegment(file.name, `brief.${extension}`)}`,
        ].join("/");
        const { error } = await this.client.storage.from("studio-project-briefs").upload(path, file, {
            cacheControl: "3600",
            contentType: file.type || "application/octet-stream",
            upsert: false,
        });
        if (error) throw error;
        return {
            storagePath: path,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            uploadedAt: new Date().toISOString(),
        };
    }

    async createProjectBriefUrl(storagePath) {
        if (!this.client || !this.user) throw new Error("Sign in before opening a project brief.");
        const { data, error } = await this.client.storage
            .from("studio-project-briefs")
            .createSignedUrl(storagePath, 60);
        if (error) throw error;
        return data.signedUrl;
    }

    async removeProjectBrief(storagePath) {
        if (!this.client || !this.user) throw new Error("Sign in before removing a project brief.");
        if (!storagePath) return;
        const { error } = await this.client.storage.from("studio-project-briefs").remove([storagePath]);
        if (error) throw error;
    }
}

if (typeof window !== "undefined") window.StudioOSCloudSync = StudioOSCloudSync;
if (typeof module !== "undefined" && module.exports) module.exports = StudioOSCloudSync;
