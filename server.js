require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const compression = require('compression');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Enable CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(compression());
app.use(express.json());
app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public')));
// ========== CHATTER DATA MANAGEMENT ==========
const CHATTER_DATA_FILE = path.join(__dirname, 'chatter-data.json');

let chatterData = {
    allTime: {
        topChatters: {},
        totalPoints: 0,
        totalWinners: 0,
        mostWins: {},
        lastUpdated: null
    },
    sessions: [],
    channelData: {}
};

// Load existing data if file exists
function loadChatterData() {
    try {
        if (fs.existsSync(CHATTER_DATA_FILE)) {
            const data = fs.readFileSync(CHATTER_DATA_FILE, 'utf8');
            if (data.trim()) {
                const parsed = JSON.parse(data);
                chatterData = parsed;
                console.log('📊 Loaded chatter data from file');
                console.log(`   ${Object.keys(chatterData.allTime?.topChatters || {}).length} all-time chatters`);
                console.log(`   ${(chatterData.sessions || []).length} sessions saved`);
            } else {
                console.log('📊 Chatter data file is empty, using default');
            }
        } else {
            console.log('📊 No chatter-data.json found, will create on first save');
        }
    } catch (e) {
        console.error('Error loading chatter data:', e);
    }
}

function saveChatterData() {
    try {
        fs.writeFileSync(CHATTER_DATA_FILE, JSON.stringify(chatterData, null, 2));
        console.log('💾 Saved chatter data to:', CHATTER_DATA_FILE);
    } catch (e) {
        console.error('Error saving chatter data:', e);
    }
}

// Load on startup
loadChatterData();

// Auto-save every 30 seconds
setInterval(saveChatterData, 30000);

// Save on process exit
process.on('SIGINT', () => {
    console.log('Saving chatter data before exit...');
    saveChatterData();
    process.exit(0);
});
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'merged.html'));
});

app.get('/overlay', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overlay.html'));
});

// ========== SHARED PARTICIPANTS & SLOTS (for Slot War overlay) ==========
let currentParticipants = [];
let selectedSlotA = null;
let selectedSlotB = null;

function broadcastParticipants() {
    const data = JSON.stringify({ type: 'participants', data: currentParticipants });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

function broadcastSlots() {
    const data = JSON.stringify({ type: 'slots', data: { teamA: selectedSlotA, teamB: selectedSlotB } });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(data);
    });
}

wss.on('connection', (ws) => {
    console.log('🟢 WebSocket client connected');
    ws.send(JSON.stringify({ type: 'participants', data: currentParticipants }));
    ws.send(JSON.stringify({ type: 'slots', data: { teamA: selectedSlotA, teamB: selectedSlotB } }));

    ws.on('message', (message) => {
        try {
            const { type, data } = JSON.parse(message);
            if (type === 'updateParticipants') {
                currentParticipants = data;
                broadcastParticipants();
            } else if (type === 'updateSlots') {
                selectedSlotA = data.teamA;
                selectedSlotB = data.teamB;
                broadcastSlots();
            }
        } catch (err) { console.error('WS message error', err); }
    });

    ws.on('close', () => console.log('🔴 WebSocket client disconnected'));
});

// HTTP fallbacks
app.post('/api/participants', express.json(), (req, res) => {
    const { participants } = req.body;
    if (participants) {
        currentParticipants = participants;
        broadcastParticipants();
    }
    res.json({ ok: true });
});

app.get('/api/participants', (req, res) => res.json(currentParticipants));

app.post('/api/slots', express.json(), (req, res) => {
    const { teamA, teamB } = req.body;
    if (teamA !== undefined) selectedSlotA = teamA;
    if (teamB !== undefined) selectedSlotB = teamB;
    broadcastSlots();
    res.json({ ok: true });
});

app.get('/api/slots', (req, res) => res.json({ teamA: selectedSlotA, teamB: selectedSlotB }));

// ========== KICK OAUTH ==========
const KICK_CLIENT_ID = process.env.KICK_CLIENT_ID;
const KICK_CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
const REDIRECT_URI = process.env.KICK_REDIRECT_URI || 'http://localhost:3000/auth/kick/callback';
const pendingLogins = new Map();
// ========== CHATTER POINTS API ==========

