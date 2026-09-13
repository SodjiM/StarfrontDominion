// The initial characterization checks have been replaced by correctness regressions.
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const result=spawnSync(process.execPath,['--test',path.join(__dirname,'../test/navigation.test.cjs')],{stdio:'inherit'});
process.exitCode=result.status ?? 1;
