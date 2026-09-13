const crypto = require('node:crypto');
const mutationLock=require('../services/game/mutation-lock');
const db = require('../db');
const get = (sql, args=[]) => new Promise((resolve,reject)=>db.get(sql,args,(e,r)=>e?reject(e):resolve(r)));
const run = (sql,args=[]) => new Promise((resolve,reject)=>db.run(sql,args,function(e){e?reject(e):resolve(this)}));
const fail = (message, status=403) => Object.assign(new Error(message), {status});
let ready;
const liveSessions=new Map();
async function revoke(value){if(!value)return;await run('DELETE FROM sessions WHERE token_hash = ?',[hash(value)]);for(const socket of liveSessions.get(hash(value))||[])socket.disconnect(true);liveSessions.delete(hash(value));}
function init() { return ready ||= run(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL)`); }
function token(req) { return String(req.headers.cookie || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('sf_session='))?.slice(11); }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
async function identity(req) {
    await init();
    const value = token(req);
    if (!value || !/^[a-f0-9]{64}$/.test(value)) throw fail('authentication_required',401);
    const row = await get('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?', [hash(value),Date.now()]);
    if (!row) throw fail('authentication_required',401);
    return Number(row.user_id);
}
async function issue(req,res,userId) {
    await init();
    const value = crypto.randomBytes(32).toString('hex');
    await run('DELETE FROM sessions WHERE expires_at <= ?', [Date.now()]);
    await revoke(token(req));
    await run('INSERT INTO sessions VALUES (?, ?, ?)',[hash(value),userId,Date.now()+7*86400000]);
    res.cookie('sf_session',value,{httpOnly:true,sameSite:'strict',secure:process.env.NODE_ENV==='production',maxAge:7*86400000,path:'/'});
}
async function logout(req,res) { await init(); const value=token(req); if(value) await run('DELETE FROM sessions WHERE token_hash = ?',[hash(value)]); res.clearCookie('sf_session',{path:'/'}); }
async function member(userId,gameId) {
    if (!Number.isSafeInteger(Number(gameId)) || !await get('SELECT 1 FROM game_players WHERE user_id = ? AND game_id = ?',[userId,gameId])) throw fail('not_a_game_member');
}
async function authorize(userId, data={}, {membership=true}={}) {
    for (const field of ['userId','creatorId','fromUserId']) if (data[field]!=null && Number(data[field])!==userId) throw fail('identity_mismatch');
    if (membership && data.gameId!=null) await member(userId,Number(data.gameId));
    for (const field of ['sectorId','destinationSectorId']) if(data[field]!=null) {
        const sector=await get('SELECT game_id FROM sectors WHERE id = ?',[data[field]]);
        if(!sector) throw fail('sector_not_found',404);
        await member(userId,sector.game_id);
        if(data.gameId!=null && Number(data.gameId)!==sector.game_id) throw fail('wrong_game');
    }
    for (const field of ['shipId','casterId','stationId','fromObjectId','objectId']) if(data[field]!=null) {
        const obj=await get('SELECT so.owner_id, so.sector_id, s.game_id FROM sector_objects so JOIN sectors s ON s.id=so.sector_id WHERE so.id = ?',[data[field]]);
        if(!obj || obj.owner_id!==userId) throw fail('not_owner');
        await member(userId,obj.game_id);
        if(data.gameId!=null && Number(data.gameId)!==obj.game_id) throw fail('wrong_game');
        if(data.sectorId!=null && Number(data.sectorId)!==obj.sector_id) throw fail('wrong_sector');
    }
}
function protectRouter(router,{lobby=false}={}) {
    for (const method of ['get','post','put','patch','delete']) {
        const original=router[method].bind(router);
        router[method]=(path,...handlers)=>original(path,async(req,res,next)=>{
            try {
                if(!sameOrigin(req)) throw fail('origin_not_allowed');
                const release=await mutationLock.acquire();
                let released=false;const done=()=>{if(!released){released=true;release();}};
                res.once('finish',done);res.once('close',done);
                req.userId=await identity(req);
                const data={...req.query,...req.body,...req.params};
                const membership=!(lobby && (method==='get' || path==='/join' || path==='/create'));
                await authorize(req.userId,data,{membership});
                // Existing handlers consume these fields; only the authenticated actor supplies identity.
                req.body ||= {}; req.body.userId=req.userId;
                if(path==='/create') req.body.creatorId=req.userId;
                req.query.userId=String(req.userId);
                next();
            } catch(e) { res.status(e.status||500).json({error:e.status?e.message:'authorization_failed'}); }
        },...handlers);
    }
}
function protectSockets(io) {
    io.use(async(socket,next)=>{
        try { if(!sameOrigin(socket.request)) throw fail('origin_not_allowed'); socket.userId=await identity(socket.request);const key=hash(token(socket.request));const group=liveSessions.get(key)||new Set();group.add(socket);liveSessions.set(key,group);socket.on('disconnect',()=>{group.delete(socket);if(!group.size)liveSessions.delete(key);});next(); } catch(e) {next(new Error(e.message));}
    });
}
function guardSocket(socket,db) {
    const original=socket.on.bind(socket);
    let pending=Promise.resolve();
    socket.on=(event,handler)=>original(event,(...args)=>{
      const task=async()=>{
        if(event==='disconnect') return handler(...args);
        try {
            const userId=await identity(socket.request);
            if(userId!==socket.userId) throw fail('authentication_required',401);
            let data=typeof args[0]==='object' && args[0] ? args[0] : {};
            if(['join-game','lock-turn','unlock-turn'].includes(event)) {
                data={gameId:args[0],userId:args[1]};
                if(args[1]!=null && Number(args[1])!==userId) throw fail('identity_mismatch');
                args[1]=userId;
            }
            if(event!=='join-game' && socket.gameId)data={...data,gameId:data.gameId??socket.gameId};
            await authorize(userId,data);
            if(event!=='join-game' && !socket.gameId) throw fail('join_game_first');
            if(event!=='join-game' && data.gameId!=null && Number(data.gameId)!==Number(socket.gameId)) throw fail('wrong_game');
            if(['lock-turn','unlock-turn'].includes(event)) {
                const turn=await get('SELECT turn_number,status FROM turns WHERE game_id=? ORDER BY turn_number DESC LIMIT 1',[data.gameId]);
                if(!turn || turn.status!=='waiting' || Number(args[2])!==turn.turn_number) throw fail('stale_turn');
            }
            return await handler(...args);
        } catch(e) {
            const cb=args.at(-1); const error=e.status?e.message:'request_failed';
            if(typeof cb==='function') cb({success:false,error}); else socket.emit('error',{message:error});
        }
      };
      pending=pending.then(()=>mutationLock.run(task),()=>mutationLock.run(task));
      return pending;
    });
}
module.exports={identity,issue,logout,sameOrigin,protectRouter,protectSockets,guardSocket,authorize};
