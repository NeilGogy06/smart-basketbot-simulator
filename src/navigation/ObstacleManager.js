/**
 * ObstacleManager.js
 * Modular registry managing both static environment obstacles and dynamic obstacles
 * (such as the basketball or defense obstacles), syncing them to the navigation grid.
 */

import { SIMULATION_CONFIG } from '../simulation/SimulationConfig.js';

export class ObstacleManager {
  /**
   * @param {import('./NavigationGrid.js').NavigationGrid} grid
   */
  constructor(grid) {
    this.grid = grid;
    this.customObstacles = new Map();
    this.staticObstacles = [];

    this.registerCourtStaticObstacles();
  }

  /**
   * Registers baseline hoop stanchions and perimeter obstacles onto the static grid.
   */
  registerCourtStaticObstacles() {
    const courtLen = SIMULATION_CONFIG.court.length;
    const hoopPostDist = SIMULATION_CONFIG.hoop.supportPostDistance;

    // East Hoop Stanchion Base (+X)
    const eastStanchionX = courtLen / 2 + hoopPostDist;
    this.addStaticBox('hoop_east', eastStanchionX, 0, 1.8, 1.4);

    // West Hoop Stanchion Base (-X)
    const westStanchionX = -(courtLen / 2 + hoopPostDist);
    this.addStaticBox('hoop_west', westStanchionX, 0, 1.8, 1.4);
  }

  /**
   * Adds a static box obstacle and updates the static grid.
   */
  addStaticBox(id, centerX, centerZ, sizeX, sizeZ) {
    this.staticObstacles.push({ id, type: 'box', x: centerX, z: centerZ, sizeX, sizeZ });
    this.grid.addStaticBox(centerX, centerZ, sizeX, sizeZ, true);
  }

  /**
   * Adds or updates a dynamic circular obstacle (e.g. obstacle cone or defense player).
   */
  setDynamicObstacle(id, x, z, radius = 0.3) {
    this.customObstacles.set(id, { x, z, radius });
  }

  /**
   * Removes a dynamic obstacle by id.
   */
  removeDynamicObstacle(id) {
    this.customObstacles.delete(id);
  }

  /**
   * Updates dynamic obstacles on the navigation grid (e.g. ball and defense dummies).
   * @param {{ x: number, z: number } | null} [ballPosition]
   */
  updateGrid(ballPosition = null) {
    this.grid.clearDynamicObstacles();

    // Register active custom obstacles
    for (const [_, obs] of this.customObstacles) {
      this.grid.addDynamicCircle(obs.x, obs.z, obs.radius, true);
    }

    // Register basketball as dynamic obstacle if provided
    if (ballPosition) {
      // Only treat ball as obstacle if it is on the court
      this.grid.addDynamicCircle(ballPosition.x, ballPosition.z, SIMULATION_CONFIG.ball.radius, true);
    }
  }

  /**
   * Checks if a point in world coordinates is inside any registered obstacle margin.
   */
  isPointObstructed(worldX, worldZ) {
    const { col, row } = this.grid.worldToGrid(worldX, worldZ);
    return !this.grid.isWalkable(col, row);
  }
}
