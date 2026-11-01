/**
 * Simulation.js
 * Central orchestrator connecting Three.js rendering, Rapier physics,
 * basketball court environment, robot entity, basketball entity, orbit controls,
 * and simulation state lifecycle (start/pause/reset).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { SIMULATION_CONFIG } from './SimulationConfig.js';
import { PhysicsWorld } from './PhysicsWorld.js';
import { BasketballCourt } from '../environment/BasketballCourt.js';
import { BasketballHoop } from '../environment/BasketballHoop.js';
import { Lighting } from '../environment/Lighting.js';
import { Basketball } from '../environment/Basketball.js';
import { Robot } from '../robot/Robot.js';

export class Simulation {
  /**
   * @param {HTMLElement} container DOM element containing the WebGL canvas
   */
  constructor(container) {
    this.container = container;

    // Simulation Execution State
    this.isRunning = true;
    this.isInitialized = false;

    // Timing & Metrics
    this.clock = new THREE.Clock();
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTimer = 0;

    // Core Systems
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.physicsWorld = null;

    // Environment & Entities
    this.court = null;
    this.hoopEast = null;
    this.hoopWest = null;
    this.lighting = null;
    this.robot = null;
    this.basketball = null;

    // Animation frame handle
    this.animationFrameId = null;

    // Telemetry listeners
    this.telemetryCallbacks = [];

    // Bound loop
    this.animate = this.animate.bind(this);
    this.onWindowResize = this.onWindowResize.bind(this);
  }

  /**
   * Initializes the 3D graphics pipeline, physics engine, and simulation entities.
   */
  async initialize() {
    if (this.isInitialized) return;

    this.initGraphics();

    // Initialize Rapier 3D physics engine
    this.physicsWorld = new PhysicsWorld();
    await this.physicsWorld.initialize();

    // Build Court and Environment
    this.lighting = new Lighting(this.scene);
    this.court = new BasketballCourt(this.scene, this.physicsWorld);

    // Primary target hoop at +X (East baseline)
    this.hoopEast = new BasketballHoop(this.scene, this.physicsWorld, 1);
    // Opposing hoop at -X (West baseline)
    this.hoopWest = new BasketballHoop(this.scene, this.physicsWorld, -1);

    // Entities
    this.robot = new Robot(this.scene, this.physicsWorld);
    this.basketball = new Basketball(this.scene, this.physicsWorld);

    // Event listeners
    window.addEventListener('resize', this.onWindowResize);

    this.isInitialized = true;
    console.log('[Simulation] SMART-BASKETBOT Simulation initialized successfully.');

    // Start render loop
    this.clock.start();
    this.animate();
  }

  /**
   * Sets up Three.js WebGLRenderer, Scene, Camera and OrbitControls.
   */
  initGraphics() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SIMULATION_CONFIG.render.clearColor);
    this.scene.fog = new THREE.FogExp2(0x0a0e14, 0.015);

    // 2. Camera
    const c = SIMULATION_CONFIG.camera;
    this.camera = new THREE.PerspectiveCamera(c.fov, width / height, c.near, c.far);
    this.camera.position.set(c.initialPosition.x, c.initialPosition.y, c.initialPosition.z);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: SIMULATION_CONFIG.render.antialias,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, SIMULATION_CONFIG.render.pixelRatioLimit));
    this.renderer.shadowMap.enabled = SIMULATION_CONFIG.render.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = SIMULATION_CONFIG.render.toneMappingExposure;

    this.container.appendChild(this.renderer.domElement);

    // 4. OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.target.set(c.initialTarget.x, c.initialTarget.y, c.initialTarget.z);
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Keep camera above floor level
    this.controls.minDistance = 2.0;
    this.controls.maxDistance = 55.0;
  }

  /**
   * Main simulation and render loop.
   */
  animate() {
    this.animationFrameId = requestAnimationFrame(this.animate);

    const deltaTime = this.clock.getDelta();

    // FPS calculation
    this.frameCount++;
    this.fpsTimer += deltaTime;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round((this.frameCount / this.fpsTimer));
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    // Step physics if simulation is running
    if (this.isRunning && this.physicsWorld) {
      this.physicsWorld.step(deltaTime);
    }

    // Update entity visuals (e.g. rotating LiDAR scanner on robot)
    if (this.robot) {
      this.robot.update(deltaTime);
    }

    // Update smooth camera controls
    if (this.controls) {
      this.controls.update();
    }

    // Render 3D scene
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }

    // Dispatch telemetry data to UI listeners
    this.broadcastTelemetry();
  }

  /**
   * Dispatches current state telemetry to UI dashboard subscribers.
   */
  broadcastTelemetry() {
    if (this.telemetryCallbacks.length === 0) return;

    const physTel = this.physicsWorld ? this.physicsWorld.getTelemetry() : {};
    const ballPos = this.basketball ? this.basketball.getPosition() : { x: 0, y: 0, z: 0 };
    const ballVel = this.basketball ? this.basketball.getVelocity() : { x: 0, y: 0, z: 0 };
    const ballSpeed = this.basketball ? this.basketball.getSpeed() : 0;
    const isBallAirborne = this.basketball ? this.basketball.isAirborne() : false;

    const robotPos = this.robot ? this.robot.getPosition() : { x: 0, y: 0, z: 0 };
    const robotHeading = this.robot ? this.robot.getHeading() : 0;
    const robotVel = this.robot ? this.robot.getVelocity() : { x: 0, y: 0, z: 0 };

    // Distance to East (Target) Hoop rim
    const targetRimX = SIMULATION_CONFIG.court.length / 2 - SIMULATION_CONFIG.court.basketCenterOverhang;
    const distToHoop = Math.hypot(targetRimX - robotPos.x, -robotPos.z);

    const telemetry = {
      status: this.isRunning ? 'RUNNING' : 'PAUSED',
      fps: this.fps,
      simTime: physTel.simTime || 0,
      stepCount: physTel.stepCount || 0,
      activeBodies: physTel.activeBodies || 0,
      activeColliders: physTel.activeColliders || 0,
      ball: {
        x: ballPos.x,
        y: ballPos.y,
        z: ballPos.z,
        vx: ballVel.x,
        vy: ballVel.y,
        vz: ballVel.z,
        speed: ballSpeed,
        isAirborne: isBallAirborne
      },
      robot: {
        x: robotPos.x,
        y: robotPos.y,
        z: robotPos.z,
        headingDeg: (robotHeading * 180 / Math.PI),
        speed: Math.hypot(robotVel.x, robotVel.z),
        distToHoop: distToHoop
      }
    };

    for (let i = 0; i < this.telemetryCallbacks.length; i++) {
      this.telemetryCallbacks[i](telemetry);
    }
  }

  /**
   * Registers a callback for real-time simulation telemetry updates.
   */
  onTelemetry(callback) {
    this.telemetryCallbacks.push(callback);
  }

  // ================= SIMULATION CONTROLS =================

  /**
   * Starts or resumes the physics simulation.
   */
  start() {
    this.isRunning = true;
    console.log('[Simulation] Simulation started.');
  }

  /**
   * Pauses the physics simulation while preserving interactive camera orbiting.
   */
  pause() {
    this.isRunning = false;
    console.log('[Simulation] Simulation paused.');
  }

  /**
   * Toggles play/pause state.
   */
  togglePlayPause() {
    if (this.isRunning) {
      this.pause();
    } else {
      this.start();
    }
    return this.isRunning;
  }

  /**
   * Resets entire simulation: resets time, step counters, robot and ball to initial poses.
   */
  reset() {
    if (this.physicsWorld) {
      this.physicsWorld.simulatedTime = 0;
      this.physicsWorld.stepCount = 0;
      this.physicsWorld.accumulator = 0;
    }
    this.resetRobot();
    this.resetBall();
    console.log('[Simulation] Simulation reset to initial state.');
  }

  /**
   * Resets basketball to default position with zero velocity.
   */
  resetBall() {
    if (this.basketball) {
      this.basketball.reset();
    }
  }

  /**
   * Resets robot to starting pose on the court.
   */
  resetRobot() {
    if (this.robot) {
      this.robot.reset();
    }
  }

  /**
   * Drops the basketball from elevated height to demonstrate Rapier gravity & bounce.
   */
  dropBallTest() {
    if (this.basketball) {
      this.basketball.triggerDropTest(3.2);
    }
  }

  /**
   * Sets camera viewpoint presets.
   * @param {'overview'|'robot'|'hoop'|'top'} preset
   */
  setCameraPreset(preset) {
    if (!this.controls || !this.camera) return;

    switch (preset) {
      case 'overview':
        this.camera.position.set(-16.0, 12.0, 18.0);
        this.controls.target.set(2.0, 1.0, 0.0);
        break;

      case 'robot':
        if (this.robot) {
          const rp = this.robot.getPosition();
          this.camera.position.set(rp.x - 3.5, rp.y + 2.2, rp.z + 3.0);
          this.controls.target.set(rp.x + 0.5, rp.y + 0.4, rp.z);
        }
        break;

      case 'hoop':
        const hoopX = SIMULATION_CONFIG.court.length / 2 - SIMULATION_CONFIG.court.basketCenterOverhang;
        this.camera.position.set(hoopX - 6.0, 4.5, 4.0);
        this.controls.target.set(hoopX, 3.05, 0);
        break;

      case 'top':
        this.camera.position.set(0.01, 28.0, 0);
        this.controls.target.set(0, 0, 0);
        break;
    }

    this.controls.update();
  }

  /**
   * Responsive window resizing handler.
   */
  onWindowResize() {
    if (!this.renderer || !this.camera) return;

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  /**
   * Cleans up all resources.
   */
  destroy() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    window.removeEventListener('resize', this.onWindowResize);

    if (this.controls) this.controls.dispose();
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement && this.renderer.domElement.parentNode) {
        this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
      }
    }
    if (this.physicsWorld) this.physicsWorld.destroy();
  }
}
