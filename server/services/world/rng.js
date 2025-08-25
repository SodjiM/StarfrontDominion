function mulberry32(seed) {
    let a = seed >>> 0;
    return function() {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), (a | 1));
        t ^= t + Math.imul(t ^ (t >>> 7), (t | 61));
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function randFloat(rng, min, max) { return rng() * (max - min) + min; }
function choice(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

module.exports = { mulberry32, hashString, randInt, randFloat, choice };


