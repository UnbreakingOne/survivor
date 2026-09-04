
const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ["GET", "POST"] }
});

const PORT = Number(process.env.PORT || 3000);
const WORLD_SIZE = 4000;
const TICK_MS = 50;
const SNAPSHOT_MS = 100;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, players: players.size }));

const players = new Map();
const enemies = new Map();
const gems = new Map();
const foods = new Map();
const vacuums = new Map();
const projectiles = new Map();

let nextEnemyId = 1;
let nextDropId = 1;
let nextProjectileId = 1;
let frame = 0;
let difficulty = 1;

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function randomSpawnNearPlayers() {
  const list = [...players.values()];
  if (!list.length) {
    return {
      x: WORLD_SIZE / 2 + (Math.random() - 0.5) * 600,
      y: WORLD_SIZE / 2 + (Math.random() - 0.5) * 600
    };
  }
  const p = list[Math.floor(Math.random() * list.length)];
  const angle = Math.random() * Math.PI * 2;
  const d = 650 + Math.random() * 350;
  return {
    x: clamp(p.x + Math.cos(angle) * d, 20, WORLD_SIZE - 20),
    y: clamp(p.y + Math.sin(angle) * d, 20, WORLD_SIZE - 20)
  };
}

function createEnemy() {
  const pos = randomSpawnNearPlayers();
  const hp = 10 * difficulty;
  const id = String(nextEnemyId++);
  enemies.set(id, {
    id,
    x: pos.x,
    y: pos.y,
    hp,
    maxHp: hp,
    damage: 5 * (0.7 + difficulty * 0.3),
    speed: 1.2 + Math.random() * 1.5,
    radius: 14
  });
}

function serializePlayer(p) {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    x: p.x,
    y: p.y,
    hp: p.hp,
    maxHp: p.maxHp,
    lvl: p.lvl,
    xp: p.xp,
    nextLvl: p.nextLvl,
    speed: p.speed,
    dashCooldown: p.dashCooldown,
    dashTimer: p.dashTimer,
    upgrades: p.upgrades
  };
}

function publicState() {
  return {
    players: [...players.values()].map(serializePlayer),
    enemies: [...enemies.values()].map(e => ({
      id: e.id, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, radius: e.radius
    })),
    gems: [...gems.values()],
    foods: [...foods.values()],
    vacuums: [...vacuums.values()],
    projectiles: [...projectiles.values()],
    difficulty,
    time: Math.floor(frame / 20)
  };
}

function awardXP(p, value) {
  p.xp += value;
  while (p.xp >= p.nextLvl) {
    p.xp -= p.nextLvl;
    p.lvl++;
    p.nextLvl = Math.floor(p.nextLvl * 1.4);
    p.pendingLevelUps++;
  }
}

function killEnemy(enemy) {
  if (!enemies.has(enemy.id)) return;
  enemies.delete(enemy.id);

  const foodRoll = Math.random();
  if (foodRoll < 0.05) {
    const id = String(nextDropId++);
    foods.set(id, { id, x: enemy.x, y: enemy.y, magnetized: false });
  } else if (foodRoll < 0.07) {
    const id = String(nextDropId++);
    vacuums.set(id, { id, x: enemy.x, y: enemy.y, magnetized: false });
  }

  const value = Math.floor(25 * Math.max(1, difficulty));
  const id = String(nextDropId++);
  gems.set(id, { id, x: enemy.x, y: enemy.y, value, magnetized: false });
}

function applyDamageToEnemy(enemy, damage, owner) {
  if (!enemy || !enemies.has(enemy.id)) return;
  enemy.hp -= damage;
  if (enemy.hp <= 0) {
    killEnemy(enemy);
    awardXP(owner, Math.floor(25 * Math.max(1, difficulty)));
  }
}

