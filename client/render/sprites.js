// Sprite registry, preloader, and simple sheet animator

const SPRITE_PATHS = {
    ship: 'assets/ships/explorer.png',
    explorer: 'assets/ships/explorer.png',
    'needle-gunship': 'assets/ships/needle-gunship.png',
    'swift-courier': 'assets/ships/swift-courier.png',
    'drill-skiff': 'assets/ships/drill-skiff.png',
    station: 'assets/structures/planet-station.png',
    'sun-station': 'assets/structures/sun-station.png',
    'planet-station': 'assets/structures/planet-station.png',
    'moon-station': 'assets/structures/moon-station.png',
    // Resource node sprites. Prefer mineral-name keys; fallbacks provided.
    resource: {
        'Aetherium': 'assets/resources/Aetherium.png',
        'Ardanium': 'assets/resources/Ardanium.png',
        'Auralite': 'assets/resources/Auralite.png',
        'Aurivex': 'assets/resources/Aurivex.png',
        'Corvexite-plasma': 'assets/resources/Corvexite-plasma.png',
        'Cryphos': 'assets/resources/Cryphos.png',
        'Crytite': 'assets/resources/Crytite.png',
        'Drakonium': 'assets/resources/Drakonium.png',
        'Ferrite-alloy': 'assets/resources/Ferrite-alloy.png',
        'Fluxium': 'assets/resources/Fluxium.png',
        'Gravium': 'assets/resources/Gravium.png',
        'Heliox-ore': 'assets/resources/Heliox-ore.png',
        'Kryon-dust': 'assets/resources/Kryon-dust.png',
        'Luminite': 'assets/resources/Luminite.png',
        'Magnetrine': 'assets/resources/Magnetrine.png',
        'Mythrion': 'assets/resources/Mythrion.png',
        'Nebryllium': 'assets/resources/Nebryllium.png',
        'Neurogel': 'assets/resources/Neurogel.png',
        'Oblivium': 'assets/resources/Oblivium.png',
        'Phasegold': 'assets/resources/Phasegold.png',
        'Pyronex': 'assets/resources/Pyronex.png',
        'Quarzon': 'assets/resources/Quarzon.png',
        'Riftstone': 'assets/resources/Riftstone.png',
        'Starforged-carbon': 'assets/resources/Starforged-carbon.png',
        'Tachytrium': 'assets/resources/Tachytrium.png',
        'Voidglass': 'assets/resources/Voidglass.png',
        'Vornite': 'assets/resources/Vornite.png',
        'Zerothium': 'assets/resources/Zerothium.png',
    },
    // Animated sheets (PNG + JSON descriptor)
    sheets: {
        
    }
};

const imageCache = new Map();
const sheetCache = new Map();

function loadImage(path) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = path;
    });
}

async function loadJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error('Failed to load JSON: ' + path);
    return res.json();
}

export async function preloadSprites() {
    const imagePaths = new Set();
    Object.entries(SPRITE_PATHS).forEach(([key, val]) => {
        if (key === 'sheets') return; // handled separately below
        if (typeof val === 'string') imagePaths.add(val);
        else if (val && typeof val === 'object') {
            Object.values(val).forEach(p => { if (typeof p === 'string') imagePaths.add(p); });
        }
    });
    // Load images
    await Promise.all([...imagePaths].map(async p => {
        if (!imageCache.has(p)) imageCache.set(p, await loadImage(p));
    }));
    // Load sheets
    const sheetEntries = SPRITE_PATHS.sheets || {};
    await Promise.all(Object.entries(sheetEntries).map(async ([key, jsonPath]) => {
        if (!sheetCache.has(key)) {
            const data = await loadJSON(jsonPath);
            const imgPath = data.image;
            const img = imageCache.get(imgPath) || await loadImage(imgPath);
            imageCache.set(imgPath, img);
            sheetCache.set(key, { image: img, ...data });
        }
    }));
}

export function getSpriteForObject(obj) {
    const meta = obj && obj.meta ? obj.meta : {};
    const typeKey = (meta.blueprintId || meta.hull || meta.stationClass || obj.type || '').toLowerCase();
    if (SPRITE_PATHS[typeKey] && imageCache.has(SPRITE_PATHS[typeKey])) return imageCache.get(SPRITE_PATHS[typeKey]);
    if (SPRITE_PATHS[obj.type] && imageCache.has(SPRITE_PATHS[obj.type])) return imageCache.get(SPRITE_PATHS[obj.type]);
    if (obj.type === 'resource_node') {
        // Prefer mineral-name sprite; match case-insensitively against keys
        const raw = String(meta.resourceType || meta.mineral || '');
        const slug = raw.toLowerCase().replace(/\s+/g, '-');
        let p = null;
        if (SPRITE_PATHS.resource) {
            // Exact key
            p = SPRITE_PATHS.resource[raw] || SPRITE_PATHS.resource[slug];
            if (!p) {
                // Case-insensitive lookup across keys
                const keys = Object.keys(SPRITE_PATHS.resource);
                const match = keys.find(k => k.toLowerCase().replace(/\s+/g, '-') === slug);
                if (match) p = SPRITE_PATHS.resource[match];
            }
        }
        if (!p) {
            // Fallback to category if provided
            const cat = (meta.category || '').toLowerCase();
            p = SPRITE_PATHS.resource && SPRITE_PATHS.resource[cat];
        }
        if (!p) {
            // Last fallback: legacy resourceType values 'rock'|'gas'|'energy'
            const r = (meta.resourceType || '').toLowerCase();
            p = SPRITE_PATHS.resource && SPRITE_PATHS.resource[r];
        }
        if (p && imageCache.has(p)) return imageCache.get(p);
    }
    const fallback = SPRITE_PATHS.ship;
    return fallback && imageCache.get(fallback);
}

export function getSheetForObject(obj) {
    const meta = obj && obj.meta ? obj.meta : {};
    const key = (meta.blueprintId || meta.hull || meta.stationClass || obj.type || '').toLowerCase();
    return sheetCache.get(key);
}

export function drawSheetFrame(ctx, sheet, animName, startedAtMs, x, y, size) {
    if (!sheet || !sheet.image) return false;
    const animations = sheet.animations || {};
    const anim = animations[animName] || animations.idle || null;
    if (!anim) return false;

    const elapsed = (performance.now() - (startedAtMs || 0)) / 1000;
    const fps = anim.fps || 8;
    const loop = anim.loop !== false;

    const framesCount = (anim.to - anim.from + 1);
    let frameIdx = Math.floor(elapsed * fps);
    if (loop) frameIdx = frameIdx % framesCount; else frameIdx = Math.min(frameIdx, framesCount - 1);
    const frame = anim.from + frameIdx;

    const padding = sheet.padding || 0;
    const fw = sheet.frameWidth;
    const fh = sheet.frameHeight;
    const cols = Math.max(1, Math.floor((sheet.image.width + padding) / (fw + padding)));
    const sx = padding + (frame % cols) * (fw + padding);
    const sy = padding + (anim.row || 0) * (fh + padding);

    const w = size;
    const h = size;
    const dx = x - w / 2;
    const dy = y - h / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sheet.image, sx, sy, fw, fh, dx, dy, w, h);
    return true;
}

export function getSpriteUrlForKey(key) {
    const p = SPRITE_PATHS[key];
    if (typeof p === 'string') return p;
    return null;
}

// Expose helpers on window for non-ESM renderers
if (typeof window !== 'undefined') {
    window.SFSprites = {
        getSpriteForObject,
        getSheetForObject,
        drawSheetFrame,
        getSpriteUrlForKey
    };
}


