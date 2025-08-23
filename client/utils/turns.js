export function computeRemainingTurns(expiresTurn, currentTurn) {
    const expires = Number(expiresTurn);
    const current = Number(currentTurn);
    if (Number.isFinite(expires) && Number.isFinite(current)) {
        return Math.max(1, Math.floor(expires - current + 1));
    }
    return 1;
}


