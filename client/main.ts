import { io, Socket } from 'socket.io-client';
import { GameState, ClientInput, PlayerRole } from '../shared/types.js';
import { GameScene } from './game.js';

// DOM Elements
const lobbyScreen = document.getElementById('lobby-screen')!;
const loginForm = document.getElementById('login-form')!;
const lobbyRoom = document.getElementById('lobby-room')!;
const usernameInput = document.getElementById('username-input') as HTMLInputElement;
const joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
const connectedCount = document.getElementById('connected-count')!;
const lobbyPlayers = document.getElementById('lobby-players')!;
const readyBtn = document.getElementById('ready-btn') as HTMLButtonElement;

const hudContainer = document.getElementById('hud-container')!;
const hudPhase = document.getElementById('hud-phase')!;
const hudTimer = document.getElementById('hud-timer')!;
const hudRound = document.getElementById('hud-round')!;
const lootRatio = document.getElementById('loot-ratio')!;
const lootFill = document.getElementById('loot-fill')!;
const hudRole = document.getElementById('hud-role')!;
const hpFill = document.getElementById('hp-fill')!;
const hpText = document.getElementById('hp-text')!;
const actionPrompt = document.getElementById('action-prompt')!;
const lootPrompt = document.getElementById('loot-prompt')!;
const scoreboardList = document.getElementById('scoreboard-list')!;

const voteScreen = document.getElementById('vote-screen')!;
const voteTimer = document.getElementById('vote-timer')!;
const voteGrid = document.getElementById('vote-grid')!;
const skipVoteBtn = document.getElementById('skip-vote-btn') as HTMLButtonElement;

const chatContainer = document.getElementById('chat-container')!;
const chatMessages = document.getElementById('chat-messages')!;
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const chatInput = document.getElementById('chat-input') as HTMLInputElement;

const gameOverScreen = document.getElementById('game-over-screen')!;
const victoryTitle = document.getElementById('victory-title')!;
const victorySub = document.getElementById('victory-sub')!;
const goLoot = document.getElementById('go-loot')!;
const goRounds = document.getElementById('go-rounds')!;
const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;

// Networking State
const socket: Socket = io((import.meta.env.VITE_BACKEND_URL as string) || undefined);
let localPlayerId: string | null = null;
let gameScene: GameScene | null = null;
let isReady = false;
let currentPhase = 'LOBBY';

// Initialise Socket Connections
socket.on('connect', () => {
  addChatMessage('SYSTEM', 'UNKNOWN', 'Connected to simulation mainframe.');
});

socket.on('initClient', ({ playerId }: { playerId: string }) => {
  localPlayerId = playerId;
  addChatMessage('SYSTEM', 'UNKNOWN', `Handshake complete. Agent ID: ${playerId.substring(0, 5)}`);
  
  // Create Three.js viewport
  if (!gameScene) {
    gameScene = new GameScene(
      'canvas-container',
      (input: ClientInput) => {
        socket.emit('updateInput', input);
      },
      (lootId: string) => {
        socket.emit('interactLoot', { lootId });
      },
      (targetId: string) => {
        socket.emit('stealthKill', { targetPlayerId: targetId });
      }
    );
  }
  gameScene.setLocalPlayer(playerId);
});

socket.on('gameStart', ({ role }: { role: PlayerRole }) => {
  addChatMessage('ANNOUNCER', 'UNKNOWN', `PROTOCOL ENGAGED. AUTH: ${role}`);
  
  // Clean overlays
  lobbyScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  hudContainer.classList.remove('hidden');
  chatContainer.classList.remove('hidden');
});

socket.on('stateUpdate', (state: GameState) => {
  if (gameScene) {
    gameScene.updateState(state);
  }

  // Check state phase changes
  if (currentPhase !== state.phase) {
    currentPhase = state.phase;
    handlePhaseTransition(state.phase);
  }

  // Update UI Elements
  updateHUD(state);
});

socket.on('chatMessage', ({ sender, role, message }: { sender: string; role: PlayerRole; message: string }) => {
  addChatMessage(sender, role, message);
});

socket.on('killNotification', ({ killerName, victimName }: { killerName: string; victimName: string }) => {
  addChatMessage('ANNOUNCER', 'UNKNOWN', `ALERT: ${victimName.toUpperCase()} terminated by ${killerName.toUpperCase()}.`);
});

