import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { 
  GamePhase, 
  PlayerRole, 
  Player, 
  Loot, 
  GameState, 
  ClientInput,
  ServerToClientEvents,
  ClientToServerEvents
} from '../shared/types.js';

interface ServerPlayer extends Player {
  hp: number;
  input: ClientInput;
}

const PORT = process.env.PORT || 3000;
const httpServer = createServer();
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Authoritative State
let currentPhase: GamePhase = 'LOBBY';
let currentRound = 1;
let phaseTimer = 0; // seconds remaining
let timerIntervalId: NodeJS.Timeout | null = null;
let gameLoopIntervalId: NodeJS.Timeout | null = null;

const players: Record<string, ServerPlayer> = {};
let loot: Loot[] = [];
let lootQuota = 0;
let totalLootCollected = 0;
let gameWinner: 'INNOCENTS' | 'INFILTRATORS' | null = null;

// Map Obstacles for 2D AABB Collisions
interface Obstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const OBSTACLES: Obstacle[] = [
  // Outer city buildings
  { minX: -35, maxX: -25, minZ: -35, maxZ: -25 },
  { minX: 25, maxX: 35, minZ: 25, maxZ: 35 },
  { minX: -35, maxX: -25, minZ: 25, maxZ: 35 },
  { minX: 25, maxX: 35, minZ: -35, maxZ: -25 },
  // Border walls to block players from escaping map limits (-50 to 50)
  { minX: -55, maxX: -50, minZ: -55, maxZ: 55 },
  { minX: 50, maxX: 55, minZ: -55, maxZ: 55 },
  { minX: -55, maxX: 55, minZ: -55, maxZ: -50 },
  { minX: -55, maxX: 55, minZ: 50, maxZ: 55 },
  // Central Bunker structures (obstacles outside central safe ring)
  { minX: -16, maxX: -14, minZ: -16, maxZ: 16 },
  { minX: 14, maxX: 16, minZ: -16, maxZ: 16 },
];

const BUNKER_RADIUS = 15;
const MAP_BOUNDS = 50;

// Spawns loot in random coordinates outside the bunker (radius > 15)
function generateLoot(count: number) {
  const generated: Loot[] = [];
  let attempts = 0;
  while (generated.length < count && attempts < 200) {
    attempts++;
    const x = (Math.random() - 0.5) * MAP_BOUNDS * 1.8;
    const z = (Math.random() - 0.5) * MAP_BOUNDS * 1.8;
    const distToCenter = Math.sqrt(x * x + z * z);
    
    // Loot must be outside bunker and inside map bounds
    if (distToCenter > BUNKER_RADIUS + 2 && Math.abs(x) < 45 && Math.abs(z) < 45) {
      // Check collision with obstacles
      let collides = false;
      for (const obstacle of OBSTACLES) {
        if (x >= obstacle.minX - 1 && x <= obstacle.maxX + 1 &&
            z >= obstacle.minZ - 1 && z <= obstacle.maxZ + 1) {
          collides = true;
          break;
        }
      }
      if (!collides) {
        generated.push({
          id: `loot_${Date.now()}_${generated.length}`,
          x,
          z,
          collected: false
        });
      }
    }
  }
  return generated;
}

// Collisions with Obstacles helper
function checkWallCollisions(x: number, z: number, radius = 0.8): { x: number; z: number } {
  let newX = x;
  let newZ = z;

  // Outer boundary clamp
  const limit = MAP_BOUNDS - radius;
  if (newX < -limit) newX = -limit;
  if (newX > limit) newX = limit;
  if (newZ < -limit) newZ = -limit;
  if (newZ > limit) newZ = limit;

  for (const obs of OBSTACLES) {
    // Check overlap with obstacle inflated by player radius
    if (newX + radius > obs.minX && newX - radius < obs.maxX &&
        newZ + radius > obs.minZ && newZ - radius < obs.maxZ) {
      // Resolve collision along the shallowest penetration axis
      const overlapLeft = (newX + radius) - obs.minX;
      const overlapRight = obs.maxX - (newX - radius);
      const overlapTop = (newZ + radius) - obs.minZ;
      const overlapBottom = obs.maxZ - (newZ - radius);

      const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

      if (minOverlap === overlapLeft) newX -= overlapLeft;
      else if (minOverlap === overlapRight) newX += overlapRight;
      else if (minOverlap === overlapTop) newZ -= overlapTop;
      else if (minOverlap === overlapBottom) newZ += overlapBottom;
    }
  }

  return { x: newX, z: newZ };
}

