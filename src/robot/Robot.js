/**
 * Robot.js
 * Visual model, Rapier 3D physics representation, and differential-drive robotics
 * subsystem for the SMART-BASKETBOT autonomous mobile robot.
 *
 * Includes:
 * - High-rigidity mobile base chassis with industrial bumpers
 * - Two independent high-traction differential drive wheels + rear caster
 * - Dynamic Rapier rigid body with pitch/roll stabilization (yaw-enabled)
 * - Dedicated DifferentialDriveController and RobotInputController
 * - High-visibility rotating wheel assemblies reflecting genuine wheel RPM
 * - Upper structural frame, front intake scoop, launcher mockup, LiDAR and stereo depth camera.
 */

import * as THREE from 'three';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';
import { DifferentialDriveController } from './DifferentialDriveController.js';
import { RobotInputController } from './RobotInputController.js';
import { AutonomousNavController } from '../navigation/AutonomousNavController.js';
import { IntakeMechanism } from './IntakeMechanism.js';
import { ShootingMechanism } from './ShootingMechanism.js';
import { TrajectoryCalculator } from './TrajectoryCalculator.js';
import { AdaptiveShotCorrector } from './AdaptiveShotCorrector.js';
import { ClosedLoopShootingController } from './ClosedLoopShootingController.js';

export class Robot {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../simulation/PhysicsWorld.js').PhysicsWorld} physicsWorld
   * @param {() => boolean} [isSimulationActive]
   */
  constructor(scene, physicsWorld, isSimulationActive = () => true) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.config = SIMULATION_CONFIG.robot;

    this.group = new THREE.Group();
    this.group.name = 'SmartBasketBot';

    this.initialPosition = { ...this.config.initialPosition };
    this.initialHeading = this.config.initialHeadingDeg * (Math.PI / 180);

    this.rigidBody = null;
    this.collider = null;

    // Control Mode: 'MANUAL' or 'AUTONOMOUS'
    this.controlMode = 'MANUAL';

    // Subsystems
    const driveConfig = {
      wheelRadius: this.config.driveWheels.radius,
      trackWidth: this.config.driveWheels.trackWidth,
      ...this.config.drive
    };
    this.driveController = new DifferentialDriveController(driveConfig);
    this.inputController = new RobotInputController(
      this.driveController,
      isSimulationActive,
      () => {
        // When manual drive key is pressed, gracefully yield autonomous control
        if (this.controlMode === 'AUTONOMOUS') {
          this.navController.cancel();
          this.controlMode = 'MANUAL';
        }
      }
    );

    // Autonomous navigation subsystem
    this.navController = new AutonomousNavController({ driveController: this.driveController });

    // Intake and Shooting Subsystems
    this.intake = new IntakeMechanism();
    this.shooter = new ShootingMechanism();

    // Trajectory calculation, adaptive correction, and closed-loop shooting
    this.trajectoryCalculator = new TrajectoryCalculator();
    this.adaptiveCorrector = new AdaptiveShotCorrector();
    this.shootingController = null;

    // Component references for visual animation
    this.leftWheel = null;
    this.rightWheel = null;
    this.intakeRoller = null;
    this.leftFlywheel = null;
    this.rightFlywheel = null;
    this.shooterGroup = null;
    this.opticalSensorLed = null;
    this.lidarPuck = null;
    this.statusLed = null;

    this.buildVisuals();
    this.buildPhysics();

