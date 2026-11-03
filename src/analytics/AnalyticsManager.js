/**
 * AnalyticsManager.js
 * Central coordinator for the SMART-BASKETBOT simulation analytics subsystem.
 * Orchestrates shooting, navigation, motion, collection, and autonomous intelligence
 * performance monitoring, handles event subscriptions, data export, and session lifecycle.
 */

import { ANALYTICS_CONFIG } from './AnalyticsConfig.js';
import { ShootingAnalytics } from './ShootingAnalytics.js';
import { NavigationAnalytics } from './NavigationAnalytics.js';
import { MotionAnalytics } from './MotionAnalytics.js';
import { CollectionAnalytics } from './CollectionAnalytics.js';
import { AutonomyAnalytics } from './AutonomyAnalytics.js';

export class AnalyticsManager {
  /**
   * @param {Object} [config] Custom overrides
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    // Core analytics modules
    this.shooting = new ShootingAnalytics(this.config);
    this.navigation = new NavigationAnalytics(this.config);
    this.motion = new MotionAnalytics(this.config);
    this.collection = new CollectionAnalytics(this.config);
    this.autonomy = new AutonomyAnalytics(this.config);

    // Session timing
    this.sessionStartTime = Date.now();
    this.sessionDuration = 0.0;

    // Active subscriptions for clean teardown
    this.unsubscribers = [];

    // Internal trackers to detect transitions in controllers
    this._prevNavState = 'IDLE';
    this._prevNavDestination = null;
    this._prevWaypointCount = 0;
  }

  /**
   * Attaches HoopDetector event listeners for accurate shot scoring/missing telemetry.
   * @param {import('../robot/HoopDetector.js').HoopDetector} hoopDetector
   */
  attachHoopDetector(hoopDetector) {
    if (!hoopDetector) return;

    const onShotFiredHandler = (stats, metadata) => {
      const mode = (this.autonomy.currentState !== 'IDLE' && this.autonomy.currentState !== 'PAUSED') ? 'AUTONOMOUS' : 'MANUAL';
      this.shooting.recordShotAttempt({
        id: metadata?.id || Date.now(),
        launchSpeed: metadata?.launchSpeed,
        launchAngle: metadata?.launchAngleDeg ?? metadata?.launchAngle,
        flywheelRPM: metadata?.flywheelRPM,
        predictedApex: metadata?.predictedApex,
        predictedFlightTime: metadata?.predictedFlightTime,
        mode: mode
      });
    };

    const onScoreHandler = (stats, shotRecord) => {
      const mode = (this.autonomy.currentState !== 'IDLE' && this.autonomy.currentState !== 'PAUSED') ? 'AUTONOMOUS' : 'MANUAL';
      this.shooting.recordShotOutcome({
        id: shotRecord?.shotNumber || Date.now(),
        isScored: true,
        outcome: shotRecord?.outcome || 'SCORED',
        flightDuration: shotRecord?.flightDuration,
        closestDistance: shotRecord?.closestDistance,
        impactDisplacement: shotRecord?.impactDisplacement,
        mode: mode
      });

      if (mode === 'AUTONOMOUS') {
        this.autonomy.recordAutonomousShot(true);
      }
    };

    const onMissHandler = (stats, shotRecord) => {
      const mode = (this.autonomy.currentState !== 'IDLE' && this.autonomy.currentState !== 'PAUSED') ? 'AUTONOMOUS' : 'MANUAL';
      this.shooting.recordShotOutcome({
        id: shotRecord?.shotNumber || Date.now(),
        isScored: false,
        outcome: shotRecord?.outcome || 'MISSED',
        flightDuration: shotRecord?.flightDuration,
        closestDistance: shotRecord?.closestDistance,
        impactDisplacement: shotRecord?.impactDisplacement,
        mode: mode
      });

      if (mode === 'AUTONOMOUS') {
        this.autonomy.recordAutonomousShot(false);
      }
    };

    if (hoopDetector.onShotFired) {
      hoopDetector.onShotFired(onShotFiredHandler);
    }
    hoopDetector.onScore(onScoreHandler);
    hoopDetector.onMiss(onMissHandler);

    this.unsubscribers.push(() => {
      if (hoopDetector.onShotFiredCallbacks) {
        const firedIdx = hoopDetector.onShotFiredCallbacks.indexOf(onShotFiredHandler);
        if (firedIdx !== -1) hoopDetector.onShotFiredCallbacks.splice(firedIdx, 1);
      }

      const scoreIdx = hoopDetector.onScoreCallbacks.indexOf(onScoreHandler);
      if (scoreIdx !== -1) hoopDetector.onScoreCallbacks.splice(scoreIdx, 1);

      const missIdx = hoopDetector.onMissCallbacks.indexOf(onMissHandler);
      if (missIdx !== -1) hoopDetector.onMissCallbacks.splice(missIdx, 1);
    });
  }

