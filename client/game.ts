import * as THREE from 'three';
import { GameState, Player, Loot, ClientInput } from '../shared/types.js';

export class GameScene {
  private container: HTMLDivElement;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private clock!: THREE.Clock;

  // Lights
  private ambientLight!: THREE.AmbientLight;
  private dirLight!: THREE.DirectionalLight;

  // Grid/Bunker visual references
  private bunkerDome!: THREE.Mesh;
  private bunkerDoors: THREE.Mesh[] = [];

  // Entities meshes map
  private playerMeshes: Record<string, THREE.Group> = {};
  private lootMeshes: Record<string, THREE.Mesh> = {};
  private obstacles: THREE.Mesh[] = [];

  // Input states
  private keys: Record<string, boolean> = {};
  private mouseYaw = 0;
  private mousePitch = 0;
  private localPlayerId: string | null = null;
  private isPointerLocked = false;

  // Obstacles data matching server
  private mapObstacles = [
    { minX: -35, maxX: -25, minZ: -35, maxZ: -25 },
    { minX: 25, maxX: 35, minZ: 25, maxZ: 35 },
    { minX: -35, maxX: -25, minZ: 25, maxZ: 35 },
    { minX: 25, maxX: 35, minZ: -35, maxZ: -25 },
    // Bunker structure pillars
    { minX: -16, maxX: -14, minZ: -16, maxZ: 16 },
    { minX: 14, maxX: 16, minZ: -16, maxZ: 16 },
  ];

  // Callback to send input updates to network
  private onSendInput: (input: ClientInput) => void;
  private onInteractLoot: (lootId: string) => void;
  private onStealthKill: (targetId: string) => void;

  // Local predicted state for local player
  public localPos = new THREE.Vector3(0, 0.5, 0);
  public localYaw = 0;
  public localHp = 100;
  public isSprinting = false;

  // Nearest targets tracking for HUD prompts
  public nearestLootId: string | null = null;
  public nearestVictimId: string | null = null;

  constructor(
    containerId: string,
    onSendInput: (input: ClientInput) => void,
    onInteractLoot: (lootId: string) => void,
    onStealthKill: (targetId: string) => void
  ) {
    this.container = document.getElementById(containerId) as HTMLDivElement;
    this.onSendInput = onSendInput;
    this.onInteractLoot = onInteractLoot;
    this.onStealthKill = onStealthKill;

    this.initThree();
    this.createWorld();
    this.setupEvents();
    this.animate();
  }

