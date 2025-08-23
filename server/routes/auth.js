const express = require('express');
const bcrypt = require('bcrypt');
const { UsersRepository } = require('../repositories/users.repo');
const usersRepo = new UsersRepository();
const router = express.Router();

router.post('/register', async (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const hashed = await bcrypt.hash(password, 10);
        const user = await usersRepo.createUser(username, hashed);
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
    
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }
    
    try {
        const user = await usersRepo.findByUsername(username);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        res.json({ userId: user.id, username: user.username });
    } catch (err) {
        return res.status(500).json({ error: 'Login failed' });
    }
});

module.exports = router; 