// Check game end conditions
function checkVictoryStatus(): boolean {
  if (currentPhase === 'LOBBY') return false;

  const playerList = Object.values(players);
  const alivePlayers = playerList.filter(p => p.alive);
  const aliveInfiltrators = alivePlayers.filter(p => p.role === 'INFILTRATOR');
  const aliveInnocents = alivePlayers.filter(p => p.role === 'INNOCENT');

  // Win condition: No innocents left
  if (aliveInnocents.length === 0) {
    endGame('INFILTRATORS');
    return true;
  }

  // Win condition: No infiltrators left
  if (aliveInfiltrators.length === 0) {
    endGame('INNOCENTS');
    return true;
  }

  // Win condition: Loot quota reached
  if (totalLootCollected >= lootQuota && lootQuota > 0) {
    endGame('INNOCENTS');
    return true;
  }

  // Win condition: End of Round 3 (Infiltrators win if alive)
  if (currentRound > 3) {
    if (aliveInfiltrators.length > 0) {
      endGame('INFILTRATORS');
    } else {
      endGame('INNOCENTS');
    }
    return true;
  }

  return false;
}

function endGame(winner: 'INNOCENTS' | 'INFILTRATORS') {
  currentPhase = 'GAME_OVER';
  gameWinner = winner;
  phaseTimer = 0;
  
  if (timerIntervalId) clearInterval(timerIntervalId);
  
  io.emit('chatMessage', {
    sender: 'SYSTEM',
    role: 'UNKNOWN',
    message: `GAME OVER! Victory goes to: ${winner}!`
  });

  // Broadcast state instantly
  broadcastState();
}

// Reset Game State
function resetGame() {
  currentPhase = 'LOBBY';
  currentRound = 1;
  phaseTimer = 0;
  totalLootCollected = 0;
  gameWinner = null;
  loot = [];
  
  if (timerIntervalId) clearInterval(timerIntervalId);
  if (gameLoopIntervalId) clearInterval(gameLoopIntervalId);
  
  Object.keys(players).forEach(id => {
    players[id].role = 'UNKNOWN';
    players[id].alive = true;
    players[id].hp = 100;
    players[id].lootCount = 0;
    players[id].inBunker = true;
    players[id].votesReceived = 0;
    players[id].hasVoted = false;
    players[id].isReady = false;
    players[id].x = (Math.random() - 0.5) * 10;
    players[id].y = 0.5;
    players[id].z = (Math.random() - 0.5) * 10;
    players[id].ry = 0;
    players[id].input = { x: 0, z: 0, ry: 0, isSprinting: false };
  });

  io.emit('gameReset');
  broadcastState();
}

// Start Game Loop
function startGame() {
  const activePlayers = Object.values(players);
  if (activePlayers.length < 2) {
    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: 'Need at least 2 players to start the PROTOCOL.'
    });
    return;
  }

  // Set Loot Quota
  const innocentCount = activePlayers.length >= 5 ? activePlayers.length - 2 : activePlayers.length - 1;
  lootQuota = Math.max(5, innocentCount * 3); // 3 loot boxes per innocent needed

  // Assign Roles (2 infiltrators if >=5 players, otherwise 1)
  const numInfiltrators = activePlayers.length >= 5 ? 2 : 1;
  const shuffledIds = activePlayers.map(p => p.id).sort(() => Math.random() - 0.5);
  
  const infiltratorIds = shuffledIds.slice(0, numInfiltrators);
  
  shuffledIds.forEach(id => {
    const isInf = infiltratorIds.includes(id);
    players[id].role = isInf ? 'INFILTRATOR' : 'INNOCENT';
    players[id].alive = true;
    players[id].hp = 100;
    players[id].lootCount = 0;
    players[id].inBunker = true;
    players[id].votesReceived = 0;
    players[id].hasVoted = false;
    
    // Spawn player inside central safe zone
    players[id].x = (Math.random() - 0.5) * 12;
    players[id].z = (Math.random() - 0.5) * 12;
    
    // Send specific role start notification
    io.to(id).emit('gameStart', { role: players[id].role });
  });

  // Spawn loot for this game
  loot = generateLoot(25);
  totalLootCollected = 0;
  currentRound = 1;
  
  io.emit('chatMessage', {
    sender: 'SYSTEM',
    role: 'UNKNOWN',
    message: `PROTOCOL ACTIVE. Innocents target: Gather ${lootQuota} items OR survive 3 rounds. Infiltrators: Eliminate everyone.`
  });

  startPhase('EXTRACTION');
  
  // Set up 15Hz ticking game engine (66ms)
  if (gameLoopIntervalId) clearInterval(gameLoopIntervalId);
  gameLoopIntervalId = setInterval(gameTick, 66);
}

