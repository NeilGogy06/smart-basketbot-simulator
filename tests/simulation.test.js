import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SIMULATION_CONFIG } from '../src/simulation/SimulationConfig.js';
import { PhysicsWorld } from '../src/simulation/PhysicsWorld.js';

describe('SIMULATION_CONFIG Verification', () => {
  it('defines regulation FIBA court dimensions', () => {
    expect(SIMULATION_CONFIG.court.length).toBe(28.0);
    expect(SIMULATION_CONFIG.court.width).toBe(15.0);
    expect(SIMULATION_CONFIG.court.centerCircleRadius).toBe(1.8);
    expect(SIMULATION_CONFIG.court.threePointRadius).toBe(6.75);
  });

  it('defines regulation basketball hoop specifications', () => {
    expect(SIMULATION_CONFIG.hoop.rimHeight).toBe(3.05); // Regulation 10ft
    expect(SIMULATION_CONFIG.hoop.rimRadius).toBe(0.225); // 0.45m diameter
    expect(SIMULATION_CONFIG.hoop.backboardWidth).toBe(1.8);
    expect(SIMULATION_CONFIG.hoop.backboardHeight).toBe(1.05);
  });

  it('defines realistic basketball physical properties', () => {
    expect(SIMULATION_CONFIG.ball.radius).toBe(0.12);
    expect(SIMULATION_CONFIG.ball.mass).toBe(0.62);
    expect(SIMULATION_CONFIG.ball.restitution).toBeGreaterThan(0.7);
  });

  it('configures stable physics world parameters', () => {
    expect(SIMULATION_CONFIG.physics.gravity.y).toBe(-9.81);
    expect(SIMULATION_CONFIG.physics.timeStep).toBe(1 / 60);
    expect(SIMULATION_CONFIG.physics.enableCcd).toBe(true);
  });
});

describe('PhysicsWorld Integration', () => {
  let physicsWorld;

  beforeEach(async () => {
    physicsWorld = new PhysicsWorld();
    await physicsWorld.initialize();
  });

  afterEach(() => {
    if (physicsWorld) {
      physicsWorld.destroy();
    }
  });

  it('initializes Rapier 3D world successfully', () => {
    expect(physicsWorld.isInitialized).toBe(true);
    expect(physicsWorld.world).not.toBeNull();
  });

  it('creates static colliders and dynamic bodies correctly', () => {
    const floor = physicsWorld.createStaticBox(0, -0.25, 0, 30, 0.5, 20, 0.75, 0.6);
    expect(floor.body).toBeDefined();
    expect(floor.collider).toBeDefined();

    const ball = physicsWorld.createDynamicSphere(0, 3.0, 0, 0.12, 0.62, 0.8, 0.6);
    expect(ball.body).toBeDefined();
    expect(ball.collider).toBeDefined();

    const telemetry = physicsWorld.getTelemetry();
    expect(telemetry.activeBodies).toBe(2);
    expect(telemetry.activeColliders).toBe(2);
  });

  it('applies gravity correctly and updates translations over time', () => {
    // Drop sphere from Y = 4.0m
    const initialY = 4.0;
    const ball = physicsWorld.createDynamicSphere(0, initialY, 0, 0.12, 0.62, 0.8, 0.6);

    // Step physics for 0.25 seconds
    physicsWorld.step(0.25);

    const pos = ball.body.translation();
    // After 0.25s under 9.81 m/s² gravity, ball should have fallen downwards
    expect(pos.y).toBeLessThan(initialY);
    expect(physicsWorld.stepCount).toBeGreaterThan(0);
    expect(physicsWorld.simulatedTime).toBeGreaterThan(0);
  });

  it('synchronizes Three.js mesh transforms with Rapier rigid bodies', () => {
    const mockMesh = {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      quaternion: { x: 0, y: 0, z: 0, w: 1, set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } }
    };

    const ball = physicsWorld.createDynamicSphere(2.5, 3.5, -1.0, 0.12, 0.62);
    physicsWorld.bindMeshToBody(mockMesh, ball.body, true);

    // Initial sync
    physicsWorld.synchronizeTransforms();
    expect(mockMesh.position.x).toBeCloseTo(2.5, 4);
    expect(mockMesh.position.y).toBeCloseTo(3.5, 4);
    expect(mockMesh.position.z).toBeCloseTo(-1.0, 4);

    // Step physics
    physicsWorld.step(0.2);
    expect(mockMesh.position.y).toBeLessThan(3.5);
  });

  it('resets rigid bodies to desired positions and zeroes velocities', () => {
    const ball = physicsWorld.createDynamicSphere(0, 5.0, 0, 0.12, 0.62);
    physicsWorld.step(0.5);

    // Check it acquired downward velocity
    const linvelBefore = ball.body.linvel();
    expect(linvelBefore.y).toBeLessThan(0);

    // Reset body
    physicsWorld.resetBody(ball.body, { x: 1.0, y: 2.0, z: 3.0 });

    const posAfter = ball.body.translation();
    const linvelAfter = ball.body.linvel();

    expect(posAfter.x).toBeCloseTo(1.0, 4);
    expect(posAfter.y).toBeCloseTo(2.0, 4);
    expect(posAfter.z).toBeCloseTo(3.0, 4);
    expect(linvelAfter.x).toBe(0);
    expect(linvelAfter.y).toBe(0);
    expect(linvelAfter.z).toBe(0);
  });
});
