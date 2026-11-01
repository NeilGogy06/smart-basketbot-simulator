/**
 * Robot.js
 * Visual model and Rapier 3D physics representation of the autonomous mobile
 * basketball robot (SMART-BASKETBOT).
 *
 * Includes:
 * - High-rigidity mobile base chassis with industrial bumpers
 * - Two independent high-traction differential drive wheels + rear caster
 * - Anodized aluminum extrusion upper structural tower
 * - Front ball intake scoop with compliant silicone rollers
 * - Angled dual-flywheel shooting mechanism
 * - Mast-mounted stereo depth camera, 2D LiDAR turret, and status beacon
 * - Dynamic Rapier rigid body and transform synchronization.
 */

import * as THREE from 'three';
import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class Robot {
  /**
   * @param {THREE.Scene} scene
   * @param {import('../simulation/PhysicsWorld.js').PhysicsWorld} physicsWorld
   */
  constructor(scene, physicsWorld) {
    this.scene = scene;
    this.physicsWorld = physicsWorld;
    this.config = SIMULATION_CONFIG.robot;

    this.group = new THREE.Group();
    this.group.name = 'SmartBasketBot';

    this.initialPosition = { ...this.config.initialPosition };
    this.initialHeading = this.config.initialHeadingDeg * (Math.PI / 180);

    this.rigidBody = null;
    this.collider = null;

    // Component references for potential animation (wheels, rollers, lidar)
    this.leftWheel = null;
    this.rightWheel = null;
    this.intakeRoller = null;
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
    // Two front bumper horns framing the intake opening
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

    // 2. Drive Wheels (Left & Right)
    const dw = this.config.driveWheels;
    const wheelGeom = new THREE.CylinderGeometry(dw.radius, dw.radius, dw.width, 24);

    // Left Drive Wheel
    const leftWheelGroup = new THREE.Group();
    const lTire = new THREE.Mesh(wheelGeom, rubberMat);
    lTire.rotation.x = Math.PI / 2;
    lTire.castShadow = true;
    const lRim = new THREE.Mesh(new THREE.CylinderGeometry(dw.radius * 0.65, dw.radius * 0.65, dw.width + 0.002, 16), rimMat);
    lRim.rotation.x = Math.PI / 2;
    leftWheelGroup.add(lTire, lRim);
    leftWheelGroup.position.set(0.06, dw.radius, dw.trackWidth / 2);
    this.group.add(leftWheelGroup);
    this.leftWheel = leftWheelGroup;

    // Right Drive Wheel
    const rightWheelGroup = new THREE.Group();
    const rTire = new THREE.Mesh(wheelGeom, rubberMat);
    rTire.rotation.x = Math.PI / 2;
    rTire.castShadow = true;
    const rRim = new THREE.Mesh(new THREE.CylinderGeometry(dw.radius * 0.65, dw.radius * 0.65, dw.width + 0.002, 16), rimMat);
    rRim.rotation.x = Math.PI / 2;
    rightWheelGroup.add(rTire, rRim);
    rightWheelGroup.position.set(0.06, dw.radius, -dw.trackWidth / 2);
    this.group.add(rightWheelGroup);
    this.rightWheel = rightWheelGroup;

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

    // 5. Front Basketball Intake Area
    const intakeGroup = new THREE.Group();
    intakeGroup.position.set(c.length / 2 - 0.05, c.groundClearance + 0.06, 0);

    // Beveled ramp plate
    const rampGeom = new THREE.BoxGeometry(0.20, 0.015, this.config.intake.width);
    const ramp = new THREE.Mesh(rampGeom, aluminumMat);
    ramp.rotation.z = -0.18;
    ramp.position.set(0.06, 0.01, 0);
    intakeGroup.add(ramp);

    // Rotating compliant intake roller bar
    const rollerShaftGeom = new THREE.CylinderGeometry(0.01, 0.01, this.config.intake.width, 12);
    const rollerShaft = new THREE.Mesh(rollerShaftGeom, aluminumMat);
    rollerShaft.rotation.x = Math.PI / 2;
    rollerShaft.position.set(0.16, 0.06, 0);

    // Silicone gripper rings on roller shaft
    for (let rz = -0.16; rz <= 0.16; rz += 0.08) {
      const ringGeom = new THREE.CylinderGeometry(this.config.intake.rollerRadius, this.config.intake.rollerRadius, 0.03, 16);
      const ring = new THREE.Mesh(ringGeom, accentOrangeMat);
      ring.position.set(0, rz, 0);
      rollerShaft.add(ring);
    }
    intakeGroup.add(rollerShaft);
    this.intakeRoller = rollerShaft;
    this.group.add(intakeGroup);

    // 6. Placeholder Shooting Mechanism
    // Dual-flywheel angled launcher barrel pointed forward (+X) and up
    const shooterGroup = new THREE.Group();
    shooterGroup.position.set(0.02, deck.position.y + 0.12, 0);
    shooterGroup.rotation.z = -this.config.shooter.elevationAngleDeg * (Math.PI / 180);

    // Dual guide rails / barrel
    const railGeom = new THREE.BoxGeometry(this.config.shooter.barrelLength, 0.03, 0.28);
    const rails = new THREE.Mesh(railGeom, aluminumMat);
    shooterGroup.add(rails);

    // Left & Right Flywheels
    const flywheelGeom = new THREE.CylinderGeometry(0.075, 0.075, 0.035, 20);
    const leftFlywheel = new THREE.Mesh(flywheelGeom, rimMat);
    leftFlywheel.position.set(0.12, 0.06, 0.15);
    leftFlywheel.rotation.x = Math.PI / 2;
    shooterGroup.add(leftFlywheel);

    const rightFlywheel = new THREE.Mesh(flywheelGeom, rimMat);
    rightFlywheel.position.set(0.12, 0.06, -0.15);
    rightFlywheel.rotation.x = Math.PI / 2;
    shooterGroup.add(rightFlywheel);

    this.group.add(shooterGroup);

    // 7. Sensor Mast & Vision Cameras
    const mastGeom = new THREE.CylinderGeometry(0.015, 0.018, 0.24, 12);
    const mast = new THREE.Mesh(mastGeom, aluminumMat);
    mast.position.set(0.12, deck.position.y + 0.12, 0);
    this.group.add(mast);

    // Stereo Depth Camera (Intel RealSense form factor)
    const camGeom = new THREE.BoxGeometry(0.03, 0.028, 0.14);
    const camBody = new THREE.Mesh(camGeom, glassSensorMat);
    camBody.position.set(0.02, 0.10, 0);

    // Left & Right Optical Lenses
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

    // LiDAR Turret on top of mast
    const lidarBaseGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.025, 16);
    const lidarBase = new THREE.Mesh(lidarBaseGeom, chassisMat);
    lidarBase.position.set(0, 0.13, 0);

    const lidarPuckGeom = new THREE.CylinderGeometry(0.028, 0.028, 0.022, 16);
    const lidarPuck = new THREE.Mesh(lidarPuckGeom, glassSensorMat);
    lidarPuck.position.set(0, 0.02, 0);
    lidarBase.add(lidarPuck);
    mast.add(lidarBase);
    this.lidarPuck = lidarPuck;

    // Omnidirectional LED Beacon on top
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
   * Creates Rapier dynamic rigid body and physical colliders for the robot.
   */
  buildPhysics() {
    const c = this.config.chassis;
    const totalHeight = 0.75;

    // We represent the robot physics using a dynamic rigid body with high mass and low center of gravity
    const { body, collider } = this.physicsWorld.createDynamicBox(
      this.initialPosition.x,
      this.initialPosition.y + totalHeight / 2 - 0.1,
      this.initialPosition.z,
      c.length,
      totalHeight,
      c.width,
      this.config.mass,
      0.15, // Low restitution (rigid metal)
      0.85, // High tire friction
      0.8,  // Linear damping prevents sliding
      0.8   // Angular damping prevents tip-overs
    );

    this.rigidBody = body;
    this.collider = collider;

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
   * Resets the robot back to starting position and heading with zero velocity.
   */
  reset(pos = this.initialPosition, headingRad = this.initialHeading) {
    if (!this.rigidBody) return;

    const halfAngle = headingRad / 2;
    const rotation = {
      x: 0,
      y: Math.sin(halfAngle),
      z: 0,
      w: Math.cos(halfAngle)
    };

    const spawnY = pos.y + 0.28; // Center of physics bounding box
    this.physicsWorld.resetBody(this.rigidBody, { x: pos.x, y: spawnY, z: pos.z }, rotation);
  }

  /**
   * Animates subtle idle sensor rotation (LiDAR scanner spin).
   */
  update(deltaTime) {
    if (this.lidarPuck) {
      this.lidarPuck.rotation.y += deltaTime * 6.0; // 360 RPM spinning LiDAR
    }
  }

  /**
   * Current position of the robot.
   */
  getPosition() {
    if (this.rigidBody) {
      return this.rigidBody.translation();
    }
    return this.group.position;
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
   * Returns current heading angle in radians.
   */
  getHeading() {
    if (this.rigidBody) {
      const q = this.rigidBody.rotation();
      // Yaw from quaternion (Y-axis rotation)
      const siny_cosp = 2 * (q.w * q.y + q.z * q.x);
      const cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z);
      return Math.atan2(siny_cosp, cosy_cosp);
    }
    return this.group.rotation.y;
  }
}
