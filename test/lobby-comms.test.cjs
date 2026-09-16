const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_PATH = ':memory:';
const db = require('../server/db');
const { UsersRepository } = require('../server/repositories/users.repo');
const { LobbyMessagesRepository, MAX_PAGE_SIZE } = require('../server/repositories/lobby-messages.repo');

const users = new UsersRepository();
const messages = new LobbyMessagesRepository();
let alice;

before(async () => {
    await db.ready;
    alice = await users.createUser('lobby-comms-test', 'not-a-password');
});

after(async () => new Promise(resolve => db.close(resolve)));

test('lobby messages trim text, return username, and paginate newest-first', async () => {
    const first = await messages.create({ userId: alice.id, text: '  Hello lobby  ' });
    const second = await messages.create({ userId: alice.id, text: 'Second message' });
    assert.equal(first.text, 'Hello lobby');
    assert.equal(first.username, 'lobby-comms-test');

    const page = await messages.list({ limit: 1 });
    assert.deepEqual(page.messages.map(message => message.id), [second.id]);
    assert.equal(page.messages[0].userId, alice.id);
    assert.equal(page.nextBefore, second.id);

    const older = await messages.list({ limit: 1, before: page.nextBefore });
    assert.deepEqual(older.messages.map(message => message.id), [first.id]);
    assert.equal(older.nextBefore, null);
});

test('lobby message validation rejects blank, oversized, and invalid page requests', async () => {
    await assert.rejects(() => messages.create({ userId: alice.id, text: ' \n\t ' }), /Message text is required/);
    await assert.rejects(() => messages.create({ userId: alice.id, text: 'x'.repeat(501) }), /500 characters/);
    await assert.rejects(() => messages.list({ limit: MAX_PAGE_SIZE + 1 }), /Limit must be/);
    await assert.rejects(() => messages.list({ before: 0 }), /positive message id/);
});