  /**
   * Attaches AutonomousGameplayController state machine listener.
   * @param {import('../autonomy/AutonomousGameplayController.js').AutonomousGameplayController} gameplayController
   */
  attachAutonomousController(gameplayController) {
    if (!gameplayController || !gameplayController.stateMachine) return;

    const onStateChangeHandler = (from, to, reason) => {
      this.autonomy.recordStateTransition(from, to, reason);

      // Track collection retries when state machine enters reacquisition
      if (to === 'REACQUIRING_BALL') {
        this.collection.recordRetry();
      }
    };

    gameplayController.stateMachine.onStateChange(onStateChangeHandler);

    this.unsubscribers.push(() => {
      const idx = gameplayController.stateMachine.listeners.indexOf(onStateChangeHandler);
      if (idx !== -1) gameplayController.stateMachine.listeners.splice(idx, 1);
    });
  }

  /**
   * Records a fired shot directly with ballistic parameters.
   * Used when ShootingMechanism or ClosedLoopShootingController fires a ball.
   * @param {Object} shotData
   */
  recordShotAttempt(shotData = {}) {
    const isAuto = this.autonomy.currentState !== 'IDLE' && this.autonomy.currentState !== 'PAUSED';
    return this.shooting.recordShotAttempt({
      ...shotData,
      mode: isAuto ? 'AUTONOMOUS' : 'MANUAL'
    });
  }

  /**
   * Updates all analytics modules per simulation frame.
   *
   * @param {number} dt Frame time step in seconds
   * @param {Object} robot Reference to Robot
   * @param {Object} [navController] Reference to AutonomousNavController
   * @param {Object} [gameplayController] Reference to AutonomousGameplayController
   */
  update(dt, robot = null, navController = null, gameplayController = null) {
    this.sessionDuration += dt;

    const currentMode = (gameplayController && gameplayController.stateMachine?.isActive)
      ? 'AUTONOMOUS'
      : 'MANUAL';

    // 1. Motion & Differential Drive Analytics
    if (robot) {
      const driveTel = robot.getDriveTelemetry ? robot.getDriveTelemetry() : {};
      const robotVel = {
        speed: robot.getVelocity ? Math.hypot(robot.getVelocity().x, robot.getVelocity().z) : 0,
        angularVelocity: robot.getAngularVelocity ? robot.getAngularVelocity().y : 0
      };
      const pidTel = robot.driveController?.headingPID?.getTelemetry ? robot.driveController.headingPID.getTelemetry() : {};

      this.motion.update(dt, driveTel, robotVel, pidTel);

      // 2. Ball Collection Analytics
      if (robot.intake) {
        const intakeTel = robot.intake.getTelemetry ? robot.intake.getTelemetry() : {
          state: robot.intake.state,
          isBallCaptured: robot.intake.isBallCaptured
        };
        this.collection.update(dt, intakeTel, currentMode);
      }
    }

    // 3. Navigation Analytics Task Lifecycle
    if (navController && robot) {
      const robotPose = robot.getPosition ? robot.getPosition() : { x: 0, y: 0, z: 0 };
      const isNavigating = (navController.state === 'NAVIGATING' || navController.state === 'APPROACHING_GOAL');

      // Detect start of navigation task
      if ((navController.state === 'NAVIGATING' || navController.state === 'PLANNING') &&
          (this._prevNavState !== 'NAVIGATING' && this._prevNavState !== 'PLANNING')) {
        this.navigation.startTask({
          destination: navController.destination,
          waypoints: navController.waypoints,
          startPose: { x: robotPose.x, z: robotPose.z },
          mode: currentMode
        });
      }

      // Detect replanning (waypoint count changed while navigating)
      if (isNavigating && navController.waypoints && navController.waypoints.length > 0 &&
          this._prevWaypointCount > 0 && navController.waypoints.length !== this._prevWaypointCount) {
        this.navigation.recordReplanning(navController.waypoints, robotPose);
      }

      // Detect completion / terminal state of navigation task
      if (this._prevNavState === 'NAVIGATING' || this._prevNavState === 'APPROACHING_GOAL') {
        if (navController.state === 'GOAL_REACHED') {
          this.navigation.finishTask('GOAL_REACHED', navController.statusMessage);
        } else if (navController.state === 'BLOCKED') {
          this.navigation.finishTask('BLOCKED', navController.statusMessage);
          this.navigation.recordObstacleEncounter();
        } else if (navController.state === 'CANCELLED') {
          this.navigation.finishTask('CANCELLED', navController.statusMessage);
        }
      }

      this.navigation.update(dt, robotPose, isNavigating);

      this._prevNavState = navController.state;
      this._prevNavDestination = navController.destination ? { ...navController.destination } : null;
      this._prevWaypointCount = navController.waypoints ? navController.waypoints.length : 0;
    }

    // 4. Autonomous Gameplay Analytics
    if (gameplayController && gameplayController.stateMachine) {
      this.autonomy.update(dt, gameplayController.stateMachine.getState());
    }
  }

