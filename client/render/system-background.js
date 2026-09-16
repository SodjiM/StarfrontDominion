// Cosmetics use only the server-provided system archetype, never hidden objects.
const images = new Map();
export function backgroundFamily(archetype = '') {
    return /nebula|wormhole|graviton/.test(String(archetype).toLowerCase()) ? 'nebula' : 'open-space';
}
export function coverRect(sw, sh, width, height) {
    const scale = Math.max(width / sw, height / sh);
    return [(width-sw*scale)/2, (height-sh*scale)/2, sw*scale, sh*scale];
}
export function drawSystemBackground(ctx, canvas, game) {
    const family = backgroundFamily(game.gameState?.sector?.archetype);
    let asset = images.get(family);
    if (!asset && typeof Image !== 'undefined') {
        const image = new Image(); asset = { image, ready: false }; images.set(family,asset);
        image.onload = () => { asset.ready = true; game.render(); };
        image.onerror = () => { asset.failed = true; };
        image.src = '/assets/backgrounds/systems/' + family + '.webp';
    }
    const key = [family,canvas.width,canvas.height,!!asset?.ready].join(':');
    if (game._backgroundCache?.key !== key) {
        const layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
        const paint = layer.getContext('2d'); paint.fillStyle = '#060c15'; paint.fillRect(0,0,layer.width,layer.height);
        if (asset?.ready) {
            paint.globalAlpha = .9;
            paint.drawImage(asset.image,...coverRect(asset.image.naturalWidth,asset.image.naturalHeight,layer.width,layer.height));
        }
        game._backgroundCache = { key, layer };
    }
    ctx.drawImage(game._backgroundCache.layer,0,0);
}