// Phase state switcher
function startPhase(phase: GamePhase) {
  currentPhase = phase;
  if (timerIntervalId) clearInterval(timerIntervalId);

  // Clear voting counts
  Object.values(players).forEach(p => {
    p.votesReceived = 0;
    p.hasVoted = false;
  });

  if (phase === 'EXTRACTION') {
    phaseTimer = 85; // 1m25s
    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: `[ROUND ${currentRound}] Extraction Phase initiated. Timers: 1m25s. Collect resources outside the bunker.`
    });
  } else if (phase === 'STORM') {
    phaseTimer = 30; // 30s
    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: `[ROUND ${currentRound}] RADIATION ALARM! Toxic storm closing in. Doors closing in 30s. Get inside the central Bunker!`
    });
  } else if (phase === 'VOTE') {
    phaseTimer = 30; // 30s
    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: `[ROUND ${currentRound}] Voting Phase. Debate and banish one player to the radioactive storm.`
    });
  }

  timerIntervalId = setInterval(() => {
    phaseTimer--;
    if (phaseTimer <= 0) {
      handlePhaseTimeout();
    }
  }, 1000);

  broadcastState();
}

function handlePhaseTimeout() {
  if (timerIntervalId) clearInterval(timerIntervalId);

  if (currentPhase === 'EXTRACTION') {
    startPhase('STORM');
  } else if (currentPhase === 'STORM') {
    // Trap/Kill everyone outside bunker when storm doors lock
    Object.values(players).forEach(p => {
      if (p.alive && !p.inBunker) {
        p.alive = false;
        p.hp = 0;
        io.emit('killNotification', {
          killerName: 'RADIATION STORM',
          victimName: p.name
        });
      }
    });

    if (checkVictoryStatus()) return;
    startPhase('VOTE');
  } else if (currentPhase === 'VOTE') {
    tallyVotes();
  }
}

function tallyVotes() {
  // Find player with max votes
  const activePlayers = Object.values(players).filter(p => p.alive);
  let exiledPlayer: ServerPlayer | null = null;
  let maxVotes = 0;
  let tie = false;

  activePlayers.forEach(p => {
    if (p.votesReceived > maxVotes) {
      maxVotes = p.votesReceived;
      exiledPlayer = p;
      tie = false;
    } else if (p.votesReceived === maxVotes && maxVotes > 0) {
      tie = true;
    }
  });

  if (exiledPlayer && !tie && maxVotes > 0) {
    const p = exiledPlayer as ServerPlayer;
    p.alive = false;
    p.hp = 0;
    io.emit('voteReveal', {
      name: p.name,
      role: p.role,
      votes: maxVotes
    });

    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: `${p.name} has been banished from the Bunker. They were a ${p.role}.`
    });
  } else {
    io.emit('chatMessage', {
      sender: 'SYSTEM',
      role: 'UNKNOWN',
      message: 'No player banished (tie or no votes).'
    });
  }

  if (checkVictoryStatus()) return;

  // Move to next round
  currentRound++;
  // Reset player bunker status to inside
  Object.values(players).forEach(p => {
    if (p.alive) {
      p.inBunker = true;
      p.x = (Math.random() - 0.5) * 8;
      p.z = (Math.random() - 0.5) * 8;
    }
  });

  startPhase('EXTRACTION');
}

