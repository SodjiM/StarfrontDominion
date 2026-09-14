// Callers must serialize work on the shared connection using mutation-lock.
// Savepoints compose with an outer transaction without committing its work.
let sequence = 0;
async function withSavepoint(db, task) {
    const name = `operation_${++sequence}`;
    const run = sql => new Promise((resolve, reject) => db.run(sql, e => e ? reject(e) : resolve()));
    await run(`SAVEPOINT ${name}`);
    try {
        const result = await task();
        if (result?.success === false) await run(`ROLLBACK TO ${name}`);
        await run(`RELEASE ${name}`);
        return result;
    } catch (error) {
        await run(`ROLLBACK TO ${name}`);
        await run(`RELEASE ${name}`);
        throw error;
    }
}
module.exports = { withSavepoint };
