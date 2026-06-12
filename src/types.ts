/**
 * Gridrunner: Neon Eclipse - TypeScript Definitions
 */

import * as THREE from 'three';

export type GameState = 'menu' | 'playing' | 'gameover';

export type ObstacleType = 'barrier' | 'fence' | 'emp';

export type CollectibleType = 'cube' | 'shield';

export interface Obstacle {
  group: THREE.Group;
  type: ObstacleType;
  angle: number;
  z: number;
  hit: boolean;
  passed: boolean;
  gapAngle?: number; // Used for EMP Rings
  gapWidth?: number; // Used for EMP Rings
}

export interface Collectible {
  mesh: THREE.Object3D;
  type: CollectibleType;
  angle: number;
  z: number;
  collected: boolean;
}

export interface PlayerState {
  angle: number;
  jumpHeight: number;
  jumpVelocity: number;
  isJumping: boolean;
  shieldTime: number;
  nitroActive: boolean;
  speed: number;
}
