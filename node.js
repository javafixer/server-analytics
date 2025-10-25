const express = require('express');
const path = require('path');
const app = express();
const PORT = 80;
const fs = require('fs');
const { status } = require('minecraft-server-util'); // Minecraft ping
app.use(express.json()); // <--- THIS IS REQUIRED

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Optional: default route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/java.js', (req, res) => {
    res.sendFile(path.join(__dirname, "java.js"));
});
app.get('/styles.css', (req, res) => {
    res.sendFile(path.join(__dirname, "styles.css"));
});
app.get('/analytics.html', (req, res) => {
    res.sendFile(path.join(__dirname, "analytics.html"));
});
app.get('/mc_history.json', (req, res) => {
    res.sendFile(path.join(__dirname, "mc_history.json"));
});
app.get('/servers.json', (req, res) => {
    res.sendFile(path.join(__dirname, "servers.json"));
});
app.get('/submit.html', (req, res) => {
    res.sendFile(path.join(__dirname, "submit.html"));
});
app.post('/save-stats', (req, res) => {
    console.log('Received body:', req.body); // should now show an object
    const point = req.body;

    if (!point || typeof point.players === 'undefined') {
        return res.status(400).json({ error: 'Invalid data' });
    }

    const filePath = path.join(__dirname, 'mc_history.json');
    let history = [];

    if (fs.existsSync(filePath)) {
        try {
            history = JSON.parse(fs.readFileSync(filePath));
        } catch {}
    }

    history.push(point);

    try {
        fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
        res.json({ status: 'ok', point });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

async function fetchServerStatus(server) {
    try {
        const result = await status(server.address, 25565, { timeout: 1000 }); // default port 25565
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

async function autoFetchLoop() {
    const serversPath = path.join(__dirname, 'servers.json');
    const historyPath = path.join(__dirname, 'mc_history.json');

    if (!fs.existsSync(serversPath)) return console.error('servers.json not found!');

    const servers = JSON.parse(fs.readFileSync(serversPath));
    let history = fs.existsSync(historyPath) ? JSON.parse(fs.readFileSync(historyPath)) : [];

    for (const server of servers) {
        const point = await fetchServerStatus(server);
        if (point) {
            history.push(point);
            console.log(`[${new Date().toLocaleTimeString()}] ${server.name}: ${point.players} players`);
        }
    }

    fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

// Fetch every 1 second
setInterval(autoFetchLoop, 10000);
autoFetchLoop(); // initia  l fetch

// Start server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
const serversPath = path.join(__dirname, 'servers.json');

// Submit new server
app.post('/api/submit', (req, res) => {
    const { name, address } = req.body;
    if (!name || !address) return res.status(400).json({ error: 'Missing name or address' });

    let servers = [];
    if (fs.existsSync(serversPath)) {
        servers = JSON.parse(fs.readFileSync(serversPath));
    }

    // Prevent duplicates
    if (servers.some(s => s.address === address)) {
        return res.status(400).json({ error: 'Server already exists' });
    }

    servers.push({ name, address });
    fs.writeFileSync(serversPath, JSON.stringify(servers, null, 2));
    res.json({ status: 'ok' });
});

// Check server status
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