// 15Hz physics tick
function gameTick() {
  if (currentPhase === 'LOBBY' || currentPhase === 'GAME_OVER') return;

  const dt = 0.0667; // 1/15s
  const activePlayers = Object.values(players);

  activePlayers.forEach(p => {
    if (!p.alive) return;

    // Movement calculation
    const input = p.input;
    const speed = input.isSprinting ? 8.0 : 4.0;
    
    // Player direction vector in world space
    const dirX = input.x;
    const dirZ = input.z;
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ);

    if (len > 0.01) {
      // Normalize
      const dx = (dirX / len) * speed * dt;
      const dz = (dirZ / len) * speed * dt;
      
      const newPos = checkWallCollisions(p.x + dx, p.z + dz);
      p.x = newPos.x;
      p.z = newPos.z;
      p.isSprinting = input.isSprinting;
    } else {
      p.isSprinting = false;
    }

    p.ry = input.ry;

    // Track Bunker status
    const distToCenter = Math.sqrt(p.x * p.x + p.z * p.z);
    
    if (currentPhase === 'EXTRACTION') {
      p.inBunker = distToCenter <= BUNKER_RADIUS;
    } else if (currentPhase === 'STORM') {
      // Doors start closing, player can only stay in if already in, or gets in
      p.inBunker = distToCenter <= BUNKER_RADIUS;
      
      // Outside bunker during storm deals continuous damage
      if (!p.inBunker) {
        p.hp -= 20 * dt; // 20 HP per second
        if (p.hp <= 0) {
          p.hp = 0;
          p.alive = false;
          io.emit('killNotification', {
            killerName: 'RADIATION',
            victimName: p.name
          });
          checkVictoryStatus();
        }
      } else {
        // Regenerate small health in bunker
        p.hp = Math.min(100, p.hp + 5 * dt);
      }
    } else if (currentPhase === 'VOTE') {
      // Everyone is locked inside the bunker during vote
      p.inBunker = true;
      p.x = Math.max(-12, Math.min(12, p.x));
      p.z = Math.max(-12, Math.min(12, p.z));
    }
  });

  broadcastState();
}

// Broadcast game state to all clients, filtering sensitive information
function broadcastState() {
  const rawPlayersList = Object.values(players);

  rawPlayersList.forEach(recip => {
    const filteredPlayers: Record<string, Player> = {};
    
    rawPlayersList.forEach(p => {
      // Show full roles to teammates (Infiltrators see other Infiltrators)
      // Otherwise, hide roles (report UNKNOWN) unless they are dead/exiled or the player looking is querying themselves
      let resolvedRole: PlayerRole = 'UNKNOWN';
      if (currentPhase === 'GAME_OVER' || !p.alive || p.id === recip.id) {
        resolvedRole = p.role;
      } else if (recip.role === 'INFILTRATOR' && p.role === 'INFILTRATOR') {
        resolvedRole = 'INFILTRATOR';
      }

      filteredPlayers[p.id] = {
        id: p.id,
        name: p.name,
        role: resolvedRole,
        x: p.x,
        y: p.y,
        z: p.z,
        ry: p.ry,
        alive: p.alive,
        hp: p.hp,
        lootCount: p.lootCount,
        inBunker: p.inBunker,
        votesReceived: p.votesReceived,
        hasVoted: p.hasVoted,
        isSprinting: p.isSprinting,
        isReady: p.isReady
      };
    });

    const state: GameState = {
      phase: currentPhase,
      round: currentRound,
      timer: phaseTimer,
      players: filteredPlayers,
      loot: loot,
      lootQuota: lootQuota,
      totalLootCollected: totalLootCollected,
      winner: gameWinner
    };

    io.to(recip.id).emit('stateUpdate', state);
  });
}