socket.on('voteReveal', ({ name, role, votes }: { name: string; role: PlayerRole; votes: number }) => {
  addChatMessage('ANNOUNCER', 'UNKNOWN', `EXILE: ${name.toUpperCase()} banished with ${votes} votes. Identity: ${role}`);
});

socket.on('gameReset', () => {
  // Show lobby overlay, hide HUD
  lobbyScreen.classList.remove('hidden');
  loginForm.classList.remove('hidden');
  lobbyRoom.classList.add('hidden');
  hudContainer.classList.add('hidden');
  voteScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  
  isReady = false;
  readyBtn.textContent = 'FLAG READY';
  readyBtn.classList.remove('active');
  usernameInput.value = '';
  
  addChatMessage('SYSTEM', 'UNKNOWN', 'PROTOCOL reset by admin.');
});

// UI Actions - Lobby
joinBtn.addEventListener('click', () => {
  const name = usernameInput.value.trim();
  if (name) {
    socket.emit('joinLobby', { name });
    loginForm.classList.add('hidden');
    lobbyRoom.classList.remove('hidden');
  }
});

readyBtn.addEventListener('click', () => {
  isReady = !isReady;
  socket.emit('playerReady', { ready: isReady });
  readyBtn.textContent = isReady ? 'AWAITING START...' : 'FLAG READY';
  readyBtn.classList.toggle('active', isReady);
});

// UI Actions - Chat
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    socket.emit('sendChat', { message: text });
    chatInput.value = '';
  }
});

// UI Actions - Voting
skipVoteBtn.addEventListener('click', () => {
  socket.emit('castVote', { targetPlayerId: null });
  skipVoteBtn.disabled = true;
});

// UI Actions - Restart
restartBtn.addEventListener('click', () => {
  socket.emit('adminReset');
});

// Helper for UI/Phase updates
function handlePhaseTransition(phase: string) {
  if (phase === 'VOTE') {
    voteScreen.classList.remove('hidden');
    skipVoteBtn.disabled = false;
  } else {
    voteScreen.classList.add('hidden');
  }

  if (phase === 'GAME_OVER') {
    gameOverScreen.classList.remove('hidden');
    hudContainer.classList.add('hidden');
  }
}

