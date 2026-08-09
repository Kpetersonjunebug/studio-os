// Studio OS - Student Data and Constants

const STUDENTS = [
    { id: 1, name: 'Maya Chen' },
    { id: 2, name: 'Jordan Lee' },
    { id: 3, name: 'Ava Martinez' },
    { id: 4, name: 'Noah Williams' },
    { id: 5, name: 'Sofia Patel' },
    { id: 6, name: 'Liam O\'Connor' },
    { id: 7, name: 'Emma Thompson' },
    { id: 8, name: 'Oliver Grant' },
    { id: 9, name: 'Isabella Rodriguez' },
    { id: 10, name: 'Ethan Kim' },
    { id: 11, name: 'Charlotte Lewis' },
    { id: 12, name: 'Mason Brown' },
    { id: 13, name: 'Amelia Johnson' },
    { id: 14, name: 'Logan Davis' },
    { id: 15, name: 'Harper White' },
    { id: 16, name: 'Benjamin Taylor' },
    { id: 17, name: 'Evelyn Jackson' },
    { id: 18, name: 'Aiden Anderson' }
];

const PROJECT_STAGES = [
    'Research',
    'Ideation',
    'Sketching',
    'Planning',
    'Design Development',
    'Technical Work',
    'Presentation'
];

const OVERALL_STATUS = [
    'Strong',
    'Developing',
    'Needs Help'
];

const FOLLOW_UP_STATUS = [
    'None',
    'Next Class',
    'Complete'
];

const EVALUATION_LEVELS = [
    'Not Evaluated',
    'Needs Help',
    'Developing',
    'Strong'
];

const ATTENDANCE_OPTIONS = [
    'Present',
    'Absent',
    'Tardy'
];

// Default student record
function createDefaultStudent(studentInfo) {
    return {
        ...studentInfo,
        attendance: 'Present',
        projectStage: 'Sketching',
        overallStatus: 'Developing',
        classNote: '',
        followUp: 'None',
        followUpNote: '',
        evaluation: {
            concept: 'Not Evaluated',
            craft: 'Not Evaluated',
            presentation: 'Not Evaluated',
            technical: 'Not Evaluated'
        },
        evaluationNote: ''
    };
}

// Initialize all students with default data
const DEFAULT_STUDENTS = STUDENTS.map(createDefaultStudent);
