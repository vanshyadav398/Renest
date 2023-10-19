const crypto = require('crypto');
const Swarm = require('discovery-swarm');
const defaults = require('dat-swarm-defaults');
const sqlite3 = require('sqlite3').verbose();
const chain = require('./chain');
let CronJob = require('cron').CronJob;

const peers = {};
let connSeq = 0;
let channel = 'myBlockchain';

let registeredMiners = [];
let lastBlockMinedBy = null;

let MessageType = {
    REQUEST_BLOCK: 'requestBlock',
    RECEIVE_NEXT_BLOCK: 'receiveNextBlock',
    RECEIVE_NEW_BLOCK: 'receiveNewBlock',
    REQUEST_ALL_REGISTER_MINERS: 'requestAllRegisterMiners',
    REGISTER_MINER: 'registerMiner'
};

const myPeerId = crypto.randomBytes(32);
console.log('myPeerId: ' + myPeerId.toString('hex'));
const config = defaults({
    id: myPeerId,
});
const swarm = Swarm(config);

const db = new sqlite3.Database('./peers.db', (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the peers database.');
        db.run('CREATE TABLE IF NOT EXISTS peers (id TEXT PRIMARY KEY)');
    }
});

swarm.listen(3282); // Change the port to your desired port
console.log('Listening port: 3282');

swarm.join(channel);
swarm.on('connection', (conn, info) => {
    const seq = connSeq;
    const peerId = info.id.toString('hex');
    console.log(`Connected #${seq} to peer: ${peerId}`);
    if (info.initiator) {
        try {
            conn.setKeepAlive(true, 600);
        } catch (exception) {
            console.log('exception', exception);
        }
    }
    conn.on('data', data => {
        console.log('----------- Received Message start ----');
        console.log(
            'from: ' + peerId.toString('hex'),
            'to: ' + peerId.toString(data.to),
            'my: ' + myPeerId.toString('hex'),
            'type: ' + JSON.stringify(data.type)
        );
        console.log('----------- Received Message end ----');
        handleMessage(JSON.parse(data), seq);
    });

    conn.on('close', () => {
        console.log(`Connection ${seq} closed, peerId: ${peerId}`);
        if (peers[peerId].seq === seq) {
            delete peers[peerId];
        }
    });
    if (!peers[peerId]) {
        peers[peerId] = {};
    }
    peers[peerId].conn = conn;
    peers[peerId].seq = seq;
    connSeq++;
});

writeMessageToPeers = (type, data) => {
    for (let id in peers) {
        if (peers[id].conn) {
            console.log('-------- writeMessageToPeers start -------- ');
            console.log('type: ' + type + ', to: ' + id);
            console.log('-------- writeMessageToPeers end ----------- ');
            sendMessage(id, type, data);
        }
    }
};

writeMessageToPeerToId = (toId, type, data) => {
    for (let id in peers) {
        if (id === toId && peers[id].conn) {
            console.log('-------- writeMessageToPeerToId start --------');
            console.log('type: ' + type + ', to: ' + toId);
            console.log('-------- writeMessageToPeerToId end -----------');
            sendMessage(id, type, data);
        }
    }
};

sendMessage = (id, type, data) => {
    if (peers[id] && peers[id].conn) {
        peers[id].conn.write(JSON.stringify(
            {
                to: id,
                from: myPeerId,
                type: type,
                data: data
            }
        ));
    }
};

setTimeout(function () {
    writeMessageToPeers('hello', null);
}, 10000);

setTimeout(function () {
    writeMessageToPeers(MessageType.REQUEST_ALL_REGISTER_MINERS, null);
}, 5000);

setTimeout(function () {
    writeMessageToPeers(MessageType.REQUEST_BLOCK, { index: chain.getLatestBlock().index + 1 });
}, 5000);

setTimeout(async function () {
    registeredMiners.push(myPeerId.toString('hex'));
    await storePeer(myPeerId.toString('hex'));
    console.log('----------Register my miner --------------');
    console.log(registeredMiners);
    writeMessageToPeers(MessageType.REGISTER_MINER, registeredMiners);
    console.log('---------- Register my miner --------------');
}, 7000);

async function handleMessage(data, seq) {
    switch (data.type) {
        case MessageType.REQUEST_ALL_REGISTER_MINERS:
            console.log('-----------REQUEST_ALL_REGISTER_MINERS------------- ' + data.to);
            writeMessageToPeers(MessageType.REGISTER_MINER, registeredMiners);
            registeredMiners = JSON.parse(JSON.stringify(data.data));
            console.log('-----------REQUEST_ALL_REGISTER_MINERS------------- ' + data.to);
            break;
        case MessageType.REGISTER_MINER:
            console.log('-----------REGISTER_MINER------------- ' + data.to);
            let miners = JSON.stringify(data.data);
            registeredMiners = JSON.parse(miners);
            console.log(registeredMiners);
            console.log('-----------REGISTER_MINER------------- ' + data.to);
            break;
        default:
            // Handle other message types
    }

    console.log(`Connection ${seq} closed, peerId: ${data.from}`);
    if (peers[data.from] && peers[data.from].seq === seq) {
        delete peers[data.from];
        console.log('--- registeredMiners before: ' + JSON.stringify(registeredMiners));
        let index = registeredMiners.indexOf(data.from);
        if (index > -1)
            registeredMiners.splice(index, 1);
        console.log('--- registeredMiners end: ' + JSON.stringify(registeredMiners));
    }
}

const job = new CronJob('30 * * * * *', async function () {
    let minerIds = await getRegisteredMiners();
    let index = 0; // first block

    if (lastBlockMinedBy) {
        let newIndex = minerIds.indexOf(lastBlockMinedBy);

        if (newIndex !== -1) {
            index = (newIndex + 1 > minerIds.length - 1) ? 0 : newIndex + 1;
            lastBlockMinedBy = minerIds[index];
        }
    }

    console.log('-- REQUESTING NEW BLOCK FROM: ' + minerIds[index] + ', index: ' + index);
    console.log(JSON.stringify(minerIds));

    if (minerIds[index] === myPeerId.toString('hex')) {
        console.log('-----------create next block -----------------');
        let newBlock = await chain.generateNextBlock(null);
        await chain.addBlock(newBlock);
        console.log(JSON.stringify(newBlock));
        writeMessageToPeers(MessageType.RECEIVE_NEW_BLOCK, newBlock);
        console.log(JSON.stringify(chain.blockchain));
        console.log('-----------create next block -----------------');
    }
});

job.start();
