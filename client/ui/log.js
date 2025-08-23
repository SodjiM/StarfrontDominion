export function addLogEntry(game, message, type = 'info') {
    const logContainer = document.getElementById('activityLog');
    if (!logContainer) return;
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
    const entries = logContainer.querySelectorAll('.log-entry');
    if (entries.length > 50) entries[0].remove();
}