function resetPlayer(p) {
  p.x = WORLD_SIZE / 2 + (Math.random() - 0.5) * 200;
  p.y = WORLD_SIZE / 2 + (Math.random() - 0.5) * 200;
  p.hp = 100;
  p.maxHp = 100;
  p.lvl = 1;
  p.xp = 0;
  p.nextLvl = 75;
  p.speed = 4;
  p.damage = 15;
  p.fireRate = 50;
  p.multiShot = 1;
  p.pickupRadius = 80;
  p.pierce = 0;
  p.critChance = 0;
  p.forceField = false;
  p.forceFieldRadius = 70;
  p.forceFieldDamage = 0.225;
  p.sparkDrone = false;
  p.sparkFireRate = 240;
  p.sparkDamage = 20;
  p.sparkRadius = 60;
  p.buzzsaw = false;
  p.sawCount = 0;
  p.sawDamage = 15;
  p.sawDistance = 110;
  p.sawAngle = 0;
  p.pet = {
    active: false, isDead: false, x: p.x, y: p.y, hp: 150, maxHp: 150,
    speed: 3, damage: 25, attackCooldown: 0, respawnTimer: 0
  };
  p.dashCooldown = 0;
  p.dashTimer = 0;
  p.fireTimer = 0;
  p.pendingLevelUps = 0;
  p.input = { up: false, down: false, left: false, right: false, dash: false };
  p.upgrades = {};
}

io.on("connection", socket => {
  socket.on("join", data => {
    const name = String(data?.name || "Player").slice(0, 12).trim() || "Player";
    const color = /^#[0-9a-fA-F]{6}$/.test(data?.color) ? data.color : "#00ffcc";

    const p = {
      id: socket.id, name, color, x: 0, y: 0, hp: 100, maxHp: 100, lvl: 1,
      xp: 0, nextLvl: 75, speed: 4, damage: 15, fireRate: 50, multiShot: 1,
      pickupRadius: 80, pierce: 0, critChance: 0, forceField: false,
      forceFieldRadius: 70, forceFieldDamage: 0.225, sparkDrone: false,
      sparkFireRate: 240, sparkDamage: 20, sparkRadius: 60, buzzsaw: false,
      sawCount: 0, sawDamage: 15, sawDistance: 110, sawAngle: 0,
      pet: null, dashCooldown: 0, dashTimer: 0, fireTimer: 0,
      pendingLevelUps: 0, input: {}, upgrades: {}
    };
    resetPlayer(p);
    players.set(socket.id, p);
    socket.emit("joined", { id: socket.id, player: serializePlayer(p) });
    io.emit("state", publicState());
  });

  socket.on("input", input => {
    const p = players.get(socket.id);
    if (!p) return;
    p.input = {
      up: !!input?.up, down: !!input?.down,
      left: !!input?.left, right: !!input?.right,
      dash: !!input?.dash
    };
  });

  socket.on("upgrade", key => {
    const p = players.get(socket.id);
    if (!p || p.pendingLevelUps <= 0) return;

    const upgrades = {
      maxHp: () => { p.maxHp += 25; p.hp += 25; },
      regen: () => {},
      speed: () => { p.speed += 0.8; },
      magnet: () => { p.pickupRadius += 40; },
      gunDamage: () => { p.damage += 8; },
      gunSpeed: () => { p.fireRate = Math.max(8, p.fireRate - 5); },
      multiShot: () => { p.multiShot += 1; },
      pierce: () => { p.pierce += 1; },
      crit: () => { p.critChance += 0.1; },
      forceField: () => {
        p.forceField = true; p.forceFieldRadius += 15; p.forceFieldDamage += 0.225;
      },
      sparkDrone: () => {
        p.sparkDrone = true; p.sparkFireRate = Math.max(60, p.sparkFireRate - 30);
        p.sparkDamage += 15; p.sparkRadius += 15;
      },
      buzzsaw: () => { p.buzzsaw = true; p.sawCount += 1; p.sawDamage += 5; },
      knightPet: () => {
        if (!p.pet.active) p.pet.active = true;
        else { p.pet.damage += 15; p.pet.maxHp += 50; p.pet.hp += 50; }
      }
    };

    const max = {
      maxHp: 10, regen: 5, speed: 5, magnet: 8, gunDamage: 10, gunSpeed: 6,
      multiShot: 4, pierce: 4, crit: 5, forceField: 8, sparkDrone: 6,
      buzzsaw: 6, knightPet: 5
    };

    p.upgrades[key] = p.upgrades[key] || 0;
    if (!upgrades[key] || p.upgrades[key] >= max[key]) return;
    p.upgrades[key]++;
    upgrades[key]();
    p.pendingLevelUps--;
  });

  socket.on("restart", () => {
    const p = players.get(socket.id);
    if (p) resetPlayer(p);
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
  });
});