    this.scene.add(this.group);
  }

  /**
   * Constructs detailed 3D visual geometry and engineering materials for the robot.
   */
  buildVisuals() {
    // Shared Materials
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Dark titanium/carbon slate
      roughness: 0.5,
      metalness: 0.6
    });

    const bumperMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a, // Tough polyurethane bumper
      roughness: 0.8,
      metalness: 0.1
    });

    const aluminumMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8, // Extruded structural aluminum
      roughness: 0.25,
      metalness: 0.85
    });

    const rubberMat = new THREE.MeshStandardMaterial({
      color: 0x111827, // Tread rubber
      roughness: 0.9,
      metalness: 0.05
    });

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7, // Robot team blue anodized rim
      roughness: 0.3,
      metalness: 0.7
    });

    const spokeMarkerMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, // White visual spoke markers for clear rotation visibility
      roughness: 0.2,
      metalness: 0.9
    });

    const accentOrangeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316, // Safety orange accents & rollers
      roughness: 0.4,
      metalness: 0.2
    });

    const glassSensorMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.1,
      metalness: 0.9
    });

    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.2,
      emissive: 0x0284c7,
      emissiveIntensity: 0.6
    });

    // 1. Lower Chassis Plate
    const c = this.config.chassis;
    const chassisPlateGeom = new THREE.BoxGeometry(c.length, c.height * 0.4, c.width);
    const chassisPlate = new THREE.Mesh(chassisPlateGeom, chassisMat);
    chassisPlate.position.set(0, c.groundClearance + (c.height * 0.4) / 2, 0);
    chassisPlate.castShadow = true;
    chassisPlate.receiveShadow = true;
    this.group.add(chassisPlate);

    // Bumper Skirt (Full perimeter protective guard)
    const bumperGeom = new THREE.BoxGeometry(c.length + 0.06, 0.10, c.width + 0.06);
    const bumperMesh = new THREE.Mesh(bumperGeom, bumperMat);
    bumperMesh.position.set(0, c.groundClearance + 0.05, 0);
    bumperMesh.castShadow = true;
    this.group.add(bumperMesh);

    // Front Bumper Cutout for Ball Intake
    const hornL = 0.22;
    const hornW = 0.08;
    const hornH = 0.10;
    const hornGeom = new THREE.BoxGeometry(hornL, hornH, hornW);

    const leftHorn = new THREE.Mesh(hornGeom, accentOrangeMat);
    leftHorn.position.set(c.length / 2 - 0.02, c.groundClearance + 0.05, (this.config.intake.width / 2) + 0.04);
    this.group.add(leftHorn);

    const rightHorn = new THREE.Mesh(hornGeom, accentOrangeMat);
    rightHorn.position.set(c.length / 2 - 0.02, c.groundClearance + 0.05, -(this.config.intake.width / 2) - 0.04);
    this.group.add(rightHorn);

    // 2. Drive Wheels (Left & Right) with High-Visibility Spoke Markers
    const dw = this.config.driveWheels;
    const wheelGeom = new THREE.CylinderGeometry(dw.radius, dw.radius, dw.width, 24);

    // Helper to build a wheel assembly with visible rotating spoke lines
    const buildWheelAssembly = () => {
      const assembly = new THREE.Group();

      const tire = new THREE.Mesh(wheelGeom, rubberMat);
      tire.rotation.x = Math.PI / 2;
      tire.castShadow = true;
      assembly.add(tire);

      const rim = new THREE.Mesh(new THREE.CylinderGeometry(dw.radius * 0.65, dw.radius * 0.65, dw.width + 0.002, 16), rimMat);
      rim.rotation.x = Math.PI / 2;
      assembly.add(rim);

      // Add 4 high-contrast radial spoke markers on outer wheel face for rotation visibility
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        const spokeGeom = new THREE.BoxGeometry(0.012, dw.radius * 0.55, dw.width + 0.005);
        const spoke = new THREE.Mesh(spokeGeom, spokeMarkerMat);
        spoke.position.set(Math.cos(angle) * (dw.radius * 0.3), Math.sin(angle) * (dw.radius * 0.3), 0);
        spoke.rotation.z = angle;
        assembly.add(spoke);
      }

      return assembly;
    };

    // Left Drive Wheel
    const leftWheelAssembly = buildWheelAssembly();
    leftWheelAssembly.position.set(0.06, dw.radius, dw.trackWidth / 2);
    this.group.add(leftWheelAssembly);
    this.leftWheel = leftWheelAssembly;

    // Right Drive Wheel
    const rightWheelAssembly = buildWheelAssembly();
    rightWheelAssembly.position.set(0.06, dw.radius, -dw.trackWidth / 2);
    this.group.add(rightWheelAssembly);
    this.rightWheel = rightWheelAssembly;

    // 3. Rear Support Caster Wheel Assembly
    const casterR = this.config.casterWheel.radius;
    const casterForkGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 12);
    const casterFork = new THREE.Mesh(casterForkGeom, aluminumMat);
    casterFork.position.set(-c.length / 2 + 0.08, casterR + 0.03, 0);

    const casterWheelGeom = new THREE.SphereGeometry(casterR, 16, 16);
    const casterWheel = new THREE.Mesh(casterWheelGeom, rubberMat);
    casterWheel.position.set(0, -0.025, 0);
    casterFork.add(casterWheel);
    this.group.add(casterFork);

    // 4. Upper Structural Frame (T-Slot Aluminum Tower)
    const towerH = 0.58;
    const strutGeom = new THREE.BoxGeometry(0.035, towerH, 0.035);

    const strutOffsets = [
      { x: -0.22, z: -0.22 },
      { x: -0.22, z: 0.22 },
      { x: 0.14, z: -0.22 },
      { x: 0.14, z: 0.22 }
    ];

    strutOffsets.forEach((off) => {
      const strut = new THREE.Mesh(strutGeom, aluminumMat);
      strut.position.set(off.x, c.groundClearance + c.height * 0.4 + towerH / 2, off.z);
      strut.castShadow = true;
      this.group.add(strut);
    });

    // Horizontal Upper Deck Frame
    const deckGeom = new THREE.BoxGeometry(0.40, 0.02, 0.48);
    const deck = new THREE.Mesh(deckGeom, aluminumMat);
    deck.position.set(-0.04, c.groundClearance + c.height * 0.4 + towerH, 0);
    deck.castShadow = true;
    this.group.add(deck);

    // Electronics & Battery Enclosure
    const elecGeom = new THREE.BoxGeometry(0.32, 0.24, 0.38);
    const elecBox = new THREE.Mesh(elecGeom, chassisMat);
    elecBox.position.set(-0.04, c.groundClearance + c.height * 0.4 + 0.13, 0);
    elecBox.castShadow = true;
    this.group.add(elecBox);

    // Emergency Stop (E-Stop) Button on Top Deck
    const estopBaseGeom = new THREE.CylinderGeometry(0.022, 0.022, 0.02, 16);
    const estopBase = new THREE.Mesh(estopBaseGeom, new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.4 }));
    const estopMushroomGeom = new THREE.SphereGeometry(0.02, 16, 12);
    const estopMushroom = new THREE.Mesh(estopMushroomGeom, new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.2 }));
    estopMushroom.position.y = 0.018;
    estopBase.add(estopMushroom);
    estopBase.position.set(-0.16, deck.position.y + 0.015, -0.16);
    this.group.add(estopBase);

    // 5. Front Basketball Intake Area & Containment Cradle
    const intakeGroup = new THREE.Group();
    intakeGroup.position.set(c.length / 2 - 0.05, c.groundClearance + 0.06, 0);

    const rampGeom = new THREE.BoxGeometry(0.20, 0.015, this.config.intake.width);
    const ramp = new THREE.Mesh(rampGeom, aluminumMat);
    ramp.rotation.z = -0.18;
    ramp.position.set(0.06, 0.01, 0);
    intakeGroup.add(ramp);

    const rollerShaftGeom = new THREE.CylinderGeometry(0.012, 0.012, this.config.intake.width, 12);
    const rollerShaft = new THREE.Mesh(rollerShaftGeom, aluminumMat);
    rollerShaft.rotation.x = Math.PI / 2;
    rollerShaft.position.set(0.16, 0.06, 0);

    for (let rz = -0.16; rz <= 0.16; rz += 0.08) {
      const ringGeom = new THREE.CylinderGeometry(this.config.intake.rollerRadius, this.config.intake.rollerRadius, 0.035, 16);
      const ring = new THREE.Mesh(ringGeom, accentOrangeMat);
      ring.position.set(0, rz, 0);
      rollerShaft.add(ring);
    }
    intakeGroup.add(rollerShaft);
    this.intakeRoller = rollerShaft;
    this.group.add(intakeGroup);

    // Ball Containment Hopper Cradle (curved retaining rails)
    const cradleGroup = new THREE.Group();
    const cradleRailGeom = new THREE.BoxGeometry(0.28, 0.02, 0.02);
    const leftRail = new THREE.Mesh(cradleRailGeom, aluminumMat);
    leftRail.position.set(0.08, c.groundClearance + 0.18, 0.16);
    cradleGroup.add(leftRail);

    const rightRail = new THREE.Mesh(cradleRailGeom, aluminumMat);
    rightRail.position.set(0.08, c.groundClearance + 0.18, -0.16);
    cradleGroup.add(rightRail);

    // Optical Beam-Break Sensor LED in cradle
    const optSensorGeom = new THREE.SphereGeometry(0.014, 12, 8);
    const optSensorMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // Red = clear; Green = ball present
      emissive: 0xef4444,
      emissiveIntensity: 0.8
    });
    const optSensorLed = new THREE.Mesh(optSensorGeom, optSensorMat);
    optSensorLed.position.set(0.08, c.groundClearance + 0.20, 0.16);
    cradleGroup.add(optSensorLed);
    this.opticalSensorLed = optSensorLed;
    this.group.add(cradleGroup);

    // 6. Dual-Flywheel Shooting Mechanism
    const shooterGroup = new THREE.Group();
    shooterGroup.position.set(0.02, deck.position.y + 0.12, 0);
    shooterGroup.rotation.z = -this.shooter.launchAngleDeg * (Math.PI / 180);

    const railGeom = new THREE.BoxGeometry(this.config.shooter.barrelLength, 0.03, 0.28);
    const rails = new THREE.Mesh(railGeom, aluminumMat);
    shooterGroup.add(rails);

    // Helper for flywheel with visible rotation markers
    const flywheelGeom = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 20);
    const buildFlywheelMesh = (posZ) => {
      const fwGroup = new THREE.Group();
      fwGroup.position.set(0.12, 0.06, posZ);

      const fw = new THREE.Mesh(flywheelGeom, rimMat);
      fw.rotation.x = Math.PI / 2;
      fwGroup.add(fw);

      // Contrast markers for spin visibility
      for (let i = 0; i < 4; i++) {
        const ang = (i * Math.PI) / 2;
        const mark = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.065, 0.038), spokeMarkerMat);
        mark.position.set(Math.cos(ang) * 0.035, Math.sin(ang) * 0.035, 0);
        mark.rotation.z = ang;
        fwGroup.add(mark);
      }
      return fwGroup;
    };

    const leftFlywheelGroup = buildFlywheelMesh(0.15);
    shooterGroup.add(leftFlywheelGroup);
    this.leftFlywheel = leftFlywheelGroup;

    const rightFlywheelGroup = buildFlywheelMesh(-0.15);
    shooterGroup.add(rightFlywheelGroup);
    this.rightFlywheel = rightFlywheelGroup;

    this.shooterGroup = shooterGroup;
    this.group.add(shooterGroup);

    // 7. Sensor Mast & Vision Cameras
    const mastGeom = new THREE.CylinderGeometry(0.015, 0.018, 0.24, 12);
    const mast = new THREE.Mesh(mastGeom, aluminumMat);
    mast.position.set(0.12, deck.position.y + 0.12, 0);
    this.group.add(mast);

    const camGeom = new THREE.BoxGeometry(0.03, 0.028, 0.14);
    const camBody = new THREE.Mesh(camGeom, glassSensorMat);
    camBody.position.set(0.02, 0.10, 0);

    const lensGeom = new THREE.CylinderGeometry(0.007, 0.007, 0.005, 12);
    const leftLens = new THREE.Mesh(lensGeom, lensMat);
    leftLens.rotation.z = Math.PI / 2;
    leftLens.position.set(0.015, 0, 0.045);
    camBody.add(leftLens);

    const rightLens = new THREE.Mesh(lensGeom, lensMat);
    rightLens.rotation.z = Math.PI / 2;
    rightLens.position.set(0.015, 0, -0.045);
    camBody.add(rightLens);

    mast.add(camBody);

    const lidarBaseGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.025, 16);
    const lidarBase = new THREE.Mesh(lidarBaseGeom, chassisMat);
    lidarBase.position.set(0, 0.13, 0);

    const lidarPuckGeom = new THREE.CylinderGeometry(0.028, 0.028, 0.022, 16);
    const lidarPuck = new THREE.Mesh(lidarPuckGeom, glassSensorMat);
    lidarPuck.position.set(0, 0.02, 0);
    lidarBase.add(lidarPuck);
    mast.add(lidarBase);
    this.lidarPuck = lidarPuck;

    const ledGeom = new THREE.SphereGeometry(0.012, 12, 8);
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const led = new THREE.Mesh(ledGeom, ledMat);
    led.position.set(0, 0.02, 0);
    lidarPuck.add(led);
    this.statusLed = led;

    // Apply initial position & rotation
    this.group.position.set(this.initialPosition.x, this.initialPosition.y, this.initialPosition.z);
    this.group.rotation.y = this.initialHeading;
  }

  /**
   * Creates Rapier dynamic rigid body and physical colliders with roll/pitch stabilization.
   */
  buildPhysics() {
    const c = this.config.chassis;
    const totalHeight = 0.75;

    const { body, collider } = this.physicsWorld.createDynamicBox(
      this.initialPosition.x,
      this.initialPosition.y + totalHeight / 2 - 0.1,
      this.initialPosition.z,
      c.length,
      totalHeight,
      c.width,
      this.config.mass,
      0.15, // Low restitution
      0.85, // High tire friction
      0.4,  // Linear damping
      0.5   // Angular damping
    );

    this.rigidBody = body;
    this.collider = collider;

    // Prevent tipping/pitching over by locking X (pitch) and Z (roll) rotations,
    // while fully permitting Y (yaw) rotation and full 3D translation.
    this.rigidBody.setEnabledRotations(false, true, false, true);

    // Initial heading rotation
    const halfAngle = this.initialHeading / 2;
    this.rigidBody.setRotation({
      x: 0,
      y: Math.sin(halfAngle),
      z: 0,
      w: Math.cos(halfAngle)
    }, true);

    // Bind mesh transform synchronization
    this.physicsWorld.bindMeshToBody(this.group, this.rigidBody, true);
  }

  /**
   * Updates robot kinematics, applies actuator velocities to Rapier body,
   * spins visual wheel meshes, updates intake/shooter subsystems, and animates sensors.
   * @param {number} deltaTime Frame time step in seconds
   * @param {{ x: number, z: number } | Object | null} [ballPose]
   * @param {Object} [basketball]
   */
  update(deltaTime, ballPose = null, basketball = null) {
    if (!this.rigidBody) return;

    // Detect if basketball object was passed as 2nd or 3rd parameter
    const basketballObj = basketball || (ballPose && typeof ballPose.getSpeed === 'function' ? ballPose : null);
    const ballCoords = ballPose && typeof ballPose.getSpeed === 'function' ? ballPose.getPosition() : ballPose;

    // 1. Query current physics state
    const currentHeading = this.getHeading();
    const currentLinvel = this.rigidBody.linvel();
    const pos = this.getPosition();

    // 2. Step autonomous navigation guidance if in AUTONOMOUS mode
    if (this.controlMode === 'AUTONOMOUS') {
      const ballAsObstacle = (this.intake && this.intake.isBallCaptured) ? null : ballCoords;
      this.navController.update(deltaTime, { x: pos.x, z: pos.z, heading: currentHeading }, ballAsObstacle);
    }

    // 3. Step differential drive controller
    const cmd = this.driveController.update(deltaTime, currentHeading);

    // 4. Apply genuine physics velocities to Rapier rigid body:
    // Preserve current vertical velocity (currentLinvel.y) for gravity & floor contact
    this.rigidBody.setLinvel({
      x: cmd.worldLinvelX,
      y: currentLinvel.y,
      z: cmd.worldLinvelZ
    }, true);

    // Apply yaw angular velocity
    this.rigidBody.setAngvel({
      x: 0,
      y: cmd.worldAngvelY,
      z: 0
    }, true);

    // 5. Update visual wheel rotation based on actual angular wheel positions
    // Negate angle so forward rotation turns wheel in the driving direction
    if (this.leftWheel) {
      this.leftWheel.rotation.z = -this.driveController.wheelAngleLeft;
    }
    if (this.rightWheel) {
      this.rightWheel.rotation.z = -this.driveController.wheelAngleRight;
    }

    // 6. Step intake and shooter subsystems
    if (basketballObj) {
      this.intake.update(deltaTime, this, basketballObj);
    }
    this.shooter.update(deltaTime);
    if (this.shootingController && this.shootingController.state !== 'IDLE') {
      this.shootingController.update(deltaTime);
    }

    // 7. Animate intake roller mesh
    if (this.intakeRoller) {
      this.intakeRoller.rotation.x = Math.PI / 2 + this.intake.rollerAngle;
    }

    // 8. Animate flywheels
    if (this.leftFlywheel) {
      this.leftFlywheel.rotation.z = this.shooter.flywheelAngle;
    }
    if (this.rightFlywheel) {
      this.rightFlywheel.rotation.z = -this.shooter.flywheelAngle;
    }

    // 9. Update optical sensor indicator LED
    if (this.opticalSensorLed && this.opticalSensorLed.material) {
      if (this.intake.opticalSensorActive) {
        this.opticalSensorLed.material.color.setHex(0x10b981); // Green when ball detected
        this.opticalSensorLed.material.emissive.setHex(0x10b981);
      } else {
        this.opticalSensorLed.material.color.setHex(0xef4444); // Red when clear
        this.opticalSensorLed.material.emissive.setHex(0xef4444);
      }
    }

    // 10. Update shooter elevation tilt if dynamically adjusted
    if (this.shooterGroup) {
      this.shooterGroup.rotation.z = -this.shooter.launchAngleDeg * (Math.PI / 180);
    }

    // 11. Update sensor mast animations (spinning LiDAR puck)
    if (this.lidarPuck) {
      this.lidarPuck.rotation.y += deltaTime * 6.0;
    }
  }

  /**
   * Resets the robot back to starting position, zero velocity, and initial controller states.
   */
  reset(pos = this.initialPosition, headingRad = this.initialHeading) {
    if (!this.rigidBody) return;

    this.controlMode = 'MANUAL';
    this.navController.reset();
    this.driveController.reset();
    this.inputController.resetKeys();

    if (this.intake) this.intake.reset();
    if (this.shooter) this.shooter.reset();
    if (this.shootingController) this.shootingController.reset();

    const halfAngle = headingRad / 2;
    const rotation = {
      x: 0,
      y: Math.sin(halfAngle),
      z: 0,
      w: Math.cos(halfAngle)
    };

    const spawnY = pos.y + 0.28;
    this.physicsWorld.resetBody(this.rigidBody, { x: pos.x, y: spawnY, z: pos.z }, rotation);

    if (this.leftWheel) this.leftWheel.rotation.z = 0;
    if (this.rightWheel) this.rightWheel.rotation.z = 0;
  }

  /**
   * Commands the robot to autonomously plan and follow a path to world (targetX, targetZ).
   */
  startAutonomousNavigation(targetX, targetZ) {
    this.controlMode = 'AUTONOMOUS';
    const pos = this.getPosition();
    const heading = this.getHeading();
    return this.navController.navigateTo(targetX, targetZ, { x: pos.x, z: pos.z, heading });
  }

  /**
   * Cancels active autonomous navigation and returns control to MANUAL teleop.
   */
  cancelAutonomousNavigation() {
    this.navController.cancel();
    this.driveController.stop();
    this.controlMode = 'MANUAL';
  }

  /**
   * Toggles or sets current control mode.
   * @param {'MANUAL'|'AUTONOMOUS'} mode
   */
  setControlMode(mode) {
    this.controlMode = mode;
    if (mode === 'MANUAL') {
      this.navController.cancel();
      this.driveController.stop();
      if (this.shootingController && this.shootingController.isActive) {
        this.shootingController.cancel();
      }
    } else if (mode === 'AUTONOMOUS') {
      this.inputController.resetKeys();
      this.driveController.stop();
    }
  }

  /**
   * Current position of the robot in world coordinates.
   */
  getPosition() {
    if (this.rigidBody) {
      return this.rigidBody.translation();
    }
    return this.group.position;
  }

  /**
   * Current linear velocity vector in world coordinates.
   */
  getVelocity() {
    if (this.rigidBody) {
      return this.rigidBody.linvel();
    }
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Current angular velocity vector.
   */
  getAngularVelocity() {
    if (this.rigidBody) {
      return this.rigidBody.angvel();
    }
    return { x: 0, y: 0, z: 0 };
  }

  /**
   * Returns current heading angle in radians [-PI, PI].
   */
  getHeading() {
    if (this.rigidBody) {
      const q = this.rigidBody.rotation();
      const siny_cosp = 2 * (q.w * q.y + q.z * q.x);
      const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
      return Math.atan2(siny_cosp, cosy_cosp);
    }
    return this.group.rotation.y;
  }

  /**
   * Returns full differential drive and robotics telemetry.
   */
  getDriveTelemetry() {
    const heading = this.getHeading();
    const pos = this.getPosition();
    const driveTel = this.driveController.getTelemetry(heading);
    const navTel = this.navController.getTelemetry({ x: pos.x, z: pos.z, heading });
    const linvel = this.getVelocity();
    const angvel = this.getAngularVelocity();

    return {
      ...driveTel,
      controlMode: this.controlMode,
      navigation: navTel,
      intake: this.intake ? this.intake.getTelemetry() : {},
      shooter: this.shooter ? this.shooter.getTelemetry() : {},
      shootingController: this.shootingController ? this.shootingController.getTelemetry() : {},
      adaptiveCorrector: this.adaptiveCorrector ? this.adaptiveCorrector.getTelemetry() : {},
      actualHeadingRad: heading,
      actualHeadingDeg: (heading * 180) / Math.PI,
      actualLinearSpeed: Math.hypot(linvel.x, linvel.z),
      actualAngularSpeed: angvel.y
    };
  }

  /**
   * Initializes dedicated closed-loop shooting controller.
   * @param {Object} basketball
   * @param {Object} hoopDetector
   */
  initShootingController(basketball, hoopDetector) {
    this.shootingController = new ClosedLoopShootingController({
      robot: this,
      basketball,
      hoopDetector,
      trajectoryCalculator: this.trajectoryCalculator,
      adaptiveCorrector: this.adaptiveCorrector
    });
    return this.shootingController;
  }

  /**
   * Alias for adaptiveCorrector for integration compatibility.
   * @returns {AdaptiveShotCorrector}
   */
  get adaptiveShotCorrector() {
    return this.adaptiveCorrector;
  }

  /**
   * Starts dedicated closed-loop trajectory optimization, alignment, spinup, and firing.
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   */
  startClosedLoopShooting(hoopTarget = null) {
    if (this.shootingController) {
      return this.shootingController.startShootingSequence(hoopTarget);
    }
    return false;
  }

  /**
   * Cancels active closed-loop shooting sequence.
   */
  cancelClosedLoopShooting() {
    if (this.shootingController) {
      this.shootingController.cancel();
    }
  }

  /**
   * Activates front intake rollers to capture balls.
   */
  startIntake() {
    if (this.intake) this.intake.startIntake();
  }

  /**
   * Deactivates front intake rollers.
   */
  stopIntake() {
    if (this.intake) this.intake.stopIntake();
  }

  /**
   * Reverses front intake rollers to reject/eject ball.
   */
  startReject() {
    if (this.intake) this.intake.startReject();
  }

  /**
   * Prepares launcher for shot at target hoop, computing ballistic trajectory.
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   */
  prepareShot(hoopTarget) {
    if (this.shooter) return this.shooter.prepareShotAtHoop(this, hoopTarget);
    return null;
  }

  /**
   * Launches basketball into 3D ballistic trajectory.
   * @param {Object} basketball
   * @param {Object} [hoopDetector]
   * @param {{ x: number, y: number, z: number }} [hoopTarget]
   */
  fireShot(basketball, hoopDetector = null, hoopTarget = null) {
    if (this.shooter) return this.shooter.fire(this, basketball, hoopDetector, hoopTarget || this.shooter.defaultHoopPos);
    return false;
  }

  /**
   * Cleans up event listeners and controller resources.
   */
  destroy() {
    if (this.inputController) {
      this.inputController.destroy();
    }
  }
}
