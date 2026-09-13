const express = require('express');
const bcrypt = require('bcrypt');
const { UsersRepository } = require('../repositories/users.repo');
const usersRepo = new UsersRepository();
const router = express.Router();
const sessions = require('../middleware/auth');
const attempts=new Map();
router.use((req,res,next)=>{
    if(req.method!=='POST' || !['/login','/register'].includes(req.path))return next();
    const now=Date.now(),key=req.ip;
    for(const [ip,entry] of attempts)if(entry.until<=now)attempts.delete(ip);
    const entry=attempts.get(key)||{count:0,until:now+15*60*1000};attempts.set(key,entry);
    if(++entry.count>30)return res.status(429).json({error:'too_many_auth_attempts'});
    next();
});
router.use(async(req,res,next)=>{const release=await require('../services/game/mutation-lock').acquire();let done=false;const finish=()=>{if(!done){done=true;release();}};res.once('finish',finish);res.once('close',finish);next();});
router.use((req,res,next)=>sessions.sameOrigin(req)?next():res.status(403).json({error:'origin_not_allowed'}));
router.get('/me', async(req,res)=>{ try { const userId=await sessions.identity(req); res.json({userId}); } catch {res.status(401).json({error:'authentication_required'});} });
router.post('/logout', async(req,res)=>{ try { await sessions.logout(req,res); res.json({success:true}); } catch { res.status(500).json({error:'logout_failed'}); } });

router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 64 || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const hashed = await bcrypt.hash(password, 10);
        const user = await usersRepo.createUser(username, hashed);
        await sessions.issue(req, res, user.id);
        res.json({ userId: user.id, username: user.username });
    } catch (err) {
        if (err && err.code === 'SQLITE_CONSTRAINT') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 64 || Buffer.byteLength(password) > 72) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const user = await usersRepo.findByUsername(username);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await sessions.issue(req, res, user.id);
        res.json({ userId: user.id, username: user.username });
    } catch (err) {
        return res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router; 