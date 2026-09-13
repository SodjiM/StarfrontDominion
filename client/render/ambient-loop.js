// One clock per canvas, independent of mouse events. Returns a complete disposer.
export function startAmbientLoop(game, env = window) {
    game._stopAmbientLoop?.();
    const doc = env.document;
    const motion = env.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = null, stopped = false, previous = null, elapsed = 0;
    function tick(now) {
        frame = null;
        if (stopped || doc.hidden || motion.matches) return;
        if (!game.canvas?.isConnected) { stop(); return; }
        if (previous === null) previous = now;
        const delta = now - previous;
        if (delta >= 1000 / 30) {
            elapsed += Math.min(delta, 100);
            previous = now;
            game.animationTime = elapsed / 1000;
            game.render({ ambient: true });
        }
        frame = env.requestAnimationFrame(tick);
    }
    function sync() {
        if (frame !== null) env.cancelAnimationFrame(frame);
        frame = null;
        previous = null;
        game.reducedMotion = motion.matches;
        if (motion.matches) game.animationTime = 0;
        if (!doc.hidden && !stopped) {
            game.render();
            if (!motion.matches) frame = env.requestAnimationFrame(tick);
        }
    }
    function stop() {
        stopped = true;
        if (frame !== null) env.cancelAnimationFrame(frame);
        doc.removeEventListener('visibilitychange', sync);
        motion.removeEventListener('change', sync);
        env.removeEventListener('pagehide', hide);
        env.removeEventListener('pageshow', sync);
    }
    function hide(event) { if (event.persisted) { if (frame !== null) env.cancelAnimationFrame(frame); frame = null; } else stop(); }
    doc.addEventListener('visibilitychange', sync);
    motion.addEventListener('change', sync);
    env.addEventListener('pagehide', hide);
    env.addEventListener('pageshow', sync);
    game._stopAmbientLoop = stop;
    sync();
    return stop;
}