function updatePlayer(p) {
  const i = p.input;
  let dx = (i.right ? 1 : 0) - (i.left ? 1 : 0);
  let dy = (i.down ? 1 : 0) - (i.up ? 1 : 0);

  if (p.dashCooldown > 0) p.dashCooldown--;
  if (p.dashTimer > 0) p.dashTimer--;

  if (i.dash && p.dashCooldown === 0 && (dx || dy)) {
    p.dashTimer = 12;
    p.dashCooldown = 120;
  }

  if (dx || dy) {
    const len = Math.hypot(dx, dy);
    const speed = p.speed * (p.dashTimer > 0 ? 3.5 : 1);
    p.x += dx / len * speed;
    p.y += dy / len * speed;
  }

  p.x = clamp(p.x, p.maxHp * 0 + 15, WORLD_SIZE - 15);
  p.y = clamp(p.y, 15, WORLD_SIZE - 15);

  if (p.hp < p.maxHp && p.upgrades.regen) {
    p.hp = Math.min(p.maxHp, p.hp + p.upgrades.regen * 0.03);
  }

  p.sawAngle += 0.05;

  // Server-side automatic weapon.
  p.fireTimer++;
  if (p.fireTimer >= p.fireRate && enemies.size) {
    p.fireTimer = 0;
    let target = null, best = Infinity;
    for (const e of enemies.values()) {
      const d = dist(p, e);
      if (d < best) { best = d; target = e; }
    }
    if (target && best < 900) {
      const base = Math.atan2(target.y - p.y, target.x - p.x);
      for (let m = 0; m < p.multiShot; m++) {
        const spread = (m - (p.multiShot - 1) / 2) * 0.15;
        const angle = base + spread;
        const id = String(nextProjectileId++);
        projectiles.set(id, {
          id, owner: p.id, x: p.x, y: p.y,
          vx: Math.cos(angle) * 12, vy: Math.sin(angle) * 12,
          damage: p.damage, life: 50, pierced: []
        });
      }
    }
  }

  // Force field.
  if (p.forceField) {
    for (const e of enemies.values()) {
      if (dist(p, e) < p.forceFieldRadius + e.radius) {
        applyDamageToEnemy(e, p.forceFieldDamage, p);
      }
    }
  }

  // Orbital saws.
  if (p.buzzsaw) {
    for (let s = 0; s < p.sawCount; s++) {
      const a = p.sawAngle + Math.PI * 2 / p.sawCount * s;
      const sx = p.x + Math.cos(a) * p.sawDistance;
      const sy = p.y + Math.sin(a) * p.sawDistance;
      for (const e of enemies.values()) {
        if (Math.hypot(sx - e.x, sy - e.y) < 20 + e.radius) {
          applyDamageToEnemy(e, p.sawDamage / 10, p);
        }
      }
    }
  }

  // Spark drone.
  if (p.sparkDrone && frame % p.sparkFireRate === 0 && enemies.size) {
    let target = null, best = Infinity;
    for (const e of enemies.values()) {
      const d = dist(p, e);
      if (d < best) { best = d; target = e; }
    }
    if (target) {
      for (const e of enemies.values()) {
        if (Math.hypot(e.x - target.x, e.y - target.y) <= p.sparkRadius + e.radius) {
          applyDamageToEnemy(e, p.sparkDamage, p);
        }
      }
    }
  }

  // Holo-Knight.
  if (p.pet?.active) {
    const pet = p.pet;
    pet.speed = p.speed * 0.75;
    if (pet.isDead) {
      pet.respawnTimer--;
      if (pet.respawnTimer <= 0) {
        pet.isDead = false; pet.hp = pet.maxHp; pet.x = p.x; pet.y = p.y;
      }
    } else {
      let target = null, best = Infinity;
      for (const e of enemies.values()) {
        const d = dist(pet, e);
        if (d < best) { best = d; target = e; }
      }
      if (target && best < 600) {
        const a = Math.atan2(target.y - pet.y, target.x - pet.x);
        pet.x += Math.cos(a) * pet.speed;
        pet.y += Math.sin(a) * pet.speed;
        if (pet.attackCooldown > 0) pet.attackCooldown--;
        if (best < pet.radius + target.radius + 15 && pet.attackCooldown <= 0) {
          applyDamageToEnemy(target, pet.damage, p);
          pet.attackCooldown = 30;
          pet.hp -= target.damage * 0.4;
          if (pet.hp <= 0) {
            pet.isDead = true; pet.respawnTimer = 300;
          }
        }
      } else if (Math.hypot(p.x - pet.x, p.y - pet.y) > 60) {
        const a = Math.atan2(p.y - pet.y, p.x - pet.x);
        pet.x += Math.cos(a) * pet.speed;
        pet.y += Math.sin(a) * pet.speed;
      }
    }
  }
}