  /**
   * Resets all analytics session data and history cleanly without corrupting simulation.
   */
  reset() {
    this.sessionStartTime = Date.now();
    this.sessionDuration = 0.0;

    this.shooting.reset();
    this.navigation.reset();
    this.motion.reset();
    this.collection.reset();
    this.autonomy.reset();

    this._prevNavState = 'IDLE';
    this._prevNavDestination = null;
    this._prevWaypointCount = 0;
  }

  /**
   * Returns a complete consolidated session telemetry snapshot.
   */
  getTelemetry() {
    return {
      sessionDuration: this.sessionDuration,
      sessionStartTime: this.sessionStartTime,
      shooting: this.shooting.getTelemetry(),
      navigation: this.navigation.getTelemetry(),
      motion: this.motion.getTelemetry(),
      collection: this.collection.getTelemetry(),
      autonomy: this.autonomy.getTelemetry()
    };
  }

  /**
   * Exports full session analytics data as a structured JSON string.
   * @returns {string} Formatted JSON string
   */
  exportJSON() {
    const data = {
      exportMetadata: {
        application: 'SMART-BASKETBOT Simulator',
        version: '1.0.0',
        exportedAt: new Date().toISOString(),
        sessionDurationSeconds: Number(this.sessionDuration.toFixed(2))
      },
      summary: {
        shootingAccuracy: Number(this.shooting.accuracyPercent.toFixed(2)),
        totalShots: this.shooting.totalAttempts,
        basketsScored: this.shooting.successfulBaskets,
        missedShots: this.shooting.missedShots,
        distanceTravelledMeters: Number(this.navigation.totalDistanceTravelled.toFixed(2)),
        navigationSuccessRate: Number(this.navigation.navigationSuccessRate.toFixed(2)),
        pathEfficiency: Number(this.navigation.overallPathEfficiency.toFixed(2)),
        collectionSuccessRate: Number(this.collection.collectionSuccessRate.toFixed(2)),
        totalBallsCollected: this.collection.totalBasketballsCollected,
        autonomousSessions: this.autonomy.totalSessions,
        autonomousAccuracy: Number(this.autonomy.accuracyPercent.toFixed(2))
      },
      shooting: {
        metrics: this.shooting.getTelemetry(),
        shotHistory: this.shooting.shotHistory
      },
      navigation: {
        metrics: this.navigation.getTelemetry(),
        taskHistory: this.navigation.taskHistory
      },
      motion: {
        metrics: {
          averageLinearError: this.motion.getAverageLinearError(),
          averageAngularError: this.motion.getAverageAngularError(),
          maxLinearError: this.motion.maxLinearError,
          maxAngularError: this.motion.maxAngularError,
          motionResponseTime: this.motion.stepResponse.lastRiseTime
        },
        timeSeries: this.motion.timeSeries
      },
      collection: {
        metrics: this.collection.getTelemetry(),
        attemptHistory: this.collection.attemptHistory
      },
      autonomy: {
        metrics: this.autonomy.getTelemetry(),
        stateDurations: this.autonomy.stateDurations,
        stateTransitions: this.autonomy.stateTransitions,
        sessionHistory: this.autonomy.sessionHistory
      }
    };

    return JSON.stringify(data, null, 2);
  }

