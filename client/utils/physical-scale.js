// One physical geometry contract for generation, navigation, combat, and UI.
(function(root) {
    const VERSION = 'physical-scale-v1';
    function metaOf(o) { if (typeof o?.meta === 'string') { try { return JSON.parse(o.meta) || {}; } catch { return {}; } } return o?.meta || {}; }
    function width(o) {
        const m = metaOf(o), key = String(m.blueprintId || m.stationClass || m.structureType || m.shipClass || m.shipType || m.hull || m.class || o?.type || '').toLowerCase();
        if (o?.type === 'resource_node') return 2;
        if (o?.type === 'station' || o?.type === 'starbase' || key.endsWith('-station')) return key === 'sun-station' || key === 'shipyard' ? 13 : key === 'moon-station' || key === 'outpost' ? 5 : 9;
        if (o?.type === 'ship' || o?.type === 'wreck') {
            if (/carrier|capital|battleship|dreadnought/.test(key)) return 5;
            if (/cruiser/.test(key)) return 3;
            if (/courier|scout/.test(key)) return 1;
            if (/explorer|frigate|skiff|gunship|mining/.test(key)) return 2;
        const cls = String(m.class || m.shipClass || m.shipType || '').toLowerCase();
            return /carrier|capital|battleship/.test(cls) ? 5 : /cruiser/.test(cls) ? 3 : /frigate|mining/.test(cls) ? 2 : 1;
        }
        if (/platform|interstellar-gate/.test(key)) return 3;
        if (/turret/.test(key)) return 2;
        return 1;
    }
    function isDisk(o) { return ['sun','star','planet','moon','black-hole','graviton-sink'].includes(o?.celestial_type || o?.type); }
    function isSolid(o) { return isDisk(o) || !['belt','nebula','wormhole','jump-gate','derelict'].includes(o?.celestial_type || o?.type); }
    // x/y is the central occupied tile for odd sizes, the NW central tile for even sizes.
    // Thus a 2x2 at (10,10) occupies (10,10)..(11,11); a 5x5 occupies (8,8)..(12,12).
    function shape(o) {
        if (isDisk(o)) return { x: Number(o.x), y: Number(o.y), radius: Math.max(0,Number(o.radius)||0), disk: true };
        const w = width(o), offset = w % 2 ? 0 : 0.5;
        return { x: Number(o.x) + offset, y: Number(o.y) + offset, half: (w - 1)/2, width: w, disk: false };
    }
    function gap(a,b,metric='euclidean') {
        return shapeGap(shape(a),shape(b),metric);
    }
    function shapeGap(A,B,metric='euclidean') {
        const dx=Math.abs(A.x-B.x), dy=Math.abs(A.y-B.y);
        if (A.disk && B.disk) return Math.max(0,Math.hypot(dx,dy)-A.radius-B.radius);
        if (A.disk || B.disk) { const disk=A.disk?A:B, rect=A.disk?B:A; return Math.max(0,Math.hypot(Math.max(0,dx-rect.half),Math.max(0,dy-rect.half))-disk.radius); }
        const gx=Math.max(0,dx-A.half-B.half),gy=Math.max(0,dy-A.half-B.half);
        return metric==='chebyshev'?Math.max(gx,gy):Math.hypot(gx,gy);
    }
    function overlaps(a,b) { return gap(a,b) <= 1e-7; }
    function inBounds(o,margin=0) { const s=shape(o),r=s.disk?s.radius:s.half; return s.x-r>=margin && s.y-r>=margin && s.x+r<=4999-margin && s.y+r<=4999-margin; }
    function adjacent(a,b) { return !overlaps(a,b) && gap(a,b,'chebyshev')<=1.000001; }
    function extent(o) { const s=shape(o); return s.disk?s.radius:Math.SQRT2*s.width/2; }
    function anchorDistance(host,station) { return extent(host)+extent(station)+12+(isDisk(host)&&['sun','star'].includes(host.celestial_type||host.type)?30:0); }
    const api={VERSION,metaOf,width,isDisk,isSolid,shape,shapeGap,gap,overlaps,inBounds,adjacent,extent,anchorDistance};
    if(typeof module!=='undefined'&&module.exports)module.exports=api;
    if(root)root.SFPhysicalScale=api;
})(typeof window!=='undefined'?window:null);
