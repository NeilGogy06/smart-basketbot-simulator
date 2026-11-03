/**
 * Basketball.js
 * Generates an authentic regulation basketball with procedural 8-panel leather
 * pebble texture and indented black rubber seams, powered by a dynamic Rapier
 * rigid body with Continuous Collision Detection (CCD).
 */

import * as THREE from 'three';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class Basketball {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../simulation/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  constructor(scene, physicsWorld, options = {}) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.config = { ...SIMULATION_CONFIG.ball, ...options };

    this.mesh = null;
    this.rigidBody = null;
    this.collider = null;

    this.initialPosition = { ...this.config.initialPosition };

    // Explicit Basketball Lifecycle States:
    // 'AVAILABLE', 'APPROACHED', 'COLLECTING', 'POSSESSED', 'IN_FLIGHT', 'SCORED', 'MISSED', 'RESTING'
    this.state = 'AVAILABLE';
    this.isPossessed = false;
    this.isAvailable = true;
    this.possessedBy = null;
    this.shotCooldownTimer = 0.0;
    this.id = options.id || 'basketball_0';

    this.buildVisuals();
    this.buildPhysics();
  }

  /**
   * Procedurally generates a high-resolution 8-panel basketball texture with
   * leather pebble grain and regulation black rubber seams.
   */
  createBasketballTextures() {
    if (typeof document === 'undefined') {
      return { diffTexture: null, bumpTexture: null };
    }

    const width = 1024;
    const height = 512;

    const diffCanvas = document.createElement('canvas');
    diffCanvas.width = width;
    diffCanvas.height = height;
    const ctx = diffCanvas.getContext('2d');

    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = width;
    bumpCanvas.height = height;
    const bumpCtx = bumpCanvas.getContext('2d');

    // 1. Base basketball leather color
    const baseGradient = ctx.createLinearGradient(0, 0, width, height);
    baseGradient.addColorStop(0, '#e26022');
    baseGradient.addColorStop(0.5, '#cf5115');
    baseGradient.addColorStop(1, '#be4309');
    ctx.fillStyle = baseGradient;
    ctx.fillRect(0, 0, width, height);

    // Bump base (neutral gray 128)
    bumpCtx.fillStyle = '#808080';
    bumpCtx.fillRect(0, 0, width, height);

    // 2. Fine leather pebble grain noise
    const imgData = ctx.getImageData(0, 0, width, height);
    const bumpData = bumpCtx.getImageData(0, 0, width, height);
    const pixels = imgData.data;
    const bumpPixels = bumpData.data;

    // Fast deterministic pseudo-random pebble noise
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const rand = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
        const noise = (rand - 0.5) * 28;

        for (let dy = 0; dy < 2 && (y + dy) < height; dy++) {
          for (let dx = 0; dx < 2 && (x + dx) < width; dx++) {
            const idx = ((y + dy) * width + (x + dx)) * 4;
            pixels[idx] = Math.min(255, Math.max(0, pixels[idx] + noise));
            pixels[idx + 1] = Math.min(255, Math.max(0, pixels[idx + 1] + noise * 0.7));
            pixels[idx + 2] = Math.min(255, Math.max(0, pixels[idx + 2] + noise * 0.4));

            const bVal = Math.min(255, Math.max(0, 128 + noise * 1.5));
            bumpPixels[idx] = bVal;
            bumpPixels[idx + 1] = bVal;
            bumpPixels[idx + 2] = bVal;
          }
        }
      }
    }
    ctx.putImageData(imgData, 0, 0);
    bumpCtx.putImageData(bumpData, 0, 0);

    // 3. Regulation Black Seams
    const drawSeams = (targetCtx, isBump) => {
      targetCtx.lineWidth = 14;
      targetCtx.strokeStyle = isBump ? '#202020' : '#141414';
      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';

      // Equator seam (horizontal line)
      targetCtx.beginPath();
      targetCtx.moveTo(0, height / 2);
      targetCtx.lineTo(width, height / 2);
      targetCtx.stroke();

      // Meridian seams (vertical lines at 25%, 50%, 75%)
      [0.25, 0.5, 0.75].forEach((ratio) => {
        targetCtx.beginPath();
        targetCtx.moveTo(width * ratio, 0);
        targetCtx.lineTo(width * ratio, height);
        targetCtx.stroke();
      });

      // Characteristic curved basketball side ribs
      // Two symmetrical sinusoidal/elliptical arcs on left & right hemispheres
      targetCtx.beginPath();
      for (let x = 0; x <= width / 2; x += 4) {
        const theta = (x / (width / 2)) * Math.PI;
        const y = height / 2 + Math.sin(theta) * (height * 0.38);
        if (x === 0) targetCtx.moveTo(x, y);
        else targetCtx.lineTo(x, y);
      }
      targetCtx.stroke();

      targetCtx.beginPath();
      for (let x = width / 2; x <= width; x += 4) {
        const theta = ((x - width / 2) / (width / 2)) * Math.PI;
        const y = height / 2 - Math.sin(theta) * (height * 0.38);
        if (x === width / 2) targetCtx.moveTo(x, y);
        else targetCtx.lineTo(x, y);
      }
      targetCtx.stroke();
    };

    drawSeams(ctx, false);
    drawSeams(bumpCtx, true);

    // 4. Stamped Brand Logo on central panel
    ctx.fillStyle = '#0a0a0a';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SMART-BOT 7', width * 0.375, height * 0.32);

    const diffTexture = new THREE.CanvasTexture(diffCanvas);
    diffTexture.colorSpace = THREE.SRGBColorSpace;
    diffTexture.wrapS = THREE.RepeatWrapping;
    diffTexture.wrapT = THREE.ClampToEdgeWrapping;

    const bumpTexture = new THREE.CanvasTexture(bumpCanvas);
    bumpTexture.wrapS = THREE.RepeatWrapping;
    bumpTexture.wrapT = THREE.ClampToEdgeWrapping;

    return { diffTexture, bumpTexture };
  }

  /**
   * Builds the Three.js basketball sphere mesh.
   */
  buildVisuals() {
    const { diffTexture, bumpTexture } = this.createBasketballTextures();

    const geometry = new THREE.SphereGeometry(this.config.radius, 32, 24);
    const material = new THREE.MeshStandardMaterial({
      color: 0xe26022,
      map: diffTexture,
      bumpMap: bumpTexture,
      bumpScale: 0.003,
      roughness: 0.55,
      metalness: 0.05
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'Basketball';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.position.set(this.initialPosition.x, this.initialPosition.y, this.initialPosition.z);

    this.scene.add(this.mesh);
  }

  /**
   * Initializes Rapier dynamic rigid body with spherical collider and CCD.
   */
  buildPhysics() {
    const { body, collider } = this.physicsWorld.createDynamicSphere(
      this.initialPosition.x,
      this.initialPosition.y,
      this.initialPosition.z,
      this.config.radius,
      this.config.mass,
      this.config.restitution,
      this.config.friction,
      this.config.linearDamping,
      this.config.angularDamping
    );

    this.rigidBody = body;
    this.collider = collider;

    // Enable continuous collision detection to prevent fast-bounce tunneling
    this.rigidBody.enableCcd(true);

    // Bind mesh transform synchronization
    this.physicsWorld.bindMeshToBody(this.mesh, this.rigidBody, true);
  }

  /**
   * Updates basketball state lifecycle, decrements cooldown timers, and evaluates floor settling.
   * @param {number} dt Delta time in seconds
   */
  update(dt = 0.016) {
    if (this.shotCooldownTimer > 0) {
      this.shotCooldownTimer = Math.max(0, this.shotCooldownTimer - dt);
    }

    // Evaluate physical settling for shot or moving balls
    if (this.state === 'IN_FLIGHT' || this.state === 'SCORED' || this.state === 'MISSED' || this.state === 'RESTING') {
      const pos = this.getPosition();
      const speed = this.getSpeed();
      const onFloor = pos.y <= (this.config.radius + 0.08);
      const isSlow = speed < 0.6;

      if (onFloor && isSlow && this.shotCooldownTimer <= 0) {
        if (this.state !== 'AVAILABLE') {
          this.state = 'AVAILABLE';
          this.isAvailable = true;
          this.isPossessed = false;
          this.possessedBy = null;
        }
      }
    }
  }

  /**
   * Sets the basketball lifecycle state with consistency validation.
   * @param {'AVAILABLE'|'APPROACHED'|'COLLECTING'|'POSSESSED'|'IN_FLIGHT'|'SCORED'|'MISSED'|'RESTING'} newState
   */
  setState(newState) {
    this.state = newState;
    if (newState === 'POSSESSED') {
      this.isPossessed = true;
      this.isAvailable = false;
    } else if (newState === 'AVAILABLE') {
      this.isPossessed = false;
      this.isAvailable = true;
      this.possessedBy = null;
    } else {
      this.isAvailable = false;
      if (newState !== 'POSSESSED') {
        this.isPossessed = false;
      }
    }
  }

  /**
   * Resets the basketball to initial coordinates with zero linear and angular momentum.
   */
  reset(pos = this.initialPosition, linvel = { x: 0, y: 0, z: 0 }) {
    if (!this.rigidBody) return;
    if (this.collider && typeof this.collider.setSensor === 'function' && this.collider.isSensor()) {
      this.collider.setSensor(false);
    }
    this.rigidBody.setGravityScale(1.0, true);
    this.physicsWorld.resetBody(this.rigidBody, pos);
    this.rigidBody.setLinvel(linvel, true);
    this.rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.rigidBody.wakeUp();

    this.state = 'AVAILABLE';
    this.isPossessed = false;
    this.isAvailable = true;
    this.possessedBy = null;
    this.shotCooldownTimer = 0.0;
  }

  /**
   * Performs an elevated drop test from a high altitude to demonstrate natural bouncing.
   */
  triggerDropTest(height = 3.2) {
    const dropPos = {
      x: this.initialPosition.x,
      y: height,
      z: this.initialPosition.z
    };
    this.reset(dropPos, { x: 0.2, y: 0, z: 0 });
  }

  /**
   * Current world position of the basketball.
   */
  getPosition() {
    if (this.rigidBody) {
      return this.rigidBody.translation();
    }
    return this.mesh.position;
  }

  /**
   * Current velocity vector.
   */
  getVelocity() {
    if (this.rigidBody) {
      return this.rigidBody.linvel();
    }
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Current scalar speed (m/s).
   */
  getSpeed() {
    const v = this.getVelocity();
    return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  }

  /**
   * Checks if basketball is in flight (above floor contact threshold).
   */
  isAirborne() {
    const pos = this.getPosition();
    return pos.y > (this.config.radius + 0.02);
  }
}
