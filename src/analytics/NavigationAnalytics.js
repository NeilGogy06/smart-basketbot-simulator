/**
 * NavigationAnalytics.js
 * Measures, stores, and evaluates autonomous and manual navigation performance,
 * path efficiency, travel distances, obstacle encounters, and replanning events.
 */

import { ANALYTICS_CONFIG } from './AnalyticsConfig.js';

export class NavigationAnalytics {
  /**
   * @param {Object} [config]
   */
  constructor(config = {}) {
    this.config = { ...ANALYTICS_CONFIG, ...config };

    this.reset();
  }

  /**
   * Resets all navigation metrics, task records, and odometry tracking cleanly.
   */
  reset() {
    // Overall movement odometry (manual + autonomous)
    this.totalDistanceTravelled = 0.0;
    this.totalNavigationTime = 0.0;
    this.prevRobotPose = null;

    // Navigation tasks lifecycle
    this.successfulTasks = 0;
    this.failedTasks = 0;
    this.totalTasksStarted = 0;
    this.navigationSuccessRate = 0.0;

    // Path lengths and efficiency
    this.totalPlannedPathLength = 0.0;
    this.totalActualPathLength = 0.0;
    this.overallPathEfficiency = 100.0;

    // Events
    this.obstacleEncounters = 0;
    this.replanningEvents = 0;

    // Successful task durations
    this.totalSuccessfulDuration = 0.0;

    // Active navigation task
    this.activeTask = null;

    // Historical tasks list
    this.taskHistory = [];
  }

  /**
   * Starts tracking a new autonomous navigation task from A* path planner.
   *
   * @param {Object} taskData
   * @param {Array<{x: number, z: number}>} taskData.waypoints Planned waypoints
   * @param {{x: number, z: number}} taskData.destination Goal coordinates
   * @param {{x: number, z: number}} taskData.startPose Initial robot position
   * @param {string} [taskData.mode] 'AUTONOMOUS' or 'MANUAL'
   * @returns {Object} Active task record
   */
  startTask(taskData) {
    // If an active task is still running, close it out as cancelled before starting new
    if (this.activeTask && !this.activeTask.isFinished) {
      this.finishTask('CANCELLED', 'Superseded by new navigation target');
    }

    this.totalTasksStarted++;

    const startPose = taskData.startPose || { x: 0, z: 0 };
    const waypoints = taskData.waypoints || [];
    const destination = taskData.destination || (waypoints.length > 0 ? waypoints[waypoints.length - 1] : { x: 0, z: 0 });

    // Compute planned path length as sum of segment lengths
    let plannedLength = 0.0;
    if (waypoints.length > 0) {
      // Distance from start to first waypoint
      plannedLength += Math.hypot(waypoints[0].x - startPose.x, waypoints[0].z - startPose.z);
      for (let i = 1; i < waypoints.length; i++) {
        plannedLength += Math.hypot(waypoints[i].x - waypoints[i - 1].x, waypoints[i].z - waypoints[i - 1].z);
      }
    } else {
      plannedLength = Math.hypot(destination.x - startPose.x, destination.z - startPose.z);
    }

    this.activeTask = {
      id: Date.now(),
      taskNumber: this.totalTasksStarted,
      startTime: Date.now(),
      mode: taskData.mode || 'AUTONOMOUS',
      startPose: { ...startPose },
      destination: { ...destination },
      waypointsCount: waypoints.length,
      plannedPathLength: plannedLength,
      actualTravelledDistance: 0.0,
      duration: 0.0,
      status: 'NAVIGATING',
      isFinished: false,
      replans: 0,
      obstacleEncounters: 0,
      pathEfficiency: 100.0
    };

    return this.activeTask;
  }

  /**
   * Records a path replanning event for the active task.
   * @param {Array<{x: number, z: number}>} [newWaypoints]
   * @param {{x: number, z: number}} [currentPose]
   */
  recordReplanning(newWaypoints = null, currentPose = null) {
    this.replanningEvents++;

    if (this.activeTask && !this.activeTask.isFinished) {
      this.activeTask.replans++;

      // Optionally recalculate remaining planned distance if new waypoints provided
      if (newWaypoints && newWaypoints.length > 0 && currentPose) {
        let remainingPlanned = Math.hypot(newWaypoints[0].x - currentPose.x, newWaypoints[0].z - currentPose.z);
        for (let i = 1; i < newWaypoints.length; i++) {
          remainingPlanned += Math.hypot(newWaypoints[i].x - newWaypoints[i - 1].x, newWaypoints[i].z - newWaypoints[i - 1].z);
        }
        // Update planned length: what was travelled so far + remaining
        this.activeTask.plannedPathLength = this.activeTask.actualTravelledDistance + remainingPlanned;
      }
    }
  }

  /**
   * Records an obstacle encounter event.
   */
  recordObstacleEncounter() {
    this.obstacleEncounters++;
    if (this.activeTask && !this.activeTask.isFinished) {
      this.activeTask.obstacleEncounters++;
    }
  }

