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
    this.initOverlay();

    this.animate();
  }

  private initThree() {
    this.scene = new THREE.Scene();
    
    // Warm desert sky — bright enough to see clearly
    this.scene.background = new THREE.Color(0x3a2a18);
    this.scene.fog = new THREE.FogExp2(0x3a2a18, 0.008);

    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.container.appendChild(this.renderer.domElement);

    this.clock = new THREE.Clock();

    // Warm ambient — hazy daylight
    this.ambientLight = new THREE.AmbientLight(0x7a5530, 0.7);
    this.scene.add(this.ambientLight);

    // Golden sun directional light
    this.dirLight = new THREE.DirectionalLight(0xffaa60, 1.4);
    this.dirLight.position.set(-30, 50, -20);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 0.5;
    this.dirLight.shadow.camera.far = 200;
    const d = 60;
    this.dirLight.shadow.camera.left = -d;
    this.dirLight.shadow.camera.right = d;
    this.dirLight.shadow.camera.top = d;
    this.dirLight.shadow.camera.bottom = -d;
    this.scene.add(this.dirLight);

    // Secondary fill light — warm ground bounce
    const fillLight = new THREE.HemisphereLight(0x6a8a50, 0x5a3820, 0.5);
    this.scene.add(fillLight);

    // Fire point lights scattered in world
    const fireLightPositions = [
      [-20, 2, -20], [20, 2, 20], [-25, 2, 30], [30, 2, -15], [0, 2, 40]
    ];
    fireLightPositions.forEach(pos => {
      const fireLight = new THREE.PointLight(0xff4400, 3.0, 18);
      fireLight.position.set(pos[0], pos[1], pos[2]);
      this.scene.add(fireLight);
    });

    // Bunker zone — radioactive green glow at center
    const bunkerLight = new THREE.PointLight(0x22ff44, 2.5, 30);
    bunkerLight.position.set(0, 5, 0);
    this.scene.add(bunkerLight);
  }

  private createWorld() {
    // ── Ground — cracked asphalt / dried earth ──────────────────
    const groundGeo = new THREE.PlaneGeometry(120, 120, 30, 30);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2c1a08,
      roughness: 1.0,
      metalness: 0.0
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    // Ground cracks / detail grid — dim orange
    const gridHelper = new THREE.GridHelper(120, 40, 0x3a1c06, 0x1a0d03);
    gridHelper.position.y = 0.02;
    this.scene.add(gridHelper);

    // ── Bunker zone — radioactive ring ─────────────────────────
    const ringGeo = new THREE.RingGeometry(14.7, 15.3, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x44ff66, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    this.scene.add(ring);

    // Inner bunker floor — concrete-green tinted
    const bunkerFloorGeo = new THREE.CircleGeometry(14.7, 64);
    const bunkerFloorMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a12,
      roughness: 0.85,
      metalness: 0.1
    });
    const bunkerFloor = new THREE.Mesh(bunkerFloorGeo, bunkerFloorMat);
    bunkerFloor.rotation.x = -Math.PI / 2;
    bunkerFloor.position.y = 0.01;
    bunkerFloor.receiveShadow = true;
    this.scene.add(bunkerFloor);

    // Shield dome — toxic green wireframe
    const domeGeo = new THREE.SphereGeometry(15, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: 0x22ff44,
      transparent: true,
      opacity: 0.07,
      wireframe: true,
      side: THREE.DoubleSide
    });
    this.bunkerDome = new THREE.Mesh(domeGeo, domeMat);
    this.scene.add(this.bunkerDome);

    // ── Bunker steel doors ──────────────────────────────────────
    const doorGeo = new THREE.BoxGeometry(8, 6, 0.6);
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x3a2800,
      roughness: 0.6,
      metalness: 0.9
    });
    
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

    // Bunker wall — dark corroded concrete
    const wallArcPositions = [
      { x: -15, z: 0,   ry: Math.PI / 2 },
      { x:  15, z: 0,   ry: Math.PI / 2 },
      { x:  0,  z: 15,  ry: 0 },
    ];
    wallArcPositions.forEach(w => {
      const wGeo = new THREE.BoxGeometry(14, 4, 0.6);
      const wMat = new THREE.MeshStandardMaterial({ color: 0x1e1008, roughness: 0.95, metalness: 0.2 });
      const wMesh = new THREE.Mesh(wGeo, wMat);
      wMesh.position.set(w.x, 2, w.z);
      wMesh.rotation.y = w.ry;
      wMesh.castShadow = true;
      wMesh.receiveShadow = true;
      this.scene.add(wMesh);
    });

    // ── Ruined buildings (the map obstacles) ───────────────────
    const ruinColors = [0x2e1a08, 0x261408, 0x331c0a, 0x1e1206];
    this.mapObstacles.forEach((obs, i) => {
      const width = obs.maxX - obs.minX;
      const depth = obs.maxZ - obs.minZ;
      const height = 10 + Math.random() * 8;

      // Main block
      const boxGeo = new THREE.BoxGeometry(width, height, depth);
      const boxMat = new THREE.MeshStandardMaterial({
        color: ruinColors[i % ruinColors.length],
        roughness: 0.95,
        metalness: 0.1
      });
      const mesh = new THREE.Mesh(boxGeo, boxMat);
      mesh.position.set(obs.minX + width / 2, height / 2, obs.minZ + depth / 2);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.obstacles.push(mesh);

      // Rooftop rubble / broken bits
      for (let r = 0; r < 3; r++) {
        const rSize = Math.random() * 2 + 0.5;
        const rGeo = new THREE.BoxGeometry(rSize, rSize * 0.5, rSize);
        const rMat = new THREE.MeshStandardMaterial({ color: 0x1a0d05, roughness: 1.0 });
        const rMesh = new THREE.Mesh(rGeo, rMat);
        rMesh.position.set(
          obs.minX + width / 2 + (Math.random() - 0.5) * width * 0.7,
          height + rSize * 0.25,
          obs.minZ + depth / 2 + (Math.random() - 0.5) * depth * 0.7
        );
        rMesh.rotation.y = Math.random() * Math.PI;
        rMesh.castShadow = true;
        this.scene.add(rMesh);
      }
    });

    // ── Scattered debris & abandoned vehicles ──────────────────
    const debrisColors = [0x2a1508, 0x3a2010, 0x1a0d04, 0x4a2c10];
    for (let i = 0; i < 50; i++) {
      const size = Math.random() * 2 + 0.3;
      const type = Math.random();
      let debrisGeo: THREE.BufferGeometry;
      if (type < 0.5) {
        debrisGeo = new THREE.BoxGeometry(size, size * 0.4, size);
      } else if (type < 0.8) {
        debrisGeo = new THREE.CylinderGeometry(size * 0.3, size * 0.3, size * 0.8, 6);
      } else {
        debrisGeo = new THREE.TetrahedronGeometry(size * 0.6);
      }
      const debrisMat = new THREE.MeshStandardMaterial({
        color: debrisColors[Math.floor(Math.random() * debrisColors.length)],
        roughness: 1.0,
        metalness: 0.3
      });
      const debris = new THREE.Mesh(debrisGeo, debrisMat);
      // Keep away from center bunker zone
      let px: number, pz: number;
      do {
        px = (Math.random() - 0.5) * 100;
        pz = (Math.random() - 0.5) * 100;
      } while (Math.sqrt(px * px + pz * pz) < 18);

      debris.position.set(px, size * 0.2, pz);
      debris.rotation.y = Math.random() * Math.PI * 2;
      debris.rotation.z = (Math.random() - 0.5) * 0.4;
      debris.castShadow = true;
      debris.receiveShadow = true;
      this.scene.add(debris);
    }

    // ── Fire barrels (glowing orange cylinders) ────────────────
    const barrelPositions = [[-20, -20], [20, 20], [-25, 30], [30, -15], [0, 42], [15, -35]];
    barrelPositions.forEach(([bx, bz]) => {
      const bGeo = new THREE.CylinderGeometry(0.5, 0.5, 1.2, 8);
      const bMat = new THREE.MeshStandardMaterial({
        color: 0x3a1a00,
        roughness: 0.8,
        metalness: 0.7,
        emissive: new THREE.Color(0xff4400),
        emissiveIntensity: 0.6
      });
      const barrel = new THREE.Mesh(bGeo, bMat);
      barrel.position.set(bx, 0.6, bz);
      barrel.castShadow = true;
      this.scene.add(barrel);

      // Flame glow sphere
      const flameGeo = new THREE.SphereGeometry(0.35, 8, 8);
      const flameMat = new THREE.MeshBasicMaterial({
        color: 0xff7700,
        transparent: true,
        opacity: 0.85
      });
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(bx, 1.5, bz);
      this.scene.add(flame);
    });

    // ── Distant ruined walls / broken skyline ──────────────────
    const skylinePositions = [
      { x: -55, z: -55 }, { x: 55, z: -55 }, { x: -55, z: 55 }, { x: 55, z: 55 },
      { x: 0, z: -58 }, { x: -58, z: 0 }, { x: 58, z: 0 }, { x: 0, z: 58 }
    ];
    skylinePositions.forEach(sp => {
      const h = 8 + Math.random() * 20;
      const w = 6 + Math.random() * 12;
      const sGeo = new THREE.BoxGeometry(w, h, 3);
      const sMat = new THREE.MeshStandardMaterial({ color: 0x110800, roughness: 1.0, metalness: 0.0 });
      const sMesh = new THREE.Mesh(sGeo, sMat);
      sMesh.position.set(sp.x, h / 2, sp.z);
      sMesh.rotation.y = Math.random() * 0.3 - 0.15;
      sMesh.castShadow = true;
      sMesh.receiveShadow = true;
      this.scene.add(sMesh);
    });
  }

  private setupEvents() {
    // Keyboard inputs
    window.addEventListener('keydown', (e) => {
      // Ignore if user is typing in an input field
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Prevent browser scrolling on arrow keys
      if (e.key.startsWith('Arrow')) {
        e.preventDefault();
      }

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
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
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
    // Update sky / fog based on game phase
    if (state.phase === 'EXTRACTION') {
      // Golden hour — extraction phase
      this.scene.background = new THREE.Color(0x4a3520);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(0x4a3520);
        this.scene.fog.density = 0.008;
      }
      this.dirLight.color.setHex(0xffaa60);
      this.ambientLight.color.setHex(0x8a6540);
      // Open doors
      this.animateDoors(true);
    } else if (state.phase === 'STORM') {
      // Greener haze — storm phase, still bright enough to play
      const ratio = (30 - state.timer) / 30;
      const skyHex = ratio > 0.5 ? 0x2a3a20 : 0x3a4a28;
      this.scene.background = new THREE.Color(skyHex);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(skyHex);
        this.scene.fog.density = 0.010 + ratio * 0.04;
      }
      this.dirLight.color.setHex(0x90dd50);
      this.ambientLight.color.setHex(0x5a7a40);
      // Doors closing
      this.animateDoors(false, state.timer);
    } else {
      // Vote / Lobby / Game Over — warm amber tint
      this.scene.background = new THREE.Color(0x3a2018);
      if (this.scene.fog instanceof THREE.FogExp2) {
        this.scene.fog.color.setHex(0x3a2018);
        this.scene.fog.density = 0.010;
      }
      this.dirLight.color.setHex(0xee7740);
      this.ambientLight.color.setHex(0x6a4030);
      this.animateDoors(false, 0);
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
        this.localHp = p.hp;
        const serverPos = new THREE.Vector3(p.x, p.y, p.z);
        const dist = this.localPos.distanceTo(serverPos);
        if (dist > 2.5 || !p.alive) {
          this.localPos.copy(serverPos);
        }
        return;
      }

      let group = this.playerMeshes[id];
      if (!group) {
          // Create humanoid player with post-apoc style clothing
          group = new THREE.Group();

          // Determine role-based palette
          const isInfil = p.role === 'INFILTRATOR';
          const bodyColor   = isInfil ? 0x1a0000 : 0x1e1408;   // dark red or dark khaki
          const clothColor  = isInfil ? 0x660000 : 0x3a2a10;   // red coat or brown jacket
          const pantsColor  = isInfil ? 0x2a0000 : 0x22180a;   // dark pants
          const skinColor   = 0xc8956c;                          // weathered skin tone
          const bootColor   = 0x1a1008;                          // dark boots
          const visorHex    = isInfil ? 0xff2200 : 0x44cc88;   // red or green visor

          // ── Torso / jacket ──────────────────────────────────
          const torsoGeo = new THREE.BoxGeometry(0.65, 0.85, 0.35);
          const torsoMat = new THREE.MeshStandardMaterial({
            color: clothColor, roughness: 0.85, metalness: 0.05
          });
          const torso = new THREE.Mesh(torsoGeo, torsoMat);
          torso.position.y = 1.0;
          torso.castShadow = true;
          torso.receiveShadow = true;
          torso.name = 'body';
          group.add(torso);

          // ── Head ────────────────────────────────────────────
          const headGeo = new THREE.SphereGeometry(0.28, 10, 10);
          const headMat = new THREE.MeshStandardMaterial({
            color: skinColor, roughness: 0.7, metalness: 0.0
          });
          const head = new THREE.Mesh(headGeo, headMat);
          head.position.y = 1.62;
          head.castShadow = true;
          group.add(head);

          // Helmet / bandana
          const hatGeo = new THREE.CylinderGeometry(0.3, 0.29, 0.18, 8);
          const hatMat = new THREE.MeshStandardMaterial({
            color: bodyColor, roughness: 0.9, metalness: 0.2
          });
          const hat = new THREE.Mesh(hatGeo, hatMat);
          hat.position.y = 1.83;
          hat.castShadow = true;
          group.add(hat);

          // ── Arms (with hands) ────────────────────────────────
          const upperArmGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.45, 7);
          const upperArmMat = new THREE.MeshStandardMaterial({ color: clothColor, roughness: 0.85 });
          const lowerArmGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.35, 7);
          const lowerArmMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.75 });

          [-1, 1].forEach(side => {
            const uArm = new THREE.Mesh(upperArmGeo, upperArmMat.clone());
            uArm.position.set(side * 0.48, 1.15, 0);
            uArm.rotation.z = side * (Math.PI / 2 + 0.2);
            uArm.castShadow = true;
            group.add(uArm);

            const lArm = new THREE.Mesh(lowerArmGeo, lowerArmMat.clone());
            lArm.position.set(side * 0.7, 0.9, 0);
            lArm.rotation.z = side * (Math.PI / 2 + 0.4);
            lArm.castShadow = true;
            group.add(lArm);
          });

          // ── Legs ─────────────────────────────────────────────
          const upperLegGeo = new THREE.CylinderGeometry(0.13, 0.11, 0.5, 7);
          const upperLegMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.9 });
          const lowerLegGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.4, 7);
          const bootMat = new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.8, metalness: 0.3 });

          [-1, 1].forEach(side => {
            const uLeg = new THREE.Mesh(upperLegGeo, upperLegMat.clone());
            uLeg.position.set(side * 0.19, 0.55, 0);
            uLeg.castShadow = true;
            group.add(uLeg);

            const lLeg = new THREE.Mesh(lowerLegGeo, bootMat.clone());
            lLeg.position.set(side * 0.19, 0.13, 0);
            lLeg.castShadow = true;
            group.add(lLeg);
          });

          // ── Eye visor / mask ─────────────────────────────────
          const visorGeo = new THREE.BoxGeometry(0.35, 0.12, 0.08);
          const visorMat = new THREE.MeshStandardMaterial({
            color: visorHex,
            emissive: new THREE.Color(visorHex),
            emissiveIntensity: 0.8,
            roughness: 0.2,
            metalness: 0.8
          });
          const visor = new THREE.Mesh(visorGeo, visorMat);
          visor.position.set(0, 1.61, -0.27);
          visor.name = 'visor';
          group.add(visor);

          // ── Name tag sprite ──────────────────────────────────
          const nameSprite = this.makeNameSprite(p.name, isInfil);
          nameSprite.position.set(0, 2.3, 0);
          (nameSprite.material as THREE.SpriteMaterial).depthTest = false;
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
        group.rotation.order = 'YXZ';
        group.rotation.y = p.ry;
        group.rotation.x = Math.PI / 2;
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

        // Update body/visor color based on role
        if (p.role === 'INFILTRATOR') {
          bodyMat.color.setHex(0x660000);
          const visor = group.getObjectByName('visor') as THREE.Mesh;
          if (visor) {
            const vm = visor.material as THREE.MeshStandardMaterial;
            vm.color.setHex(0xff2200);
            vm.emissive.setHex(0xff2200);
            vm.emissiveIntensity = 1.0;
          }
        } else {
          bodyMat.color.setHex(0x3a2a10);
          const visor = group.getObjectByName('visor') as THREE.Mesh;
          if (visor) {
            const vm = visor.material as THREE.MeshStandardMaterial;
            vm.color.setHex(0x44cc88);
            vm.emissive.setHex(0x44cc88);
            vm.emissiveIntensity = 0.7;
          }
        }
      }
    });

    // Sync Loot items
    state.loot.forEach(l => {
      let mesh = this.lootMeshes[l.id];
      
      if (!mesh) {
        // Create Loot visual — glowing amber supply crate
        const lootGeo = new THREE.BoxGeometry(0.65, 0.45, 0.65);
        const lootMat = new THREE.MeshStandardMaterial({
          color: 0xcc7700,
          emissive: new THREE.Color(0xaa5500),
          emissiveIntensity: 0.5,
          metalness: 0.6,
          roughness: 0.4
        });
        mesh = new THREE.Mesh(lootGeo, lootMat);
        mesh.position.set(l.x, 0.25, l.z);
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

  private makeNameSprite(name: string, isInfiltrator = false): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 56;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Background — dark panel
      ctx.fillStyle = isInfiltrator ? 'rgba(60,0,0,0.78)' : 'rgba(8,20,10,0.78)';
      ctx.fillRect(0, 0, 256, 56);

      // Border glow
      ctx.strokeStyle = isInfiltrator ? 'rgba(255,40,0,0.85)' : 'rgba(60,200,80,0.85)';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(1, 1, 254, 54);

      // Name text
      ctx.fillStyle = isInfiltrator ? '#ff8866' : '#aaffbb';
      ctx.font = 'bold 22px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.toUpperCase(), 128, 29);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(mat);
    (sprite.material as THREE.SpriteMaterial).depthTest = false;
    sprite.renderOrder = 9999;
    sprite.scale.set(1.6, 0.35, 1);
    return sprite;
  }

  private initOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'game-rules-overlay';
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0', left: '0',
      width: '100%', height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: '9000',
      padding: '2rem',
      textAlign: 'center'
    });
    overlay.innerHTML = `
      <h1 style="font-family:'Oswald',sans-serif;font-size:2.4rem;letter-spacing:.3em;
                 color:#f5c87a;text-shadow:0 0 30px rgba(230,107,16,.7);margin-bottom:24px;">⚠ PROTOCOL 10 ⚠</h1>
      <p style="font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.75rem;
                letter-spacing:.2em;margin-bottom:28px;text-transform:uppercase;">BRIEFING DE MISSION — ZONE CONTAMINATION ALPHA</p>
      <ul style="list-style:none;max-width:640px;text-align:left;">
        <li style="padding:10px 0;border-bottom:1px solid rgba(180,90,20,.2);
                   font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.88rem;line-height:1.6">
          🎮 <b style="color:#e06b10">DÉPLACEMENT</b> — ↑ / ← / ↓ / → &nbsp;|&nbsp; <b style="color:#e06b10">SHIFT</b> pour sprinter
        </li>
        <li style="padding:10px 0;border-bottom:1px solid rgba(180,90,20,.2);
                   font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.88rem;line-height:1.6">
          📦 <b style="color:#e06b10">RESSOURCES</b> — Appuyez sur <b style="color:#e06b10">F</b> près d'une caisse pour ramasser le butin
        </li>
        <li style="padding:10px 0;border-bottom:1px solid rgba(180,90,20,.2);
                   font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.88rem;line-height:1.6">
          🔴 <b style="color:#cc2a2a">INFILTRÉ</b> — Utilisez <b style="color:#cc2a2a">E</b> dans le dos d'un innocent pour l'éliminer silencieusement
        </li>
        <li style="padding:10px 0;border-bottom:1px solid rgba(180,90,20,.2);
                   font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.88rem;line-height:1.6">
          🟢 <b style="color:#4ec832">INNOCENT</b> — Récoltez 5 ressources OU survivez 3 cycles pour gagner
        </li>
        <li style="padding:10px 0;
                   font-family:'JetBrains Mono',monospace;color:#7a5c3a;font-size:.88rem;line-height:1.6">
          🗳️ <b style="color:#e06b10">VOTE</b> — Entre les cycles, votez pour bannir un suspect dans la tempête
        </li>
      </ul>
      <p>Appuyez sur une touche ou cliquez pour commencer.</p>
    `;
    document.body.appendChild(overlay);
    const dismiss = () => overlay.remove();
    window.addEventListener('keydown', dismiss, { once: true });
    window.addEventListener('click', dismiss, { once: true });
  }

  private animateDoors(isOpen: boolean, timerVal: number = 0) {
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

    // Arrow keys only
    if (this.keys['arrowdown']) {
      moveX += forward.x;
      moveZ += forward.z;
    }
    if (this.keys['arrowup']) {
      moveX -= forward.x;
      moveZ -= forward.z;
    }
    if (this.keys['arrowright']) {
      moveX -= right.x;
      moveZ -= right.z;
    }
    if (this.keys['arrowleft']) {
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
