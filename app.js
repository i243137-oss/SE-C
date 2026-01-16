/**
 * BS SE Section C Schedule Application
 * Fetches and displays class schedule from Google Sheets using Google Visualization API
 */

// ========================================
// Configuration
// ========================================
const CONFIG = {
    // Google Sheet ID
    SHEET_ID: '1ZQJqdArlwCS965uw4sbJrB6j8rEPfZerMT7X8qkXSzY',

    // Google Sheets API v4 Key (obfuscated)
    // IMPORTANT: Restrict this key in Google Cloud Console to your domain/IP
    get API_KEY() {
        // Obfuscated using base64 encoding
        const parts = ['QUl6YVN5RElQdlhfcGpt', 'QTdldHhZRHQwY0J5eVox', 'Yl9KaFJSdVRr'];
        return atob(parts.join(''));
    },

    // Sheet names for each day
    SHEET_NAMES: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],

    // Section to filter
    TARGET_SECTION: 'SE-C',

    // Target batch color (2024 batch SE-C cells have this background color)
    // Hex #85200c = RGB(133, 32, 12) = floats (0.522, 0.125, 0.047)
    BATCH_COLOR: { r: 0.522, g: 0.125, b: 0.047 },
    
    // Color matching tolerance
    COLOR_TOLERANCE: 0.05,

    // Auto-refresh interval (5 minutes)
    REFRESH_INTERVAL: 5 * 60 * 1000,

    // Cache key for localStorage
    CACHE_KEY: 'se_section_c_schedule_2024',
    CACHE_TIMESTAMP_KEY: 'se_section_c_last_updated_2024',

    // Days of the week
    DAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
};

// ========================================
// State Management
// ========================================
const state = {
    schedule: [],
    filteredSchedule: [],
    currentView: 'today',
    currentDayFilter: 'all',
    searchQuery: '',
    isLoading: true,
    error: null,
    lastUpdated: null,
    dataSource: 'loading'
};

// ========================================
// DOM Elements
// ========================================
const elements = {
    loadingState: document.getElementById('loadingState'),
    errorState: document.getElementById('errorState'),
    errorMessage: document.getElementById('errorMessage'),
    scheduleContent: document.getElementById('scheduleContent'),
    viewToday: document.getElementById('viewToday'),
    viewWeek: document.getElementById('viewWeek'),
    viewFiltered: document.getElementById('viewFiltered'),
    todayCards: document.getElementById('todayCards'),
    filteredCards: document.getElementById('filteredCards'),
    weekTableBody: document.getElementById('weekTableBody'),
    navTabs: document.querySelectorAll('.nav-tab'),
    dayFilters: document.getElementById('dayFilters'),
    dayBtns: document.querySelectorAll('.day-btn'),
    searchInput: document.getElementById('searchInput'),
    clearSearch: document.getElementById('clearSearch'),
    lastUpdated: document.getElementById('lastUpdated'),
    themeToggle: document.getElementById('themeToggle'),
    refreshBtn: document.getElementById('refreshBtn'),
    retryBtn: document.getElementById('retryBtn'),
    todayInfo: document.getElementById('todayInfo'),
    currentDayName: document.getElementById('currentDayName'),
    currentFullDate: document.getElementById('currentFullDate'),
    nextClassInfo: document.getElementById('nextClassInfo'),
    noClassesToday: document.getElementById('noClassesToday'),
    noResults: document.getElementById('noResults')
};

// ========================================
// Utility Functions
// ========================================

// Regex pattern for matching embedded time in cell text
// Matches patterns like "09:30-11:15", "9:30-11:15", "09:30 - 11:15", "09:30–11:15"
const EMBEDDED_TIME_PATTERN = /(\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2})/;

function getCurrentDay() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[new Date().getDay()];
}