function updateEnemies() {
  for (const e of enemies.values()) {
    let target = null, best = Infinity;
    for (const p of players.values()) {
      const d = dist(p, e);
      if (d < best) { best = d; target = p; }
    }
    if (!target) continue;

    const a = Math.atan2(target.y - e.y, target.x - e.x);
    e.x += Math.cos(a) * e.speed;
    e.y += Math.sin(a) * e.speed;

    if (best < e.radius + 15 && target.dashTimer === 0) {
      target.hp -= e.damage / 60;
      if (target.hp <= 0) {
        target.hp = 0;
        resetPlayer(target);
        io.to(target.id).emit("playerRespawned");
      }
    }
  }
}

function updateProjectiles() {
  for (const p of projectiles.values()) {
    p.x += p.vx; p.y += p.vy; p.life--;
    if (p.life <= 0 || p.x < 0 || p.x > WORLD_SIZE || p.y < 0 || p.y > WORLD_SIZE) {
      projectiles.delete(p.id); continue;
    }
    const owner = players.get(p.owner);
    if (!owner) { projectiles.delete(p.id); continue; }

    for (const e of enemies.values()) {
      if (p.pierced.includes(e.id)) continue;
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 4) {
        const crit = Math.random() < owner.critChance;
        applyDamageToEnemy(e, crit ? p.damage * 3 : p.damage, owner);
        p.pierced.push(e.id);
        if (p.pierced.length > owner.pierce) {
          projectiles.delete(p.id);
          break;
        }
      }
    }
  }
}

function updateDrops() {
  for (const p of players.values()) {
    for (const [id, g] of gems) {
      let d = dist(p, g);
      if (d < p.pickupRadius) g.magnetized = true;
      if (g.magnetized) {
        const a = Math.atan2(p.y - g.y, p.x - g.x);
        g.x += Math.cos(a) * 25;
        g.y += Math.sin(a) * 25;
        if (d < 25) {
          awardXP(p, g.value);
          gems.delete(id);
        }
      }
    }
    for (const [id, f] of foods) {
      let d = dist(p, f);
      if (d < p.pickupRadius) f.magnetized = true;
      if (f.magnetized) {
        const a = Math.atan2(p.y - f.y, p.x - f.x);
        f.x += Math.cos(a) * 20;
        f.y += Math.sin(a) * 20;
        if (d < 20) {
          p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.2);
          foods.delete(id);
        }
      }
    }
    for (const [id, v] of vacuums) {
      let d = dist(p, v);
      if (d < p.pickupRadius) v.magnetized = true;
      if (v.magnetized) {
        const a = Math.atan2(p.y - v.y, p.x - v.x);
        v.x += Math.cos(a) * 20;
        v.y += Math.sin(a) * 20;
        if (d < 20) {
          for (const g of gems.values()) g.magnetized = true;
          vacuums.delete(id);
        }
      }
    }
  }
}

setInterval(() => {
  frame++;
  if (frame % 1200 === 0) difficulty += 0.3;

  for (const p of players.values()) updatePlayer(p);

  const baseSpawnRate = Math.max(3, 90 - Math.floor(Math.max(1, ...[...players.values()].map(p => p.lvl), 1) * 3.5));
  if (frame % baseSpawnRate === 0 && players.size) createEnemy();

  updateEnemies();
  updateProjectiles();
  updateDrops();

  // Keep entity count bounded.
  while (enemies.size > 450) enemies.delete(enemies.keys().next().value);
}, TICK_MS);

setInterval(() => {
  io.emit("state", publicState());
}, SNAPSHOT_MS);

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`Survivor Arena multiplayer server listening on ${PORT}`);
});
