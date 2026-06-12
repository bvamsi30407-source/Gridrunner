/**
 * Gridrunner: Neon Eclipse - 3D Cyber Endless Runner Core
 */

import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { motion, AnimatePresence } from 'motion/react';
import {
  RotateCcw,
  Play,
  Shield,
  Zap,
  Trophy,
  Volume2,
  VolumeX,
  Keyboard,
  Info,
  ChevronRight,
  Database
} from 'lucide-react';
import { GameState, Obstacle, Collectible, PlayerState } from './types';
import { gameAudio } from './audio';

// Constants
const TUBE_RADIUS = 15;
const VEHICLE_HEIGHT = 0.5;
const VEHICLE_Y_BASE = -(TUBE_RADIUS - VEHICLE_HEIGHT); // -14.5
const SEGMENT_LENGTH = 150;
const TOTAL_CYLINDERS = 3;
const FAR_LIMIT = -SEGMENT_LENGTH * (TOTAL_CYLINDERS - 0.5); // -375 units
const BASE_SPEED = 38;
const BOOST_SPEED = 70;
const COLLISION_Z_THRESHOLD = 1.3;

export default function App() {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [highScore, setHighScore] = useState<number>(() => {
    const saved = localStorage.getItem('gridrunner_highscore');
    return saved ? parseInt(saved, 10) : 0;
  });
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [activeShield, setActiveShield] = useState<boolean>(false);
  const [scoreText, setScoreText] = useState<number>(0);
  const [crystalsCount, setCrystalsCount] = useState<number>(0);

  // References for low-latency game loop access
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState>('menu');
  const scoreRef = useRef<number>(0);
  const crystalsRef = useRef<number>(0);
  const peakSpeedRef = useRef<number>(0);

  // Keyboard/Touch input state
  const keysRef = useRef({
    left: false,
    right: false,
    up: false, // Nitro Boost
    space: false // Jump
  });

  // Screen flash notification state
  const flashColorRef = useRef<'red' | 'cyan' | 'green' | null>(null);

  // Particle systems
  const sparksRef = useRef<{
    mesh: THREE.Mesh | THREE.LineSegments;
    vx: number;
    vy: number;
    vz: number;
    life: number;
    maxLife: number;
  }[]>([]);

  // Update game state ref when state changes
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // Audio setup
  useEffect(() => {
    gameAudio.setMute(isMuted);
  }, [isMuted]);

  // Main Three.js Game Setup
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    // --- INTERNAL DATA & WEBGL SETUP ---
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000216, 0.005);

    // Dynamic third-person camera
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 800);
    camera.position.set(0, 5, 14); // Initial camera placeholder

    const renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000109, 1.0);

    // --- ACCESSIBLE STAGE ARRAYS ---
    let cylinders: THREE.Mesh[] = [];
    let obstacles: Obstacle[] = [];
    let collectibles: Collectible[] = [];

    // --- GAMEPLAY COORDINATES ---
    const player: PlayerState = {
      angle: 0,
      jumpHeight: 0,
      jumpVelocity: 0,
      isJumping: false,
      shieldTime: 0,
      nitroActive: false,
      speed: BASE_SPEED
    };

    let cameraAngle = 0;
    let cameraZTarget = 14;
    let currentFov = 60;
    let obstacleTimer = 0;
    let collectibleTimer = 0;
    let nextSectorGoal = 400; // Sector clearance meters
    let screenShake = 0;

    // --- PROCEDURAL MODEL GENERATORS ---

    // 1. Cyber-Cycle mesh generator
    const playerGroup = new THREE.Group();
    
    // Core fuselage capsule
    const bodyGeo = new THREE.BoxGeometry(0.55, 0.45, 1.8);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      emissive: 0x004a60,
      roughness: 0.1,
      metalness: 0.95
    });
    const bikeBody = new THREE.Mesh(bodyGeo, bodyMat);
    playerGroup.add(bikeBody);

    // Holographic canopy/windshield
    const windshieldGeo = new THREE.BoxGeometry(0.38, 0.25, 0.6);
    const windshieldMat = new THREE.MeshStandardMaterial({
      color: 0xff00aa,
      emissive: 0x55003b,
      transparent: true,
      opacity: 0.7,
      roughness: 0.1
    });
    const canopy = new THREE.Mesh(windshieldGeo, windshieldMat);
    canopy.position.set(0, 0.22, -0.3);
    playerGroup.add(canopy);

    // Wing Stabilizers (Magenta side fins)
    const stabilizerMat = new THREE.MeshStandardMaterial({
      color: 0xff00aa,
      emissive: 0x770044,
      roughness: 0.3
    });
    const wingLGeo = new THREE.BoxGeometry(0.42, 0.04, 0.7);
    wingLGeo.translate(-0.35, -0.1, 0.2);
    const wingL = new THREE.Mesh(wingLGeo, stabilizerMat);
    playerGroup.add(wingL);

    const wingRGeo = new THREE.BoxGeometry(0.42, 0.04, 0.7);
    wingRGeo.translate(0.35, -0.1, 0.2);
    const wingR = new THREE.Mesh(wingRGeo, stabilizerMat);
    playerGroup.add(wingR);

    // Under-body glowing levitation discs
    const diskGeo = new THREE.TorusGeometry(0.18, 0.03, 8, 16);
    diskGeo.rotateX(Math.PI / 2);
    const diskMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff, wireframe: true });
    const hoverDiskL = new THREE.Mesh(diskGeo, diskMat);
    hoverDiskL.position.set(-0.35, -0.14, 0.2);
    playerGroup.add(hoverDiskL);

    const hoverDiskR = hoverDiskL.clone();
    hoverDiskR.position.x = 0.35;
    playerGroup.add(hoverDiskR);

    // Tail engine exhaust nozzle
    const nozzleGeo = new THREE.CylinderGeometry(0.12, 0.07, 0.3, 8);
    nozzleGeo.rotateX(Math.PI / 2);
    const nozzleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.position.set(0, -0.05, 0.85);
    playerGroup.add(nozzle);

    // Exhaust fire cones (reactive scaling)
    const flameGeo = new THREE.ConeGeometry(0.1, 0.75, 8);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, 0.37);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0xff3c00,
      transparent: true,
      opacity: 0.85
    });
    const flame = new THREE.Mesh(flameGeo, flameMat);
    flame.position.set(0, -0.05, 0.9);
    playerGroup.add(flame);

    // Glowing outline highlight
    const highlightGeo = new THREE.BoxGeometry(0.56, 0.46, 1.82);
    const wireHighlight = new THREE.WireframeGeometry(highlightGeo);
    const wireLineMat = new THREE.LineBasicMaterial({ color: 0x00f3ff, linewidth: 2 });
    const outlineHighlight = new THREE.LineSegments(wireHighlight, wireLineMat);
    playerGroup.add(outlineHighlight);

    // Ambient point headlight zipping down the cylinder
    const headlight = new THREE.PointLight(0x00f3ff, 2.2, 35);
    headlight.position.set(0, 0.3, -1.8);
    playerGroup.add(headlight);

    // Translucent shield bubble mesh
    const shieldGeo = new THREE.SphereGeometry(1.4, 16, 16);
    const shieldMat = new THREE.MeshBasicMaterial({
      color: 0x00e6ff,
      wireframe: true,
      transparent: true,
      opacity: 0.0
    });
    const shieldBubble = new THREE.Mesh(shieldGeo, shieldMat);
    playerGroup.add(shieldBubble);

    // Position physical player system
    const playerPivot = new THREE.Group();
    scene.add(playerPivot);
    playerGroup.position.y = VEHICLE_Y_BASE;
    playerPivot.add(playerGroup);

    // Helper functions for particle explosion bursts
    const spawnExplosionParticles = (pos: THREE.Vector3, colorVal: number, count = 30) => {
      const geo = new THREE.BoxGeometry(0.15, 0.15, 0.15);
      const mat = new THREE.MeshBasicMaterial({ color: colorVal, transparent: true, opacity: 0.95 });

      for (let i = 0; i < count; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        // Translate world coordinates back relative to local or push into global scene
        mesh.position.copy(pos);
        
        // Random spherical directions
        const phi = Math.random() * Math.PI * 2;
        const theta = Math.acos(Math.random() * 2 - 1);
        const force = 10 + Math.random() * 25;
        const vx = force * Math.sin(theta) * Math.cos(phi);
        const vy = force * Math.sin(theta) * Math.sin(phi);
        const vz = force * Math.cos(theta);

        sparksRef.current.push({
          mesh,
          vx,
          vy,
          vz,
          maxLife: 0.8 + Math.random() * 0.5,
          life: 0.8 + Math.random() * 0.5
        });

        scene.add(mesh);
      }
    };

    const spawnGlowSparks = (pos: THREE.Vector3, colorVal: number, count = 8) => {
      const geo = new THREE.BufferGeometry();
      const points = new Float32Array(6); // 2 coordinate links
      points[0] = 0; points[1] = 0; points[2] = 0;
      points[3] = 0; points[4] = 0; points[5] = -0.5;
      geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
      const mat = new THREE.LineBasicMaterial({ color: colorVal, transparent: true, opacity: 0.8 });

      for (let i = 0; i < count; i++) {
        const line = new THREE.LineSegments(geo, mat);
        line.position.copy(pos);
        
        const vx = (Math.random() - 0.5) * 8;
        const vy = (Math.random() - 0.5) * 8;
        const vz = (Math.random() - 0.5) * 10 - 15; // float backward

        sparksRef.current.push({
          mesh: line,
          vx,
          vy,
          vz,
          maxLife: 0.4 + Math.random() * 0.4,
          life: 0.4 + Math.random() * 0.4
        });
        scene.add(line);
      }
    };

    // --- CYBER SPACE CYLINDERS (INFINITE GRIDS) ---
    const tunnelGroup = new THREE.Group();
    scene.add(tunnelGroup);

    // Create sliding modular segments
    const constructCylinders = () => {
      cylinders.forEach(c => tunnelGroup.remove(c));
      cylinders = [];

      const cylGeo = new THREE.CylinderGeometry(TUBE_RADIUS, TUBE_RADIUS, SEGMENT_LENGTH, 18, 15, true);
      cylGeo.rotateX(Math.PI / 2); // Align with Z-axis

      const backingGeo = new THREE.CylinderGeometry(TUBE_RADIUS + 0.1, TUBE_RADIUS + 0.1, SEGMENT_LENGTH, 18, 1, true);
      backingGeo.rotateX(Math.PI / 2);

      for (let i = 0; i < TOTAL_CYLINDERS; i++) {
        const segGroup = new THREE.Group();
        segGroup.position.z = -i * SEGMENT_LENGTH;

        // Glowing Wireframe Web
        const cylMat = new THREE.MeshBasicMaterial({
          color: 0x004bff,
          wireframe: true,
          transparent: true,
          opacity: 0.28
        });
        const mesh = new THREE.Mesh(cylGeo, cylMat);
        segGroup.add(mesh);

        // Solid Backside occluding outer debris
        const backMat = new THREE.MeshBasicMaterial({
          color: 0x010313,
          side: THREE.BackSide,
          transparent: true,
          opacity: 0.95
        });
        const backMesh = new THREE.Mesh(backingGeo, backMat);
        segGroup.add(backMesh);

        // Distance indicators: Pink rings at the seams of each cylinder
        const ringGeo = new THREE.RingGeometry(TUBE_RADIUS - 0.05, TUBE_RADIUS + 0.05, 24);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xff0088,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.5
        });
        const seamRing = new THREE.Mesh(ringGeo, ringMat);
        seamRing.position.z = SEGMENT_LENGTH / 2;
        segGroup.add(seamRing);

        tunnelGroup.add(segGroup);
        cylinders.push(segGroup as any);
      }
    };
    constructCylinders();

    // --- COMSIC CELESTIAL STARS ---
    const numStars = 450;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(numStars * 3);
    const starSpeeds = new Float32Array(numStars);

    for (let i = 0; i < numStars; i++) {
      const radius = 6 + Math.random() * 45;
      const starAngle = Math.random() * Math.PI * 2;
      starPositions[i * 3] = radius * Math.cos(starAngle);
      starPositions[i * 3 + 1] = radius * Math.sin(starAngle);
      starPositions[i * 3 + 2] = -Math.random() * 500;
      starSpeeds[i] = 1.0 + Math.random() * 2.5;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xb589ff,
      size: 0.14,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // --- AMBIENT LIGHTS ---
    const ambientLight = new THREE.AmbientLight(0x1a123a, 1.2);
    scene.add(ambientLight);

    const centralLight = new THREE.DirectionalLight(0x401050, 1.5);
    centralLight.position.set(0, 10, -50);
    scene.add(centralLight);

    // --- HARNESS INPUTS WITH PREV_EVENTS PREVENT ---
    const keys = keysRef.current;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (gameStateRef.current !== 'playing') return;
      
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || k === 'a') {
        keys.left = true;
        e.preventDefault();
      }
      if (e.key === 'ArrowRight' || k === 'd') {
        keys.right = true;
        e.preventDefault();
      }
      if (e.key === 'ArrowUp' || k === 'w') {
        keys.up = true;
        e.preventDefault();
      }
      if (e.key === ' ' || e.key === 'Spacebar') {
        keys.space = true;
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowLeft' || k === 'a') keys.left = false;
      if (e.key === 'ArrowRight' || k === 'd') keys.right = false;
      if (e.key === 'ArrowUp' || k === 'w') keys.up = false;
      if (e.key === ' ' || e.key === 'Spacebar') keys.space = false;
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    window.addEventListener('keyup', handleKeyUp);

    // Normalize angular difference in polar calculations
    const getAngleDiff = (a1: number, a2: number) => {
      let diff = Math.abs(a1 - a2);
      while (diff > Math.PI) diff = Math.abs(diff - Math.PI * 2);
      return diff;
    };

    // --- LEVEL GENERATORS ---

    const spawnObstacle = () => {
      const angle = Math.random() * Math.PI * 2;
      const typeChoice = Math.random();
      const obsGroup = new THREE.Group();
      obsGroup.position.set(0, 0, -420);
      obsGroup.rotation.z = angle;

      // Spawns based on difficulty
      if (typeChoice < 0.45) {
        // Red holographic barrier blocking half the cylinder
        const wallResGeo = new THREE.BoxGeometry(9.0, 7.5, 2.8);
        const wallResMat = new THREE.MeshStandardMaterial({
          color: 0xff0f33,
          emissive: 0xcc0011,
          roughness: 0.1,
          transparent: true,
          opacity: 0.8
        });
        const barrierMesh = new THREE.Mesh(wallResGeo, wallResMat);
        barrierMesh.position.set(0, -(TUBE_RADIUS - 3.75), 0); // Touches wall
        obsGroup.add(barrierMesh);

        // Add glowing border
        const borderGeo = new THREE.BoxGeometry(9.1, 7.6, 2.9);
        const helperBorder = new THREE.WireframeGeometry(borderGeo);
        const borderMat = new THREE.LineBasicMaterial({ color: 0xff4433, linewidth: 2 });
        const wireBorder = new THREE.LineSegments(helperBorder, borderMat);
        wireBorder.position.copy(barrierMesh.position);
        obsGroup.add(wireBorder);

        scene.add(obsGroup);
        obstacles.push({
          group: obsGroup,
          type: 'barrier',
          angle: angle,
          z: -420,
          hit: false,
          passed: false
        });
      } else if (typeChoice < 0.80) {
        // Low grid-fence (jumpable barrier)
        const fenceGeo = new THREE.BoxGeometry(7.2, 2.0, 1.3);
        const fenceMat = new THREE.MeshStandardMaterial({
          color: 0xffbb00,
          emissive: 0x996600,
          roughness: 0.4,
          transparent: true,
          opacity: 0.85
        });
        const fenceMesh = new THREE.Mesh(fenceGeo, fenceMat);
        fenceMesh.position.set(0, -(TUBE_RADIUS - 1.0), 0);
        obsGroup.add(fenceMesh);

        // Warning neon highlights
        const fenceWarnGeo = new THREE.BoxGeometry(7.3, 2.1, 1.4);
        const fenceWire = new THREE.WireframeGeometry(fenceWarnGeo);
        const fenceLineMat = new THREE.LineBasicMaterial({ color: 0xfff000, linewidth: 1.5 });
        const wireFence = new THREE.LineSegments(fenceWire, fenceLineMat);
        wireFence.position.copy(fenceMesh.position);
        obsGroup.add(wireFence);

        scene.add(obsGroup);
        obstacles.push({
          group: obsGroup,
          type: 'fence',
          angle: angle,
          z: -420,
          hit: false,
          passed: false
        });
      } else {
        // EMP Ring centered on tube Axis with a safe angle gap
        const gapAngle = Math.random() * Math.PI * 2;
        const ringSegmentGroup = new THREE.Group();
        ringSegmentGroup.position.set(0, 0, 0);

        // Generate segmented boxes in a circle, omitting sections around gapAngle
        const segments = 12;
        const radSegments = (Math.PI * 2) / segments;
        const cellGeo = new THREE.BoxGeometry(7.0, 0.45, 1.4);
        const cellMat = new THREE.MeshStandardMaterial({
          color: 0xbc3fff,
          emissive: 0x7700cc,
          roughness: 0.1
        });

        for (let i = 0; i < segments; i++) {
          const thetaSegment = i * radSegments;
          const diff = getAngleDiff(thetaSegment, gapAngle);

          // Omit two slots to form a 60 degree safe zone
          if (diff < 0.6) continue;

          const pGroup = new THREE.Group();
          pGroup.rotation.z = thetaSegment;
          const cell = new THREE.Mesh(cellGeo, cellMat);
          cell.position.y = -(TUBE_RADIUS - 0.22);
          pGroup.add(cell);
          ringSegmentGroup.add(pGroup);
        }

        obsGroup.add(ringSegmentGroup);
        scene.add(obsGroup);

        obstacles.push({
          group: obsGroup,
          type: 'emp',
          angle: angle, // Unused base rotation since segments are pre-offset
          z: -420,
          hit: false,
          passed: false,
          gapAngle: gapAngle,
          gapWidth: 1.0
        });
      }
    };

    const spawnCollectible = () => {
      const typeChoice = Math.random();
      const angle = Math.random() * Math.PI * 2;
      const type = typeChoice < 0.88 ? 'cube' : 'shield';
      
      let mesh: THREE.Object3D;

      if (type === 'cube') {
        // Green Cyber Data Cube
        const gemGeo = new THREE.OctahedronGeometry(0.35);
        const gemMat = new THREE.MeshStandardMaterial({
          color: 0x00ff8e,
          emissive: 0x00783a,
          roughness: 0.1,
          metalness: 0.9
        });
        mesh = new THREE.Mesh(gemGeo, gemMat);

        // Subtle wire outer cube bounding
        const wireGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
        const wireOutline = new THREE.WireframeGeometry(wireGeo);
        const wireMat = new THREE.LineBasicMaterial({ color: 0x00ffb4 });
        const outlineBox = new THREE.LineSegments(wireOutline, wireMat);
        mesh.add(outlineBox);
      } else {
        // Glowing blue shield sphere matrix
        const innerGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
        const innerMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff });
        const innerMesh = new THREE.Mesh(innerGeo, innerMat);

        const coreGeo = new THREE.IcosahedronGeometry(0.5, 1);
        const coreMat = new THREE.MeshBasicMaterial({
          color: 0x00ccff,
          wireframe: true,
          transparent: true,
          opacity: 0.8
        });
        mesh = new THREE.Mesh(coreGeo, coreMat);
        mesh.add(innerMesh);
      }

      // Space slightly off the wall (hovering)
      mesh.position.set(
        (TUBE_RADIUS - 0.75) * Math.sin(angle),
        -(TUBE_RADIUS - 0.75) * Math.cos(angle),
        -420
      );

      scene.add(mesh);
      collectibles.push({
        mesh,
        type,
        angle,
        z: -420,
        collected: false
      });
    };

    // --- COLLISION TRIGGER HANDLERS ---

    const handleCollisionHit = (obs: Obstacle) => {
      if (player.shieldTime > 0) {
        // Smash through obstacle!
        gameAudio.playShieldSmash();
        spawnExplosionParticles(obs.group.position, 0x00e6ff, 18);
        obs.hit = true;
        obs.group.visible = false;
        
        // Disable shield
        player.shieldTime = 0;
        setActiveShield(false);

        // Screen flash indicator of protection
        flashColorRef.current = 'cyan';
        setTimeout(() => { flashColorRef.current = null; }, 200);
        return;
      }

      // CRASH EXPLOSION! Game Over
      gameAudio.playCrash();
      spawnExplosionParticles(playerGroup.getWorldPosition(new THREE.Vector3()), 0xff3c00, 45);
      
      // Hide ship mesh
      playerGroup.visible = false;
      screenShake = 1.5;

      // Screen crash flash
      flashColorRef.current = 'red';
      setTimeout(() => { flashColorRef.current = null; }, 350);

      // Trigger transition to Game Over Screen
      setTimeout(() => {
        setGameState('gameover');
      }, 1000);
    };

    // --- GAME ENGINE LOOP ---
    let lastTime = performance.now();
    let animationFrameId: number;

    const gameLoop = (now: number) => {
      animationFrameId = requestAnimationFrame(gameLoop);

      // Delta time caps at 0.1 to guard frame skips
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const currentGameState = gameStateRef.current;

      // 1. ANIMAL EXHAUST & COLLISION PARTICLES UPDATE
      const activeSparks = sparksRef.current;
      for (let i = activeSparks.length - 1; i >= 0; i--) {
        const sp = activeSparks[i];
        sp.mesh.position.x += sp.vx * dt;
        sp.mesh.position.y += sp.vy * dt;
        sp.mesh.position.z += sp.vz * dt;
        
        sp.life -= dt;
        
        // Spin cube segments
        sp.mesh.rotation.x += 1.5 * dt;
        sp.mesh.rotation.y += 1.5 * dt;

        if (sp.mesh instanceof THREE.Mesh && sp.mesh.material) {
          const mat = sp.mesh.material as THREE.Material;
          mat.opacity = THREE.MathUtils.clamp(sp.life / sp.maxLife, 0, 1);
        } else if (sp.mesh instanceof THREE.LineSegments && sp.mesh.material) {
          const mat = sp.mesh.material as THREE.Material;
          mat.opacity = THREE.MathUtils.clamp(sp.life / sp.maxLife, 0, 1);
        }

        if (sp.life <= 0) {
          scene.remove(sp.mesh);
          // Clean geometries
          if (sp.mesh instanceof THREE.Mesh) sp.mesh.geometry.dispose();
          else if (sp.mesh instanceof THREE.LineSegments) sp.mesh.geometry.dispose();
          activeSparks.splice(i, 1);
        }
      }

      // Background rotation on Menu / Game over
      if (currentGameState === 'menu' || currentGameState === 'gameover') {
        tunnelGroup.rotation.z += 0.12 * dt;
        starField.rotation.z += 0.05 * dt;
        
        // Drift stars toward camera
        const positions = starField.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < numStars; i++) {
          positions[i * 3 + 2] += (BASE_SPEED * 0.12) * dt;
          if (positions[i * 3 + 2] > 20) {
            positions[i * 3 + 2] = -500;
          }
        }
        starField.geometry.attributes.position.needsUpdate = true;

        // Keep camera static but aesthetic
        camera.position.set(0, 4.5, 13);
        camera.lookAt(0, 0, -25);
        renderer.render(scene, camera);
        return;
      }

      if (currentGameState === 'playing') {
        playerGroup.visible = true; // Ensure ship visible

        // 2. INPUT CONTROL DRIVERS
        const steeringSpeed = 3.6; // rads/sec circum-rotation
        if (keys.left) {
          player.angle -= steeringSpeed * dt;
        }
        if (keys.right) {
          player.angle += steeringSpeed * dt;
        }
        
        // Wrapping angle limits
        while (player.angle > Math.PI) player.angle -= Math.PI * 2;
        while (player.angle < -Math.PI) player.angle += Math.PI * 2;

        // Nitro boosts FOV & scale shifts
        if (keys.up) {
          player.nitroActive = true;
          player.speed = THREE.MathUtils.lerp(player.speed, BOOST_SPEED, 3.8 * dt);
          currentFov = THREE.MathUtils.lerp(currentFov, 75, 4.0 * dt);
          cameraZTarget = 11.2; // closer exciting follow
          screenShake = THREE.MathUtils.clamp(screenShake + dt * 0.45, 0, 0.08); // Speed wobble
          
          // Exhaust fire length scales
          flame.scale.set(1.1, 1.1, 2.0);
          flame.material.color.setHex(0xffaa00);
        } else {
          player.nitroActive = false;
          player.speed = THREE.MathUtils.lerp(player.speed, BASE_SPEED, 2.5 * dt);
          currentFov = THREE.MathUtils.lerp(currentFov, 58, 2.2 * dt);
          cameraZTarget = 14.0;
          
          flame.scale.set(0.9, 0.9, Math.sin(now * 0.04) * 0.2 + 0.9);
          flame.material.color.setHex(0xff3c00);
        }
        camera.fov = currentFov;
        camera.updateProjectionMatrix();

        // 3. JUMP MATH ARC (GRAVITY TO WALL)
        if (keys.space && !player.isJumping) {
          player.isJumping = true;
          player.jumpVelocity = 14.5;
          gameAudio.playJump();
        }

        if (player.isJumping) {
          player.jumpHeight += player.jumpVelocity * dt;
          player.jumpVelocity -= 34.0 * dt; // Gravity pull outwards

          if (player.jumpHeight <= 0) {
            player.jumpHeight = 0;
            player.jumpVelocity = 0;
            player.isJumping = false;
          }
        }

        // Apply player coordinate placements
        playerMeshCalculations(playerPivot, playerGroup, player);

        // Particle stream from active engines
        if (Math.random() < 0.4) {
          // Find ship world position
          const shipPos = playerGroup.getWorldPosition(new THREE.Vector3());
          spawnGlowSparks(shipPos, player.nitroActive ? 0xffbf00 : 0x00f3ff, player.nitroActive ? 4 : 2);
        }

        // 4. TIMERS & SCORE METRICS
        scoreRef.current += player.speed * dt;
        scoreRef.current = parseFloat(scoreRef.current.toFixed(1));
        
        // Pass to direct DOM for latency-free updating of stats
        const liveDistText = Math.floor(scoreRef.current);
        const speedKmh = Math.floor(player.speed * 4.2);
        
        if (speedKmh > peakSpeedRef.current) peakSpeedRef.current = speedKmh;

        // Perform fast DOM injection:
        const distEl = document.getElementById('hud-dist-val');
        if (distEl) distEl.innerText = liveDistText.toString().padStart(6, '0');

        const speedEl = document.getElementById('hud-speed-val');
        if (speedEl) speedEl.innerText = speedKmh.toString();

        const speedBar = document.getElementById('hud-speed-bar');
        if (speedBar) {
          const ratio = (player.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED);
          speedBar.style.width = `${Math.floor(ratio * 100)}%`;
        }

        const angleDot = document.getElementById('hud-angle-dot');
        if (angleDot) {
          const angleDeg = (player.angle * 180) / Math.PI;
          angleDot.style.transform = `rotate(${angleDeg}deg)`;
        }

        // Sector clearing trigger
        if (scoreRef.current >= nextSectorGoal) {
          triggerSectorClear();
          nextSectorGoal += 500;
        }

        // Handle Audio engine frequency
        const speedRatio = (player.speed - BASE_SPEED) / (BOOST_SPEED - BASE_SPEED);
        gameAudio.setEngineSpeed(speedRatio);

        // Shield matrices timer
        if (player.shieldTime > 0) {
          player.shieldTime -= dt;
          
          // Flash shield bubble
          shieldBubble.visible = true;
          shieldBubble.rotation.z += 1.5 * dt;
          shieldBubble.rotation.x += 1.0 * dt;
          shieldBubble.material.opacity = 0.2 + Math.abs(Math.sin(now * 0.01)) * 0.35;

          const shieldTimeEl = document.getElementById('hud-shield-time');
          if (shieldTimeEl) shieldTimeEl.innerText = Math.max(0, parseFloat(player.shieldTime.toFixed(1))).toString();

          const shieldBar = document.getElementById('hud-shield-bar');
          if (shieldBar) {
            const shRatio = player.shieldTime / 5.0;
            shieldBar.style.width = `${Math.max(0, shRatio * 100)}%`;
          }

          if (player.shieldTime <= 0) {
            shieldBubble.visible = false;
            setActiveShield(false);
            const shieldHUD = document.getElementById('hud-shield-panel');
            if (shieldHUD) shieldHUD.style.opacity = '0';
          }
        }

        // 5. CYLINDER GRID SLIDING GENERATOR
        cylinders.forEach((cyl) => {
          cyl.position.z += player.speed * dt;
          
          // Re-tile once fully behind camera
          if (cyl.position.z > SEGMENT_LENGTH * 0.75) {
            cyl.position.z -= SEGMENT_LENGTH * TOTAL_CYLINDERS;
          }
        });

        // 6. STAR DRIFTING BACKGROUND
        const positions = starField.geometry.attributes.position.array as Float32Array;
        for (let i = 0; i < numStars; i++) {
          positions[i * 3 + 2] += (player.speed * 0.45 + starSpeeds[i] * 5.0) * dt;
          if (positions[i * 3 + 2] > 20) {
            positions[i * 3 + 2] = -500;
          }
        }
        starField.geometry.attributes.position.needsUpdate = true;

        // 7. LEVEL SPAWNER REGULATORS
        obstacleTimer += player.speed * dt;
        if (obstacleTimer >= 74) {
          spawnObstacle();
          // Varied gap frequency depending on speed
          obstacleTimer = Math.random() * 22;
        }

        collectibleTimer += player.speed * dt;
        if (collectibleTimer >= 32) {
          spawnCollectible();
          collectibleTimer = Math.random() * 12;
        }

        // 8. OBSTACLE UPDATE & COLLISION CHECK
        for (let i = obstacles.length - 1; i >= 0; i--) {
          const obs = obstacles[i];
          obs.group.position.z += player.speed * dt;
          obs.z = obs.group.position.z;

          // Check boundary z overlap centered on player
          if (!obs.passed && !obs.hit && obs.z >= -COLLISION_Z_THRESHOLD && obs.z <= COLLISION_Z_THRESHOLD) {
            
            let collided = false;
            if (obs.type === 'barrier') {
              const diff = getAngleDiff(player.angle, obs.angle);
              if (diff < 0.6) {
                collided = true;
              }
            } else if (obs.type === 'fence') {
              const diff = getAngleDiff(player.angle, obs.angle);
              if (diff < 0.52) {
                if (player.jumpHeight < 1.3) collided = true;
                else {
                  // Clean dodge! Float award
                  obs.passed = true;
                  triggerScoreReward(100, "GRID LEAP!");
                }
              }
            } else if (obs.type === 'emp') {
              if (obs.gapAngle !== undefined) {
                const diff = getAngleDiff(player.angle, obs.gapAngle);
                // Hit if not in safe zone gap
                if (diff > 0.58) {
                  collided = true;
                } else {
                  obs.passed = true;
                  triggerScoreReward(150, "SLIPSTREAM ACCEL!");
                }
              }
            }

            if (collided) {
              handleCollisionHit(obs);
            }
          }

          if (obs.z > 25) {
            scene.remove(obs.group);
            obs.group.traverse((node) => {
              if (node instanceof THREE.Mesh) {
                node.geometry.dispose();
                if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                else node.material.dispose();
              }
            });
            obstacles.splice(i, 1);
          }
        }

        // 9. COLLECTIBLES COLLISION ENGINE
        for (let i = collectibles.length - 1; i >= 0; i--) {
          const col = collectibles[i];
          col.mesh.position.z += player.speed * dt;
          col.z = col.mesh.position.z;

          // Float rotation animation
          col.mesh.rotation.y += 2.0 * dt;
          col.mesh.rotation.x += 1.0 * dt;

          if (!col.collected && col.z >= -COLLISION_Z_THRESHOLD && col.z <= COLLISION_Z_THRESHOLD) {
            const diff = getAngleDiff(player.angle, col.angle);
            // Matches low heights
            if (diff < 0.42 && player.jumpHeight < 2.0) {
              col.collected = true;
              scene.remove(col.mesh);

              // Trig events
              if (col.type === 'cube') {
                gameAudio.playCollect();
                crystalsRef.current += 1;
                setCrystalsCount(crystalsRef.current);
                
                const rewardVal = player.nitroActive ? 250 : 150;
                scoreRef.current += rewardVal;
                
                // Show in HUD
                const cubeHUD = document.getElementById('hud-cubes-val');
                if (cubeHUD) cubeHUD.innerText = crystalsRef.current.toString();

                triggerScoreReward(rewardVal, "+DATA+");
                spawnExplosionParticles(col.mesh.position, 0x00ff8e, 10);
              } else {
                gameAudio.playShieldUp();
                player.shieldTime = 5.0; // 5 Sec protect bubble
                setActiveShield(true);
                
                const shieldHUD = document.getElementById('hud-shield-panel');
                if (shieldHUD) shieldHUD.style.opacity = '1';

                triggerScoreReward(300, "DEFENSE SHIELD ONLINE");
                spawnExplosionParticles(col.mesh.position, 0x00e1ff, 12);
              }
              
              collectibles.splice(i, 1);
              continue;
            }
          }

          if (col.z > 25) {
            scene.remove(col.mesh);
            col.mesh.traverse((node) => {
              if (node instanceof THREE.Mesh) {
                node.geometry.dispose();
                if (Array.isArray(node.material)) node.material.forEach(m => m.dispose());
                else node.material.dispose();
              }
            });
            collectibles.splice(i, 1);
          }
        }

        // 10. DRUM THIRD-PERSON CAMERA WORK
        cameraAngle = THREE.MathUtils.lerp(cameraAngle, player.angle, 7.8 * dt);
        
        let targetX = (TUBE_RADIUS - 3.4) * Math.sin(cameraAngle);
        let targetY = -(TUBE_RADIUS - 3.4) * Math.cos(cameraAngle);
        
        // Track slightly behind player along Z
        camera.position.set(
          targetX,
          targetY,
          THREE.MathUtils.lerp(camera.position.z, cameraZTarget, 4.0 * dt)
        );

        // Apply roll/tilt when steering for organic lean force
        const steeringRoll = keys.left ? -0.15 : keys.right ? 0.15 : 0;
        camera.up.set(
          -Math.sin(cameraAngle + steeringRoll),
          Math.cos(cameraAngle + steeringRoll),
          0
        );

        // Always lock looking focus towards player grid mesh ahead
        const aheadFocus = new THREE.Vector3(
          (TUBE_RADIUS - 0.7) * Math.sin(player.angle),
          -(TUBE_RADIUS - 0.7) * Math.cos(player.angle),
          -10
        );
        camera.lookAt(aheadFocus);

        // Apply Camera screen vibrating rumble
        if (screenShake > 0) {
          camera.position.x += (Math.random() - 0.5) * screenShake;
          camera.position.y += (Math.random() - 0.5) * screenShake;
          screenShake = THREE.MathUtils.lerp(screenShake, 0, 7.2 * dt);
        }
      }

      renderer.render(scene, camera);
    };

    // --- HELPER WRITING FUNCTIONS ---

    const playerMeshCalculations = (pivot: THREE.Group, meshGroup: THREE.Group, state: PlayerState) => {
      pivot.rotation.z = state.angle;
      // Inward vertical shift for jumping height off tube surface
      meshGroup.position.y = VEHICLE_Y_BASE + state.jumpHeight;
      meshGroup.rotation.y = Math.PI; // Look forwards down Z
    };

    const triggerSectorClear = () => {
      // Sector Cleared overlay notification alert
      const overlay = document.getElementById('hud-alert-overlay');
      if (!overlay) return;
      overlay.innerText = "CYBER PORTAL CLEARED - INCREASING ENGINE POWER";
      overlay.style.opacity = '1';
      setTimeout(() => {
        overlay.style.opacity = '0';
      }, 2000);
    };

    const triggerScoreReward = (pts: number, text: string) => {
      const rewardArea = document.getElementById('hud-rewards-container');
      if (!rewardArea) return;
      
      const item = document.createElement('div');
      item.className = 'font-orbitron font-bold text-emerald-400 bg-black/75 px-3 py-1 rounded border border-emerald-500/20 text-xs tracking-wider animate-bounce flex items-center gap-1 shadow-[0_0_15px_rgba(16,185,129,0.3)]';
      item.innerHTML = `<span class="text-[9px] text-emerald-500 opacity-60">${text}</span> +${pts}`;
      
      rewardArea.appendChild(item);
      setTimeout(() => {
        item.classList.add('transition-all', 'opacity-0', 'translate-y-[-10px]');
        setTimeout(() => rewardArea.removeChild(item), 250);
      }, 1100);
    };

    // Initial frame run
    animationFrameId = requestAnimationFrame(gameLoop);

    // Dynamic resize handler
    const handleResize = () => {
      const w = containerRef.current?.clientWidth || window.innerWidth;
      const h = containerRef.current?.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Cleanup trigger
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      
      // Dispose elements
      renderer.dispose();
      cylinders.forEach(c => scene.remove(c));
      obstacles.forEach(o => scene.remove(o.group));
      collectibles.forEach(c => scene.remove(c.mesh));
      sparksRef.current.forEach(s => scene.remove(s.mesh));
      starGeo.dispose();
      starMat.dispose();
    };
  }, [gameState]);

  // Handle Game Start Click
  const startGame = () => {
    // Reset global metrics
    scoreRef.current = 0;
    crystalsRef.current = 0;
    peakSpeedRef.current = 0;
    setActiveShield(false);
    setScoreText(0);
    setCrystalsCount(0);
    keysRef.current = { left: false, right: false, up: false, space: false };
    sparksRef.current = [];

    gameAudio.init(); // Boot synthesizer
    gameAudio.stopEngine();
    
    // Smooth transition
    setGameState('playing');
  };

  // Post Game scores updates
  useEffect(() => {
    if (gameState === 'gameover') {
      gameAudio.stopEngine();

      const finalScore = Math.floor(scoreRef.current) + crystalsRef.current * 150;
      setScoreText(finalScore);

      if (finalScore > highScore) {
        setHighScore(finalScore);
        localStorage.setItem('gridrunner_highscore', finalScore.toString());
      }
    }
  }, [gameState, highScore]);

  // On Screen manual control keys for Mobile/Touch optimization
  const setMobileKey = (key: 'left' | 'right' | 'up' | 'space', isDown: boolean) => {
    keysRef.current[key] = isDown;
  };

  return (
    <div
      ref={containerRef}
      className="relative w-screen h-screen overflow-hidden select-none bg-[#000109] text-white font-sans"
    >
      {/* 3D WEBGL WEB GRID CANVAS */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full block z-0"
      />

      {/* AMBIENT SCREEN RED FLASH COVERS (DODGE ERROR IMPACT) */}
      <div
        className="absolute inset-0 z-10 pointer-events-none transition-opacity duration-150"
        style={{
          backgroundColor:
            flashColorRef.current === 'red'
              ? 'rgba(239, 68, 68, 0.4)'
              : flashColorRef.current === 'cyan'
              ? 'rgba(6, 182, 212, 0.35)'
              : 'transparent'
        }}
      />

      {/* SOUND TOGGLER TOP RUMBLE ACTIONS */}
      <div className="absolute top-4 right-4 z-40 flex items-center gap-3">
        <button
          onClick={() => setIsMuted(!isMuted)}
          className="p-3 bg-black/60 backdrop-blur-md border border-cyan-500/20 rounded-full hover:bg-cyan-500/10 active:scale-95 transition-all text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)] cursor-pointer"
          title={isMuted ? "Unmute Synthesizer" : "Mute Synthesizer"}
        >
          {isMuted ? <VolumeX className="w-5 h-5 text-pink-500" /> : <Volume2 className="w-5 h-5 text-cyan-400" />}
        </button>
      </div>

      {/* ==============================================
          1. START GAME MENU STAGE
          ============================================== */}
      <AnimatePresence>
        {gameState === 'menu' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-950/80 via-black/95 to-slate-950/80 backdrop-blur-sm"
          >
            {/* Retro grid lines decoration */}
            <div className="absolute inset-0 bg-[linear-gradient(rgba(18,24,38,0.2)_1px,_transparent_1px),_linear-gradient(90deg,_rgba(18,24,38,0.2)_1px,_transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-50" />
            
            <div className="text-center max-w-xl z-10 w-full relative">
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-48 bg-cyan-500/10 blur-3xl rounded-full" />
              
              {/* BRAND LOGO */}
              <motion.div
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
              >
                <h1 className="font-orbitron font-black text-5xl md:text-6xl tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-sky-300 to-indigo-500 neon-text-cyan uppercase">
                  Gridrunner
                </h1>
                <p className="font-orbitron italic tracking-widest text-pink-500 text-lg md:text-xl font-bold mt-2 neon-text-pink uppercase select-none">
                  // Neon Eclipse
                </p>
              </motion.div>

              {/* HIGH SCORE BADGE */}
              {highScore > 0 && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="inline-flex items-center gap-2 mt-5 px-4 py-1.5 bg-pink-500/10 border border-pink-500/30 rounded-full font-mono text-xs text-pink-400 tracking-wider shadow-[0_0_15px_rgba(236,72,153,0.15)]"
                >
                  <Trophy className="w-3.5 h-3.5 text-yellow-400" />
                  HIGH MATRIX RECORD: <span className="font-bold text-white font-orbitron">{highScore}</span>
                </motion.div>
              )}

              {/* USER MANUALS */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="mt-8 bg-black/60 backdrop-blur-md rounded-2xl border border-cyan-500/30 p-6 text-left shadow-[0_0_25px_rgba(6,182,212,0.1)] font-sans"
              >
                <div className="flex items-center gap-2 text-cyan-400 font-orbitron font-bold text-sm tracking-wider border-b border-cyan-500/20 pb-3 mb-4">
                  <Keyboard className="w-4 h-4" />
                  COGNITIVE SECTOR MANUAL
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs md:text-sm text-gray-300">
                  <div className="flex items-start gap-2.5">
                    <span className="flex items-center justify-center bg-cyan-950 border border-cyan-400/40 rounded px-2 py-0.5 font-mono text-cyan-300 font-bold shadow-sm whitespace-nowrap min-w-[55px] text-center">A / D</span>
                    <span className="text-gray-400">or</span>
                    <span className="flex items-center justify-center bg-cyan-950 border border-cyan-400/40 rounded px-2 py-0.5 font-mono text-cyan-300 font-bold shadow-sm whitespace-nowrap min-w-[55px] text-center">← / →</span>
                    <span className="leading-tight text-gray-300 ml-1">Rotate 360° inside tube</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center justify-center bg-cyan-950 border border-cyan-400/40 rounded px-2 py-0.5 font-mono text-cyan-300 font-bold shadow-sm whitespace-nowrap min-w-[55px] text-center">W</span>
                    <span className="text-gray-400">or</span>
                    <span className="flex items-center justify-center bg-cyan-950 border border-cyan-400/40 rounded px-2 py-0.5 font-mono text-cyan-300 font-bold shadow-sm whitespace-nowrap min-w-[55px] text-center">↑</span>
                    <span className="leading-tight text-gray-300 ml-1">Speed Nitro Boost</span>
                  </div>
                  <div className="flex items-center col-span-1 md:col-span-2 gap-2.5 mt-1">
                    <span className="flex items-center justify-center bg-cyan-950 border border-cyan-400/40 rounded px-6 py-0.5 font-mono text-cyan-300 font-bold shadow-sm text-center">SPACEBAR</span>
                    <span className="leading-tight text-gray-300 ml-1">Brief Jump to clear low grid-fences</span>
                  </div>
                </div>

                {/* VISUAL DICTIONARY */}
                <div className="mt-5 pt-4 border-t border-cyan-500/20 grid grid-cols-3 gap-2 text-[11px] font-mono text-center text-gray-400">
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-4 h-4 bg-red-600 rounded-sm shadow-[0_0_8px_rgba(239,68,68,0.8)] border border-red-400" />
                    <span>Holo Barrier</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-4 h-2 bg-yellow-400 rounded-sm shadow-[0_0_8px_rgba(253,224,71,0.8)] border border-yellow-200 mt-1" />
                    <span>Jumpable Fence</span>
                  </div>
                  <div className="flex flex-col items-center gap-1">
                    <div className="w-4 h-4 bg-violet-600 rounded-full shadow-[0_0_8px_rgba(139,92,246,0.8)] border border-violet-400" />
                    <span>EMP Hoop/Gap</span>
                  </div>
                </div>
              </motion.div>

              {/* INITIATE RUN BUTTON */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="mt-8"
              >
                <button
                  onClick={startGame}
                  className="group relative inline-flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-cyan-500 to-indigo-600 rounded-xl hover:from-cyan-400 hover:to-indigo-500 text-white font-orbitron font-bold text-lg tracking-widest border border-cyan-300/35 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 duration-150 transition-all shadow-[0_0_25px_rgba(6,182,212,0.45)] cursor-pointer"
                >
                  <Play className="w-5 h-5 fill-white text-transparent group-hover:scale-110 transition-transform duration-100" />
                  INITIATE SYSTEM RUN
                  <ChevronRight className="w-5 h-5 opacity-50 group-hover:translate-x-1 duration-150 transition-transform" />
                </button>
                <div className="text-[10px] text-cyan-400/50 mt-3 font-mono">AUTHORIZED GATEWAYS BY CRAZYGAMES // v1.2</div>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==============================================
          2. HUD INTERACTIVE WEB GAMEPLAY LAYER
          ============================================== */}
      <div
        className="absolute inset-0 z-20 pointer-events-none transition-all duration-300"
        style={{
          opacity: gameState === 'playing' ? 1 : 0,
          visibility: gameState === 'playing' ? 'visible' : 'hidden'
        }}
      >
        {/* TOP LEFT DATA CORNER */}
        <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-md rounded-lg border border-cyan-500/20 px-4 py-2 flex items-center gap-3 shadow-[0_0_15px_rgba(6,182,212,0.1)] min-w-[190px]">
            <div className="w-1.5 h-8 bg-cyan-500 rounded-full animate-pulse" />
            <div>
              <div className="text-[10px] font-mono text-cyan-400/50 tracking-wider leading-none">GRID DISTANCE</div>
              <div className="text-xl font-mono font-bold tracking-widest text-cyan-400 leading-tight">
                <span id="hud-dist-val">000000</span><span className="text-xs text-cyan-300 font-orbitron ml-1">M</span>
              </div>
            </div>
          </div>
        </div>

        {/* TOP RIGHT STORAGE COUNT */}
        <div className="absolute top-4 right-16 flex flex-col gap-2 pointer-events-auto">
          <div className="bg-black/80 backdrop-blur-md rounded-lg border border-emerald-500/20 px-4 py-2 flex items-center gap-3 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
            <div className="p-1 px-1.5 bg-emerald-500/10 rounded-md border border-emerald-500/30">
              <Database className="w-4 h-4 text-emerald-400 animate-spin" style={{ animationDuration: '4s' }} />
            </div>
            <div>
              <div className="text-[10px] font-mono text-emerald-400/50 tracking-wider leading-none">DATA CODES</div>
              <div className="text-lg font-mono font-bold text-emerald-400 leading-tight">
                CUBE: <span id="hud-cubes-val">0</span>
              </div>
            </div>
          </div>
        </div>

        {/* BOTTOM RIGHT INTELLIGENT SPEEDOMETER */}
        <div className="absolute bottom-6 right-6 flex flex-col items-end pointer-events-auto max-w-[200px] w-full">
          <div className="bg-black/85 backdrop-blur-md border border-cyan-500/25 rounded-xl p-3 w-full shadow-[0_0_20px_rgba(6,182,212,0.12)]">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10px] font-orbitron text-cyan-500/70 tracking-wider">SPEED</span>
              <span className="font-mono text-xl font-black text-cyan-400">
                <span id="hud-speed-val">0</span> <span className="text-xs text-cyan-300 font-orbitron">KM/H</span>
              </span>
            </div>
            {/* Speed segmented dashboard bar */}
            <div className="w-full h-1.5 bg-slate-950 rounded overflow-hidden flex border border-cyan-500/15">
              <div
                id="hud-speed-bar"
                className="h-full bg-gradient-to-r from-cyan-500 via-sky-400 to-indigo-500 transition-all duration-75"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        </div>

        {/* BOTTOM LEFT TUBE PERSPECTIVE ANGLE WIDGET */}
        <div className="absolute bottom-6 left-6 pointer-events-auto flex items-center gap-3 bg-black/85 backdrop-blur-md border border-cyan-500/25 rounded-xl p-3 shadow-[0_0_20px_rgba(6,182,212,0.12)]">
          <div className="relative w-10 h-10 rounded-full border border-cyan-500/30 flex items-center justify-center">
            {/* Compass rotating indicator dot */}
            <div
              id="hud-angle-dot"
              className="absolute inset-0 transition-transform duration-75 ease-out"
              style={{ transform: 'rotate(0deg)' }}
            >
              <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-pink-500 shadow-[0_0_8px_rgb(236,72,153)] border border-white" />
            </div>
            <div className="font-orbitron text-[9px] text-cyan-400/50 text-center uppercase tracking-tighter">GRID</div>
          </div>
          <div>
            <div className="text-[10px] font-orbitron text-cyan-400/60 leading-none mb-0.5">3D GYRO SCAN</div>
            <div className="text-xs font-mono text-gray-400 uppercase tracking-tight">Active Tracking</div>
          </div>
        </div>

        {/* ACTIVE WEAPON / SHIELD BAR */}
        <div
          id="hud-shield-panel"
          className="absolute top-20 left-4 bg-black/85 backdrop-blur-md border border-cyan-400 rounded-lg p-2.5 shadow-[0_0_20px_rgba(6,182,212,0.25)] flex items-center gap-3 transition-all duration-200 pointer-events-auto min-w-[190px]"
          style={{ opacity: activeShield ? 1 : 0 }}
        >
          <div className="p-1 px-1.5 bg-cyan-500/10 rounded border border-cyan-500/30">
            <Shield className="w-4 h-4 text-cyan-400 animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-baseline mb-0.5">
              <span className="text-[9px] font-orbitron text-cyan-400 tracking-wider">SHIELD BARRIER</span>
              <span className="text-[10px] font-mono font-bold text-cyan-300">
                <span id="hud-shield-time">0.0</span>s
              </span>
            </div>
            <div className="w-full h-1 bg-slate-950 rounded overflow-hidden">
              <div
                id="hud-shield-bar"
                className="h-full bg-cyan-400 transition-all duration-75"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        </div>

        {/* FLOATING BOARDS (REWARDS SPURS) */}
        <div
          id="hud-rewards-container"
          className="absolute bottom-24 left-6 flex flex-col gap-2 pointer-events-none z-20"
        />

        {/* SECTOR ALERT CENTERING OVERLAY */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 text-center select-none z-10 w-full px-4">
          <div
            id="hud-alert-overlay"
            className="font-orbitron text-md md:text-xl font-bold tracking-widest text-indigo-400 uppercase leading-normal bg-black/75 rounded border border-indigo-500/30 px-6 py-2 shadow-[0_0_25px_rgba(168,85,247,0.3)] inline-block transition-opacity duration-300 pointer-events-none"
            style={{ opacity: 0 }}
          />
        </div>

        {/* MOBILE CONTROLS OVERLAYS (EXPLICIT REQ CAPABILITY) */}
        <div className="absolute inset-x-0 bottom-4 flex md:hidden justify-between px-6 pointer-events-auto">
          {/* Direct Steer Dials */}
          <div className="flex items-center gap-3">
            <button
              onTouchStart={() => setMobileKey('left', true)}
              onTouchEnd={() => setMobileKey('left', false)}
              className="w-14 h-14 bg-black/60 backdrop-blur-md rounded-full border border-cyan-500/20 flex items-center justify-center hover:bg-cyan-500/10 active:scale-95 text-cyan-400 font-bold shadow-md cursor-pointer pointer-events-auto"
            >
              ←
            </button>
            <button
              onTouchStart={() => setMobileKey('right', true)}
              onTouchEnd={() => setMobileKey('right', false)}
              className="w-14 h-14 bg-black/60 backdrop-blur-md rounded-full border border-cyan-500/20 flex items-center justify-center hover:bg-cyan-500/10 active:scale-95 text-cyan-400 font-bold shadow-md cursor-pointer pointer-events-auto"
            >
              →
            </button>
          </div>

          {/* Action hot buttons */}
          <div className="flex items-center gap-3">
            <button
              onTouchStart={() => setMobileKey('space', true)}
              onTouchEnd={() => setMobileKey('space', false)}
              className="px-6 h-14 bg-black/60 backdrop-blur-md rounded-xl border border-cyan-500/20 flex items-center justify-center hover:bg-cyan-500/10 active:scale-95 text-cyan-400 font-orbitron font-bold shadow-md cursor-pointer pointer-events-auto"
            >
              JUMP
            </button>
            <button
              onTouchStart={() => setMobileKey('up', true)}
              onTouchEnd={() => setMobileKey('up', false)}
              className="p-3 w-14 h-14 bg-black/60 backdrop-blur-md rounded-full border border-pink-500/20 flex items-center justify-center text-pink-500 hover:bg-pink-500/10 active:scale-95 shadow-md cursor-pointer pointer-events-auto"
            >
              <Zap className="w-5 h-5 text-pink-500" />
            </button>
          </div>
        </div>
      </div>

      {/* ==============================================
          3. CRASHED / SYSTEM GAME OVER OVERLAY
          ============================================== */}
      <AnimatePresence>
        {gameState === 'gameover' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-30 flex flex-col items-center justify-center p-6 bg-gradient-to-b from-red-950/45 via-black/95 to-slate-950 backdrop-blur-sm"
          >
            <div className="absolute inset-0 bg-[linear-gradient(rgba(239,68,68,0.1)_1px,_transparent_1px),_linear-gradient(90deg,_rgba(239,68,68,0.1)_1px,_transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-50" />
            
            <div className="text-center max-w-md z-10 w-full relative">
              <div className="absolute -top-10 left-1/2 -translate-x-1/2 w-48 h-48 bg-red-500/10 blur-3xl rounded-full" />

              {/* CRASH HEADER */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="mb-8"
              >
                <div className="text-[10px] font-mono text-red-500 uppercase tracking-widest neon-text-pink p-1 bg-red-500/10 border border-red-500/30 rounded inline-block mb-3 px-3">
                  DISCONNECTED FROM THE MATRIX
                </div>
                <h1 className="font-orbitron font-black text-3xl md:text-4xl text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-orange-400 neon-text-pink tracking-tight uppercase">
                  NEON CRASH DETECTED
                </h1>
                <p className="text-gray-400 text-xs mt-1">GRID INTEGRITY EXHAUSTED</p>
              </motion.div>

              {/* DASHBOARD STATS PANEL */}
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="bg-black/80 backdrop-blur-md rounded-2xl border border-red-500/45 p-6 text-left shadow-[0_0_30px_rgba(239,68,68,0.15)] flex flex-col gap-4 font-mono text-xs text-gray-300"
              >
                <div className="text-cyan-400 font-orbitron font-bold text-sm tracking-widest border-b border-red-500/20 pb-2 mb-1 flex items-center justify-between">
                  <span>METRICS LOG</span>
                  <span className="text-[10px] text-gray-500 text-right font-normal">SYS_RUN_ECLIPSE</span>
                </div>

                <div className="flex justify-between items-center py-1">
                  <span className="text-gray-400 uppercase">Distance Covered</span>
                  <span className="text-white font-bold text-sm">{Math.floor(scoreRef.current)} M</span>
                </div>
                <div className="flex justify-between items-center py-1 border-t border-red-500/10">
                  <span className="text-gray-400 uppercase">Cubes Synthesized</span>
                  <span className="text-emerald-400 font-bold text-sm flex items-center gap-1">
                    <Database className="w-3.5 h-3.5" />
                    {crystalsCount}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-t border-red-500/10">
                  <span className="text-gray-400 uppercase">Max Peak Speed</span>
                  <span className="text-white font-bold text-sm">{Math.max(0, peakSpeedRef.current)} KM/H</span>
                </div>
                
                {/* FINAL CALCULATED SCORE */}
                <div className="mt-2 pt-4 border-t-2 border-red-500/20 flex justify-between items-center text-lg">
                  <span className="font-orbitron font-bold text-cyan-400 tracking-wider">TOTAL SCORE</span>
                  <span className="font-orbitron font-black text-rose-500 text-xl neon-text-pink">
                    {scoreText}
                  </span>
                </div>

                {/* NEW HIGH SCORE ALERT */}
                {scoreText > 0 && scoreText >= highScore && (
                  <div className="bg-yellow-500/10 border border-yellow-500/35 rounded-lg p-2.5 text-center text-yellow-300 font-bold select-none text-[11px] uppercase tracking-widest flex items-center justify-center gap-3 animate-pulse shadow-[0_0_15px_rgba(234,179,8,0.2)]">
                    <Trophy className="w-4 h-4 text-yellow-400" />
                    SYSTEM NEW HIGHSCORE GAINED!
                  </div>
                )}
              </motion.div>

              {/* RE-BOOT BUTTONS */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="mt-8 flex flex-col gap-3"
              >
                <button
                  onClick={startGame}
                  className="group relative inline-flex items-center justify-center gap-3 px-8 py-4 bg-gradient-to-r from-red-600 via-rose-500 to-orange-500 hover:from-red-500 hover:to-orange-400 rounded-xl text-white font-orbitron font-bold text-sm md:text-base tracking-widest border border-red-400/40 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 duration-150 transition-all shadow-[0_0_20px_rgba(239,68,68,0.4)] cursor-pointer"
                >
                  <RotateCcw className="w-5 h-5 group-hover:rotate-45 transition-transform duration-150" />
                  REBOOT CYCLE SYSTEM
                </button>
                
                <button
                  onClick={() => setGameState('menu')}
                  className="font-orbitron uppercase text-xs text-cyan-500 hover:text-cyan-400 hover:underline transition-all duration-150 py-2 cursor-pointer pointer-events-auto"
                >
                  Return to sector bay
                </button>
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