// Handle socket connections
io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create temporary player profile
  players[socket.id] = {
    id: socket.id,
    name: `Player_${socket.id.substring(0, 4)}`,
    role: 'UNKNOWN',
    x: (Math.random() - 0.5) * 10,
    y: 0.5,
    z: (Math.random() - 0.5) * 10,
    ry: 0,
    alive: true,
    lootCount: 0,
    inBunker: true,
    votesReceived: 0,
    hasVoted: false,
    isSprinting: false,
    isReady: false,
    hp: 100,
    input: { x: 0, z: 0, ry: 0, isSprinting: false }
  };

  // Tell the client who they are
  socket.emit('initClient', { playerId: socket.id });

  // Broadcast state to new joiners
  broadcastState();

  // Join Lobby
  socket.on('joinLobby', ({ name }) => {
    if (players[socket.id]) {
      const cleanName = name.trim().substring(0, 16);
      players[socket.id].name = cleanName || `Player_${socket.id.substring(0, 4)}`;
      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${players[socket.id].name} joined the lobby.`
      });
      broadcastState();
    }
  });

  // Ready status
  socket.on('playerReady', ({ ready }) => {
    if (players[socket.id] && currentPhase === 'LOBBY') {
      players[socket.id].isReady = ready;
      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${players[socket.id].name} is ${ready ? 'READY' : 'NOT READY'}.`
      });

      // Start game automatically if all players are ready and count >= 2
      const activePlayers = Object.values(players);
      const readyCount = activePlayers.filter(p => p.isReady).length;
      if (readyCount === activePlayers.length && activePlayers.length >= 2) {
        startGame();
      } else {
        broadcastState();
      }
    }
  });

  // Receive Inputs
  socket.on('updateInput', (input) => {
    const player = players[socket.id];
    if (player && player.alive && currentPhase !== 'LOBBY' && currentPhase !== 'GAME_OVER') {
      // Validate bounds to prevent cheats
      player.input.x = Math.max(-1, Math.min(1, input.x));
      player.input.z = Math.max(-1, Math.min(1, input.z));
      player.input.ry = input.ry;
      player.input.isSprinting = input.isSprinting;
    }
  });

  // Interact with Loot
  socket.on('interactLoot', ({ lootId }) => {
    const p = players[socket.id];
    if (!p || !p.alive || currentPhase !== 'EXTRACTION') return;

    const item = loot.find(l => l.id === lootId && !l.collected);
    if (!item) return;

    // Verify distance autoritatively (must be close to loot)
    const dx = p.x - item.x;
    const dz = p.z - item.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= 3.5) {
      item.collected = true;
      p.lootCount++;
      totalLootCollected++;

      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${p.name} extracted loot (${totalLootCollected}/${lootQuota}).`
      });

      if (checkVictoryStatus()) return;
      broadcastState();
    }
  });

  // Stealth Kill Action
  socket.on('stealthKill', ({ targetPlayerId }) => {
    const killer = players[socket.id];
    const victim = players[targetPlayerId];

    if (!killer || !victim || !killer.alive || !victim.alive) return;
    if (killer.role !== 'INFILTRATOR') return; // Only infiltrators kill
    if (currentPhase !== 'EXTRACTION' && currentPhase !== 'STORM') return; // Only during game rounds

    // Distance Check
    const dx = victim.x - killer.x;
    const dz = victim.z - killer.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist <= 3.0) {
      // Blind Spot (Angle) Check
      // Victim facing direction
      const fx = Math.sin(victim.ry);
      const fz = Math.cos(victim.ry);

      // Vector to killer (normalized)
      const kdx = killer.x - victim.x;
      const kdz = killer.z - victim.z;
      const klen = Math.sqrt(kdx * kdx + kdz * kdz);

      if (klen > 0) {
        const ndx = kdx / klen;
        const ndz = kdz / klen;

        // Dot product
        const dot = fx * ndx + fz * ndz;

        // dot < -0.2 means the killer is behind the victim
        if (dot < -0.2) {
          victim.alive = false;
          victim.hp = 0;
          io.emit('killNotification', {
            killerName: 'An Infiltrator',
            victimName: victim.name
          });

          // Play kill chat notify
          io.emit('chatMessage', {
            sender: 'ANNOUNCER',
            role: 'UNKNOWN',
            message: `Stealth kill reported in the blind spots!`
          });

          checkVictoryStatus();
          broadcastState();
        } else {
          // Notify killer they weren't in the blind spot
          socket.emit('chatMessage', {
            sender: 'SYSTEM',
            role: 'UNKNOWN',
            message: `Stealth kill failed! You must attack from behind (victim's blind spot).`
          });
        }
      }
    }
  });

  // Vote Casting
  socket.on('castVote', ({ targetPlayerId }) => {
    const voter = players[socket.id];
    if (!voter || !voter.alive || voter.hasVoted || currentPhase !== 'VOTE') return;

    voter.hasVoted = true;

    if (targetPlayerId && players[targetPlayerId] && players[targetPlayerId].alive) {
      players[targetPlayerId].votesReceived++;
      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${voter.name} cast their vote.`
      });
    } else {
      // Skiped vote
      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${voter.name} skipped voting.`
      });
    }

    // Tally instantly if all alive players have voted
    const activePlayers = Object.values(players).filter(p => p.alive);
    const votesCount = activePlayers.filter(p => p.hasVoted).length;

    if (votesCount === activePlayers.length) {
      tallyVotes();
    } else {
      broadcastState();
    }
  });

  // Chat
  socket.on('sendChat', ({ message }) => {
    const p = players[socket.id];
    if (p) {
      const cleanMsg = message.trim().substring(0, 100);
      if (cleanMsg) {
        io.emit('chatMessage', {
          sender: p.name,
          role: p.role,
          message: cleanMsg
        });
      }
    }
  });

  // Admin Reset
  socket.on('adminReset', () => {
    resetGame();
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
    const p = players[socket.id];
    if (p) {
      io.emit('chatMessage', {
        sender: 'SYSTEM',
        role: 'UNKNOWN',
        message: `${p.name} disconnected.`
      });
      delete players[socket.id];
      checkVictoryStatus();
      broadcastState();
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`PROTOCOL 10 Server running on port ${PORT}`);
});
