/**
 * PhysicsWorld.js
 * Manages the Rapier 3D physics engine instance, fixed-timestep stepping,
 * collision registration, rigid body creation, and Three.js synchronization.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { SIMULATION_CONFIG } from './SimulationConfig.js';

export class PhysicsWorld {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.isInitialized = false;
    this.fixedTimeStep = SIMULATION_CONFIG.physics.timeStep;
    this.accumulator = 0;
    this.maxSubSteps = SIMULATION_CONFIG.physics.maxSubSteps;
    this.simulatedTime = 0;
    this.stepCount = 0;

    // Pairs of { mesh, rigidBody, syncRotation: true }
    this.syncBindings = [];
  }

  /**
   * Initializes the Rapier WebAssembly core and creates the 3D physics world.
   */
  async initialize() {
    if (this.isInitialized) return;

    await RAPIER.init();
    const g = SIMULATION_CONFIG.physics.gravity;
    const gravity = new RAPIER.Vector3(g.x, g.y, g.z);
    this.world = new RAPIER.World(gravity);
    this.isInitialized = true;
    console.log(`[PhysicsWorld] Initialized Rapier 3D (v${RAPIER.version()}) with gravity [${g.x}, ${g.y}, ${g.z}]`);
  }

  /**
   * Registers a Three.js mesh with a Rapier rigid body for automated transform synchronization.
   * @param {THREE.Object3D} mesh
   * @param {RAPIER.RigidBody} rigidBody
   * @param {boolean} syncRotation
   */
  bindMeshToBody(mesh, rigidBody, syncRotation = true) {
    const binding = { mesh, rigidBody, syncRotation };
    this.syncBindings.push(binding);
    return binding;
  }

  /**
   * Unbinds a mesh from sync updates.
   */
  unbindMesh(mesh) {
    this.syncBindings = this.syncBindings.filter(b => b.mesh !== mesh);
  }

  /**
   * Creates a static ground or obstacle collider.
   * Note: Rapier cuboid takes half-extents.
   */
  createStaticBox(x, y, z, width, height, depth, restitution = 0.7, friction = 0.6) {
    if (!this.world) throw new Error('PhysicsWorld not initialized');

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setRestitution(restitution)
      .setFriction(friction);

    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /**
   * Creates a dynamic spherical body (e.g. basketball).
   */
  createDynamicSphere(x, y, z, radius, mass, restitution = 0.82, friction = 0.65, linearDamping = 0.08, angularDamping = 0.1) {
    if (!this.world) throw new Error('PhysicsWorld not initialized');

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping)
      .setCcdEnabled(SIMULATION_CONFIG.physics.enableCcd);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.ball(radius)
      .setMass(mass)
      .setRestitution(restitution)
      .setFriction(friction)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max);

    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /**
   * Creates a dynamic box rigid body (e.g. robot chassis).
   */
  createDynamicBox(x, y, z, width, height, depth, mass, restitution = 0.1, friction = 0.8, linearDamping = 0.2, angularDamping = 0.3) {
    if (!this.world) throw new Error('PhysicsWorld not initialized');

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setLinearDamping(linearDamping)
      .setAngularDamping(angularDamping);

    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, height / 2, depth / 2)
      .setMass(mass)
      .setRestitution(restitution)
      .setFriction(friction);

    const collider = this.world.createCollider(colliderDesc, body);
    return { body, collider };
  }

  /**
   * Resets a rigid body's position, rotation and cancels all velocities.
   */
  resetBody(rigidBody, position, rotation = { x: 0, y: 0, z: 0, w: 1 }) {
    if (!rigidBody) return;
    rigidBody.setTranslation(position, true);
    rigidBody.setRotation(rotation, true);
    rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    rigidBody.wakeUp();
  }

  /**
   * Advances physics simulation by a given delta time using fixed-substep accumulation.
   * @param {number} deltaSeconds Elapsed wall clock time in seconds
   */
  step(deltaSeconds) {
    if (!this.isInitialized || !this.world) return;

    // Guard against huge delta times from tab switching
    const clampedDelta = Math.min(deltaSeconds, 0.1);
    this.accumulator += clampedDelta;

    let subSteps = 0;
    while (this.accumulator >= this.fixedTimeStep && subSteps < this.maxSubSteps) {
      this.world.step();
      this.accumulator -= this.fixedTimeStep;
      this.simulatedTime += this.fixedTimeStep;
      this.stepCount++;
      subSteps++;
    }

    // Synchronize Three.js visual objects with Rapier physics transforms
    this.synchronizeTransforms();
  }

  /**
   * Copies rigid body positions & orientations to bound Three.js meshes.
   */
  synchronizeTransforms() {
    for (let i = 0; i < this.syncBindings.length; i++) {
      const { mesh, rigidBody, syncRotation } = this.syncBindings[i];
      if (!mesh || !rigidBody) continue;

      const t = rigidBody.translation();
      mesh.position.set(t.x, t.y, t.z);

      if (syncRotation) {
        const r = rigidBody.rotation();
        mesh.quaternion.set(r.x, r.y, r.z, r.w);
      }
    }
  }

  /**
   * Telemetry summary of the physics simulation.
   */
  getTelemetry() {
    if (!this.world) {
      return { activeBodies: 0, activeColliders: 0, stepCount: 0, simTime: 0 };
    }
    return {
      activeBodies: this.world.bodies.len(),
      activeColliders: this.world.colliders.len(),
      stepCount: this.stepCount,
      simTime: this.simulatedTime
    };
  }

  /**
   * Cleans up resources.
   */
  destroy() {
    this.syncBindings = [];
    if (this.world) {
      this.world.free();
      this.world = null;
    }
    this.isInitialized = false;
  }
}
