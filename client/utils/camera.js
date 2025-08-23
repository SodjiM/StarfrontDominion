export function screenToWorld(client, screenX, screenY) {
    const centerX = client.canvas.width / 2;
    const centerY = client.canvas.height / 2;
    const worldX = Math.round(client.camera.x + (screenX - centerX) / client.tileSize);
    const worldY = Math.round(client.camera.y + (screenY - centerY) / client.tileSize);
    return { worldX, worldY };
}

export function centerOn(client, x, y) {
    client.camera.x = x; client.camera.y = y; client.render && client.render();
}