  /**
   * Completes the active navigation task with success or failure.
   *
   * @param {'GOAL_REACHED'|'BLOCKED'|'CANCELLED'|'FAILED'} status
   * @param {string} [reason='']
   * @returns {Object|null} Completed task record
   */
  finishTask(status, reason = '') {
    if (!this.activeTask || this.activeTask.isFinished) {
      return null;
    }

    const task = this.activeTask;
    task.isFinished = true;
    task.status = status;
    task.reason = reason;

    const isSuccess = (status === 'GOAL_REACHED');

    if (isSuccess) {
      this.successfulTasks++;
      this.totalSuccessfulDuration += task.duration;
    } else {
      this.failedTasks++;
    }

    // Path efficiency:
    // Path Efficiency = (Planned Path Length / Actual Travelled Distance) * 100
    // If actual distance is near zero (e.g. already at goal), path efficiency is 100%
    if (task.actualTravelledDistance <= 0.001) {
      task.pathEfficiency = 100.0;
    } else {
      task.pathEfficiency = (task.plannedPathLength / task.actualTravelledDistance) * 100.0;
    }

    // Accumulate task lengths for overall metrics
    this.totalPlannedPathLength += task.plannedPathLength;
    this.totalActualPathLength += task.actualTravelledDistance;

    this._updateOverallEfficiency();
    this._updateSuccessRate();

    this.taskHistory.unshift({ ...task });
    if (this.taskHistory.length > this.config.limits.maxNavTaskHistory) {
      this.taskHistory.pop();
    }

    this.activeTask = null;
    return task;
  }

  /**
   * Integrates robot physical displacement and steps active task timer.
   * Call once per physics/simulation step.
   *
   * @param {number} dt Frame delta time in seconds
   * @param {{x: number, y: number, z: number}} currentRobotPose
   * @param {boolean} isNavigating Whether navigation controller is actively guiding robot
   */
  update(dt, currentRobotPose, isNavigating = false) {
    if (!currentRobotPose) return;

    if (this.prevRobotPose) {
      const dx = currentRobotPose.x - this.prevRobotPose.x;
      const dz = currentRobotPose.z - this.prevRobotPose.z;
      const dist = Math.hypot(dx, dz);

      // Filter out teleport / court reset jumps (> 25m)
      if (dist > 0 && dist < 25.0) {
        this.totalDistanceTravelled += dist;

        if (this.activeTask && !this.activeTask.isFinished) {
          this.activeTask.actualTravelledDistance += dist;
        }
      }
    }

    this.prevRobotPose = { x: currentRobotPose.x, z: currentRobotPose.z };

    if (isNavigating) {
      this.totalNavigationTime += dt;
      if (this.activeTask && !this.activeTask.isFinished) {
        this.activeTask.duration += dt;
      }
    }
  }

  /**
   * Calculates path efficiency.
   * Formula: Path Efficiency = (Planned Path Length / Actual Travelled Distance) * 100
   * @private
   */
  _updateOverallEfficiency() {
    if (this.totalActualPathLength <= 0.001) {
      this.overallPathEfficiency = 100.0;
    } else {
      this.overallPathEfficiency = (this.totalPlannedPathLength / this.totalActualPathLength) * 100.0;
    }
  }

  /**
   * Calculates navigation success rate.
   * Formula: Success Rate = (Successful Tasks / (Successful Tasks + Failed Tasks)) * 100
   * @private
   */
  _updateSuccessRate() {
    const totalFinished = this.successfulTasks + this.failedTasks;
    if (totalFinished <= 0) {
      this.navigationSuccessRate = 0.0;
    } else {
      this.navigationSuccessRate = (this.successfulTasks / totalFinished) * 100.0;
    }
  }

  /**
   * Average duration of successful tasks in seconds.
   */
  getAverageTimeToReachTarget() {
    return this.successfulTasks > 0 ? (this.totalSuccessfulDuration / this.successfulTasks) : 0.0;
  }

  /**
   * Returns comprehensive telemetry packet.
   */
  getTelemetry() {
    return {
      totalDistanceTravelled: this.totalDistanceTravelled,
      totalNavigationTime: this.totalNavigationTime,
      successfulTasks: this.successfulTasks,
      failedTasks: this.failedTasks,
      totalTasksStarted: this.totalTasksStarted,
      navigationSuccessRate: this.navigationSuccessRate,
      totalPlannedPathLength: this.totalPlannedPathLength,
      totalActualPathLength: this.totalActualPathLength,
      overallPathEfficiency: this.overallPathEfficiency,
      obstacleEncounters: this.obstacleEncounters,
      replanningEvents: this.replanningEvents,
      averageTimeToTarget: this.getAverageTimeToReachTarget(),
      activeTask: this.activeTask ? { ...this.activeTask } : null,
      recentTasksCount: this.taskHistory.length
    };
  }
}
