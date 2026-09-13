// A single SQLite connection has a single transaction owner across all games.
let tail=Promise.resolve();
async function acquire(){let release;const prior=tail;tail=new Promise(r=>{release=r});await prior;return release;}
async function run(task){const release=await acquire();try{return await task();}finally{release();}}
module.exports={acquire,run};
