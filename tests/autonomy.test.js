/**
 * autonomy.test.js
 * Comprehensive Vitest suite for SMART-BASKETBOT Milestone 7:
 * Complete Autonomous Basketball Intelligence.
 *
 * Verifies:
 * 1. State machine transitions and lifecycle.
 * 2. Decision engine target selection and vision-driven ball selection.
 * 3. Continuous gameplay progression.
 * 4. Fixed successful-shot target completion.
 * 5. Missed-shot handling and adaptive bias recording.
 * 6. Successful-shot counting and accuracy tracking.
 * 7. Pause and resume behavior.
 * 8. Manual stop and actuator halting.
 * 9. Lost-ball recovery.
 * 10. Failed collection recovery.
 * 11. Navigation failure recovery.
 * 12. Hoop visibility and alignment handling.
 * 13. Shooting rejection handling.
 * 14. Retry limits and recovery safety ceilings.
 * 15. Reset behavior.
 * 16. Prevention of conflicting movement controllers.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as THREE from 'three';
import { AUTONOMOUS_STATES, GAMEPLAY_MODES, AUTONOMOUS_CONFIG } from '../src/autonomy/AutonomousConfig.js';
import { AutonomousStateMachine } from '../src/autonomy/AutonomousStateMachine.js';
import { AutonomousDecisionEngine } from '../src/autonomy/AutonomousDecisionEngine.js';
import { AutonomousGameplayController } from '../src/autonomy/AutonomousGameplayController.js';

describe('Milestone 7: Complete Autonomous Basketball Intelligence', () => {

  // =========================================================================
  // 1. STATE MACHINE TRANSITIONS & LIFECYCLE
  // =========================================================================
  describe('AutonomousStateMachine', () => {
    let sm;

    beforeEach(() => {
      sm = new AutonomousStateMachine();
    });

    it('initializes in IDLE state with zero timer and ready message', () => {
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.IDLE);
      expect(sm.getTimeInState()).toBe(0);
      expect(sm.isActive).toBe(false);
      expect(sm.isTerminal()).toBe(false);
      expect(sm.isPaused()).toBe(false);
    });

    it('transitions between valid states and updates timers and history', () => {
      const stateTransitions = [];
      sm.onStateChange((from, to, reason) => {
        stateTransitions.push({ from, to, reason });
      });

      sm.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_BALL, 'Starting visual scan');
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
      expect(sm.isActive).toBe(true);

      sm.update(1.5);
      expect(sm.getTimeInState()).toBeCloseTo(1.5, 2);

      sm.transitionTo(AUTONOMOUS_STATES.SELECTING_TARGET, 'Target candidate locked');
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
      expect(sm.previousState).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
      expect(sm.getTimeInState()).toBe(0.0);

      expect(stateTransitions).toHaveLength(2);
      expect(stateTransitions[0].to).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
      expect(stateTransitions[1].to).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
    });

    it('handles pause and resume, restoring the previously active state', () => {
      sm.transitionTo(AUTONOMOUS_STATES.NAVIGATING_TO_BALL, 'Driving to approach point');
      expect(sm.isActive).toBe(true);

      // Pause
      const paused = sm.pause('Operator paused session');
      expect(paused).toBe(true);
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.PAUSED);
      expect(sm.isPaused()).toBe(true);
      expect(sm.isActive).toBe(false);

      // Resume
      const resumed = sm.resume();
      expect(resumed).toBe(true);
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      expect(sm.isPaused()).toBe(false);
      expect(sm.isActive).toBe(true);
    });

    it('recognizes terminal states: COMPLETED, FAILED, and CANCELLED', () => {
      sm.complete('Goal achieved');
      expect(sm.isTerminal()).toBe(true);
      expect(sm.isActive).toBe(false);
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.COMPLETED);

      sm.fail('Fatal error');
      expect(sm.isTerminal()).toBe(true);
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.FAILED);

      sm.cancel('User aborted');
      expect(sm.isTerminal()).toBe(true);
      expect(sm.getState()).toBe(AUTONOMOUS_STATES.CANCELLED);
    });

    it('reset returns state machine to IDLE with clean history', () => {
      sm.transitionTo(AUTONOMOUS_STATES.COLLECTING_BALL);
      sm.update(2.0);
      sm.reset();

      expect(sm.getState()).toBe(AUTONOMOUS_STATES.IDLE);
      expect(sm.previousState).toBeNull();
      expect(sm.getTimeInState()).toBe(0);
      expect(sm.getTelemetry().historyCount).toBe(0);
    });
  });

  // =========================================================================
  // 2. DECISION ENGINE & TARGET SELECTION
  // =========================================================================
  describe('AutonomousDecisionEngine', () => {
    let engine;

    beforeEach(() => {
      engine = new AutonomousDecisionEngine();
    });

    function createMockRobot(x = 0, z = 0, heading = 0) {
      return {
        getPosition: () => ({ x, y: 0.1, z }),
        getHeading: () => heading,
        intake: {
          isBallCaptured: false,
          opticalSensorActive: false,
          ballState: 'FIELD',
          state: 'IDLE'
        },
        shooter: {
          state: 'IDLE',
          flywheelRpm: 0
        },
        driveController: {
          mode: 'STANDBY'
        }
      };
    }

    it('selects the best basketball candidate from vision observations based on multi-factor utility score', () => {
      const robot = createMockRobot(0, 0, 0); // At origin, facing +X

      const mockVisionManager = {
        getTrackedBasketballs: () => [
          // Candidate A: 8m away, 45 deg to the side
          {
            id: 'BALL_A',
            worldPosition: { x: 5.6, y: 0.24, z: 5.6 },
            distance: 8.0,
            confidence: 0.85,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          },
          // Candidate B: 3.5m away, directly in front (optimal)
          {
            id: 'BALL_B',
            worldPosition: { x: 3.5, y: 0.24, z: 0.0 },
            distance: 3.5,
            confidence: 0.92,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          },
          // Candidate C: 12m away
          {
            id: 'BALL_C',
            worldPosition: { x: 12.0, y: 0.24, z: -1.0 },
            distance: 12.0,
            confidence: 0.70,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          }
        ]
      };

      const selected = engine.selectBestBasketballTarget(mockVisionManager, robot);
      expect(selected).not.toBeNull();
      expect(selected.id).toBe('BALL_B');
      expect(selected.distance).toBe(3.5);
      // Approach waypoint should be offset ~0.45m in front of ball
      expect(selected.approachPosition.x).toBeCloseTo(3.5 - 0.45, 2);
      expect(selected.approachPosition.z).toBeCloseTo(0.0, 2);
    });

    it('rejects basketball tracks outside court boundaries or with low confidence', () => {
      const robot = createMockRobot(0, 0, 0);

      const mockVisionManager = {
        getTrackedBasketballs: () => [
          // Out of court bounds (X = 16m > 14.5m baseline)
          {
            id: 'BALL_OUT',
            worldPosition: { x: 16.0, y: 0.24, z: 0.0 },
            distance: 16.0,
            confidence: 0.9,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          },
          // Low confidence (< 0.35)
          {
            id: 'BALL_LOW_CONF',
            worldPosition: { x: 4.0, y: 0.24, z: 0.0 },
            distance: 4.0,
            confidence: 0.20,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          }
        ]
      };

      const selected = engine.selectBestBasketballTarget(mockVisionManager, robot);
      expect(selected).toBeNull();
    });

    it('calculates shooting position dynamically from vision hoop observations', () => {
      const robot = createMockRobot(0, 0, 0);

      // 1. Observed hoop
      const hoopObs = {
        visible: true,
        confidence: 0.88,
        targetRimPosition: { x: 12.425, y: 3.05, z: 0.0 }
      };

      const pos = engine.calculateShootingPosition(hoopObs, robot);
      // Standoff of 4.225m from rim at 12.425m places shooting spot at X = 8.2m
      expect(pos.x).toBeCloseTo(8.2, 1);
      expect(pos.z).toBeCloseTo(0.0, 1);
      expect(pos.hoopTarget.x).toBeCloseTo(12.425, 2);

      // 2. Fallback when hoop observation is invisible
      const posFallback = engine.calculateShootingPosition({ visible: false }, robot);
      expect(posFallback.x).toBe(8.2);
      expect(posFallback.z).toBe(0.0);
    });

    it('evaluates robot ball possession accurately', () => {
      const robot = createMockRobot();

      // No ball
      let pos = engine.evaluatePossession(robot);
      expect(pos.hasBall).toBe(false);
      expect(pos.opticalActive).toBe(false);

      // Ball captured
      robot.intake.isBallCaptured = true;
      robot.intake.opticalSensorActive = true;
      robot.intake.ballState = 'CAPTURED';

      pos = engine.evaluatePossession(robot);
      expect(pos.hasBall).toBe(true);
      expect(pos.opticalActive).toBe(true);
    });

    it('evaluates shooting interlocks correctly', () => {
      const robot = createMockRobot();
      const hoopObs = { visible: true };

      // Missing ball & unready shooter
      let check = engine.evaluateShootingInterlocks(robot, hoopObs);
      expect(check.isReady).toBe(false);
      expect(check.blockers.length).toBeGreaterThanOrEqual(2);

      // Set ready states
      robot.intake.isBallCaptured = true;
      robot.shooter.state = 'READY';

      check = engine.evaluateShootingInterlocks(robot, hoopObs);
      expect(check.isReady).toBe(true);
      expect(check.blockers).toHaveLength(0);

      // E-stop blocks shooting
      robot.driveController.mode = 'E_STOP';
      check = engine.evaluateShootingInterlocks(robot, hoopObs);
      expect(check.isReady).toBe(false);
      expect(check.blockers).toContain('Emergency stop is active');
    });

    it('evaluates recovery actions and halts before exceeding safety ceiling', () => {
      // Normal collection retry
      let rec = engine.evaluateRecoveryAction('COLLECTION_FAILED', { retries: 1, totalRecoveries: 2 });
      expect(rec.action).toBe('BACKUP_AND_REAPPROACH');
      expect(rec.nextState).toBe('RECOVERING');

      // Exceeded category retries -> search alternative ball
      rec = engine.evaluateRecoveryAction('COLLECTION_FAILED', { retries: 3, totalRecoveries: 4 });
      expect(rec.action).toBe('SEARCH_NEW_TARGET');
      expect(rec.nextState).toBe('SEARCHING_FOR_BALL');

      // Exceeded total session safety ceiling (>= 10)
      rec = engine.evaluateRecoveryAction('COLLECTION_FAILED', { retries: 1, totalRecoveries: 10 });
      expect(rec.action).toBe('ABORT_SESSION');
      expect(rec.nextState).toBe('FAILED');
    });

    it('evaluates mission completion for Fixed-Target and Continuous modes', () => {
      // Fixed target mode (goal: 5)
      let evalResult = engine.evaluateMissionCompletion(GAMEPLAY_MODES.FIXED_TARGET, 3, 5);
      expect(evalResult.isCompleted).toBe(false);
      expect(evalResult.remainingShots).toBe(2);

      evalResult = engine.evaluateMissionCompletion(GAMEPLAY_MODES.FIXED_TARGET, 5, 5);
      expect(evalResult.isCompleted).toBe(true);
      expect(evalResult.remainingShots).toBe(0);

      // Continuous mode never auto-completes
      evalResult = engine.evaluateMissionCompletion(GAMEPLAY_MODES.CONTINUOUS, 10, 0);
      expect(evalResult.isCompleted).toBe(false);
    });
  });

  // =========================================================================
  // 3. GAMEPLAY CONTROLLER INTEGRATION & MODES
  // =========================================================================
  describe('AutonomousGameplayController', () => {
    let controller;
    let mockRobot;
    let mockVisionManager;
    let mockHoopDetector;
    let mockBasketball;

    beforeEach(() => {
      mockRobot = {
        getPosition: vi.fn(() => ({ x: 0, y: 0.1, z: 0 })),
        getHeading: vi.fn(() => 0.0),
        controlMode: 'MANUAL',
        setControlMode: vi.fn((m) => { mockRobot.controlMode = m; }),
        startAutonomousNavigation: vi.fn(() => true),
        cancelAutonomousNavigation: vi.fn(),
        startIntake: vi.fn(),
        stopIntake: vi.fn(),
        startReject: vi.fn(),
        fireShot: vi.fn(() => true),
        driveController: {
          mode: 'STANDBY',
          stop: vi.fn(),
          setDriveVelocities: vi.fn(),
          setTargetHeading: vi.fn()
        },
        inputController: {
          resetKeys: vi.fn()
        },
        navController: {
          state: 'IDLE',
          cancel: vi.fn()
        },
        intake: {
          state: 'IDLE',
          isBallCaptured: false,
          opticalSensorActive: false,
          ballState: 'FIELD'
        },
        shooter: {
          state: 'IDLE',
          flywheelRpm: 0,
          spinUp: vi.fn(function() { this.state = 'READY'; }),
          cancel: vi.fn(),
          setLaunchAngle: vi.fn()
        },
        shootingController: {
          state: 'IDLE',
          cancel: vi.fn()
        },
        trajectoryCalculator: {
          optimizeTrajectory: vi.fn(() => ({
            valid: true,
            solution: {
              speed: 8.45,
              launchAngleDeg: 52.0,
              targetDistance: 4.225,
              flightTime: 1.15,
              apexHeight: 4.1,
              entryAngleDeg: 46.5
            }
          }))
        },
        adaptiveCorrector: {
          headingBias: 0.0,
          elevationBias: 0.0,
          velocityBias: 0.0,
          applyCorrection: vi.fn((sol) => ({
            speed: sol.speed,
            launchAngleDeg: sol.launchAngleDeg,
            targetHeadingRad: sol.requiredHeadingRad || 0,
            biases: { v: 0, e: 0, h: 0 }
          })),
          recordOutcome: vi.fn()
        }
      };

      mockVisionManager = {
        getTrackedBasketballs: vi.fn(() => [
          {
            id: 'BALL_1',
            worldPosition: { x: 4.0, y: 0.24, z: 0.0 },
            distance: 4.0,
            azimuthDeg: 0,
            confidence: 0.9,
            status: 'TRACKED',
            isVisible: true,
            timeSinceLastSeen: 0
          }
        ]),
        getSelectedBasketball: vi.fn(() => ({
          id: 'BALL_1',
          worldPosition: { x: 4.0, y: 0.24, z: 0.0 },
          distance: 4.0,
          azimuthDeg: 0,
          confidence: 0.9
        })),
        getHoopObservation: vi.fn(() => ({
          visible: true,
          confidence: 0.85,
          distance: 8.5,
          targetRimPosition: { x: 12.425, y: 3.05, z: 0.0 }
        }))
      };

      mockHoopDetector = {
        stats: {
          totalAttempts: 0,
          successfulBaskets: 0,
          missedShots: 0,
          lastShotResult: 'NONE',
          lastDetailedResult: 'NONE'
        },
        notifyShotFired: vi.fn(),
        lastShotDetails: null
      };

      mockBasketball = {
        getPosition: vi.fn(() => ({ x: 4.0, y: 0.24, z: 0.0 })),
        getVelocity: vi.fn(() => ({ x: 0, y: 0, z: 0 })),
        reset: vi.fn()
      };

      controller = new AutonomousGameplayController({
        robot: mockRobot,
        visionManager: mockVisionManager,
        hoopDetector: mockHoopDetector,
        basketball: mockBasketball
      });
    });

    it('starts continuous mode, yields manual control, and initiates visual ball search', () => {
      const started = controller.startContinuousMode();
      expect(started).toBe(true);
      expect(controller.mode).toBe(GAMEPLAY_MODES.CONTINUOUS);
      expect(mockRobot.setControlMode).toHaveBeenCalledWith('AUTONOMOUS');
      expect(mockRobot.inputController.resetKeys).toHaveBeenCalled();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);
    });

    it('starts fixed-target mode with specified target shots count', () => {
      const started = controller.startFixedTargetMode(5);
      expect(started).toBe(true);
      expect(controller.mode).toBe(GAMEPLAY_MODES.FIXED_TARGET);
      expect(controller.targetShots).toBe(5);
    });

    it('transitions smoothly through search, target selection, and navigation', () => {
      controller.startContinuousMode();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_BALL);

      // Update 1: Vision detects ball -> SELECTING_TARGET
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SELECTING_TARGET);
      expect(controller.currentTarget).not.toBeNull();
      expect(controller.currentTarget.id).toBe('BALL_1');

      // Update 2: Plans navigation -> NAVIGATING_TO_BALL
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      expect(mockRobot.startAutonomousNavigation).toHaveBeenCalled();
    });

    it('engages intake upon arrival at ball and transitions to collecting', () => {
      controller.startContinuousMode();
      controller.update(0.1); // SEARCHING -> SELECTING
      controller.update(0.1); // SELECTING -> NAVIGATING

      // Simulate robot reaching ball vicinity (dist <= 0.55m)
      mockRobot.getPosition.mockReturnValue({ x: 3.55, y: 0.1, z: 0.0 });
      controller.update(0.1);

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COLLECTING_BALL);
      expect(mockRobot.startIntake).toHaveBeenCalled();
    });

    it('confirms possession, stops drive, and transitions to hoop search', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.COLLECTING_BALL);

      // Simulate ball captured by intake mechanism
      mockRobot.intake.isBallCaptured = true;
      mockRobot.intake.ballState = 'CAPTURED';
      controller.update(0.1);

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SEARCHING_FOR_HOOP);
      expect(mockRobot.driveController.stop).toHaveBeenCalled();
      expect(mockRobot.stopIntake).toHaveBeenCalled();
    });

    it('navigates to shooting position, aligns, spins up flywheels, and shoots', () => {
      controller.startContinuousMode();
      mockRobot.intake.isBallCaptured = true;
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.SEARCHING_FOR_HOOP);

      // 1. Hoop observed -> NAVIGATING_TO_SHOOTING_POSITION
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_SHOOTING_POSITION);

      // 2. Simulate arrival at key (8.2m) -> ALIGNING_WITH_HOOP
      mockRobot.getPosition.mockReturnValue({ x: 8.2, y: 0.1, z: 0.0 });
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.ALIGNING_WITH_HOOP);

      // 3. Simulate heading alignment (error <= 0.035 rad) -> OPTIMIZING_TRAJECTORY
      mockRobot.getHeading.mockReturnValue(0.0);
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.OPTIMIZING_TRAJECTORY);

      // 4. Optimization succeeds -> SPINNING_UP_FLYWHEELS
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SPINNING_UP_FLYWHEELS);

      // 5. Flywheels ready -> SHOOTING
      mockRobot.shooter.state = 'READY';
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.SHOOTING);

      // 6. Shot fired -> EVALUATING_SHOT
      controller.update(0.1);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.EVALUATING_SHOT);
      expect(mockRobot.fireShot).toHaveBeenCalled();
      expect(controller.statistics.totalAttempts).toBe(1);
    });

    it('increments score upon verified basket and completes session in fixed target mode', () => {
      controller.startFixedTargetMode(1); // Target: 1 successful shot
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);
      controller.statistics.totalAttempts = 1;

      // Simulate SCORED result from HoopDetector
      mockHoopDetector.stats.lastShotResult = 'SCORED';
      mockHoopDetector.stats.successfulBaskets = 1;

      controller.update(0.1);

      expect(controller.statistics.successfulShots).toBe(1);
      expect(controller.statistics.accuracyPercent).toBe(100.0);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.COMPLETED);
      expect(controller.stateMachine.isTerminal()).toBe(true);
    });

    it('records miss outcome into adaptive corrector and reacquires ball', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.EVALUATING_SHOT);
      controller.statistics.totalAttempts = 1;

      // Simulate MISSED_SHORT result from HoopDetector
      mockHoopDetector.stats.lastShotResult = 'MISSED';
      mockHoopDetector.stats.lastDetailedResult = 'MISSED_SHORT';
      mockHoopDetector.lastShotDetails = { outcome: 'MISSED_SHORT', deltaX: -0.22, deltaZ: 0.0 };

      controller.update(0.1);

      expect(controller.statistics.successfulShots).toBe(0);
      expect(controller.statistics.missedShots).toBe(1);
      expect(mockRobot.adaptiveCorrector.recordOutcome).toHaveBeenCalled();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.REACQUIRING_BALL);
    });

    it('pauses and resumes without losing session statistics or target progress', () => {
      controller.startFixedTargetMode(5);
      controller.statistics.successfulShots = 2;
      controller.statistics.totalAttempts = 3;
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);

      controller.pause();
      expect(controller.stateMachine.isPaused()).toBe(true);
      expect(mockRobot.driveController.stop).toHaveBeenCalled();

      controller.resume();
      expect(controller.stateMachine.isPaused()).toBe(false);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      expect(controller.statistics.successfulShots).toBe(2);
    });

    it('manually stopping halts actuators and transitions to CANCELLED', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.COLLECTING_BALL);

      controller.stop();
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.CANCELLED);
      expect(mockRobot.driveController.stop).toHaveBeenCalled();
      expect(mockRobot.stopIntake).toHaveBeenCalled();
    });

    it('executes collection failure recovery and limits retries', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.COLLECTING_BALL);

      // Simulate collection timeout without ball capture (5.1s > 5.0s)
      controller.update(5.1);

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.RECOVERING);
      expect(controller.statistics.recoveryAttempts).toBe(1);

      // In RECOVERING state with BACKUP_AND_REAPPROACH: backs up for 0.8s
      controller.update(0.4);
      expect(mockRobot.driveController.setDriveVelocities).toHaveBeenCalledWith(
        AUTONOMOUS_CONFIG.recoveryBackupSpeed,
        0.0
      );

      // After 0.8s, completes backup and transitions back to re-approach
      controller.update(0.5);
      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
    });

    it('handles navigation blockage with path replan recovery', () => {
      controller.startContinuousMode();
      controller.stateMachine.transitionTo(AUTONOMOUS_STATES.NAVIGATING_TO_BALL);
      controller.currentTarget = { worldPosition: { x: 5, y: 0.24, z: 0 } };

      // Simulate navigation blockage
      mockRobot.navController.state = 'BLOCKED';
      controller.update(0.1);

      expect(controller.stateMachine.getState()).toBe(AUTONOMOUS_STATES.RECOVERING);
      expect(controller.recoveryContext.action).toBe('REPLAN_NAVIGATION');
    });

    it('prevents conflicting movement controllers during state transitions', () => {
      controller.startContinuousMode();
      expect(mockRobot.navController.cancel).toHaveBeenCalled();
      expect(mockRobot.shootingController.cancel).toHaveBeenCalled();
    });

    it('resets all session statistics and state cleanly', () => {
      controller.startFixedTargetMode(5);
      controller.statistics.successfulShots = 3;
      controller.statistics.totalAttempts = 4;
      controller.statistics.recoveryAttempts = 2;

      controller.reset();

      const status = controller.getStatus();
      expect(status.state).toBe(AUTONOMOUS_STATES.IDLE);
      expect(status.statistics.successfulShots).toBe(0);
      expect(status.statistics.totalAttempts).toBe(0);
      expect(status.statistics.recoveryAttempts).toBe(0);
      expect(status.target).toBeNull();
    });
  });
});
