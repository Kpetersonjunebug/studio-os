// Studio OS - Main Application Logic

class StudioOSApp {
    constructor() {
        this.students = [];
        this.selectedStudentId = null;
        this.storageKey = 'studioOS_students';
        this.init();
    }

    init() {
        this.loadStudents();
        this.renderStudentList();
        this.updateFollowUpsStat();
    }

    loadStudents() {
        const stored = localStorage.getItem(this.storageKey);
        if (stored) {
            try {
                this.students = JSON.parse(stored);
            } catch (e) {
                console.error('Error loading stored students:', e);
                this.students = JSON.parse(JSON.stringify(DEFAULT_STUDENTS));
            }
        } else {
            this.students = JSON.parse(JSON.stringify(DEFAULT_STUDENTS));
        }
    }

    saveStudents() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.students));
    }

    renderStudentList() {
        const studentList = document.getElementById('studentList');
        studentList.innerHTML = '';

        this.students.forEach(student => {
            const item = document.createElement('div');
            item.className = 'student-item';
            if (student.id === this.selectedStudentId) {
                item.classList.add('selected');
            }

            // Determine indicator color
            let indicatorClass = '';
            if (student.followUp === 'Next Class') {
                indicatorClass = 'follow-up';
            } else if (student.overallStatus === 'Needs Help') {
                indicatorClass = 'needs-help';
            }

            item.innerHTML = `
                <span class="student-item-name">${student.name}</span>
                ${indicatorClass ? `<div class="student-item-indicator ${indicatorClass}"></div>` : ''}
            `;

            item.addEventListener('click', () => this.selectStudent(student.id));
            studentList.appendChild(item);
        });
    }

    selectStudent(studentId) {
        this.selectedStudentId = studentId;
        this.renderStudentList();
        this.renderDetailPanel();
    }

    renderDetailPanel() {
        const panel = document.getElementById('detailPanel');

        if (!this.selectedStudentId) {
            panel.innerHTML = `
                <div class="panel-placeholder">
                    <p>Select a student to view details</p>
                </div>
            `;
            return;
        }

        const student = this.students.find(s => s.id === this.selectedStudentId);
        if (!student) return;

        const statusBadgeClass = student.followUp === 'Next Class' ? 'follow-up' :
                                 student.overallStatus === 'Needs Help' ? 'needs-help' : 'on-track';

        panel.innerHTML = `
            <div class="detail-header">
                <div class="detail-name">${student.name}</div>
                <div class="detail-meta">
                    <span class="status-badge ${statusBadgeClass}">${student.followUp === 'Next Class' ? '⚠ Follow-up' : student.overallStatus}</span>
                </div>
            </div>

            <div class="form-section">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Attendance</label>
                        <select class="form-select" id="attendance" data-field="attendance">
                            ${ATTENDANCE_OPTIONS.map(opt => `<option value="${opt}" ${student.attendance === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Project Stage</label>
                        <select class="form-select" id="projectStage" data-field="projectStage">
                            ${PROJECT_STAGES.map(opt => `<option value="${opt}" ${student.projectStage === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Overall Status</label>
                        <select class="form-select" id="overallStatus" data-field="overallStatus">
                            ${OVERALL_STATUS.map(opt => `<option value="${opt}" ${student.overallStatus === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group">
                        <label class="form-label">Follow-up</label>
                        <select class="form-select" id="followUp" data-field="followUp">
                            ${FOLLOW_UP_STATUS.map(opt => `<option value="${opt}" ${student.followUp === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                </div>
            </div>

            <div class="form-section">
                <div class="form-group form-row full">
                    <label class="form-label">Class Note</label>
                    <textarea class="form-input" id="classNote" data-field="classNote" placeholder="Quick note about student progress...">${student.classNote}</textarea>
                </div>
                <div class="form-group form-row full">
                    <label class="form-label">Follow-up Note</label>
                    <textarea class="form-input" id="followUpNote" data-field="followUpNote" placeholder="What do they need to work on?">${student.followUpNote}</textarea>
                </div>
            </div>

            <div class="section-divider"></div>

            <div class="form-section">
                <div class="form-label" style="margin-bottom: 10px;">Evaluation</div>
                <div class="evaluation-grid">
                    <div class="form-group evaluation-item">
                        <label class="form-label" style="text-transform: none; font-weight: 500; font-size: 11px;">Concept</label>
                        <select class="form-select" id="evalConcept" data-field="evaluation.concept">
                            ${EVALUATION_LEVELS.map(opt => `<option value="${opt}" ${student.evaluation.concept === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group evaluation-item">
                        <label class="form-label" style="text-transform: none; font-weight: 500; font-size: 11px;">Craft / Execution</label>
                        <select class="form-select" id="evalCraft" data-field="evaluation.craft">
                            ${EVALUATION_LEVELS.map(opt => `<option value="${opt}" ${student.evaluation.craft === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group evaluation-item">
                        <label class="form-label" style="text-transform: none; font-weight: 500; font-size: 11px;">Presentation / Graphics</label>
                        <select class="form-select" id="evalPresentation" data-field="evaluation.presentation">
                            ${EVALUATION_LEVELS.map(opt => `<option value="${opt}" ${student.evaluation.presentation === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group evaluation-item">
                        <label class="form-label" style="text-transform: none; font-weight: 500; font-size: 11px;">Technical Deliverables</label>
                        <select class="form-select" id="evalTechnical" data-field="evaluation.technical">
                            ${EVALUATION_LEVELS.map(opt => `<option value="${opt}" ${student.evaluation.technical === opt ? 'selected' : ''}>${opt}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-group form-row full" style="margin-top: 12px;">
                    <label class="form-label">Evaluation Note</label>
                    <textarea class="form-input" id="evaluationNote" data-field="evaluationNote" placeholder="Feedback and observations...">${student.evaluationNote}</textarea>
                </div>
            </div>
        `;

        // Attach event listeners to form elements
        this.attachFormListeners();
    }

    attachFormListeners() {
        const formElements = document.querySelectorAll('[data-field]');
        formElements.forEach(element => {
            element.addEventListener('change', (e) => this.updateStudentField(e.target));
            element.addEventListener('input', (e) => this.updateStudentField(e.target));
        });
    }

    updateStudentField(element) {
        const field = element.getAttribute('data-field');
        const value = element.value;

        const student = this.students.find(s => s.id === this.selectedStudentId);
        if (!student) return;

        // Handle nested fields (e.g., evaluation.concept)
        if (field.includes('.')) {
            const parts = field.split('.');
            student[parts[0]][parts[1]] = value;
        } else {
            student[field] = value;
        }

        this.saveStudents();
        this.renderStudentList();
        this.updateFollowUpsStat();
    }

    updateFollowUpsStat() {
        const followUpsCount = this.students.filter(s => s.followUp === 'Next Class').length;
        const stat = document.getElementById('followUpsStat');
        if (stat) {
            stat.textContent = followUpsCount > 0 ? `${followUpsCount} follow-up(s) due today` : 'Follow-ups due today';
        }
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new StudioOSApp();
    console.log('Studio OS initialized successfully');
});

