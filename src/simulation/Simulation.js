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
import { PathVisualizer } from '../navigation/PathVisualizer.js';
import { HoopDetector } from '../robot/HoopDetector.js';
import { AutonomousShooterWorkflow } from '../navigation/AutonomousShooterWorkflow.js';
import { VisionManager } from '../vision/VisionManager.js';
import { AutonomousGameplayController } from '../autonomy/AutonomousGameplayController.js';
import { AnalyticsManager } from '../analytics/AnalyticsManager.js';

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
    this.hoopDetector = null;
    this.shooterWorkflow = null;
    this.visionManager = null;
    this.gameplayController = null;
    this.analyticsManager = null;

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
    this.robot = new Robot(this.scene, this.physicsWorld, () => this.isRunning);
    this.basketball = new Basketball(this.scene, this.physicsWorld);

    // Basketball scoring detection & autonomous shooter workflow
    this.hoopDetector = new HoopDetector();
    this.robot.initShootingController(this.basketball, this.hoopDetector);

    this.shooterWorkflow = new AutonomousShooterWorkflow({
      robot: this.robot,
      basketball: this.basketball,
      hoopDetector: this.hoopDetector
    });

    // Robot Vision & Camera perception system
    this.visionManager = new VisionManager(SIMULATION_CONFIG.vision);
    this.visionManager.initialize(this.scene, this.renderer);

    // Complete Autonomous Gameplay Controller (Milestone 7)
    this.gameplayController = new AutonomousGameplayController({
      robot: this.robot,
      visionManager: this.visionManager,
      hoopDetector: this.hoopDetector,
      basketball: this.basketball
    });

    // Performance Analytics Subsystem (Milestone 8)
    this.analyticsManager = new AnalyticsManager();
    this.analyticsManager.attachHoopDetector(this.hoopDetector);
    this.analyticsManager.attachAutonomousController(this.gameplayController);

    // Autonomous Navigation Path Visualizer
    this.pathVisualizer = new PathVisualizer(this.scene);

    // Court click interaction
    this.onCourtClickCallback = null;
    this.setupCourtRaycaster();

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
   * Enables clicking on the 3D basketball court to select navigation targets.
   */
  setupCourtRaycaster() {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    let downPos = { x: 0, y: 0 };

    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downPos = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('pointerup', (e) => {
      // Differentiate clean click from orbit drag
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      if (dist > 5) return;

      if (!this.court || !this.court.floorMesh) return;

      const rect = this.renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, this.camera);
      const intersects = raycaster.intersectObject(this.court.floorMesh);

      if (intersects.length > 0) {
        const pt = intersects[0].point;
        if (this.onCourtClickCallback) {
          this.onCourtClickCallback(pt.x, pt.z);
        }
      }
    });
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

    // Update entity visuals & autonomous navigation
    const ballPos = this.basketball ? this.basketball.getPosition() : null;
    const ballVel = this.basketball ? this.basketball.getVelocity() : { x: 0, y: 0, z: 0 };
    if (this.robot) {
      this.robot.update(deltaTime, ballPos, this.basketball);
    }

    // Update hoop scoring detector
    if (this.hoopDetector && ballPos) {
      this.hoopDetector.update(ballPos, ballVel, deltaTime);
    }

    // Step complete autonomous basketball intelligence (Milestone 7)
    if (this.gameplayController && this.gameplayController.isActive) {
      this.gameplayController.update(deltaTime);
    } else if (this.shooterWorkflow) {
      // Step standalone acquisition and shooting workflow when gameplay controller is not active
      this.shooterWorkflow.update(deltaTime);
    }

    // Update robot vision perception system
    if (this.visionManager && this.robot) {
      this.visionManager.update(deltaTime, this.robot, this.basketball, this.hoopEast);
    }

    // Update navigation path visualizer
    if (this.pathVisualizer && this.robot) {
      const nav = this.robot.navController;
      if (nav && (nav.state === 'NAVIGATING' || nav.state === 'APPROACHING_GOAL')) {
        this.pathVisualizer.updatePath(nav.waypoints, this.robot.getPosition());
      } else if (nav && (nav.state === 'GOAL_REACHED' || nav.state === 'IDLE' || nav.state === 'CANCELLED' || nav.state === 'BLOCKED')) {
        this.pathVisualizer.clear();
      }
    }

    // Step simulation analytics and performance monitoring (Milestone 8)
    if (this.analyticsManager && this.robot) {
      this.analyticsManager.update(
        deltaTime,
        this.robot,
        this.robot.navController,
        this.gameplayController
      );
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
    const driveTel = this.robot ? this.robot.getDriveTelemetry() : {};

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
        headingRad: robotHeading,
        headingDeg: (robotHeading * 180 / Math.PI),
        speed: Math.hypot(robotVel.x, robotVel.z),
        angularVelocity: this.robot ? this.robot.getAngularVelocity().y : 0,
        distToHoop: distToHoop,
        // Differential drive & kinematics telemetry
        controlMode: driveTel.controlMode || 'MANUAL',
        navigation: driveTel.navigation || {},
        mode: driveTel.mode || 'STOPPED',
        movementState: driveTel.movementState || 'STOPPED',
        vLeft: driveTel.vLeft || 0,
        vRight: driveTel.vRight || 0,
        omegaLeft: driveTel.omegaLeft || 0,
        omegaRight: driveTel.omegaRight || 0,
        rpmLeft: driveTel.rpmLeft || 0,
        rpmRight: driveTel.rpmRight || 0,
        targetLinearVelocity: driveTel.targetLinearVelocity || 0,
        targetAngularVelocity: driveTel.targetAngularVelocity || 0,
        targetHeadingDeg: driveTel.targetHeadingDeg || 0,
        headingErrorDeg: driveTel.headingErrorDeg || 0,
        pidOutput: driveTel.pidOutput || 0,
        intake: driveTel.intake || {},
        shooter: driveTel.shooter || {},
        shootingController: driveTel.shootingController || {},
        adaptiveCorrector: driveTel.adaptiveCorrector || {}
      },
      shooterWorkflow: this.shooterWorkflow ? this.shooterWorkflow.getTelemetry() : {},
      shotStats: this.hoopDetector ? this.hoopDetector.getTelemetry() : {},
      vision: this.visionManager ? this.visionManager.getTelemetry() : {},
      autonomy: this.gameplayController ? this.gameplayController.getStatus() : {},
      analytics: this.analyticsManager ? this.analyticsManager.getTelemetry() : {}
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
    if (this.hoopDetector) this.hoopDetector.reset();
    if (this.shooterWorkflow) this.shooterWorkflow.reset();
    if (this.visionManager) this.visionManager.reset();
    if (this.gameplayController) this.gameplayController.reset();
    if (this.pathVisualizer) this.pathVisualizer.clear();
    if (this.analyticsManager) this.analyticsManager.reset();
    console.log('[Simulation] Simulation reset to initial state.');
  }

  /**
   * Resets simulation analytics tracking session independently.
   */
  resetAnalytics() {
    if (this.analyticsManager) {
      this.analyticsManager.reset();
    }
  }

  /**
   * Exports session analytics formatted as JSON string.
   */
  exportAnalyticsJSON() {
    return this.analyticsManager ? this.analyticsManager.exportJSON() : '{}';
  }

  /**
   * Exports session analytics formatted as CSV string.
   */
  exportAnalyticsCSV() {
    return this.analyticsManager ? this.analyticsManager.exportCSV() : '';
  }

  /**
   * Triggers browser download for analytics in JSON or CSV format.
   * @param {'JSON'|'CSV'} format
   */
  downloadAnalytics(format = 'JSON') {
    if (this.analyticsManager) {
      this.analyticsManager.downloadExport(format);
    }
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
   * Toggles front intake mechanism on robot.
   */
  toggleIntake() {
    if (!this.robot || !this.robot.intake) return;
    if (this.robot.intake.state === 'INTAKING') {
      this.robot.intake.stopIntake();
    } else {
      this.robot.intake.startIntake();
    }
  }

  /**
   * Reverses intake to eject ball forward.
   */
  rejectBall() {
    if (this.robot && this.robot.intake) {
      this.robot.intake.startReject();
    }
  }

  /**
   * Begins flywheel spin-up for basketball launcher.
   * @param {number} [speed]
   */
  spinUpShooter(speed = null) {
    if (this.robot && this.robot.shooter) {
      this.robot.shooter.spinUp(speed);
    }
  }

  /**
   * Launches basketball into 3D ballistic trajectory towards target hoop.
   */
  fireShooter() {
    if (this.robot && this.basketball) {
      return this.robot.fireShot(this.basketball, this.hoopDetector);
    }
    return false;
  }

  /**
   * Starts end-to-end autonomous ball acquisition and shooting sequence.
   */
  startAutonomousShootingSequence() {
    if (this.shooterWorkflow) {
      return this.shooterWorkflow.startSequence();
    }
    return false;
  }

  /**
   * Cancels active autonomous shooting sequence.
   */
  cancelAutonomousShootingSequence() {
    if (this.shooterWorkflow) {
      this.shooterWorkflow.cancelSequence();
    }
  }

  /**
   * Starts dedicated closed-loop targeting and shooting sequence from current robot position.
   */
  startClosedLoopShooting() {
    if (this.robot) {
      return this.robot.startClosedLoopShooting();
    }
    return false;
  }

  /**
   * Cancels active closed-loop shooting sequence.
   */
  cancelClosedLoopShooting() {
    if (this.robot) {
      this.robot.cancelClosedLoopShooting();
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
    if (this.pathVisualizer) this.pathVisualizer.destroy();
    if (this.shooterWorkflow) this.shooterWorkflow.reset();
    if (this.visionManager) this.visionManager.destroy();
    if (this.gameplayController) this.gameplayController.stop();
    if (this.analyticsManager) this.analyticsManager.destroy();
    if (this.robot) this.robot.destroy();
    if (this.physicsWorld) this.physicsWorld.destroy();
  }

  // ================= VISION CONTROLS =================

  /**
   * Toggles robot camera perception on or off.
   * @param {boolean} enabled
   */
  setVisionEnabled(enabled) {
    if (this.visionManager) {
      this.visionManager.setEnabled(enabled);
    }
  }

  /**
   * Sets robot camera vertical FOV in degrees.
   * @param {number} fovDeg
   */
  setVisionFOV(fovDeg) {
    if (this.visionManager) {
      this.visionManager.setFOV(fovDeg);
    }
  }

  /**
   * Sets robot camera maximum detection distance in meters.
   * @param {number} maxDist
   */
  setVisionMaxDistance(maxDist) {
    if (this.visionManager) {
      this.visionManager.setMaxDistance(maxDist);
    }
  }

  /**
   * Sets robot camera offscreen resolution.
   * @param {number} width
   * @param {number} height
   */
  setVisionResolution(width, height) {
    if (this.visionManager) {
      this.visionManager.setResolution(width, height);
    }
  }

  // ================= AUTONOMOUS GAMEPLAY CONTROLS (M7) =================

  /**
   * Begins autonomous continuous gameplay.
   */
  startAutonomousContinuous() {
    if (this.gameplayController) {
      return this.gameplayController.startContinuousMode();
    }
    return false;
  }

  /**
   * Begins autonomous gameplay with fixed successful basket target.
   * @param {number} targetShots
   */
  startAutonomousFixedTarget(targetShots = 5) {
    if (this.gameplayController) {
      return this.gameplayController.startFixedTargetMode(targetShots);
    }
    return false;
  }

  /**
   * Pauses autonomous gameplay session.
   */
  pauseAutonomousGameplay() {
    if (this.gameplayController) {
      return this.gameplayController.pause();
    }
    return false;
  }

  /**
   * Resumes paused autonomous gameplay session.
   */
  resumeAutonomousGameplay() {
    if (this.gameplayController) {
      return this.gameplayController.resume();
    }
    return false;
  }

  /**
   * Stops/cancels autonomous gameplay session.
   */
  stopAutonomousGameplay() {
    if (this.gameplayController) {
      return this.gameplayController.stop();
    }
    return false;
  }

  /**
   * Resets autonomous gameplay session and statistics.
   */
  resetAutonomousGameplay() {
    if (this.gameplayController) {
      this.gameplayController.reset();
    }
  }
}