function formatDate(date) {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function formatTime(timeStr) {
    if (!timeStr) return { start: '', end: '' };
    const parts = timeStr.split('-');
    return {
        start: parts[0] ? parts[0].trim() : '',
        end: parts[1] ? parts[1].trim() : ''
    };
}

function isLabRoom(room) {
    return room && room.toLowerCase().includes('lab');
}

function isLabTimeSlot(time) {
    if (!time) return false;
    // Lab slots are typically 2h45min long
    const labTimes = ['08:30-11:15', '11:30-02:15', '02:30-05:15'];
    return labTimes.some(labTime => time.includes(labTime) || labTime.includes(time));
}

/**
 * Extract embedded time from cell text
 * Matches patterns like "09:30-11:15", "9:30-11:15", "09:30 - 11:15", "09:30–11:15"
 * @param {string} cellText - Cell content to search for time
 * @returns {string|null} Normalized time string "HH:MM-HH:MM" or null if not found
 */
function extractEmbeddedTime(cellText) {
    if (!cellText) return null;
    
    const match = cellText.match(EMBEDDED_TIME_PATTERN);
    
    if (match) {
        // Normalize: remove spaces and use standard hyphen
        return match[1].replace(/\s+/g, '').replace('–', '-');
    }
    
    return null;
}

/**
 * Clean subject name by removing embedded time and section pattern
 * @param {string} cellText - Original cell content
 * @param {string|null} embeddedTime - Embedded time to remove (if present)
 * @returns {string} Cleaned subject name
 */
function cleanSubjectName(cellText, embeddedTime) {
    if (!cellText) return '';
    
    let subject = cellText;
    
    // Remove embedded time if present
    if (embeddedTime) {
        // Remove the original time pattern (may have spaces/en-dash)
        subject = subject.replace(EMBEDDED_TIME_PATTERN, '');
    }
    
    // Remove section pattern like (SE-C)
    subject = subject.replace(/\(SE-C\)/gi, '');
    
    // Clean up extra spaces and trim
    subject = subject.replace(/\s+/g, ' ').trim();
    
    return subject;
}

/**
 * Parse subject name and status from cell content
 * Handles cancelled/rescheduled prefixes and embedded time
 * @param {string} content - Cell content to parse
 * @returns {{subject: string|null, status: string, embeddedTime: string|null}} 
 *          Object containing:
 *          - subject: Cleaned subject name (time and section removed)
 *          - status: 'normal', 'cancelled', 'rescheduled', or 'makeup'
 *          - embeddedTime: Extracted time in format "HH:MM-HH:MM" or null
 */
function parseSubjectAndStatus(content) {
    if (!content) return { subject: null, status: 'normal', embeddedTime: null };
    
    const contentLower = content.toLowerCase();
    let status = 'normal';
    let cleanContent = content;
    
    // Check for status keywords
    if (contentLower.includes('cancel')) {
        status = 'cancelled';
        cleanContent = content.replace(/cancell?e?d/gi, '').trim();
    } else if (contentLower.includes('reschedule')) {
        status = 'rescheduled';
        cleanContent = content.replace(/rescheduled?/gi, '').trim();
    } else if (contentLower.includes('postpone')) {
        status = 'rescheduled';
        cleanContent = content.replace(/postponed?/gi, '').trim();
    } else if (contentLower.includes('makeup')) {
        status = 'makeup';
        cleanContent = content.replace(/makeup/gi, '').trim();
    }
    
    // Extract embedded time
    const embeddedTime = extractEmbeddedTime(cleanContent);
    
    // Clean subject name (remove embedded time and section pattern)
    const subject = cleanSubjectName(cleanContent, embeddedTime);
    
    return { subject, status, embeddedTime };
}

function isSectionC(content) {
    if (!content) return false;
    return content.toUpperCase().includes('(SE-C)');
}

/**
 * Check if a color matches the target batch color
 * Returns true if the RGB values are within tolerance
 */
function matchesBatchColor(cellColor) {
    if (!cellColor || !cellColor.red || !cellColor.green || !cellColor.blue) {
        return false;
    }
    
    const r = cellColor.red;
    const g = cellColor.green;
    const b = cellColor.blue;
    
    const target = CONFIG.BATCH_COLOR;
    const tolerance = CONFIG.COLOR_TOLERANCE;
    
    return Math.abs(r - target.r) <= tolerance &&
           Math.abs(g - target.g) <= tolerance &&
           Math.abs(b - target.b) <= tolerance;
}

function getSubjectColorIndex(subject) {
    if (!subject) return 1;
    let hash = 0;
    for (let i = 0; i < subject.length; i++) {
        hash = subject.charCodeAt(i) + ((hash << 5) - hash);
    }
    return (Math.abs(hash) % 8) + 1;
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const cleanTime = timeStr.replace(/[^\d:]/g, '');
    const [hours, minutes] = cleanTime.split(':').map(s => parseInt(s) || 0);
    let adjustedHours = hours;
    if (hours >= 1 && hours <= 5) {
        adjustedHours = hours + 12;
    }
    return adjustedHours * 60 + minutes;
}

function getNextClass(todayClasses) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const upcoming = todayClasses
        .map(cls => {
            const time = formatTime(cls.time);
            const startMinutes = timeToMinutes(time.start);
            return { ...cls, startMinutes };
        })
        .filter(cls => cls.startMinutes > currentMinutes)
        .sort((a, b) => a.startMinutes - b.startMinutes);

    return upcoming[0] || null;
}

