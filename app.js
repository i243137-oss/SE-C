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

    // Sheet names for each day
    SHEET_NAMES: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],

    // Section to filter
    TARGET_SECTION: 'SE-C',

    // 2024 Batch subjects only (to exclude 2025 batch)
    BATCH_2024_SUBJECTS: [
        'SDA',          // Software Design & Architecture
        'DB',           // Database
        'COAL',         // Computer Organization & Assembly Language
        'SRE',          // Software Requirements Engineering
        'OS',           // Operating Systems
        'Pak Studies',  // Pak Studies (full name)
        'Pak',          // Pak Studies (short form)
        'Pakistan',     // Pakistan Studies
        'Studies'       // Backup to catch "Pak Studies"
    ],

    // Auto-refresh interval (5 minutes)
    REFRESH_INTERVAL: 5 * 60 * 1000,

    // Cache key for localStorage
    CACHE_KEY: 'se_section_c_schedule_2024',
    CACHE_TIMESTAMP_KEY: 'se_section_c_last_updated_2024',

    // Days of the week
    DAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
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

function parseSubject(content) {
    if (!content) return null;
    const match = content.match(/(.+?)\s*\(SE-C\)/i);
    return match ? match[1].trim() : content.replace(/\(SE-C\)/i, '').trim();
}

function isSectionC(content) {
    if (!content) return false;
    return content.toUpperCase().includes('(SE-C)');
}

/**
 * Check if the subject belongs to the 2024 batch
 * This filters out 2025 batch subjects like DLD, OOP, Entre, etc.
 */
function isBatch2024Subject(subject) {
    if (!subject) return false;
    const subjectUpper = subject.toUpperCase();
    return CONFIG.BATCH_2024_SUBJECTS.some(batchSubject =>
        subjectUpper.includes(batchSubject.toUpperCase())
    );
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
// Google Sheets Data Fetching via Visualization API
// ========================================

/**
 * Fetch data from Google Sheets using the Visualization API
 * Uses a CORS proxy when running from local file to bypass browser restrictions
 */
async function fetchGoogleSheetData(sheetName) {
    // Google Visualization API endpoint
    const baseUrl = `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;

    // Check if running from local file (needs CORS proxy)
    const isLocalFile = window.location.protocol === 'file:';

    // Use CORS proxy for local file access
    const url = isLocalFile
        ? `https://corsproxy.io/?${encodeURIComponent(baseUrl)}`
        : baseUrl;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const text = await response.text();

        // The response is wrapped in google.visualization.Query.setResponse(...)
        // We need to extract the JSON part
        const jsonMatch = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?$/);
        if (!jsonMatch) {
            throw new Error('Invalid response format');
        }

        const data = JSON.parse(jsonMatch[1]);

        if (data.status === 'error') {
            throw new Error(data.errors?.[0]?.message || 'Unknown error');
        }

        return data.table;
    } catch (error) {
        console.error(`Error fetching ${sheetName}:`, error);
        throw error;
    }
}

/**
 * Parse the Google Visualization API response and extract SE-C classes
 */
function parseGoogleSheetData(table, day) {
    const schedule = [];

    if (!table || !table.rows || !table.cols) {
        return schedule;
    }

    const cols = table.cols;
    const rows = table.rows;

    // Find the header row with time slots
    let headerRowIndex = -1;
    let timeColumns = [];

    for (let i = 0; i < Math.min(10, rows.length); i++) {
        const row = rows[i];
        if (!row || !row.c) continue;

        for (let j = 1; j < row.c.length; j++) {
            const cell = row.c[j];
            const value = cell?.v || cell?.f || '';
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
    for (let j = 1; j < headerRow.c.length; j++) {
        const cell = headerRow.c[j];
        const value = cell?.v || cell?.f || '';
        if (typeof value === 'string' && value.includes(':')) {
            timeColumns.push({ index: j, time: value.trim() });
        }
    }

    // Parse each data row after header
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !row.c) continue;

        // Get room from first column
        const roomCell = row.c[0];
        const room = roomCell?.v || roomCell?.f || '';

        if (!room || room.toLowerCase().includes('lab sessions') || room.toLowerCase().includes('timetable')) {
            continue;
        }

        // Check each time column for SE-C classes
        for (const { index, time } of timeColumns) {
            const cell = row.c[index];
            const cellContent = cell?.v || cell?.f || '';

            if (typeof cellContent === 'string' && isSectionC(cellContent)) {
                const subject = parseSubject(cellContent);

                // Only include subjects from the 2024 batch
                if (!isBatch2024Subject(subject)) {
                    continue;
                }

                const isLab = isLabRoom(room) || isLabTimeSlot(time);

                schedule.push({
                    day,
                    time,
                    subject,
                    room: room.trim(),
                    isLab,
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

        console.log('🔄 Fetching schedule from Google Sheets...');

        // Fetch each day in parallel
        const fetchPromises = CONFIG.SHEET_NAMES.map(async (day) => {
            try {
                const table = await fetchGoogleSheetData(day);
                const daySchedule = parseGoogleSheetData(table, day);
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

    return `
        <div class="schedule-card ${typeClass} subject-color-${colorIndex}" style="animation-delay: ${delay}s">
            <div class="card-time">
                <span class="time-start">${time.start}</span>
                <span class="time-separator">to</span>
                <span class="time-end">${time.end}</span>
            </div>
            <div class="card-details">
                <h3 class="subject-name">${cls.subject || 'Unknown'}</h3>
                <div class="room-info">
                    <span>📍</span>
                    <span>${cls.room || 'TBA'}</span>
                </div>
            </div>
            <div class="card-badge">
                <span class="badge badge-${badgeType}">${cls.isLab ? '🔬 Lab' : '📚 Lecture'}</span>
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
    console.log('📊 Using Google Visualization API for live data');

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
