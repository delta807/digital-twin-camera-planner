/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';

/**
 * coverage.ts — decide whether a workspace point is ACTUALLY captured by the sensor.
 *
 * "Inside the frustum" only tells you the camera is *pointed* at a spot. Honest
 * coverage also needs occlusion: a cube directly behind the robot arm is in-frustum
 * but invisible. This predicate answers the real question the drag-and-dropper cares
 * about — "would my D435i actually see this point from here?".
 *
 * ── The two knobs that define "covered" (your design call) ──────────────────────
 *
 *  SELF_HIT_EPSILON: how far short of the target point we stop the occlusion ray.
 *    Sample points sit ON surfaces (e.g. a cube's body), so a ray to them grazes
 *    that surface first and would report the object as occluding itself.
 *      • too small  → solid objects flag themselves as occluded (false "blind spots")
 *      • too large  → thin occluders right next to the point get missed
 *    Default 0.03 m clears a ~4 cm cube's self-hit while still catching the arm.
 *
 *  REQUIRE_DEPTH_RANGE: whether a point beyond the sensor's near/far must count as
 *    NOT covered. A D435i returns no usable depth past ~3 m, so true is the honest
 *    choice for a depth sensor; flip to false to treat it as an RGB-only camera.
 */
const SELF_HIT_EPSILON = 0.03;
const REQUIRE_DEPTH_RANGE = true;

const _camPos = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _ndc = new THREE.Vector3();

/**
 * @param point        world-space point to test (matrices of sensorCamera must be current)
 * @param sensorCamera the placeable camera (perspective)
 * @param raycaster    a reusable THREE.Raycaster (state is overwritten)
 * @param occluders    scene meshes that can block the view (robot links, cubes, floor…)
 * @returns true iff the point is inside the FOV (and depth range) AND not occluded.
 */
export function isPointVisibleFromSensor(
  point: THREE.Vector3,
  sensorCamera: THREE.PerspectiveCamera,
  raycaster: THREE.Raycaster,
  occluders: THREE.Object3D[],
): boolean {
  // 1. Frustum + depth test. project() maps the point into normalized device
  //    coords; anything outside the [-1,1] box is off-screen, and the z component
  //    falls outside [-1,1] exactly when the point is nearer than `near` or
  //    farther than `far`.
  _ndc.copy(point).project(sensorCamera);
  if (_ndc.x < -1 || _ndc.x > 1 || _ndc.y < -1 || _ndc.y > 1) return false;
  if (REQUIRE_DEPTH_RANGE && (_ndc.z < -1 || _ndc.z > 1)) return false;

  // 2. Occlusion test. Cast from the camera toward the point; if anything is hit
  //    before we reach it (minus the self-hit epsilon), the view is blocked.
  _camPos.setFromMatrixPosition(sensorCamera.matrixWorld);
  _dir.copy(point).sub(_camPos);
  const dist = _dir.length();
  if (dist <= SELF_HIT_EPSILON) return true; // point is essentially at the lens
  raycaster.set(_camPos, _dir.normalize());
  raycaster.far = dist - SELF_HIT_EPSILON;
  return raycaster.intersectObjects(occluders, true).length === 0;
}
