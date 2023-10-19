const crypto = require('crypto');
const Swarm = require('discovery-swarm');
const defaults = require('dat-swarm-defaults');
const chain = require("./chain");
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./blockchain.db');

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

// Create the miners table if it doesn't exist
db.serialize(function() {
  db.run("CREATE TABLE IF NOT EXISTS miners (miner_id TEXT)");
});

// Helper function to retrieve registered miners from SQLite
async function getRegisteredMiners() {
  return new Promise((resolve, reject) => {
    db.all('SELECT miner_id FROM miners', (err, rows) => {
      if (err) {
        reject(err);
      } else {
        const miners = rows.map(row => row.miner_id);
        resolve(miners);
      }
    });
  });
}

(async () => {
  let getPort;

  try {
    const module = await import('get-port');
    getPort = module.default;
    const port = await getPort();

    swarm.listen(port);
    console.log('Listening port: ' + port);

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
  } catch (error) {
    console.error('Error:', error);
  }
})();

writeMessageToPeers = (type, data) => {
  for (let id in peers) {
    if (peers[id].conn) {
      console.log('-------- writeMessageToPeers start -------- ');
      console.log('type: ' + type + ', to: ' + id);
      console.log('-------- writeMessageToPeers end ----------- ');
      sendMessage(id, type, data);
    }
  };
};

writeMessageToPeerToId = (toId, type, data) => {
  for (let id in peers) {
    if (id === toId && peers[id].conn) {
      console.log('-------- writeMessageToPeerToId start --------');
      console.log('type: ' + type + ', to: ' + toId);
      console.log('-------- writeMessageToPeerToId end -----------');
      sendMessage(id, type, data);
    };
  };
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

setTimeout(function(){
  writeMessageToPeers('hello', null);
}, 10000);

setTimeout(function(){
  writeMessageToPeers(MessageType.REQUEST_ALL_REGISTER_MINERS, null);
}, 5000);

setTimeout(function(){
  writeMessageToPeers(MessageType.REQUEST_BLOCK, {index: chain.getLatestBlock().index + 1});
}, 5000);

// Rest of your code

function handleMessage(data, seq) {
  switch (data.type) {
    case MessageType.REQUEST_ALL_REGISTER_MINERS:
      console.log('-----------REQUEST_ALL_REGISTER_MINERS------------- ' + data.to);
      getRegisteredMiners()
        .then(miners => {
          registeredMiners = miners;
          writeMessageToPeers(MessageType.REGISTER_MINER, registeredMiners);
        })
        .catch(err => {
          console.error('Error fetching miners:', err);
        });
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

const job = new CronJob('30 * * * * *', function() {
  let index = 0; // first block
  if (lastBlockMinedBy) {
    let newIndex = registeredMiners.indexOf(lastBlockMinedBy);
    index = (newIndex + 1 > registeredMiners.length - 1) ? 0 : newIndex + 1;
  }
  lastBlockMinedBy = registeredMiners[index];
  console.log('-- REQUESTING NEW BLOCK FROM: ' + registeredMiners[index] + ', index: ' + index);
  console.log(JSON.stringify(registeredMiners));
  if (registeredMiners[index] === myPeerId.toString('hex')) {
    console.log('-----------create next block -----------------');
    let newBlock = chain.generateNextBlock(null);
    chain.addBlock(newBlock);
    console.log(JSON.stringify(newBlock));
    writeMessageToPeers(MessageType.RECEIVE_NEW_BLOCK, new     block);
    console.log(JSON.stringify(chain.blockchain));
    console.log('-----------create next block -----------------');
  }
});
job.start();