const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONFIGURATION ---
const MAP_SIZE = 24;
const TICK_RATE = 60;
const PROJ_SPEED = 0.6;
const PROJ_DMG = 25;

// --- GAME STATE ---
const players = {};
let projectiles = [];
const map = [];

// Generate Map (Shared World)
for(let y=0; y<MAP_SIZE; y++) {
    map[y] = [];
    for(let x=0; x<MAP_SIZE; x++) {
        if(x===0 || x===MAP_SIZE-1 || y===0 || y===MAP_SIZE-1) map[y][x] = 1; 
        else map[y][x] = 0;
    }
}
// Random internal walls
for(let y=2; y<MAP_SIZE-2; y+=2) {
    for(let x=2; x<MAP_SIZE-2; x+=2) {
        if(Math.random() > 0.4) map[y][x] = 1;
    }
}

// Helpers
function isWall(x, y) {
    if(x<0 || x>=MAP_SIZE || y<0 || y>=MAP_SIZE) return true;
    return map[Math.floor(y)][Math.floor(x)] > 0;
}

function findSafeSpawn() {
    let attempts = 0;
    while(attempts < 100) {
        let x = Math.floor(Math.random() * (MAP_SIZE-2)) + 1.5;
        let y = Math.floor(Math.random() * (MAP_SIZE-2)) + 1.5;
        if(!isWall(x, y)) return {x, y};
        attempts++;
    }
    return {x: 2.5, y: 2.5};
}

io.on('connection', (socket) => {
    console.log('Player joined:', socket.id);

    // Spawn Logic
    let spawn = findSafeSpawn();
    players[socket.id] = { 
        id: socket.id,
        x: spawn.x, y: spawn.y, dir: 1.5, 
        hp: 100, 
        dead: false,
        team: (Object.keys(players).length % 2 == 0) ? 'CT' : 'T' 
    };

    // 1. Handle Movement
    socket.on('input', (data) => {
        let p = players[socket.id];
        if(!p || p.dead) return;

        let speed = 0.07;
        let mx = 0, my = 0;
        if(data.keys.w) { mx += Math.cos(p.dir)*speed; my += Math.sin(p.dir)*speed; }
        if(data.keys.s) { mx -= Math.cos(p.dir)*speed; my -= Math.sin(p.dir)*speed; }
        if(data.keys.a) { mx += Math.sin(p.dir)*speed; my -= Math.cos(p.dir)*speed; }
        if(data.keys.d) { mx -= Math.sin(p.dir)*speed; my += Math.cos(p.dir)*speed; }

        // Wall Collision
        if(!isWall(p.x + mx + Math.sign(mx)*0.2, p.y)) p.x += mx;
        if(!isWall(p.x, p.y + my + Math.sign(my)*0.2)) p.y += my;

        p.dir = data.dir;
    });

    // 2. Handle Shooting
    socket.on('shoot', () => {
        let p = players[socket.id];
        if(!p || p.dead) return;

        projectiles.push({
            x: p.x, y: p.y,
            vx: Math.cos(p.dir) * PROJ_SPEED,
            vy: Math.sin(p.dir) * PROJ_SPEED,
            ownerId: socket.id,
            life: 50 // Lasts 50 frames
        });
    });

    // 3. Handle Respawn Request
    socket.on('respawn', () => {
        let p = players[socket.id];
        if(p && p.dead) {
            let spawn = findSafeSpawn();
            p.x = spawn.x; p.y = spawn.y;
            p.hp = 100; p.dead = false;
        }
    });

    socket.on('disconnect', () => {
        console.log('Player left:', socket.id);
        delete players[socket.id];
    });
});

// --- SERVER GAME LOOP ---
setInterval(() => {
    // Update Projectiles
    for(let i = projectiles.length - 1; i >= 0; i--) {
        let p = projectiles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life--;

        // Remove if hit wall or expired
        if(p.life <= 0 || isWall(p.x, p.y)) {
            projectiles.splice(i, 1);
            continue;
        }

        // Check Player Hits
        for(let id in players) {
            let target = players[id];
            if(id !== p.ownerId && !target.dead) {
                let dist = Math.sqrt((p.x - target.x)**2 + (p.y - target.y)**2);
                if(dist < 0.4) {
                    target.hp -= PROJ_DMG;
                    if(target.hp <= 0) {
                        target.hp = 0;
                        target.dead = true;
                    }
                    projectiles.splice(i, 1); 
                    break;
                }
            }
        }
    }

    io.emit('state', { players, projectiles, map }); 

}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
