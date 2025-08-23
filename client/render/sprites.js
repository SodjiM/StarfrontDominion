// Sprite registry, preloader, and simple sheet animator

const SPRITE_PATHS = {
    ship: 'assets/ships/ship.png',
    explorer: 'assets/ships/explorer.png',
    'needle-gunship': 'assets/ships/needle-gunship.png',
    'swift-courier': 'assets/ships/swift-courier.png',
    'drill-skiff': 'assets/ships/drill-skiff.png',
    station: 'assets/structures/station.png',
    'sun-station': 'assets/structures/sun-station.png',
    'planet-station': 'assets/structures/planet-station.png',
    'moon-station': 'assets/structures/moon-station.png',
    'storage-box': 'assets/structures/storage-box.png',
    'warp-beacon': 'assets/structures/warp-beacon.png',
    'interstellar-gate': 'assets/structures/interstellar-gate.png',
    resource: {
        rock: 'assets/resources/rock.png',
        gas: 'assets/resources/gas.png',
        energy: 'assets/resources/energy.png'
    },
    // Animated sheets (PNG + JSON descriptor)
    sheets: {
        explorer: 'assets/sheets/explorer.sheet.json'
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
        const r = (meta.resourceType || '').toLowerCase();
        const p = SPRITE_PATHS.resource && SPRITE_PATHS.resource[r];
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


