export function timeAgo(isoString) {
    try {
        const then = new Date(isoString).getTime();
        const now = Date.now();
        const seconds = Math.max(0, Math.floor((now - then) / 1000));
        const units = [
            ['year', 31536000],
            ['month', 2592000],
            ['week', 604800],
            ['day', 86400],
            ['hour', 3600],
            ['minute', 60],
            ['second', 1],
        ];
        for (const [name, secs] of units) {
            if (seconds >= secs) {
                const value = Math.floor(seconds / secs);
                return `${value} ${name}${value !== 1 ? 's' : ''} ago`;
            }
        }
        return 'just now';
    } catch (e) { return ''; }
}

export function renderPresence(p){
    const now = Date.now();
    const lastSeen = p.lastSeenAt ? new Date(p.lastSeenAt).getTime() : 0;
    const lastActivity = p.lastActivityAt ? new Date(p.lastActivityAt).getTime() : lastSeen;
    const idleMs = now - lastActivity;
    if (p.online) {
        if (idleMs >= 180000) { return `🟠 Idle · ${timeAgo(new Date(now - idleMs).toISOString())}`; }
        return '🟢 Online';
    }
    return `⚪ Offline${p.lastSeenAt ? ' · seen ' + timeAgo(p.lastSeenAt) : ''}`;
}


