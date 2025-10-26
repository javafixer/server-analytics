const express = require('express');
const path = require('path');
const fs = require('fs');
const { status } = require('minecraft-server-util');
const { parse } = require('jsonc-parser'); // Lenient JSON parser

const app = express();
const PORT = 80;
app.use(express.json());

// ------------------- HELPERS -------------------

// Repair JSON files with nested objects, using jsonc-parser
function repairJsonArray(filePath) {
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, 'utf-8');
    const errors = [];
    const data = parse(content, errors, { allowTrailingComma: true });

    if (errors.length) {
        console.warn(`Found ${errors.length} JSON errors in ${filePath}, attempting repair.`);
    }

    if (!Array.isArray(data)) return [];
    return data;
}

// Atomically write JSON to prevent partial corruption
function safeWriteJson(filePath, data) {
    const tmpFile = filePath + '.tmp';
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2));
    fs.renameSync(tmpFile, filePath);
}

// ------------------- STATIC FILES -------------------

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/java.js', (req, res) => res.sendFile(path.join(__dirname, "java.js")));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, "styles.css")));
app.get('/analytics.html', (req, res) => res.sendFile(path.join(__dirname, "analytics.html")));
app.get('/mc_history.json', (req, res) => res.sendFile(path.join(__dirname, "mc_history.json")));
app.get('/servers.json', (req, res) => res.sendFile(path.join(__dirname, "servers.json")));
app.get('/submit.html', (req, res) => res.sendFile(path.join(__dirname, "submit.html")));

// ------------------- SAVE STATS -------------------

app.post('/save-stats', (req, res) => {
    console.log('Received body:', req.body);
    const point = req.body;

    if (!point || typeof point.players === 'undefined') {
        return res.status(400).json({ error: 'Invalid data' });
    }

    const historyPath = path.join(__dirname, 'mc_history.json');
    let history = repairJsonArray(historyPath);

    history.push(point);

    try {
        safeWriteJson(historyPath, history);
        res.json({ status: 'ok', point });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// ------------------- FETCH SERVER STATUS -------------------

async function fetchServerStatus(server) {
    try {
        const result = await status(server.address, 25565, { timeout: 1000 });
        return {
            t: Date.now(),
            players: result.players.online,
            meta: {
                addr: server.address,
                name: server.name,
                version: result.version.name,
                maxPlayers: result.players.max
            }
        };
    } catch (err) {
        console.error(`Failed to ping ${server.address}:`, err.message);
        return null;
    }
}

// ------------------- AUTO FETCH LOOP -------------------

async function autoFetchLoop() {
    const serversPath = path.join(__dirname, 'servers.json');
    const historyPath = path.join(__dirname, 'mc_history.json');

    if (!fs.existsSync(serversPath)) return console.error('servers.json not found!');

    const servers = repairJsonArray(serversPath);
    let history = repairJsonArray(historyPath);

    for (const server of servers) {
        const point = await fetchServerStatus(server);
        if (point) {
            history.push(point);
            console.log(`[${new Date().toLocaleTimeString()}] ${server.name}: ${point.players} players`);
        }
    }

    safeWriteJson(historyPath, history);
}

setInterval(autoFetchLoop, 10000);
autoFetchLoop(); // initial fetch

// ------------------- SUBMIT NEW SERVER -------------------

const serversPath = path.join(__dirname, 'servers.json');

app.post('/api/submit', (req, res) => {
    const { name, address } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Missing name or address' });

    let servers = repairJsonArray(serversPath);

    if (servers.some(s => s.address === address)) {
        return res.status(400).json({ error: 'Server already exists' });
    }

    servers.push({ name, address });
    safeWriteJson(serversPath, servers);

    res.json({ status: 'ok' });
});

// ------------------- CHECK SERVER STATUS -------------------

app.get('/api/check', async (req, res) => {
    const ip = req.query.ip;
    if (!ip) return res.status(400).json({ online: false });

    try {
        const result = await status(ip, 25565, { timeout: 1000 });
        res.json({ online: true, players: result.players.online });
    } catch {
        res.json({ online: false });
    }
});

// ------------------- START SERVER -------------------

app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