function updateHUD(state: GameState) {
  // 1. Text displays
  hudPhase.textContent = state.phase;
  
  // Format minutes:seconds
  const mins = Math.floor(state.timer / 60);
  const secs = state.timer % 60;
  hudTimer.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  hudRound.textContent = `CYCLE ${state.round.toString().padStart(2, '0')}/03`;

  // 2. Loot quota progress
  lootRatio.textContent = `${state.totalLootCollected}/${state.lootQuota}`;
  const lootPct = state.lootQuota > 0 ? (state.totalLootCollected / state.lootQuota) * 100 : 0;
  lootFill.style.width = `${Math.min(100, lootPct)}%`;

  // 3. Local Player status
  if (localPlayerId && state.players[localPlayerId]) {
    const me = state.players[localPlayerId];
    hudRole.textContent = me.role;
    
    // Style role badge
    hudRole.className = 'value';
    if (me.role === 'INFILTRATOR') {
      hudRole.classList.add('infiltrator-role');
    } else {
      hudRole.classList.add('innocent-role');
    }

    // Health
    if (gameScene) {
      const hp = gameScene.localHp;
      hpFill.style.width = `${hp}%`;
      hpText.textContent = `${Math.round(hp)} HP`;

      // Flashing low health
      if (hp < 30) {
        hpFill.style.background = '#ff3333';
      } else {
        hpFill.style.background = '#ffffff';
      }
    }
  }

  // 4. Prompt displays (Stealth Kill and Looting)
  if (gameScene) {
    if (gameScene.nearestLootId && state.phase === 'EXTRACTION') {
      lootPrompt.classList.remove('hidden');
    } else {
      lootPrompt.classList.add('hidden');
    }

    if (gameScene.nearestVictimId && (state.phase === 'EXTRACTION' || state.phase === 'STORM')) {
      actionPrompt.classList.remove('hidden');
    } else {
      actionPrompt.classList.add('hidden');
    }
  }

  // 5. Scoreboard / Active Syndicate Panel
  scoreboardList.innerHTML = '';
  Object.values(state.players).forEach(p => {
    const row = document.createElement('div');
    row.className = 'score-row';
    
    if (!p.alive) {
      row.classList.add('dead');
    }
    if (p.id === localPlayerId) {
      row.classList.add('local-player');
    }
    
    // Infiltrators show green or red border between allies
    const localRole = localPlayerId ? state.players[localPlayerId]?.role : 'UNKNOWN';
    if (localRole === 'INFILTRATOR' && p.role === 'INFILTRATOR') {
      row.classList.add('infiltrator-ally');
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = p.name;
    
    const countSpan = document.createElement('span');
    countSpan.className = 'loot';
    countSpan.textContent = p.alive ? `LOOT: ${p.lootCount}` : 'DECEASED';

    row.appendChild(nameSpan);
    row.appendChild(countSpan);
    scoreboardList.appendChild(row);
  });

  // 6. Lobby Connect List
  if (state.phase === 'LOBBY') {
    const activeList = Object.values(state.players);
    connectedCount.textContent = activeList.length.toString();
    lobbyPlayers.innerHTML = '';

    activeList.forEach(p => {
      const row = document.createElement('div');
      row.className = 'player-lobby-row';
      if (p.isReady) {
        row.classList.add('ready-active');
      }

      const nameSpan = document.createElement('span');
      nameSpan.textContent = p.name;

      const readySpan = document.createElement('span');
      readySpan.className = 'ready-tag';
      readySpan.textContent = p.isReady ? 'READY' : 'STANDBY';

      row.appendChild(nameSpan);
      row.appendChild(readySpan);
      lobbyPlayers.appendChild(row);
    });
  }

  // 7. Voting Overlay updates
  if (state.phase === 'VOTE') {
    voteTimer.textContent = state.timer.toString();
    voteGrid.innerHTML = '';

    Object.values(state.players).forEach(p => {
      const card = document.createElement('div');
      card.className = 'vote-card';
      
      if (!p.alive) {
        card.classList.add('voted-out');
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'v-name';
      nameSpan.textContent = p.name;

      const countSpan = document.createElement('span');
      countSpan.className = 'v-count';
      countSpan.textContent = `${p.votesReceived} VOTES`;

      card.appendChild(nameSpan);
      card.appendChild(countSpan);

      // Disable card actions if self or dead
      if (p.alive && p.id !== localPlayerId) {
        card.addEventListener('click', () => {
          socket.emit('castVote', { targetPlayerId: p.id });
          // Highlight selected card visually
          const allCards = voteGrid.querySelectorAll('.vote-card');
          allCards.forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
        });
      }

      voteGrid.appendChild(card);
    });
  }

  // 8. Game Over Screen
  if (state.phase === 'GAME_OVER') {
    goLoot.textContent = state.totalLootCollected.toString();
    goRounds.textContent = state.round.toString();
    
    if (state.winner === 'INNOCENTS') {
      victoryTitle.textContent = 'INNOCENTS ESCAPED';
      victorySub.textContent = 'ALL INFILTRATORS BANISHED OR QUOTA SECURED';
      victoryTitle.style.color = '#ffffff';
    } else {
      victoryTitle.textContent = 'INFILTRATORS DOMINATED';
      victorySub.textContent = 'THE BUNKER HAS BEEN SECURED BY HOSTILE AGENTS';
      victoryTitle.style.color = '#ff3333';
    }
  }
}

function addChatMessage(sender: string, role: PlayerRole, message: string) {
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg';

  if (sender === 'SYSTEM') {
    msgEl.classList.add('system');
    msgEl.innerHTML = `&gt; ${message}`;
  } else if (sender === 'ANNOUNCER') {
    msgEl.classList.add('announcer');
    msgEl.innerHTML = `[ANNOUNCEMENT] ${message}`;
  } else {
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = `${sender}: `;
    
    // Highlight Infiltrator text in red for fellow Infiltrators
    if (role === 'INFILTRATOR') {
      msgEl.classList.add('infiltrator');
    }

    const textSpan = document.createElement('span');
    textSpan.textContent = message;

    msgEl.appendChild(nameSpan);
    msgEl.appendChild(textSpan);
  }

  chatMessages.appendChild(msgEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}
