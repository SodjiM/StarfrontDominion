#!/usr/bin/env node
const { diagnoseSector } = require('../server/services/world/generation-diagnostics');
const db = require('../server/db');

const sectorId = Number(process.argv[2]);
if (!Number.isInteger(sectorId) || sectorId <= 0) {
    console.error('Usage: node tools/diagnose-world.cjs <sectorId>');
    process.exitCode = 2;
} else {
    db.ready.then(async () => {
        const report = await diagnoseSector(sectorId);
        if (!report) process.exitCode = 1;
        else console.log(JSON.stringify(report, null, 2));
        db.close();
    }).catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
}
