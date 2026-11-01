/**
 * RobotInputController.js
 * Keyboard teleoperation and UI event handler for manual robot driving.
 * Supports simultaneous key combinations (e.g. W + A for forward-left arc),
 * clean key-release stopping, browser scroll interception, and Emergency Stop.
 */

export class RobotInputController {
  /**
   * @param {import('./DifferentialDriveController.js').DifferentialDriveController} driveController
   * @param {() => boolean} isSimulationActive Predicate checking if simulation is running
   * @param {(() => void) | null} [onManualAction] Callback when a manual teleop key is engaged
   */
  constructor(driveController, isSimulationActive = () => true, onManualAction = null) {
    this.driveController = driveController;
    this.isSimulationActive = isSimulationActive;
    this.onManualAction = onManualAction;

    // Active key state tracker
    this.keys = {
      forward: false,
      reverse: false,
      left: false,
      right: false
    };

    // Teleoperation drive speeds
    this.driveSpeed = 1.6;     // m/s
    this.turnSpeed = 2.4;      // rad/s

    this.boundKeyDown = this.handleKeyDown.bind(this);
    this.boundKeyUp = this.handleKeyUp.bind(this);
    this.boundBlur = this.handleBlur.bind(this);

    this.bindEvents();
  }

  bindEvents() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.boundKeyDown);
      window.addEventListener('keyup', this.boundKeyUp);
      window.addEventListener('blur', this.boundBlur);
    }
  }

  /**
   * Cleans up event listeners.
   */
  destroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.boundKeyDown);
      window.removeEventListener('keyup', this.boundKeyUp);
      window.removeEventListener('blur', this.boundBlur);
    }
  }

  /**
   * Handles keydown events.
   */
  handleKeyDown(e) {
    // Ignore input if user is focusing an input element
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (!this.isSimulationActive()) return;

    let handled = false;

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = true;
        handled = true;
        break;

      case 'KeyS':
      case 'ArrowDown':
        this.keys.reverse = true;
        handled = true;
        break;

      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = true;
        handled = true;
        break;

      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = true;
        handled = true;
        break;

      case 'Space':
        // Milestone 2 Requirement: Space is Emergency Stop
        this.driveController.emergencyStop();
        this.resetKeys();
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      if (this.onManualAction && (this.keys.forward || this.keys.reverse || this.keys.left || this.keys.right)) {
        this.onManualAction();
      }
      this.updateActuatorCommands();
    }
  }

  /**
   * Handles keyup events.
   */
  handleKeyUp(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    let handled = false;

    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keys.forward = false;
        handled = true;
        break;

      case 'KeyS':
      case 'ArrowDown':
        this.keys.reverse = false;
        handled = true;
        break;

      case 'KeyA':
      case 'ArrowLeft':
        this.keys.left = false;
        handled = true;
        break;

      case 'KeyD':
      case 'ArrowRight':
        this.keys.right = false;
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      if (this.onManualAction && (this.keys.forward || this.keys.reverse || this.keys.left || this.keys.right)) {
        this.onManualAction();
      }
      this.updateActuatorCommands();
    }
  }

  /**
   * When window loses focus, safely zero all teleoperation inputs.
   */
  handleBlur() {
    this.resetKeys();
    this.updateActuatorCommands();
  }

  /**
   * Resets all internal key states.
   */
  resetKeys() {
    this.keys.forward = false;
    this.keys.reverse = false;
    this.keys.left = false;
    this.keys.right = false;
  }

  /**
   * Computes desired linear and angular velocities from active key combinations
   * and dispatches them to the DifferentialDriveController.
   */
  updateActuatorCommands() {
    // If in E_STOP, any movement key press can attempt to release it if explicitly intended,
    // or keep in E_STOP until user triggers forward or release.
    if (this.driveController.mode === 'E_STOP') {
      // If user released space and pressed a movement key, we can release E_STOP
      if (this.keys.forward || this.keys.reverse || this.keys.left || this.keys.right) {
        this.driveController.releaseEmergencyStop();
      } else {
        return;
      }
    }

    let targetLinear = 0.0;
    let targetAngular = 0.0;

    // Longitudinal control
    if (this.keys.forward && !this.keys.reverse) {
      targetLinear = this.driveSpeed;
    } else if (this.keys.reverse && !this.keys.forward) {
      targetLinear = -this.driveSpeed;
    }

    // Rotational control (Left is positive angular velocity, Right is negative)
    if (this.keys.left && !this.keys.right) {
      targetAngular = this.turnSpeed;
    } else if (this.keys.right && !this.keys.left) {
      targetAngular = -this.turnSpeed;
    }

    this.driveController.setTargetVelocity(targetLinear, targetAngular);
  }

  // UI Button programmatic actions
  setUiAction(action, isPressed) {
    if (action === 'estop') {
      this.driveController.emergencyStop();
      this.resetKeys();
      return;
    }

    if (this.keys[action] !== undefined) {
      this.keys[action] = isPressed;
      this.updateActuatorCommands();
    }
  }
}
