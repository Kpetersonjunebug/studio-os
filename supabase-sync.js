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
            students: (cls.roster || []).map((student, studentIndex) => ({
                id: Number(student.id),
                name: String(student.name || ""),
                sortOrder: studentIndex,
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
            students: cls.students,
        })));
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
        const [classesResult, studentsResult] = await Promise.all([
            this.client.from("studio_classes").select("local_id, code, name, meeting_days, sort_order, updated_at").order("sort_order"),
            this.client.from("studio_students").select("class_local_id, local_id, name, sort_order, updated_at").order("sort_order"),
        ]);
        if (classesResult.error) throw classesResult.error;
        if (studentsResult.error) throw studentsResult.error;

        const studentsByClass = new Map();
        (studentsResult.data || []).forEach((row) => {
            if (!studentsByClass.has(row.class_local_id)) studentsByClass.set(row.class_local_id, []);
            studentsByClass.get(row.class_local_id).push({
                id: Number(row.local_id),
                name: row.name,
                sortOrder: Number(row.sort_order) || 0,
            });
        });

        return (classesResult.data || []).map((row) => ({
            id: row.local_id,
            code: row.code,
            name: row.name,
            meetingDays: Array.isArray(row.meeting_days) ? row.meeting_days : [],
            sortOrder: Number(row.sort_order) || 0,
            students: studentsByClass.get(row.local_id) || [],
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
    }
}

if (typeof window !== "undefined") window.StudioOSCloudSync = StudioOSCloudSync;
if (typeof module !== "undefined" && module.exports) module.exports = StudioOSCloudSync;