// Save all-time data from client
app.post('/api/chatter/alltime', express.json(), (req, res) => {
    try {
        const { channel, data } = req.body;
        
        if (!channel || !data) {
            return res.status(400).json({ error: 'Missing channel or data' });
        }
        
        // Initialize channel data if needed
        if (!chatterData.channelData[channel]) {
            chatterData.channelData[channel] = {
                allTime: {
                    topChatters: {},
                    totalPoints: 0,
                    totalWinners: 0,
                    mostWins: {}
                },
                sessions: []
            };
        }
        
        const channelData = chatterData.channelData[channel];
        
        // Update all-time stats (merge client data)
        if (data.topChatters) {
            for (const [username, stats] of Object.entries(data.topChatters)) {
                if (!channelData.allTime.topChatters[username]) {
                    channelData.allTime.topChatters[username] = {
                        totalPoints: 0,
                        totalMessages: 0,
                        wins: 0
                    };
                }
                const existing = channelData.allTime.topChatters[username];
                existing.totalPoints += stats.totalPoints || stats.points || 0;
                existing.totalMessages += stats.totalMessages || stats.messages || 0;
                existing.wins += stats.wins || 0;
            }
        }
        
        // Update total points
        if (data.totalPoints) {
            channelData.allTime.totalPoints += data.totalPoints;
            chatterData.allTime.totalPoints += data.totalPoints;
        }
        
        // Update total winners
        if (data.totalWinners) {
            channelData.allTime.totalWinners += data.totalWinners;
            chatterData.allTime.totalWinners += data.totalWinners;
        }
        
        // Update most wins
        if (data.mostWins) {
            for (const [username, wins] of Object.entries(data.mostWins)) {
                if (!channelData.allTime.mostWins[username]) {
                    channelData.allTime.mostWins[username] = 0;
                }
                channelData.allTime.mostWins[username] += wins;
            }
        }
        
        // Add session to history
        if (data.sessionData) {
            const sessionEntry = {
                sessionId: data.sessionData.sessionId || Date.now().toString(),
                date: new Date().toISOString(),
                totalPoints: data.sessionData.totalPoints || 0,
                chatCount: data.sessionData.chatCount || 0,
                winnerCount: data.sessionData.winnerCount || 0,
                topChatters: data.sessionData.topChatters || [],
                winners: data.sessionData.winners || []
            };
            
            channelData.sessions.push(sessionEntry);
            
            // Keep last 50 sessions per channel
            if (channelData.sessions.length > 50) {
                channelData.sessions = channelData.sessions.slice(-50);
            }
            
            // Also keep global sessions list
            if (!chatterData.sessions) {
                chatterData.sessions = [];
            }
            chatterData.sessions.push(sessionEntry);
            if (chatterData.sessions.length > 100) {
                chatterData.sessions = chatterData.sessions.slice(-100);
            }
        }
        
        channelData.allTime.lastUpdated = Date.now();
        chatterData.allTime.lastUpdated = Date.now();
        
        // Save to file
        saveChatterData();
        
        res.json({ 
            ok: true,
            message: 'All-time data saved successfully'
        });
    } catch (err) {
        console.error('Error saving all-time data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get all-time data for a channel
app.get('/api/chatter/alltime/:channel', (req, res) => {
    try {
        const channel = req.params.channel;
        
        if (!chatterData.channelData[channel]) {
            return res.json({
                channel: channel,
                allTime: {
                    topChatters: {},
                    totalPoints: 0,
                    totalWinners: 0,
                    mostWins: {}
                },
                sessions: []
            });
        }
        
        const channelData = chatterData.channelData[channel];
        res.json({
            channel: channel,
            allTime: channelData.allTime,
            sessions: channelData.sessions.slice(-10) // Last 10 sessions
        });
    } catch (err) {
        console.error('Error fetching all-time data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get session history (paginated)
app.get('/api/chatter/sessions/:channel', (req, res) => {
    try {
        const channel = req.params.channel;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        
        if (!chatterData.channelData[channel]) {
            return res.json({ sessions: [], total: 0, page: 1, limit: limit });
        }
        
        const sessions = chatterData.channelData[channel].sessions || [];
        const total = sessions.length;
        const start = (page - 1) * limit;
        const paginated = sessions.slice(-start - limit, sessions.length - start);
        
        res.json({
            sessions: paginated.reverse(),
            total: total,
            page: page,
            limit: limit
        });
    } catch (err) {
        console.error('Error fetching sessions:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Reset all-time data for a channel (use with caution)
app.post('/api/chatter/reset/:channel', express.json(), (req, res) => {
    try {
        const channel = req.params.channel;
        const { confirm } = req.body;
        
        if (confirm !== 'YES_DELETE_ALL') {
            return res.status(400).json({ error: 'Must confirm with "YES_DELETE_ALL"' });
        }
        
        if (chatterData.channelData[channel]) {
            // Archive before deleting
            const archive = {
                channel: channel,
                deletedAt: new Date().toISOString(),
                data: chatterData.channelData[channel]
            };
            
            // Save archive
            const archiveFile = CHATTER_DATA_FILE + '.archives';
            let archives = [];
            try {
                if (fs.existsSync(archiveFile)) {
                    archives = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
                }
            } catch (e) { /* ignore */ }
            archives.push(archive);
            fs.writeFileSync(archiveFile, JSON.stringify(archives, null, 2));
            
            // Delete channel data
            delete chatterData.channelData[channel];
            saveChatterData();
            
            res.json({ ok: true, message: `All data for ${channel} has been reset` });
        } else {
            res.json({ ok: true, message: `No data found for ${channel}` });
        }
    } catch (err) {
        console.error('Error resetting data:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

function generateCodeVerifier() { return crypto.randomBytes(32).toString('base64url'); }
function generateCodeChallenge(verifier) { return crypto.createHash('sha256').update(verifier).digest('base64url'); }

app.get('/auth/kick', (req, res) => {
    console.log("🔑 OAuth login started");
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = crypto.randomBytes(16).toString('hex');
    pendingLogins.set(state, { verifier });

    const params = new URLSearchParams({
        client_id: KICK_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'user:read',
        state: state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
    });
    res.redirect(`https://id.kick.com/oauth/authorize?${params.toString()}`);
});

app.get('/auth/kick/callback', async (req, res) => {
    console.log("🔄 OAuth callback received");
    const { code, state, error, error_description } = req.query;
    if (error) return res.status(400).send(`<h3>Login failed</h3><p>${error_description || error}</p><button onclick="window.close()">Close</button>`);
    if (!code) return res.status(400).send('<h3>Missing code</h3><button onclick="window.close()">Close</button>');

    const pending = pendingLogins.get(state);
    if (!pending) return res.status(400).send('<h3>Invalid state</h3><button onclick="window.close()">Close</button>');
    pendingLogins.delete(state);

    try {
        const tokenParams = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: REDIRECT_URI,
            client_id: KICK_CLIENT_ID,
            client_secret: KICK_CLIENT_SECRET,
            code_verifier: pending.verifier
        });
        const tokenRes = await fetch('https://id.kick.com/oauth/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams
        });
        if (!tokenRes.ok) throw new Error('Token exchange failed');
        const tokenData = await tokenRes.json();

        res.send(`
            <!DOCTYPE html>
            <html><head><title>Login Successful</title>
            <style>body{margin:0;min-height:100vh;background:#0a0c12;display:flex;align-items:center;justify-content:center;color:#e2e8f0;font-family:system-ui;}
            .card{background:rgba(15,23,42,0.9);padding:2rem;border-radius:32px;text-align:center;border:1px solid #19C6FD;}</style>
            </head><body>
                <div class="card">
                    <h1>✅ Login Successful!</h1>
                    <p>You can now close this window.</p>
                    <button onclick="window.close()">Close Window</button>
                </div>
                <script>
                    if (window.opener) window.opener.postMessage({ type: 'KICK_TOKEN', token: '${tokenData.access_token}' }, '*');
                </script>
            </body></html>
        `);
    } catch (err) {
        res.status(500).send('<h3>Login failed</h3>');
    }
});

// ========== KICK CHANNEL RESOLUTION WITH CACHE & FALLBACKS ==========
const KICK_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const channelCache = new Map(); // simple cache to avoid repeated calls

async function fetchKickChannel(channelName) {
    const clean = channelName.trim().toLowerCase().replace(/^@/, '');
    if (channelCache.has(clean)) {
        const cached = channelCache.get(clean);
        console.log(`🔄 Using cached chatroom ID for ${clean}: ${cached.id}`);
        return cached;
    }

    console.log(`🔍 Resolving ${clean}...`);

    // Method 1: API v2
    try {
        const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(clean)}`, {
            headers: { 'User-Agent': KICK_USER_AGENT, 'Accept': 'application/json' }
        });
        if (res.ok) {
            const json = await res.json();
            if (json.chatroom && json.chatroom.id) {
                channelCache.set(clean, json);
                console.log(`✅ Found via v2: ${json.chatroom.id}`);
                return json;
            }
        }
    } catch (e) { console.log("v2 failed:", e.message); }

    // Method 2: API v1
    try {
        const res = await fetch(`https://kick.com/api/v1/channels/${encodeURIComponent(clean)}`, {
            headers: { 'User-Agent': KICK_USER_AGENT }
        });
        if (res.ok) {
            const json = await res.json();
            if (json.chatroom && json.chatroom.id) {
                channelCache.set(clean, json);
                console.log(`✅ Found via v1: ${json.chatroom.id}`);
                return json;
            }
        }
    } catch (e) { console.log("v1 failed"); }

    // Method 3: Scrape HTML
    try {
        const pageRes = await fetch(`https://kick.com/${encodeURIComponent(clean)}`, {
            headers: { 'User-Agent': KICK_USER_AGENT, 'Accept': 'text/html' }
        });
        if (pageRes.ok) {
            const html = await pageRes.text();
            let match = html.match(/data-chatroom-id=["'](\d+)["']/i);
            if (!match) match = html.match(/"chatroom"\s*:\s*\{\s*"id"\s*:\s*(\d+)/);
            if (!match) match = html.match(/"chatroomId":(\d+)/);
            if (match && match[1]) {
                const data = { chatroom: { id: match[1] } };
                channelCache.set(clean, data);
                console.log(`✅ Found via scraping: ${match[1]}`);
                return data;
            }
        }
    } catch (e) { console.log("scraping error"); }

    console.log(`❌ Could not resolve ${clean}`);
    return null;
}

app.get('/api/kick/channel/:name', async (req, res) => {
    const data = await fetchKickChannel(req.params.name);
    if (!data || !data.chatroom?.id) {
        return res.status(404).json({ error: 'Unable to resolve Kick chatroom ID' });
    }
    res.json(data);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`✨ Merged server running on http://localhost:${PORT}`);
    console.log(`📺 Slot War overlay available at http://localhost:${PORT}/overlay`);
});