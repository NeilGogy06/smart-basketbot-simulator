/**
 * analytics.test.js
 * Comprehensive automated test suite for Milestone 8:
 * Simulation Analytics and Performance Monitoring.
 * Verifies real physics/controller metrics, mathematical formulas,
 * strict event deduplication, time-series ring buffers, session lifecycle,
 * and export data integrity.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AnalyticsManager } from '../src/analytics/AnalyticsManager.js';
import { ShootingAnalytics } from '../src/analytics/ShootingAnalytics.js';
import { NavigationAnalytics } from '../src/analytics/NavigationAnalytics.js';
import { MotionAnalytics } from '../src/analytics/MotionAnalytics.js';
import { CollectionAnalytics } from '../src/analytics/CollectionAnalytics.js';
import { AutonomyAnalytics } from '../src/analytics/AutonomyAnalytics.js';
import { HoopDetector } from '../src/robot/HoopDetector.js';

describe('Milestone 8: Simulation Analytics & Performance Monitoring', () => {

  // =========================================================================
  // 1. SHOOTING ANALYTICS TESTS
  // =========================================================================
  describe('ShootingAnalytics Subsystem', () => {
    let shooting;

    beforeEach(() => {
      shooting = new ShootingAnalytics();
    });

    it('1. initializes with zero attempts, zero accuracy, and empty datasets', () => {
      const tel = shooting.getTelemetry();
      expect(tel.totalAttempts).toBe(0);
      expect(tel.successfulBaskets).toBe(0);
      expect(tel.missedShots).toBe(0);
      expect(tel.accuracyPercent).toBe(0.0);
      expect(tel.averageLaunchSpeed).toBe(0.0);
      expect(tel.averageLaunchAngle).toBe(0.0);
      expect(tel.averageFlightTime).toBe(0.0);
      expect(tel.averageTimeBetweenShots).toBe(0.0);
      expect(shooting.shotHistory.length).toBe(0);
    });

    it('2. records shooting attempts and calculates launch averages accurately', () => {
      shooting.recordShotAttempt({ id: 101, launchSpeed: 8.4, launchAngle: 50.0 });
      shooting.recordShotOutcome({ id: 101, isScored: true, outcome: 'SCORED', flightDuration: 1.2 });

      shooting.recordShotAttempt({ id: 102, launchSpeed: 9.0, launchAngle: 54.0 });
      shooting.recordShotOutcome({ id: 102, isScored: false, outcome: 'MISSED_LONG', flightDuration: 1.4 });

      const tel = shooting.getTelemetry();
      expect(tel.totalAttempts).toBe(2);
      expect(tel.successfulBaskets).toBe(1);
      expect(tel.missedShots).toBe(1);
      // Accuracy = (1 / 2) * 100 = 50.0%
      expect(tel.accuracyPercent).toBe(50.0);
      expect(tel.averageLaunchSpeed).toBeCloseTo(8.7, 2);
      expect(tel.averageLaunchAngle).toBeCloseTo(52.0, 1);
      expect(tel.averageFlightTime).toBeCloseTo(1.3, 2);
    });

    it('3. enforces mathematical formula for shooting accuracy across multiple outcomes', () => {
      // 3 scored, 1 missed = 4 attempts -> 75%
      for (let i = 1; i <= 3; i++) {
        shooting.recordShotAttempt({ id: i });
        shooting.recordShotOutcome({ id: i, isScored: true, outcome: 'SCORED' });
      }
      shooting.recordShotAttempt({ id: 4 });
      shooting.recordShotOutcome({ id: 4, isScored: false, outcome: 'MISSED_SHORT' });

      expect(shooting.totalAttempts).toBe(4);
      expect(shooting.successfulBaskets).toBe(3);
      expect(shooting.missedShots).toBe(1);
      expect(shooting.accuracyPercent).toBe(75.0);
    });

    it('4. strictly prevents duplicate event counting for the same physical shot', () => {
      const now = Date.now();
      // First call from ShootingMechanism with basic timestamp ID
      shooting.recordShotAttempt({ id: 200, timestamp: now, launchSpeed: 8.5 });

      // Immediate second call from ClosedLoopShootingController within 0.4s debounce window
      shooting.recordShotAttempt({
        id: 200,
        timestamp: now + 20,
        launchSpeed: 8.5,
        launchAngle: 52.0,
        flywheelRPM: 1700
      });

      // Third call within debounce window without ID
      shooting.recordShotAttempt({ timestamp: now + 50, flywheelRPM: 1700 });

      // Must be counted as exactly ONE physical attempt
      expect(shooting.totalAttempts).toBe(1);
      expect(shooting.shotHistory.length).toBe(1);
      expect(shooting.activeShot.launchAngle).toBe(52.0);
      expect(shooting.activeShot.flywheelRPM).toBe(1700);

      // Now resolve the shot
      shooting.recordShotOutcome({ id: 200, isScored: true, outcome: 'SCORED' });
      // Duplicate resolution call must not increment scored count again
      shooting.recordShotOutcome({ id: 200, isScored: true, outcome: 'SCORED' });

      expect(shooting.successfulBaskets).toBe(1);
      expect(shooting.accuracyPercent).toBe(100.0);
    });

    it('5. stores comprehensive shot history with trajectory metadata and miss classifications', () => {
      shooting.recordShotAttempt({
        id: 'shot-alpha',
        launchSpeed: 8.25,
        launchAngle: 51.5,
        flywheelRPM: 1650,
        mode: 'AUTONOMOUS',
        predictedTrajectory: { apex: 4.12, flightTime: 1.15 }
      });

      shooting.recordShotOutcome({
        id: 'shot-alpha',
        isScored: false,
        outcome: 'MISSED_LEFT',
        flightDuration: 1.18,
        actualTrajectory: { minDistToRim: 0.28, impactDisplacement: { x: 0.05, z: 0.22 } }
      });

      const record = shooting.shotHistory[0];
      expect(record.id).toBe('shot-alpha');
      expect(record.shotNumber).toBe(1);
      expect(record.mode).toBe('AUTONOMOUS');
      expect(record.outcome).toBe('MISSED_LEFT');
      expect(record.isScored).toBe(false);
      expect(record.missClassification).toBe('MISSED_LEFT');
      expect(record.launchSpeed).toBe(8.25);
      expect(record.predictedTrajectory.apex).toBe(4.12);
      expect(record.actualTrajectory.minDistToRim).toBe(0.28);
    });

    it('6. tracks interval between consecutive shots', () => {
      const t0 = 1000000;
      shooting.recordShotAttempt({ id: 1, timestamp: t0 });
      shooting.recordShotOutcome({ id: 1, isScored: true });

      shooting.recordShotAttempt({ id: 2, timestamp: t0 + 4000 }); // 4s later
      shooting.recordShotOutcome({ id: 2, isScored: true });

      shooting.recordShotAttempt({ id: 3, timestamp: t0 + 10000 }); // 6s later
      shooting.recordShotOutcome({ id: 3, isScored: true });

      // Avg interval = (4 + 6) / 2 = 5.0s
      expect(shooting.getAverageTimeBetweenShots()).toBeCloseTo(5.0, 1);
    });
  });

  // =========================================================================
  // 2. NAVIGATION ANALYTICS TESTS
  // =========================================================================
  describe('NavigationAnalytics Subsystem', () => {
    let nav;

    beforeEach(() => {
      nav = new NavigationAnalytics();
    });

    it('7. integrates robot physical translation into total distance travelled', () => {
      nav.update(0.1, { x: 0.0, z: 0.0 });
      nav.update(0.1, { x: 3.0, z: 4.0 }); // hypot(3, 4) = 5.0m
      nav.update(0.1, { x: 3.0, z: 5.0 }); // + 1.0m

      expect(nav.totalDistanceTravelled).toBeCloseTo(6.0, 2);
    });

    it('8. calculates path efficiency formula: (Planned Path Length / Actual Travelled Distance) * 100', () => {
      // Task with planned length = 10.0m
      nav.startTask({
        startPose: { x: 0, z: 0 },
        destination: { x: 10, z: 0 },
        waypoints: [{ x: 5, z: 0 }, { x: 10, z: 0 }]
      });

      // Robot travels slightly deviating path: actual = 12.5m (6.0 + 4.0 + 2.5)
      nav.update(0.1, { x: 0, z: 0 }, true);
      nav.update(0.1, { x: 6.0, z: 0 }, true);
      nav.update(0.1, { x: 6.0, z: 4.0 }, true);
      nav.update(0.1, { x: 6.0, z: 6.5 }, true);

      // Finish task successfully
      const task = nav.finishTask('GOAL_REACHED', 'Arrived at goal');

      // Efficiency = (10.0 / 12.5) * 100 = 80.0%
      expect(task.plannedPathLength).toBeCloseTo(10.0, 1);
      expect(task.actualTravelledDistance).toBeCloseTo(12.5, 1);
      expect(task.pathEfficiency).toBeCloseTo(80.0, 1);
      expect(nav.overallPathEfficiency).toBeCloseTo(80.0, 1);
    });

    it('9. handles zero-distance and stationary tasks safely without division by zero', () => {
      nav.startTask({
        startPose: { x: 5, z: 5 },
        destination: { x: 5, z: 5 },
        waypoints: []
      });
      const task = nav.finishTask('GOAL_REACHED', 'Already at destination');
      expect(task.pathEfficiency).toBe(100.0);
      expect(nav.overallPathEfficiency).toBe(100.0);
    });

    it('10. calculates navigation success rate: (Successful Tasks / Completed Tasks) * 100', () => {
      // Task 1: Success
      nav.startTask({ startPose: { x: 0, z: 0 }, destination: { x: 2, z: 0 } });
      nav.finishTask('GOAL_REACHED');

      // Task 2: Blocked by obstacle
      nav.startTask({ startPose: { x: 0, z: 0 }, destination: { x: 4, z: 0 } });
      nav.finishTask('BLOCKED', 'No path');

      // Task 3: Success
      nav.startTask({ startPose: { x: 0, z: 0 }, destination: { x: 6, z: 0 } });
      nav.finishTask('GOAL_REACHED');

      // 2 success, 1 fail -> (2 / 3) * 100 = 66.67%
      expect(nav.successfulTasks).toBe(2);
      expect(nav.failedTasks).toBe(1);
      expect(nav.navigationSuccessRate).toBeCloseTo(66.67, 1);
    });

    it('11. records obstacle encounters and path replanning events', () => {
      nav.startTask({ startPose: { x: 0, z: 0 }, destination: { x: 8, z: 0 } });
      nav.recordObstacleEncounter();
      nav.recordReplanning();
      nav.recordReplanning();
      const task = nav.finishTask('GOAL_REACHED');

      expect(task.obstacleEncounters).toBe(1);
      expect(task.replans).toBe(2);
      expect(nav.obstacleEncounters).toBe(1);
      expect(nav.replanningEvents).toBe(2);
    });
  });

  // =========================================================================
  // 3. MOTION & PID ANALYTICS TESTS
  // =========================================================================
  describe('MotionAnalytics Subsystem', () => {
    let motion;

    beforeEach(() => {
      motion = new MotionAnalytics();
    });

    it('12. records linear and angular tracking errors and peak errors', () => {
      // Frame 1: target = 2.0 m/s, actual = 1.6 m/s -> err = 0.4 m/s
      motion.update(0.1, { targetLinearVelocity: 2.0, targetAngularVelocity: 1.0 }, { speed: 1.6, angularVelocity: 0.8 });
      // Frame 2: target = 2.0 m/s, actual = 1.2 m/s -> err = 0.8 m/s (new max)
      motion.update(0.1, { targetLinearVelocity: 2.0, targetAngularVelocity: 1.0 }, { speed: 1.2, angularVelocity: 0.7 });

      expect(motion.maxLinearError).toBeCloseTo(0.8, 2);
      // Avg error = (0.4 + 0.8) / 2 = 0.6 m/s
      expect(motion.getAverageLinearError()).toBeCloseTo(0.6, 2);
      // Angular avg error = (0.2 + 0.3) / 2 = 0.25 rad/s
      expect(motion.getAverageAngularError()).toBeCloseTo(0.25, 2);
    });

    it('13. records left and right wheel RPM correctly', () => {
      motion.update(0.1, { rpmLeft: 120.5, rpmRight: 118.2 });
      expect(motion.current.rpmLeft).toBe(120.5);
      expect(motion.current.rpmRight).toBe(118.2);
    });

    it('14. maintains bounded ring buffers for time-series charts without unbounded growth', () => {
      // Simulate 100 sample intervals (exceeding limit of 60 points)
      for (let i = 0; i < 100; i++) {
        motion.update(0.15, { targetLinearVelocity: 1.5, rpmLeft: 100 }, { speed: 1.4 });
      }

      // Max capacity is capped at 60 points
      expect(motion.timeSeries.timestamps.length).toBeLessThanOrEqual(60);
      expect(motion.timeSeries.targetLinearVelocities.length).toBeLessThanOrEqual(60);
      expect(motion.timeSeries.actualLinearVelocities.length).toBeLessThanOrEqual(60);
    });

    it('15. detects motion step response 90% rise time', () => {
      // Step from 0 to 2.0 m/s
      motion.update(0.1, { targetLinearVelocity: 2.0 }, { speed: 0.0 }); // Trigger step detection
      motion.update(0.1, { targetLinearVelocity: 2.0 }, { speed: 0.8 });
      motion.update(0.1, { targetLinearVelocity: 2.0 }, { speed: 1.5 });
      motion.update(0.1, { targetLinearVelocity: 2.0 }, { speed: 1.82 }); // > 90% of 2.0 (1.8m/s)

      expect(motion.stepResponse.lastRiseTime).toBeDefined();
      expect(motion.stepResponse.lastRiseTime).toBeGreaterThan(0.0);
    });
  });

  // =========================================================================
  // 4. COLLECTION ANALYTICS TESTS
  // =========================================================================
  describe('CollectionAnalytics Subsystem', () => {
    let col;

    beforeEach(() => {
      col = new CollectionAnalytics();
    });

    it('16. counts collection attempts once, never on every simulation update', () => {
      // Simulate 10 consecutive ticks while intake is in INTAKING state
      for (let i = 0; i < 10; i++) {
        col.update(0.016, { state: 'INTAKING', isBallCaptured: false });
      }

      // Exactly 1 attempt should be in progress, NOT 10 attempts!
      expect(col.totalAttempts).toBe(1);
      expect(col.activeAttempt).toBeDefined();
      expect(col.activeAttempt.status).toBe('INTAKING');
    });

    it('17. resolves successful collection upon optical sensor ball capture and calculates success rate', () => {
      col.startAttempt({ mode: 'AUTONOMOUS' });
      // Capture occurs
      col.recordSuccess({ duration: 1.8, mode: 'AUTONOMOUS' });

      // Second attempt fails
      col.startAttempt({ mode: 'AUTONOMOUS' });
      col.recordFailure('Ball rolled away');

      expect(col.totalAttempts).toBe(2);
      expect(col.successfulCollections).toBe(1);
      expect(col.failedCollections).toBe(1);
      expect(col.totalBasketballsCollected).toBe(1);
      // (1 / 2) * 100 = 50%
      expect(col.collectionSuccessRate).toBe(50.0);
      expect(col.getAverageCollectionDuration()).toBeCloseTo(1.8, 1);
    });

    it('18. distinguishes manual versus autonomous collection performance', () => {
      col.startAttempt({ mode: 'MANUAL' });
      col.recordSuccess({ duration: 2.0, mode: 'MANUAL' });

      col.startAttempt({ mode: 'AUTONOMOUS' });
      col.recordSuccess({ duration: 1.2, mode: 'AUTONOMOUS' });

      expect(col.modes.MANUAL.successes).toBe(1);
      expect(col.modes.AUTONOMOUS.successes).toBe(1);
      expect(col.modes.AUTONOMOUS.totalDuration).toBeCloseTo(1.2, 1);
    });
  });

  // =========================================================================
  // 5. AUTONOMY ANALYTICS TESTS
  // =========================================================================
  describe('AutonomyAnalytics Subsystem', () => {
    let auto;

    beforeEach(() => {
      auto = new AutonomyAnalytics();
    });

    it('19. tracks time spent across the 18 autonomous states', () => {
      auto.update(1.5, 'SEARCHING_FOR_BALL');
      auto.update(2.0, 'NAVIGATING_TO_BALL');
      auto.update(0.8, 'COLLECTING_BALL');
      auto.update(1.2, 'ALIGNING_WITH_HOOP');

      const d = auto.stateDurations;
      expect(d.SEARCHING_FOR_BALL).toBeCloseTo(1.5, 1);
      expect(d.NAVIGATING_TO_BALL).toBeCloseTo(2.0, 1);
      expect(d.COLLECTING_BALL).toBeCloseTo(0.8, 1);
      expect(d.ALIGNING_WITH_HOOP).toBeCloseTo(1.2, 1);
      expect(d.SHOOTING).toBe(0.0);
    });

    it('20. tracks autonomous session lifecycle: started, completed, and failed', () => {
      // Session 1: Completed
      auto.startSession('CONTINUOUS');
      auto.recordStateTransition('IDLE', 'SEARCHING_FOR_BALL');
      auto.recordAutonomousShot(true);
      auto.recordStateTransition('EVALUATING_SHOT', 'COMPLETED', 'Session finished successfully');

      // Session 2: Failed
      auto.startSession('FIXED_TARGET', 3);
      auto.recordStateTransition('NAVIGATING_TO_BALL', 'FAILED', 'Emergency stop engaged');

      expect(auto.totalSessions).toBe(2);
      expect(auto.completedSessions).toBe(1);
      expect(auto.failedSessions).toBe(1);
      expect(auto.successfulShots).toBe(1);
    });

    it('21. calculates recovery success rate and fixed-target progress', () => {
      auto.startSession('FIXED_TARGET', 5);

      // Recovery 1: succeeds (transitions back to SEARCHING_FOR_BALL)
      auto.recordStateTransition('COLLECTING_BALL', 'RECOVERING');
      auto.recordStateTransition('RECOVERING', 'SEARCHING_FOR_BALL');

      // Recovery 2: succeeds
      auto.recordStateTransition('ALIGNING_WITH_HOOP', 'RECOVERING');
      auto.recordStateTransition('RECOVERING', 'ALIGNING_WITH_HOOP');

      expect(auto.recoveryAttempts).toBe(2);
      expect(auto.successfulRecoveries).toBe(2);
      expect(auto.recoverySuccessRate).toBe(100.0);

      // Score 3 baskets out of 5 target -> 60%
      auto.recordAutonomousShot(true);
      auto.recordAutonomousShot(true);
      auto.recordAutonomousShot(true);
      expect(auto.fixedTargetProgress).toBeCloseTo(60.0, 1);
    });
  });

  // =========================================================================
  // 6. ANALYTICS MANAGER COORDINATION & EXPORT TESTS
  // =========================================================================
  describe('AnalyticsManager Orchestration & Exports', () => {
    let manager;
    let hoopDetector;

    beforeEach(() => {
      manager = new AnalyticsManager();
      hoopDetector = new HoopDetector();
      manager.attachHoopDetector(hoopDetector);
    });

    it('22. integrates with HoopDetector events seamlessly', () => {
      // Fire shot
      hoopDetector.notifyShotFired({ id: 'test-shot-1', launchSpeed: 8.5, launchAngleDeg: 52 });
      expect(manager.shooting.totalAttempts).toBe(1);

      // Score shot
      hoopDetector.resolveShot(true);
      expect(manager.shooting.successfulBaskets).toBe(1);
      expect(manager.shooting.accuracyPercent).toBe(100.0);
    });

    it('23. resets all sub-modules cleanly without corrupting state', () => {
      manager.shooting.recordShotAttempt({ id: 1 });
      manager.shooting.recordShotOutcome({ id: 1, isScored: true });
      manager.navigation.update(0.1, { x: 5, z: 0 });
      manager.collection.startAttempt();
      manager.collection.recordSuccess();

      manager.reset();

      const tel = manager.getTelemetry();
      expect(tel.sessionDuration).toBe(0.0);
      expect(tel.shooting.totalAttempts).toBe(0);
      expect(tel.navigation.totalDistanceTravelled).toBe(0.0);
      expect(tel.collection.totalBasketballsCollected).toBe(0);
      expect(tel.autonomy.totalSessions).toBe(0);
    });

    it('24. cleans up event listeners on destroy()', () => {
      expect(hoopDetector.onScoreCallbacks.length).toBeGreaterThan(0);
      manager.destroy();
      expect(manager.unsubscribers.length).toBe(0);
    });

    it('25. exports complete and structurally valid JSON session report', () => {
      manager.shooting.recordShotAttempt({ id: 50, launchSpeed: 8.4, launchAngle: 52.0 });
      manager.shooting.recordShotOutcome({ id: 50, isScored: true, outcome: 'SCORED', flightDuration: 1.25 });

      const jsonStr = manager.exportJSON();
      expect(typeof jsonStr).toBe('string');

      const parsed = JSON.parse(jsonStr);
      expect(parsed.exportMetadata.application).toBe('SMART-BASKETBOT Simulator');
      expect(parsed.summary.totalShots).toBe(1);
      expect(parsed.summary.basketsScored).toBe(1);
      expect(parsed.summary.shootingAccuracy).toBe(100.0);
      expect(parsed.shooting.shotHistory.length).toBe(1);
      expect(parsed.autonomy.stateDurations).toBeDefined();
    });

    it('26. exports well-formed CSV report containing real session data', () => {
      manager.shooting.recordShotAttempt({ id: 99, launchSpeed: 8.8, launchAngle: 53.0 });
      manager.shooting.recordShotOutcome({ id: 99, isScored: false, outcome: 'MISSED_SHORT', flightDuration: 1.1 });

      const csv = manager.exportCSV();
      expect(typeof csv).toBe('string');
      expect(csv).toContain('# SMART-BASKETBOT SIMULATOR - ANALYTICS EXPORT');
      expect(csv).toContain('--- SHOT HISTORY ---');
      expect(csv).toContain('MISSED_SHORT');
      expect(csv).toContain('8.80');
      expect(csv).toContain('--- AUTONOMOUS STATE DURATIONS ---');
    });
  });
});