  private initThree() {
    this.scene = new THREE.Scene();
    
    // Radioactive green/gray fog
    this.scene.background = new THREE.Color(0x050805);
    this.scene.fog = new THREE.FogExp2(0x050805, 0.015);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.08);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    this.dirLight.position.set(20, 40, 20);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 1024;
    this.dirLight.shadow.mapSize.height = 1024;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 150;
    const d = 40;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);
  }

  private createWorld() {
    // Ground Grid
    const gridHelper = new THREE.GridHelper(120, 60, 0xffffff, 0x222222);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    const groundGeo = new THREE.PlaneGeometry(120, 120);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Bunker Zone (Radius 15)
    // Red glowing ring border
    const ringGeo = new THREE.RingGeometry(14.8, 15.2, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.05;
    this.scene.add(ring);

    // Semi-transparent shield dome
    const domeGeo = new THREE.SphereGeometry(15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.05,
      wireframe: true,
      side: THREE.DoubleSide
    });
    this.bunkerDome = new THREE.Mesh(domeGeo, domeMat);
    this.scene.add(this.bunkerDome);

    // Bunker Gates/Doors
    const doorGeo = new THREE.BoxGeometry(8, 6, 0.5);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8 });
    
    const doorLeft = new THREE.Mesh(doorGeo, doorMat);
    doorLeft.position.set(-4, 3, -15);
    doorLeft.castShadow = true;
    doorLeft.receiveShadow = true;
    this.scene.add(doorLeft);
    this.bunkerDoors.push(doorLeft);

    const doorRight = new THREE.Mesh(doorGeo, doorMat);
    doorRight.position.set(4, 3, -15);
    doorRight.castShadow = true;
    doorRight.receiveShadow = true;
    this.scene.add(doorRight);
    this.bunkerDoors.push(doorRight);

    // Outer City Buildings
    this.mapObstacles.forEach(obs => {
      const width = obs.maxX - obs.minX;
      const depth = obs.maxZ - obs.minZ;
      const height = 15;

      const boxGeo = new THREE.BoxGeometry(width, height, depth);
      const boxMat = new THREE.MeshStandardMaterial({ 
        color: 0x111111, 
        roughness: 0.8,
        bumpScale: 0.1
      });
      const mesh = new THREE.Mesh(boxGeo, boxMat);
      // Center position
      mesh.position.set(obs.minX + width / 2, height / 2, obs.minZ + depth / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.obstacles.push(mesh);
    });
  }

  private setupEvents() {
    // Keyboard inputs
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;

      // Handle Interact [F]
      if (e.key.toLowerCase() === 'f' && this.nearestLootId) {
        this.onInteractLoot(this.nearestLootId);
      }

      // Handle Kill [E]
      if (e.key.toLowerCase() === 'e' && this.nearestVictimId) {
        this.onStealthKill(this.nearestVictimId);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // Mouse Pointer Lock
    this.container.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        this.container.requestPointerLock();
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.container;
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPointerLocked) return;

      const sensitivity = 0.002;
      this.mouseYaw -= e.movementX * sensitivity;
      this.mousePitch -= e.movementY * sensitivity;

      // Clamp vertical camera angle
      this.mousePitch = Math.max(-Math.PI / 4, Math.min(Math.PI / 4, this.mousePitch));
    });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }

  public setLocalPlayer(playerId: string) {
    this.localPlayerId = playerId;
  }

  // Authoritative State Sync & Reconciliation
  public updateState(state: GameState) {
    // Update Fog based on Phase
    if (state.phase === 'EXTRACTION') {
      this.scene.background = new THREE.Color(0x050805);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(0x050805);
        this.scene.fog.density = 0.012;
      }
      // Open doors
      this.animateDoors(true);
    } else if (state.phase === 'STORM') {
      this.scene.background = new THREE.Color(0x020f02);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(0x020f02);
        // Fog density grows over the 30s Storm phase
        const ratio = (30 - state.timer) / 30;
        this.scene.fog.density = 0.02 + ratio * 0.08;
      }
      // Doors closing
      this.animateDoors(false, state.timer);
    } else {
      // Vote / Lobby / Game Over
      this.scene.background = new THREE.Color(0x050505);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(0x050505);
        this.scene.fog.density = 0.015;
      }
      this.animateDoors(false, 0); // closed
    }

    // Sync Players
    const activeIds = Object.keys(state.players);

    // Remove disconnected players
    Object.keys(this.playerMeshes).forEach(id => {
      if (!activeIds.includes(id)) {
        this.scene.remove(this.playerMeshes[id]);
        delete this.playerMeshes[id];
      }
    });

    // Create or update player representations
    activeIds.forEach(id => {
      const p = state.players[id];
      
      // Update local values directly from authoritative data if needed
      if (id === this.localPlayerId) {
        this.localHp = p.alive ? 100 : 0; // simple update
        // We reconciliate position if too far from server coordinates
        const serverPos = new THREE.Vector3(p.x, p.y, p.z);
        const dist = this.localPos.distanceTo(serverPos);
        if (dist > 2.5 || !p.alive) {
          this.localPos.copy(serverPos);
        }
        return;
      }

      let group = this.playerMeshes[id];
      if (!group) {
        // Create new player visual model
        group = new THREE.Group();

        // Body Capsule
        const bodyGeo = new THREE.CapsuleGeometry(0.4, 1.2, 4, 8);
        const bodyMat = new THREE.MeshStandardMaterial({ 
          color: 0x555555,
          roughness: 0.5
        });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.8;
        body.castShadow = true;
        body.receiveShadow = true;
        body.name = 'body';
        group.add(body);

        // Direction visor to show facing direction
        const visorGeo = new THREE.BoxGeometry(0.5, 0.15, 0.4);
        const visorMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const visor = new THREE.Mesh(visorGeo, visorMat);
        visor.position.set(0, 1.2, -0.3);
        visor.name = 'visor';
        group.add(visor);

        // Name tag Sprite
        const nameSprite = this.makeNameSprite(p.name);
        nameSprite.position.set(0, 1.8, 0);
        nameSprite.name = 'nametag';
        group.add(nameSprite);

        this.scene.add(group);
        this.playerMeshes[id] = group;
      }

      // If dead, lie flat on the ground
      const bodyMesh = group.getObjectByName('body') as THREE.Mesh;
      const bodyMat = bodyMesh.material as THREE.MeshStandardMaterial;

      if (!p.alive) {
        group.position.set(p.x, 0.15, p.z);
        group.rotation.x = Math.PI / 2;
        group.rotation.y = p.ry;
        bodyMat.color.setHex(0x1a0505);
      } else {
        // Smooth interpolation to avoid lag spikes
        group.position.lerp(new THREE.Vector3(p.x, p.y, p.z), 0.2);
        
        // Match rotation Y smoothly
        // Unroll angle
        let diff = p.ry - group.rotation.y;
        while (diff < -Math.PI) diff += Math.PI * 2;
        while (diff > Math.PI) diff -= Math.PI * 2;
        group.rotation.y += diff * 0.2;
        group.rotation.x = 0;

        // Custom styling for Infiltrators teammates (Red name tags/visors)
        if (p.role === 'INFILTRATOR') {
          bodyMat.color.setHex(0xff3333);
          const visor = group.getObjectByName('visor') as THREE.Mesh;
          if (visor) (visor.material as THREE.MeshBasicMaterial).color.setHex(0xff0000);
        } else {
          bodyMat.color.setHex(0x555555);
          const visor = group.getObjectByName('visor') as THREE.Mesh;
          if (visor) (visor.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
        }
      }
    });

    // Sync Loot items
    state.loot.forEach(l => {
      let mesh = this.lootMeshes[l.id];
      
      if (!mesh) {
        // Create Loot visual
        const lootGeo = new THREE.BoxGeometry(0.6, 0.6, 0.6);
        const lootMat = new THREE.MeshStandardMaterial({
          color: 0xeeeeee,
          wireframe: true,
          metalness: 0.9,
          roughness: 0.1
        });
        mesh = new THREE.Mesh(lootGeo, lootMat);
        mesh.position.set(l.x, 0.3, l.z);
        mesh.castShadow = true;
        this.scene.add(mesh);
        this.lootMeshes[l.id] = mesh;
      }

      // Hide or show based on collected state
      mesh.visible = !l.collected;
    });

    // Clean up old loot meshes if needed
    Object.keys(this.lootMeshes).forEach(id => {
      if (!state.loot.find(l => l.id === id)) {
        this.scene.remove(this.lootMeshes[id]);
        delete this.lootMeshes[id];
      }
    });

    // Check distances for prompt displays
    this.checkPrompts(state);
  }

  private makeNameSprite(name: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(0, 0, 256, 64);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(0, 0, 256, 64);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 24px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.toUpperCase(), 128, 32);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(1.5, 0.375, 1);
    return sprite;
  }

  private animateDoors(isOpen: boolean, timerVal = 30) {
    // Sliding gates at z = -15.
    // Left door default x = -4, open x = -10
    // Right door default x = 4, open x = 10
    let targetLeftX = -10;
    let targetRightX = 10;

    if (!isOpen) {
      // If closing, door position is function of remaining timer
      // 30s -> open, 0s -> closed
      const pct = Math.max(0, Math.min(1, timerVal / 30));
      targetLeftX = -10 + (6 * (1 - pct)); // slides towards -4
      targetRightX = 10 - (6 * (1 - pct)); // slides towards 4
    }

    const doorL = this.bunkerDoors[0];
    const doorR = this.bunkerDoors[1];
    if (doorL && doorR) {
      doorL.position.x = THREE.MathUtils.lerp(doorL.position.x, targetLeftX, 0.1);
      doorR.position.x = THREE.MathUtils.lerp(doorR.position.x, targetRightX, 0.1);
    }
  }

  // Local movement calculation and prediction
  private localMovement(dt: number) {
    if (!this.localPlayerId) return;

    this.isSprinting = this.keys['shift'];
    const speed = this.isSprinting ? 8.0 : 4.0;

    let moveX = 0;
    let moveZ = 0;

    // Movement vectors relative to camera Y orientation
    const forward = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mouseYaw);
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.mouseYaw);

    // Support ZQSD (French) and WASD (English)
    if (this.keys['z'] || this.keys['w']) {
      moveX += forward.x;
      moveZ += forward.z;
    }
    if (this.keys['s']) {
      moveX -= forward.x;
      moveZ -= forward.z;
    }
    if (this.keys['q'] || this.keys['a']) {
      moveX -= right.x;
      moveZ -= right.z;
    }
    if (this.keys['d']) {
      moveX += right.x;
      moveZ += right.z;
    }

    const len = Math.sqrt(moveX * moveX + moveZ * moveZ);
    let inputDir = { x: 0, z: 0 };

    if (len > 0.01) {
      // Normalize movement direction
      const dx = (moveX / len) * speed * dt;
      const dz = (moveZ / len) * speed * dt;

      // Predict position locally with collision checks
      const nextPos = this.localCollisionCheck(this.localPos.x + dx, this.localPos.z + dz);
      this.localPos.x = nextPos.x;
      this.localPos.z = nextPos.z;

      inputDir = { x: moveX / len, z: moveZ / len };
    }

    this.localYaw = this.mouseYaw;

    // Send input packet to server
    this.onSendInput({
      x: inputDir.x,
      z: inputDir.z,
      ry: this.localYaw,
      isSprinting: this.isSprinting
    });
  }

  // Local 2D bounding collisions
  private localCollisionCheck(x: number, z: number, radius = 0.8): { x: number; z: number } {
    let newX = x;
    let newZ = z;

    // Boundary clamp
    const bounds = 50 - radius;
    if (newX < -bounds) newX = -bounds;
    if (newX > bounds) newX = bounds;
    if (newZ < -bounds) newZ = -bounds;
    if (newZ > bounds) newZ = bounds;

    // Buildings collision
    this.mapObstacles.forEach(obs => {
      if (newX + radius > obs.minX && newX - radius < obs.maxX &&
          newZ + radius > obs.minZ && newZ - radius < obs.maxZ) {
        
        const overLeft = (newX + radius) - obs.minX;
        const overRight = obs.maxX - (newX - radius);
        const overTop = (newZ + radius) - obs.minZ;
        const overBottom = obs.maxZ - (newZ - radius);

        const min = Math.min(overLeft, overRight, overTop, overBottom);

        if (min === overLeft) newX -= overLeft;
        else if (min === overRight) newX += overRight;
        else if (min === overTop) newZ -= overTop;
        else if (min === overBottom) newZ += overBottom;
      }
    });

    return { x: newX, z: newZ };
  }

  // Prompt checks for nearby loot and victims
  private checkPrompts(state: GameState) {
    if (!this.localPlayerId) return;
    const localP = state.players[this.localPlayerId];
    if (!localP || !localP.alive) {
      this.nearestLootId = null;
      this.nearestVictimId = null;
      return;
    }

    // 1. Loot check
    let nearestLoot: Loot | null = null;
    let minLootDist = Infinity;

    state.loot.forEach(l => {
      if (l.collected) return;
      const dx = this.localPos.x - l.x;
      const dz = this.localPos.z - l.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < minLootDist) {
        minLootDist = dist;
        nearestLoot = l;
      }
    });

    this.nearestLootId = (nearestLoot && minLootDist <= 3.0) ? (nearestLoot as Loot).id : null;

    // 2. Kill check (Infiltrators only)
    if (localP.role === 'INFILTRATOR') {
      let nearestVictim: Player | null = null;
      let minVictimDist = Infinity;

      Object.values(state.players).forEach(p => {
        if (p.id === this.localPlayerId || !p.alive || p.role === 'INFILTRATOR') return;

        const dx = p.x - this.localPos.x;
        const dz = p.z - this.localPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist < minVictimDist) {
          minVictimDist = dist;
          nearestVictim = p;
        }
      });

      if (nearestVictim && minVictimDist <= 3.0) {
        // Blind spot angle calculation
        const victim = nearestVictim as Player;
        const fx = Math.sin(victim.ry);
        const fz = Math.cos(victim.ry);

        const kdx = this.localPos.x - victim.x;
        const kdz = this.localPos.z - victim.z;
        const klen = Math.sqrt(kdx * kdx + kdz * kdz);

        if (klen > 0) {
          const ndx = kdx / klen;
          const ndz = kdz / klen;
          const dot = fx * ndx + fz * ndz;

          // Killer must be behind victim
          this.nearestVictimId = (dot < -0.2) ? victim.id : null;
        }
      } else {
        this.nearestVictimId = null;
      }
    } else {
      this.nearestVictimId = null;
    }
  }

  // Core animate draw loop
  private animate = () => {
    requestAnimationFrame(this.animate);

    const dt = Math.min(0.1, this.clock.getDelta()); // clamp delta to prevent giant jumps

    // Run movement locally
    if (this.localHp > 0) {
      this.localMovement(dt);
    }

    // Rotate local player loot meshes locally for juice
    Object.values(this.lootMeshes).forEach(m => {
      if (m.visible) {
        m.rotation.y += 1.2 * dt;
        m.rotation.x += 0.6 * dt;
      }
    });

    // Smoothly orbit/TPS follow local camera
    this.updateCamera();

    this.renderer.render(this.scene, this.camera);
  };

  private updateCamera() {
    // Camera is attached to local player position
    const targetOffset = new THREE.Vector3(
      -Math.sin(this.mouseYaw) * Math.cos(this.mousePitch) * 8.0,
      Math.sin(this.mousePitch) * 8.0 + 3.5,
      -Math.cos(this.mouseYaw) * Math.cos(this.mousePitch) * 8.0
    );

    const targetCamPos = this.localPos.clone().add(targetOffset);
    
    // Smooth lerp camera movement
    this.camera.position.lerp(targetCamPos, 0.15);

    // Camera looks slightly above the local player position
    const lookTarget = this.localPos.clone().add(new THREE.Vector3(0, 1.2, 0));
    this.camera.lookAt(lookTarget);
  }
}
