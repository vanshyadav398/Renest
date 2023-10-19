const moment = require("moment");
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./blockchain.db');

// Import Block and BlockHeader classes from block.js
const { Block, BlockHeader } = require("./block.js");

const getGenesisBlock = () => {
    const blockHeader = new BlockHeader(1, null, "0x1bc3300000000000000000000000000000000000000000000", moment().unix());
    return new Block(blockHeader, 0, null);
};

const getLatestBlock = () => blockchain[blockchain.length - 1];

const addBlock = (newBlock) => {
    const prevBlock = getLatestBlock();
    if (prevBlock.index < newBlock.index && newBlock.blockHeader.previousBlockHeader === prevBlock.blockHeader.merkleRoot) {
        blockchain.push(newBlock);
        storeBlock(newBlock);
    }
};

// Store a block in the SQLite database with "block_index" instead of "index"
const storeBlock = (newBlock) => {
    const insertBlockQuery = 'INSERT INTO blocks (block_index, data) VALUES (?, ?)';
    db.run(insertBlockQuery, [newBlock.index, JSON.stringify(newBlock)], (err) => {
        if (err) {
            return console.log('Error storing block in the database:', err.message);
        }
        console.log('--- Inserting block index: ' + newBlock.index);
    });
};

// Retrieve a block from the SQLite database using "block_index"
const getDbBlock = (index, res) => {
    const selectBlockQuery = 'SELECT data FROM blocks WHERE block_index = ?';
    db.get(selectBlockQuery, [index], (err, row) => {
        if (err) {
            return res.send(JSON.stringify(err));
        }
        return res.send(row.data);
    });
};

const generateNextBlock = (txns) => {
    const prevBlock = getLatestBlock();
    const prevMerkleRoot = prevBlock.blockHeader.merkleRoot;
    const nextIndex = prevBlock.index + 1;
    const nextTime = moment().unix();
    const nextMerkleRoot = CryptoJS.SHA256(1, prevMerkleRoot, nextTime).toString();

    const blockHeader = new BlockHeader(1, prevMerkleRoot, nextMerkleRoot, nextTime);
    const newBlock = new Block(blockHeader, nextIndex, txns);
    blockchain.push(newBlock);
    storeBlock(newBlock);
    return newBlock;
};

// Initialize the blockchain with the genesis block
const blockchain = [getGenesisBlock()];

module.exports = {
    addBlock,
    getBlock: (index) => (blockchain.length - 1 >= index) ? blockchain[index] : null,
    blockchain,
    getLatestBlock,
    generateNextBlock,
};

// Create the "blocks" table in the SQLite database
db.run('CREATE TABLE IF NOT EXISTS blocks (block_index INTEGER PRIMARY KEY, data TEXT)');

