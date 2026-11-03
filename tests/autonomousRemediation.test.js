/**
 * autonomousRemediation.test.js
 * Comprehensive Vitest regression and integration test suite verifying the
 * Complete Autonomous System Remediation and Implementation:
 * - Autonomous gameplay state machine & continuous gameplay cycles
 * - Ball possession lifecycle (available, approached, collecting, possessed, in-flight, scored, resting)
 * - Prevention of duplicate collection, ghost possession, or immediate re-capture
 * - Physical scoring detection (downward penetration through rim cylinder vs invalid crossings)
 * - Precision heading alignment & differential drive PID stabilization
 * - Shooting trajectory calculations & genuine adaptive outcome feedback
 * - System stability and error containment across repeated cycles.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { AUTONOMOUS_STATES, GAMEPLAY_MODES, AUTONOMOUS_CONFIG } from '../src/autonomy/AutonomousConfig.js';
import { AutonomousStateMachine } from '../src/autonomy/AutonomousStateMachine.js';
import { AutonomousDecisionEngine } from '../src/autonomy/AutonomousDecisionEngine.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';
import { IntakeMechanism } from '../src/robot/IntakeMechanism.js';
import { ShootingMechanism } from '../src/robot/ShootingMechanism.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';
import { AdaptiveShotCorrector } from '../src/robot/AdaptiveShotCorrector.js';
import { TrajectoryCalculator } from '../src/robot/TrajectoryCalculator.js';
import { DifferentialDriveController } from '../src/robot/DifferentialDriveController.js';

describe('SMART-BASKETBOT Complete Autonomous System Remediation Suite', () => {

  // =========================================================================
  // 1. BALL POSSESSION LIFECYCLE & RECOLLECTION GATING (PROBLEM B)
  // =========================================================================
  describe('Ball Possession Lifecycle & Gating', () => {
    let intake;
    let mockRobot;
    let mockBall1;
    let mockBall2;

    beforeEach(() => {
      intake = new IntakeMechanism();
      mockRobot = {
        getPosition: vi.fn(() => ({ x: 2.0, y: 0.14, z: 0.0 })),
        getHeading: vi.fn(() => 0.0), // Facing +X
        getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 }))
      };
      mockRobot.intake = intake;

      // Mock basketball 1 with full lifecycle interface
      mockBall1 = {
        id: 'ball_1',
        state: 'AVAILABLE',
        isPossessed: false,
        isAvailable: true,
        shotCooldownTimer: 0.0,
        pos: { x: 2.45, y: -0.08 + 0.14, z: 0.0 }, // Right at front intake rollers
        vel: { x: 0, y: 0, z: 0 },
        getPosition() { return { ...this.pos }; },
        getVelocity() { return { ...this.vel }; },
        getSpeed() { return Math.hypot(this.vel.x, this.vel.y, this.vel.z); },
        setState(s) {
          this.state = s;
          this.isPossessed = (s === 'POSSESSED');
          this.isAvailable = (s === 'AVAILABLE');
        },
        rigidBody: {
          setTranslation: vi.fn(),
          setLinvel: vi.fn(),
          setAngvel: vi.fn(),
          setGravityScale: vi.fn(),
          wakeUp: vi.fn()
        },
        collider: {
          isSensor: vi.fn(() => false),
          setSensor: vi.fn()
        },
        update(dt) {
          if (this.shotCooldownTimer > 0) {
            this.shotCooldownTimer = Math.max(0, this.shotCooldownTimer - dt);
          }
          if (this.state === 'IN_FLIGHT' || this.state === 'MISSED' || this.state === 'SCORED') {
            if (this.pos.y <= 0.20 && this.getSpeed() < 0.6 && this.shotCooldownTimer <= 0) {
              this.setState('AVAILABLE');
            }
          }
        }
      };

      mockBall2 = {
        id: 'ball_2',
        state: 'AVAILABLE',
        isPossessed: false,
        isAvailable: true,
        shotCooldownTimer: 0.0,
        pos: { x: 5.5, y: 0.12, z: 2.0 },
        vel: { x: 0, y: 0, z: 0 },
        getPosition() { return { ...this.pos }; },
        getVelocity() { return { ...this.vel }; },
        getSpeed() { return 0; },
        setState(s) {
          this.state = s;
          this.isPossessed = (s === 'POSSESSED');
          this.isAvailable = (s === 'AVAILABLE');
        },
        rigidBody: {
          setTranslation: vi.fn(),
          setLinvel: vi.fn(),
          setAngvel: vi.fn(),
          setGravityScale: vi.fn(),
          wakeUp: vi.fn()
        },
        collider: { isSensor: vi.fn(() => false), setSensor: vi.fn() },
        update: vi.fn()
      };
    });

    it('collects an available ball when intaking and locks it in containment cradle', () => {
      intake.startIntake();
      expect(intake.state).toBe('INTAKING');

      // Update intake with available ball right in capture zone
      intake.update(0.016, mockRobot, [mockBall1, mockBall2]);

      expect(intake.isBallCaptured).toBe(true);
      expect(intake.state).toBe('BALL_CAPTURED');
      expect(intake.capturedBall).toBe(mockBall1);
      expect(mockBall1.state).toBe('POSSESSED');
      expect(mockBall1.isPossessed).toBe(true);
      expect(mockBall1.isAvailable).toBe(false);
      expect(mockBall1.collider.setSensor).toHaveBeenCalledWith(true);
    });

    it('does NOT collect a ball that is in IN_FLIGHT state or in shot cooldown', () => {
      intake.startIntake();
      mockBall1.state = 'IN_FLIGHT';
      mockBall1.isAvailable = false;
      mockBall1.shotCooldownTimer = 1.5;

      intake.update(0.016, mockRobot, [mockBall1]);

      expect(intake.isBallCaptured).toBe(false);
      expect(intake.state).toBe('INTAKING');
      expect(mockBall1.state).toBe('IN_FLIGHT');
    });

    it('prevents duplicate possession or simultaneous ownership of multiple balls', () => {
      // First capture Ball 1
      intake.startIntake();
      intake.update(0.016, mockRobot, [mockBall1]);
      expect(intake.capturedBall).toBe(mockBall1);

      // Place Ball 2 into front zone while Ball 1 is already captured
      mockBall2.pos = { x: 2.45, y: -0.08 + 0.14, z: 0.0 };
      intake.update(0.016, mockRobot, [mockBall1, mockBall2]);

      // Possession must remain strictly Ball 1, Ball 2 is not captured
      expect(intake.capturedBall).toBe(mockBall1);
      expect(mockBall2.isPossessed).toBe(false);
    });

    it('releases ball upon shot launch, applies IN_FLIGHT, and prevents immediate re-capture', () => {
      const shooter = new ShootingMechanism();
      intake.startIntake();
      intake.update(0.016, mockRobot, [mockBall1]);
      expect(intake.isBallCaptured).toBe(true);

      const fired = shooter.fire(mockRobot, mockBall1);
      expect(fired).toBe(true);

      // Ball must now be released and marked IN_FLIGHT
      expect(intake.isBallCaptured).toBe(false);
      expect(intake.capturedBall).toBeNull();
      expect(mockBall1.state).toBe('IN_FLIGHT');
      expect(mockBall1.isPossessed).toBe(false);
      expect(mockBall1.isAvailable).toBe(false);
      expect(mockBall1.shotCooldownTimer).toBeGreaterThan(0.5);

      // Immediately run intake update with the ball still near muzzle
      intake.startIntake();
      intake.update(0.016, mockRobot, [mockBall1]);
      // Must NOT re-capture immediately!
      expect(intake.isBallCaptured).toBe(false);
    });

    it('re-enables ball collection when the ball lands, decelerates, and settles on court', () => {
      mockBall1.state = 'IN_FLIGHT';
      mockBall1.isAvailable = false;
      mockBall1.shotCooldownTimer = 1.0;

      // Ball flying high and fast
      mockBall1.pos.y = 2.5;
      mockBall1.vel = { x: 5.0, y: 2.0, z: 0.0 };
      mockBall1.update(0.5);
      expect(mockBall1.state).toBe('IN_FLIGHT');

      // Cooldown elapses, ball hits floor and settles
      mockBall1.update(0.6); // shotCooldownTimer <= 0
      mockBall1.pos.y = 0.12; // on court floor
      mockBall1.vel = { x: 0.05, y: 0.0, z: 0.0 }; // resting
      mockBall1.update(0.016);

      expect(mockBall1.state).toBe('AVAILABLE');
      expect(mockBall1.isAvailable).toBe(true);

      // Now intaking should successfully collect the settled ball!
      intake.startIntake();
      mockBall1.pos = { x: 2.45, y: 0.06, z: 0.0 };
      intake.update(0.016, mockRobot, [mockBall1]);
      expect(intake.isBallCaptured).toBe(true);
      expect(mockBall1.state).toBe('POSSESSED');
    });
  });

  // =========================================================================
  // 2. PHYSICAL BASKETBALL SCORING SYSTEM (PROBLEM C)
  // =========================================================================
  describe('Physical Basketball Scoring & Directional Detection', () => {
    let hoopDetector;
    const rimX = 12.425;
    const rimY = 3.05;
    const rimZ = 0.0;

    beforeEach(() => {
      hoopDetector = new HoopDetector({ rimX, rimY, rimZ });
    });

    it('counts basket ONLY when ball crosses downward within inner rim cylinder', () => {
      hoopDetector.notifyShotFired({ id: 101, distance: 4.2 });

      // 1. Ball arcs high above the rim
      hoopDetector.update({ x: 10.0, y: 3.8, z: 0.0 }, { x: 4.0, y: 1.0, z: 0.0 }, 0.1);
      expect(hoopDetector.activeShot.passedAboveRim).toBe(true);

      // 2. Ball crosses downward through Y = rimY plane inside inner rim radius
      // Previous Y was 3.10, current Y is 3.02, vel.y is negative
      hoopDetector.update({ x: rimX + 0.04, y: rimY + 0.05, z: rimZ }, { x: 1.0, y: -3.0, z: 0.0 }, 0.02);
      hoopDetector.update({ x: rimX + 0.04, y: rimY - 0.05, z: rimZ }, { x: 1.0, y: -3.0, z: 0.0 }, 0.02);
      expect(hoopDetector.activeShot.enteredRimPlane).toBe(true);

      // 3. Ball exits below net (Y < rimY - 0.20)
      const result = hoopDetector.update({ x: rimX + 0.02, y: rimY - 0.35, z: rimZ }, { x: 0.5, y: -2.5, z: 0.0 }, 0.05);

      expect(result).toBe('SCORED');
      expect(hoopDetector.stats.successfulBaskets).toBe(1);
      expect(hoopDetector.stats.accuracyPercent).toBe(100.0);
    });

    it('does NOT count a basket when ball crosses upward through the rim from below', () => {
      hoopDetector.notifyShotFired({ id: 102 });

      // Ball starts underneath rim and bounces upwards
      hoopDetector.update({ x: rimX, y: 2.8, z: 0.0 }, { x: 0, y: 3.5, z: 0.0 }, 0.05);
      hoopDetector.update({ x: rimX, y: 3.15, z: 0.0 }, { x: 0, y: 3.0, z: 0.0 }, 0.05);

      // enteredRimPlane must remain false
      expect(hoopDetector.activeShot.enteredRimPlane).toBe(false);
      expect(hoopDetector.stats.successfulBaskets).toBe(0);
    });

    it('classifies miss when ball falls short, long, or outside inner cylinder', () => {
      hoopDetector.notifyShotFired({ id: 103 });

      // Ball flies above rim, then drops outside front rim (X = 12.0 instead of 12.425)
      hoopDetector.update({ x: 10.5, y: 3.6, z: 0.0 }, { x: 2.0, y: 0.5, z: 0.0 }, 0.1);
      hoopDetector.update({ x: 12.0, y: 3.10, z: 0.0 }, { x: 2.0, y: -2.5, z: 0.0 }, 0.05);
      hoopDetector.update({ x: 12.0, y: 2.90, z: 0.0 }, { x: 2.0, y: -3.0, z: 0.0 }, 0.05);

      // Did not enter inner cylinder (horizDist = 0.425m > rimRadius)
      expect(hoopDetector.activeShot.enteredRimPlane).toBe(false);

      // Ball hits the floor
      const result = hoopDetector.update({ x: 12.0, y: 0.12, z: 0.0 }, { x: 0.5, y: -1.0, z: 0.0 }, 0.1);
      expect(result).toBe('MISSED');
      expect(hoopDetector.stats.lastDetailedResult).toBe('MISSED_SHORT');
      expect(hoopDetector.stats.successfulBaskets).toBe(0);
      expect(hoopDetector.stats.missedShots).toBe(1);
    });

    it('prevents duplicate basket registrations for a single shot', () => {
      hoopDetector.notifyShotFired({ id: 104 });
      hoopDetector.update({ x: rimX, y: 3.5, z: 0.0 }, { x: 0, y: 0, z: 0 }, 0.05);
      hoopDetector.update({ x: rimX, y: 3.08, z: 0.0 }, { x: 0, y: -2, z: 0 }, 0.02);
      hoopDetector.update({ x: rimX, y: 2.95, z: 0.0 }, { x: 0, y: -2, z: 0 }, 0.02);
      const res1 = hoopDetector.update({ x: rimX, y: 2.70, z: 0.0 }, { x: 0, y: -2, z: 0 }, 0.05);
      expect(res1).toBe('SCORED');
      expect(hoopDetector.stats.successfulBaskets).toBe(1);

      // Extra frames while ball bounces on floor must NOT re-increment
      const res2 = hoopDetector.update({ x: rimX, y: 0.12, z: 0.0 }, { x: 0, y: 0, z: 0 }, 0.1);
      expect(res2).toBe('IDLE');
      expect(hoopDetector.stats.successfulBaskets).toBe(1);
      expect(hoopDetector.stats.totalAttempts).toBe(1);
    });
  });

  // =========================================================================
  // 3. HEADING ALIGNMENT & DIFFERENTIAL DRIVE PID STABILIZATION (PROBLEM A)
  // =========================================================================
  describe('Differential Drive Heading Control & PID Stability', () => {
    let driveController;

    beforeEach(() => {
      driveController = new DifferentialDriveController({
        wheelRadius: 0.10,
        trackWidth: 0.64,
        maxLinearVelocity: 2.2,
        maxAngularVelocity: 3.2
      });
    });

    it('resets heading PID upon stop() to eliminate integral windup across transitions', () => {
      driveController.setTargetHeading(0.5, 0.0);
      // Simulate multiple frames accumulating error and integral
      driveController.update(0.016, 0.0);
      driveController.update(0.016, 0.0);
      driveController.update(0.016, 0.0);
      expect(driveController.headingPID.integral).toBeGreaterThan(0);

      // Calling stop() must reset the PID memory
      driveController.stop();
      expect(driveController.mode).toBe('STOPPED');
      expect(driveController.headingPID.integral).toBe(0);
      expect(driveController.headingPID.hasRun).toBe(false);
    });

    it('resets derivative state when switching to a new target heading to prevent derivative kicks', () => {
      driveController.setTargetHeading(0.2, 0.0);
      driveController.update(0.016, 0.15); // PID runs and hasRun = true
      expect(driveController.headingPID.hasRun).toBe(true);

      // Now change setpoint significantly
      driveController.setTargetHeading(1.2, 0.0);
      expect(driveController.headingPID.hasRun).toBe(false);

      // The first update on the new setpoint must NOT generate an explosive derivative spike
      const cmd = driveController.update(0.016, 0.15);
      expect(Math.abs(cmd.worldAngvelY)).toBeLessThanOrEqual(driveController.maxAngularVelocity);
      expect(driveController.headingPID.lastDTerm).toBe(0);
    });

    it('converges smoothly to target heading within tolerance without wild oscillation', () => {
      driveController.setTargetHeading(0.0, 0.0);
      let currentHeading = 0.35; // ~20 degrees off

      for (let step = 0; step < 80; step++) {
        const cmd = driveController.update(0.016, currentHeading);
        // Integrate simulated yaw
        currentHeading += cmd.worldAngvelY * 0.016;
      }

      // Must be tightly converged near 0.0 rad
      expect(Math.abs(currentHeading)).toBeLessThan(0.035);
    });
  });

  // =========================================================================
  // 4. CONTINUOUS AND TARGET AUTONOMOUS GAMEPLAY CYCLES (PROBLEM D)
  // =========================================================================
  describe('Complete Autonomous Gameplay Engine & State Cycles', () => {
    let mockRobot;
    let mockHoopDetector;
    let mockVisionManager;
    let controller;
    let ballEntity;

    beforeEach(() => {
      ballEntity = {
        id: 'ball_gameplay',
        state: 'AVAILABLE',
        isPossessed: false,
        isAvailable: true,
        shotCooldownTimer: 0,
        pos: { x: 4.0, y: 0.12, z: 0.0 },
        vel: { x: 0, y: 0, z: 0 },
        getPosition() { return { ...this.pos }; },
        getVelocity() { return { ...this.vel }; },
        getSpeed() { return 0; },
        setState(s) {
          this.state = s;
          this.isPossessed = (s === 'POSSESSED');
          this.isAvailable = (s === 'AVAILABLE');
        },
        collider: { setSensor: vi.fn(), isSensor: vi.fn(() => false) },
        rigidBody: { setTranslation: vi.fn(), setLinvel: vi.fn(), setAngvel: vi.fn(), setGravityScale: vi.fn(), wakeUp: vi.fn() },
        update: vi.fn()
      };

      const driveCtrl = new DifferentialDriveController({ wheelRadius: 0.1, trackWidth: 0.64 });

      mockRobot = {
        getPosition: vi.fn(() => ({ x: 2.0, y: 0.14, z: 0.0 })),
        getHeading: vi.fn(() => 0.0),
        getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        getAngularVelocity: vi.fn(() => ({ y: 0.0 })),
        setControlMode: vi.fn(),
        driveController: driveCtrl,
        inputController: { resetKeys: vi.fn() },
        navController: {
          state: 'IDLE',
          navigateTo: vi.fn(() => true),
          cancel: vi.fn(),
          reset: vi.fn()
        },
        intake: new IntakeMechanism(),
        shooter: new ShootingMechanism(),
        trajectoryCalculator: new TrajectoryCalculator(),
        adaptiveCorrector: new AdaptiveShotCorrector(),
        startAutonomousNavigation: vi.fn((x, z) => {
          mockRobot.navController.state = 'NAVIGATING';
          return true;
        }),
        startIntake: vi.fn(function() { this.intake.startIntake(); }),
        stopIntake: vi.fn(function() { this.intake.stopIntake(); }),
        fireShot: vi.fn(function(ball, detector, target) {
          this.intake.releaseBall(ball);
          ball.setState('IN_FLIGHT');
          return true;
        })
      };

      mockHoopDetector = new HoopDetector({ rimX: 12.425, rimY: 3.05, rimZ: 0.0 });

      mockVisionManager = {
        getTrackedBasketballs: vi.fn(() => [{
          id: 'ball_gameplay',
          confidence: 0.85,
          distance: 2.0,
          azimuthDeg: 0.0,
          worldPosition: { x: 4.0, y: 0.12, z: 0.0 },
          reference: ballEntity,
          isVisible: true
        }]),
        getSelectedBasketball: vi.fn(() => ({
          id: 'ball_gameplay',
          confidence: 0.85,
          worldPosition: { x: 4.0, y: 0.12, z: 0.0 }
        })),
        getHoopObservation: vi.fn(() => ({
          visible: true,
          confidence: 0.90,
          distance: 5.5,
          targetRimPosition: { x: 12.425, y: 3.05, z: 0.0 }
        }))
      };

      controller = new AutonomousGameplayController({
        robot: mockRobot,
        visionManager: mockVisionManager,
        hoopDetector: mockHoopDetector,
        basketball: ballEntity
      });
    });

    it('advances from SEARCHING_FOR_BALL to SELECTING_TARGET upon visual detection', () => {
      controller.startContinuousMode();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);

      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
      expect(controller.currentTarget).not.toBeNull();
      expect(controller.currentTarget.id).toBe('ball_gameplay');
    });

    it('progresses to NAVIGATING_TO_BALL and approaches target coordinates', () => {
      controller.startContinuousMode();
      controller.update(0.016); // -> SELECTING_TARGET
      controller.update(0.016); // -> NAVIGATING_TO_BALL

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      expect(mockRobot.startAutonomousNavigation).toHaveBeenCalled();
    });

    it('engages front intake and captures ball upon arriving within capture distance', () => {
      controller.startContinuousMode();
      controller.update(0.016); // -> SELECTING_TARGET
      controller.update(0.016); // -> NAVIGATING_TO_BALL

      // Simulate robot arriving within ball capture distance (0.50m)
      mockRobot.getPosition = vi.fn(() => ({ x: 3.55, y: 0.14, z: 0.0 })); // Ball is at 4.0
      controller.update(0.016);

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COLLECTING_BALL);
      expect(mockRobot.intake.state).toBe('INTAKING');

      // Now intake captures the ball
      mockRobot.intake.captureBall(ballEntity, mockRobot);
      controller.update(0.016);

      // Verifies possession and transitions to hoop search
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_HOOP);
    });

    it('navigates to shooting position, aligns with basket, optimizes trajectory, and fires', () => {
      // Start with ball already captured
      mockRobot.intake.captureBall(ballEntity, mockRobot);
      controller.startContinuousMode();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_HOOP);

      // Hoop observation available
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION);

      // Simulate arrival at shooting key
      mockRobot.getPosition = vi.fn(() => ({ x: 8.2, y: 0.14, z: 0.0 }));
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.ALIGNING_WITH_HOOP);

      // Align robot heading with hoop (+X)
      mockRobot.getHeading = vi.fn(() => 0.0);
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY);

      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS);

      // Spin up ready
      mockRobot.shooter.state = 'READY';
      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SHOOTING);

      controller.update(0.016);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.EVALUATING_SHOT);
      expect(controller.statistics.totalAttempts).toBe(1);
    });

    it('completes session when target shots are scored in Fixed-Target mode', () => {
      controller.startFixedTargetMode(1);
      controller.statistics.totalAttempts = 1;
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);

      // Register score in hoop detector
      mockHoopDetector.stats.lastShotResult = 'SCORED';
      controller.update(0.016);

      expect(controller.statistics.successfulShots).toBe(1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COMPLETED);
      expect(controller.stateMachine.isTerminal()).toBe(true);
    });

    it('repeats gameplay cycle automatically in Continuous mode', () => {
      controller.startContinuousMode();
      controller.statistics.totalAttempts = 1;
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);

      // Score registered in continuous mode
      mockHoopDetector.stats.lastShotResult = 'SCORED';
      controller.update(0.016);

      // In continuous mode, transitions to REACQUIRING_BALL to continue
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.REACQUIRING_BALL);

      // Advance past reacquire cooldown (1.0s) until leaving REACQUIRING_BALL
      while (controller.stateMachine.getState() === AUTONOMOUS_STATES.REACQUIRING_BALL) {
        controller.update(0.016);
      }

      // Re-enters SEARCHING_FOR_BALL or advances automatically into next cycle (SELECTING_TARGET / NAVIGATING_TO_BALL)
      expect([
        AUTONOMOUS_STATES.SEARCHING_FOR_BALL,
        AUTONOMOUS_STATES.SELECTING_TARGET,
        AUTONOMOUS_STATES.NAVIGATING_TO_BALL
      ]).toContain(controller.stateMachine.getState());
    });

    it('isolates category retries so alignment timeouts do not exhaust collection retries', () => {
      // Trigger alignment timeout recovery
      controller.triggerRecovery('ALIGNMENT_TIMEOUT', 'Simulated alignment test');
      expect(controller.retries.alignment).toBe(1);
      expect(controller.retries.collection).toBe(0);
      expect(controller.retries.navigation).toBe(0);

      // Trigger navigation block recovery
      controller.triggerRecovery('NAV_BLOCKED', 'Simulated nav block');
      expect(controller.retries.navigation).toBe(1);
      expect(controller.retries.collection).toBe(0);
      expect(controller.retries.alignment).toBe(1);
    });
  });
});