  /**
   * Exports session analytics shot records and KPI metrics as a CSV formatted string.
   * @returns {string} CSV text
   */
  exportCSV() {
    const lines = [];

    // Header & Summary
    lines.push('# SMART-BASKETBOT SIMULATOR - ANALYTICS EXPORT');
    lines.push(`# Exported: ${new Date().toISOString()}`);
    lines.push(`# Session Duration (s): ${this.sessionDuration.toFixed(1)}`);
    lines.push(`# Total Shots: ${this.shooting.totalAttempts}`);
    lines.push(`# Scored: ${this.shooting.successfulBaskets}`);
    lines.push(`# Accuracy: ${this.shooting.accuracyPercent.toFixed(1)}%`);
    lines.push(`# Distance Travelled (m): ${this.navigation.totalDistanceTravelled.toFixed(2)}`);
    lines.push(`# Collection Success Rate: ${this.collection.collectionSuccessRate.toFixed(1)}%`);
    lines.push('');

    // Detailed Shot History Table
    lines.push('--- SHOT HISTORY ---');
    lines.push('ShotNumber,Timestamp,Mode,Outcome,IsScored,LaunchSpeed(m/s),LaunchAngle(deg),FlywheelRPM,FlightDuration(s)');

    for (let i = this.shooting.shotHistory.length - 1; i >= 0; i--) {
      const s = this.shooting.shotHistory[i];
      lines.push([
        s.shotNumber,
        new Date(s.timestamp).toLocaleTimeString(),
        s.mode,
        s.outcome,
        s.isScored ? '1' : '0',
        s.launchSpeed != null ? s.launchSpeed.toFixed(2) : '',
        s.launchAngle != null ? s.launchAngle.toFixed(1) : '',
        s.flywheelRPM != null ? Math.round(s.flywheelRPM) : '',
        s.flightDuration != null ? s.flightDuration.toFixed(2) : ''
      ].join(','));
    }

    lines.push('');
    // Detailed Navigation Tasks Table
    lines.push('--- NAVIGATION TASKS ---');
    lines.push('TaskNumber,Mode,Status,PlannedLength(m),ActualLength(m),PathEfficiency(%),Duration(s),Replans,Obstacles');
    for (let i = this.navigation.taskHistory.length - 1; i >= 0; i--) {
      const t = this.navigation.taskHistory[i];
      lines.push([
        t.taskNumber,
        t.mode,
        t.status,
        t.plannedPathLength.toFixed(2),
        t.actualTravelledDistance.toFixed(2),
        t.pathEfficiency.toFixed(1),
        t.duration.toFixed(2),
        t.replans,
        t.obstacleEncounters
      ].join(','));
    }

    lines.push('');
    // Autonomous State Durations Table
    lines.push('--- AUTONOMOUS STATE DURATIONS ---');
    lines.push('State,DurationSeconds');
    for (const [state, dur] of Object.entries(this.autonomy.stateDurations)) {
      lines.push(`${state},${dur.toFixed(2)}`);
    }

    return lines.join('\n');
  }

  /**
   * Helper for triggering a file download in the browser.
   * @param {'JSON'|'CSV'} format
   */
  downloadExport(format = 'JSON') {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const upper = format.toUpperCase();
    const content = upper === 'CSV' ? this.exportCSV() : this.exportJSON();
    const mime = upper === 'CSV' ? 'text/csv' : 'application/json';
    const ext = upper === 'CSV' ? 'csv' : 'json';

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-basketbot-analytics-${Date.now()}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Disposes all attached event listeners and tears down analytics.
   */
  destroy() {
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch (e) {
        console.warn('[AnalyticsManager] Error unsubscribing listener:', e);
      }
    }
    this.unsubscribers = [];
  }
}
