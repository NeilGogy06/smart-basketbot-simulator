/**
 * AnalyticsConfig.js
 * Configuration parameters, buffer limits, and enumerations for the
 * SMART-BASKETBOT simulation analytics and performance monitoring subsystem.
 */

export const ANALYTICS_CONFIG = {
  // Maximum ring buffer capacities to prevent unbounded memory growth
  limits: {
    maxTimeSeriesPoints: 60,       // Points for real-time velocity & PID charts (~6-12s at 5-10Hz)
    maxShotHistory: 100,           // Historical shot records retained in session
    maxNavTaskHistory: 50,         // Historical navigation tasks retained
    maxCollectionHistory: 50,      // Historical ball collection attempts retained
    maxStateTransitions: 100,      // Autonomy state transition records
    maxRecoveriesHistory: 50       // Historical recovery attempts
  },

  // Telemetry sampling and chart update frequencies (seconds)
  sampling: {
    timeSeriesSampleInterval: 0.1, // Sample motion/PID time-series at 10 Hz (every 100ms)
    chartRefreshInterval: 0.25,    // Refresh Chart.js visuals at 4 Hz (every 250ms) to conserve CPU
    shotDeduplicationWindow: 0.4   // Window in seconds within which duplicate shot notifications are merged
  },

  // Motion response detection threshold
  motion: {
    stepResponseThreshold: 0.90,   // 90% rise time threshold
    minVelocityForTracking: 0.05   // Min target velocity (m/s) to track tracking error
  },

  // Navigation tolerance and thresholds
  navigation: {
    minPlannedDistance: 0.1        // Ignore negligible paths (< 10cm) for efficiency calculation
  },

  // Export formats
  exportFormats: ['JSON', 'CSV']
};

export const SHOT_OUTCOMES = {
  SCORED: 'SCORED',
  MISSED_SHORT: 'MISSED_SHORT',
  MISSED_LONG: 'MISSED_LONG',
  MISSED_LEFT: 'MISSED_LEFT',
  MISSED_RIGHT: 'MISSED_RIGHT',
  MISSED: 'MISSED',
  IN_FLIGHT: 'IN_FLIGHT'
};

export const AUTONOMY_STATES_LIST = [
  'IDLE',
  'SEARCHING_FOR_BALL',
  'SELECTING_TARGET',
  'NAVIGATING_TO_BALL',
  'COLLECTING_BALL',
  'SEARCHING_FOR_HOOP',
  'NAVIGATING_TO_SHOOTING_POSITION',
  'ALIGNING_WITH_HOOP',
  'OPTIMIZING_TRAJECTORY',
  'SPINNING_UP_FLYWHEELS',
  'SHOOTING',
  'EVALUATING_SHOT',
  'REACQUIRING_BALL',
  'PAUSED',
  'RECOVERING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
];