// ========================================
// Google Sheets API v4 Data Fetching
// ========================================

/**
 * Fetch data from Google Sheets using API v4 with includeGridData
 * This gives us access to cell formatting (colors) for proper batch filtering
 */
async function fetchGoogleSheetData(sheetName) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}?ranges=${encodeURIComponent(sheetName)}&includeGridData=true&key=${CONFIG.API_KEY}`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message || 'API error');
        }

        // Return the first sheet's data
        return data.sheets?.[0]?.data?.[0];
    } catch (error) {
        console.error(`Error fetching ${sheetName}:`, error);
        throw error;
    }
}

/**
 * Parse the Google Sheets API v4 response and extract SE-C classes with color filtering
 */
function parseGoogleSheetData(gridData, day) {
    const schedule = [];

    if (!gridData || !gridData.rowData) {
        return schedule;
    }

    const rows = gridData.rowData;

    // Find the header row with time slots
    let headerRowIndex = -1;
    let timeColumns = [];

    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = rows[i];
        if (!row || !row.values) continue;

        for (let j = 1; j < row.values.length; j++) {
            const cell = row.values[j];
            const value = cell?.formattedValue || '';
            if (typeof value === 'string' && value.includes(':') && value.includes('-')) {
                headerRowIndex = i;
                break;
            }
        }
        if (headerRowIndex !== -1) break;
    }

    if (headerRowIndex === -1) {
        console.warn(`No header row found for ${day}`);
        return schedule;
    }

    // Extract time columns from header row
    const headerRow = rows[headerRowIndex];
    for (let j = 1; j < headerRow.values.length; j++) {
        const cell = headerRow.values[j];
        const value = cell?.formattedValue || '';
        if (typeof value === 'string' && value.includes(':')) {
            timeColumns.push({ index: j, time: value.trim() });
        }
    }

    // Parse each data row after header
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.values) continue;

        // Get room from first column
        const roomCell = row.values[0];
        const room = roomCell?.formattedValue || '';

        if (!room || room.toLowerCase().includes('lab sessions') || room.toLowerCase().includes('timetable')) {
            continue;
        }

        // Check each time column for SE-C classes with matching color
        for (const { index, time } of timeColumns) {
            if (index >= row.values.length) continue;
            
            const cell = row.values[index];
            const cellContent = cell?.formattedValue || '';
            const backgroundColor = cell?.effectiveFormat?.backgroundColor;

            // Filter by: 1) Contains SE-C text, 2) Has matching background color
            if (typeof cellContent === 'string' && isSectionC(cellContent)) {
                // Check color match for batch filtering
                if (!matchesBatchColor(backgroundColor)) {
                    continue;
                }

                const { subject, status, embeddedTime } = parseSubjectAndStatus(cellContent);
                
                // Use embedded time if present, otherwise use column header time
                const finalTime = embeddedTime || time;
                
                const isLab = isLabRoom(room) || isLabTimeSlot(finalTime);

                schedule.push({
                    day,
                    time: finalTime,
                    subject,
                    room: room.trim(),
                    isLab,
                    status,
                    teacher: '', // Placeholder for future enhancement
                    rawContent: cellContent
                });
            }
        }
    }

    return schedule;
}

/**
 * Main fetch function - fetches all days
 */
async function fetchSchedule() {
    try {
        state.isLoading = true;
        state.error = null;
        updateUI();

        const schedule = [];
        let successCount = 0;

        console.log('🔄 Fetching schedule from Google Sheets API v4...');

        // Fetch each day in parallel
        const fetchPromises = CONFIG.SHEET_NAMES.map(async (day) => {
            try {
                const gridData = await fetchGoogleSheetData(day);
                const daySchedule = parseGoogleSheetData(gridData, day);
                console.log(`✅ ${day}: Found ${daySchedule.length} SE-C classes`);
                schedule.push(...daySchedule);
                successCount++;
            } catch (error) {
                console.warn(`⚠️ Failed to fetch ${day}:`, error.message);
            }
        });

        await Promise.allSettled(fetchPromises);

        if (successCount > 0 && schedule.length > 0) {
            state.schedule = schedule;
            state.dataSource = 'live';
            state.lastUpdated = new Date();
            cacheSchedule(schedule);
            console.log(`✅ Loaded ${schedule.length} total classes from ${successCount} days`);
        } else {
            // Try loading from cache
            const cached = loadCachedSchedule();
            if (cached && cached.schedule.length > 0) {
                state.schedule = cached.schedule;
                state.dataSource = 'cached';
                state.lastUpdated = new Date(cached.timestamp);
                console.log('📦 Loaded from cache');
            } else {
                state.error = 'Unable to fetch schedule. Please ensure the Google Sheet is shared as "Anyone with the link can view".';
            }
        }

        state.isLoading = false;
        updateUI();

    } catch (error) {
        console.error('❌ Error fetching schedule:', error);
        state.error = 'Unable to load schedule. Please check your internet connection.';
        state.isLoading = false;
        updateUI();
    }
}

function cacheSchedule(schedule) {
    try {
        localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify(schedule));
        localStorage.setItem(CONFIG.CACHE_TIMESTAMP_KEY, new Date().toISOString());
    } catch (error) {
        console.warn('Failed to cache schedule:', error);
    }
}

function loadCachedSchedule() {
    try {
        const schedule = localStorage.getItem(CONFIG.CACHE_KEY);
        const timestamp = localStorage.getItem(CONFIG.CACHE_TIMESTAMP_KEY);

        if (schedule && timestamp) {
            return {
                schedule: JSON.parse(schedule),
                timestamp
            };
        }
    } catch (error) {
        console.warn('Failed to load cached schedule:', error);
    }
    return null;
}

// ========================================
// UI Rendering
// ========================================

function updateUI() {
    elements.loadingState.classList.toggle('hidden', !state.isLoading);
    elements.errorState.classList.toggle('hidden', !state.error || state.isLoading);
    elements.scheduleContent.classList.toggle('hidden', state.isLoading || state.error);

    if (state.error) {
        elements.errorMessage.textContent = state.error;
        return;
    }

    if (!state.isLoading) {
        updateLastUpdated();
        updateTodayInfo();
        applyFilters();
        renderCurrentView();
    }
}

function updateLastUpdated() {
    if (state.lastUpdated) {
        const timeStr = state.lastUpdated.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
        });
        const sourceLabel = state.dataSource === 'live' ? '' : ` (${state.dataSource})`;
        elements.lastUpdated.querySelector('.update-text').textContent = `Updated ${timeStr}${sourceLabel}`;
    }
}

function updateTodayInfo() {
    const today = new Date();
    const dayName = getCurrentDay();

    elements.currentDayName.textContent = dayName;
    elements.currentFullDate.textContent = formatDate(today);

    const todayClasses = state.schedule.filter(cls => cls.day === dayName);
    const nextClass = getNextClass(todayClasses);

    const nextSubject = elements.nextClassInfo.querySelector('.next-subject');
    const nextTime = elements.nextClassInfo.querySelector('.next-time');

    if (nextClass) {
        nextSubject.textContent = nextClass.subject;
        const time = formatTime(nextClass.time);
        nextTime.textContent = `${time.start} • ${nextClass.room}`;
    } else if (todayClasses.length > 0) {
        nextSubject.textContent = 'All done!';
        nextTime.textContent = 'No more classes today';
    } else {
        nextSubject.textContent = 'No Classes';
        nextTime.textContent = dayName === 'Saturday' || dayName === 'Sunday' ? 'Weekend! 🎉' : 'Day off';
    }
}

function applyFilters() {
    let filtered = [...state.schedule];

    if (state.currentDayFilter !== 'all') {
        filtered = filtered.filter(cls => cls.day === state.currentDayFilter);
    }

    if (state.searchQuery) {
        const query = state.searchQuery.toLowerCase();
        filtered = filtered.filter(cls =>
            (cls.subject && cls.subject.toLowerCase().includes(query)) ||
            (cls.room && cls.room.toLowerCase().includes(query))
        );
    }

    const dayOrder = CONFIG.DAYS;
    filtered.sort((a, b) => {
        const dayDiff = dayOrder.indexOf(a.day) - dayOrder.indexOf(b.day);
        if (dayDiff !== 0) return dayDiff;
        return timeToMinutes(formatTime(a.time).start) - timeToMinutes(formatTime(b.time).start);
    });

    state.filteredSchedule = filtered;
}

function renderCurrentView() {
    elements.viewToday.classList.add('hidden');
    elements.viewWeek.classList.add('hidden');
    elements.viewFiltered.classList.add('hidden');

    if (state.searchQuery || state.currentDayFilter !== 'all') {
        elements.viewFiltered.classList.remove('hidden');
        renderFilteredView();
    } else if (state.currentView === 'today') {
        elements.viewToday.classList.remove('hidden');
        renderTodayView();
    } else {
        elements.viewWeek.classList.remove('hidden');
        renderWeekView();
    }
}

function renderTodayView() {
    const currentDay = getCurrentDay();
    const todayClasses = state.schedule
        .filter(cls => cls.day === currentDay)
        .sort((a, b) => timeToMinutes(formatTime(a.time).start) - timeToMinutes(formatTime(b.time).start));

    if (todayClasses.length === 0) {
        elements.todayCards.innerHTML = '';
        elements.noClassesToday.classList.remove('hidden');
        return;
    }

    elements.noClassesToday.classList.add('hidden');
    elements.todayCards.innerHTML = todayClasses.map((cls, idx) => createScheduleCard(cls, false, idx)).join('');
}

function renderFilteredView() {
    if (state.filteredSchedule.length === 0) {
        elements.filteredCards.innerHTML = '';
        elements.noResults.classList.remove('hidden');
        return;
    }

    elements.noResults.classList.add('hidden');
    elements.filteredCards.innerHTML = state.filteredSchedule
        .map((cls, idx) => createScheduleCard(cls, true, idx))
        .join('');
}

function renderWeekView() {
    const allTimes = [...new Set(state.schedule.map(cls => cls.time))];

    allTimes.sort((a, b) => {
        const aStart = timeToMinutes(a.split('-')[0]);
        const bStart = timeToMinutes(b.split('-')[0]);
        return aStart - bStart;
    });

    let html = '';

    for (const time of allTimes) {
        html += '<tr>';
        html += `<td class="time-cell">${time}</td>`;

        for (const day of CONFIG.DAYS) {
            const cls = state.schedule.find(c => c.day === day && c.time === time);

            if (cls) {
                const typeClass = cls.isLab ? 'lab' : 'lecture';
                const colorIndex = getSubjectColorIndex(cls.subject);
                html += `
                    <td>
                        <div class="table-class ${typeClass}" style="border-left-color: var(--subject-${colorIndex})">
                            <div class="table-subject">${cls.subject}</div>
                            <div class="table-room">📍 ${cls.room}</div>
                        </div>
                    </td>
                `;
            } else {
                html += '<td></td>';
            }
        }

        html += '</tr>';
    }

    elements.weekTableBody.innerHTML = html;
}

function createScheduleCard(cls, showDay = false, index = 0) {
    const time = formatTime(cls.time);
    const typeClass = cls.isLab ? 'is-lab' : '';
    const badgeType = cls.isLab ? 'lab' : 'lecture';
    const colorIndex = getSubjectColorIndex(cls.subject);
    const delay = index * 0.05;
    
    // Status badge and subject styling
    let statusBadge = '';
    let subjectClass = '';
    
    if (cls.status === 'cancelled') {
        statusBadge = '<span class="badge badge-cancelled">Cancelled</span>';
        subjectClass = 'subject-cancelled';
    } else if (cls.status === 'rescheduled') {
        statusBadge = '<span class="badge badge-rescheduled">Rescheduled</span>';
    } else if (cls.status === 'makeup') {
        statusBadge = '<span class="badge badge-makeup">Makeup</span>';
    }
    
    // Teacher info (if available)
    const teacherInfo = cls.teacher ? `
        <div class="teacher-info">
            <span>👤</span>
            <span>${cls.teacher}</span>
        </div>
    ` : '';

    return `
        <div class="schedule-card ${typeClass} subject-color-${colorIndex}" style="animation-delay: ${delay}s">
            <div class="card-time">
                <span class="time-start">${time.start}</span>
                <span class="time-separator">to</span>
                <span class="time-end">${time.end}</span>
            </div>
            <div class="card-details">
                <h3 class="subject-name ${subjectClass}">${cls.subject || 'Unknown'}</h3>
                <div class="room-info">
                    <span>📍</span>
                    <span>${cls.room || 'TBA'}</span>
                </div>
                ${teacherInfo}
            </div>
            <div class="card-badge">
                <span class="badge badge-${badgeType}">${cls.isLab ? '🔬 Lab' : '📚 Lecture'}</span>
                ${statusBadge}
                ${showDay ? `<span class="badge badge-day">${cls.day}</span>` : ''}
            </div>
        </div>
    `;
}

// ========================================
// Event Handlers
// ========================================

function initEventListeners() {
    elements.navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            elements.navTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            state.currentView = tab.dataset.view;
            state.searchQuery = '';
            state.currentDayFilter = 'all';
            elements.searchInput.value = '';
            updateDayFilterButtons();
            renderCurrentView();
            updateTodayInfoVisibility();
        });
    });

    elements.dayBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.dayBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.currentDayFilter = btn.dataset.day;
            applyFilters();
            renderCurrentView();
        });
    });

    elements.searchInput.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        applyFilters();
        renderCurrentView();
    });

    elements.clearSearch.addEventListener('click', () => {
        elements.searchInput.value = '';
        state.searchQuery = '';
        applyFilters();
        renderCurrentView();
    });

    elements.searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            elements.searchInput.value = '';
            state.searchQuery = '';
            applyFilters();
            renderCurrentView();
        }
    });

    elements.themeToggle.addEventListener('click', toggleTheme);

    elements.refreshBtn.addEventListener('click', () => {
        elements.refreshBtn.classList.add('spinning');
        fetchSchedule().finally(() => {
            setTimeout(() => {
                elements.refreshBtn.classList.remove('spinning');
            }, 500);
        });
    });

    elements.retryBtn.addEventListener('click', fetchSchedule);
}

function updateDayFilterButtons() {
    elements.dayBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.day === state.currentDayFilter);
    });
}

function updateTodayInfoVisibility() {
    elements.todayInfo.classList.toggle('hidden', state.currentView !== 'today');
}

// ========================================
// Theme Management
// ========================================

function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (prefersDark) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('theme')) {
            document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
        }
    });
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

// ========================================
// Auto Refresh
// ========================================

function startAutoRefresh() {
    setInterval(() => {
        console.log('🔄 Auto-refreshing schedule...');
        fetchSchedule();
    }, CONFIG.REFRESH_INTERVAL);
}

// ========================================
// Initialize Application
// ========================================

async function init() {
    console.log('🚀 Initializing BS SE Section C Schedule App...');
    console.log('📊 Using Google Sheets API v4 with color-based filtering');

    initTheme();
    initEventListeners();
    updateTodayInfoVisibility();

    await fetchSchedule();
    startAutoRefresh();

    console.log('✅ App initialized!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
