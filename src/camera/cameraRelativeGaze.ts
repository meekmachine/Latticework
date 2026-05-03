import * as THREE from 'three';
import {
  computeCameraRelativeGazeOffset,
  type CameraRelativeGazeOffset,
  type CameraRelativeGazeOptions,
} from '@lovelace_lol/loom3';

export type CameraRelativeGazeController = {
  camera: THREE.Camera;
  controls: {
    target: THREE.Vector3;
    domElement?: HTMLElement | null;
    addEventListener?: (type: 'change', listener: () => void) => void;
    removeEventListener?: (type: 'change', listener: () => void) => void;
  };
  getModel?: () => THREE.Object3D | null;
};

export type { CameraRelativeGazeOffset, CameraRelativeGazeOptions };
export { computeCameraRelativeGazeOffset };

interface CameraRelativeGazeTrackerOptions extends CameraRelativeGazeOptions {
  enabled?: boolean;
  onChange?: (offset: CameraRelativeGazeOffset) => void;
}

const DEFAULT_EPSILON = 1e-4;
const ZERO_OFFSET: CameraRelativeGazeOffset = { x: 0, y: 0 };
const projectedAnchorScratch = new THREE.Vector3();
const modelWorldQuaternionScratch = new THREE.Quaternion();
const cameraRightLocalScratch = new THREE.Vector3();
const cameraUpLocalScratch = new THREE.Vector3();
const localMouseDirectionScratch = new THREE.Vector3();

function clampUnit(value: number): number {
  return THREE.MathUtils.clamp(value, -1, 1);
}

function hasVectorChanged(
  current: THREE.Vector3,
  previous: THREE.Vector3,
  epsilon: number
): boolean {
  return (
    Math.abs(current.x - previous.x) > epsilon ||
    Math.abs(current.y - previous.y) > epsilon ||
    Math.abs(current.z - previous.z) > epsilon
  );
}

export function computeCharacterRelativePointerTarget(
  controller: CameraRelativeGazeController | null,
  event: Pick<MouseEvent, 'clientX' | 'clientY'>,
  fallbackSize?: { width: number; height: number }
): CameraRelativeGazeOffset {
  const rect = controller?.controls.domElement?.getBoundingClientRect();
  const left = rect?.left ?? 0;
  const top = rect?.top ?? 0;
  const windowWidth = typeof window !== 'undefined' ? window.innerWidth : 1;
  const windowHeight = typeof window !== 'undefined' ? window.innerHeight : 1;
  const width = rect?.width || fallbackSize?.width || windowWidth || 1;
  const height = rect?.height || fallbackSize?.height || windowHeight || 1;
  const pointerX = ((event.clientX - left) / width) * 2 - 1;
  const pointerY = -(((event.clientY - top) / height) * 2 - 1);

  if (!controller) {
    return {
      x: -clampUnit(pointerX),
      y: clampUnit(pointerY),
    };
  }

  const camera = controller.camera;
  const anchor = controller.controls.target;
  camera.updateMatrixWorld(true);

  const projectedAnchor = projectedAnchorScratch.copy(anchor).project(camera);
  const anchorX = Number.isFinite(projectedAnchor.x) ? clampUnit(projectedAnchor.x) : 0;
  const anchorY = Number.isFinite(projectedAnchor.y) ? clampUnit(projectedAnchor.y) : 0;
  const dx = pointerX - anchorX;
  const dy = pointerY - anchorY;
  const model = controller.getModel?.() ?? null;
  const xRange = dx >= 0
    ? Math.max(1 - anchorX, DEFAULT_EPSILON)
    : Math.max(anchorX + 1, DEFAULT_EPSILON);
  const yRange = dy >= 0
    ? Math.max(1 - anchorY, DEFAULT_EPSILON)
    : Math.max(anchorY + 1, DEFAULT_EPSILON);
  const normalizedX = clampUnit(dx / xRange);
  const normalizedY = clampUnit(dy / yRange);

  if (!model) {
    return {
      x: -normalizedX,
      y: normalizedY,
    };
  }

  model.updateWorldMatrix(true, false);

  model.getWorldQuaternion(modelWorldQuaternionScratch).invert();
  const cameraRightLocal = cameraRightLocalScratch
    .setFromMatrixColumn(camera.matrixWorld, 0)
    .normalize()
    .applyQuaternion(modelWorldQuaternionScratch);
  const cameraUpLocal = cameraUpLocalScratch
    .setFromMatrixColumn(camera.matrixWorld, 1)
    .normalize()
    .applyQuaternion(modelWorldQuaternionScratch);
  const localMouseDirection = localMouseDirectionScratch
    .copy(cameraRightLocal)
    .multiplyScalar(normalizedX)
    .add(cameraUpLocal.multiplyScalar(normalizedY));

  return {
    x: -clampUnit(localMouseDirection.x),
    y: clampUnit(localMouseDirection.y),
  };
}

export class CameraRelativeGazeTracker {
  private offset: CameraRelativeGazeOffset = ZERO_OFFSET;
  private hasCameraState = false;
  private lastCameraPosition = new THREE.Vector3();
  private lastControlsTarget = new THREE.Vector3();
  private enabled = false;
  private subscribed = false;

  constructor(
    private controller: CameraRelativeGazeController,
    private options: CameraRelativeGazeTrackerOptions = {}
  ) {
    this.setEnabled(options.enabled ?? true);
  }

  public getOffset(): CameraRelativeGazeOffset {
    return this.offset;
  }

  public setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      if (enabled) {
        this.setSubscribed(true);
        this.refresh(true);
      }
      return;
    }

    this.enabled = enabled;

    if (!enabled) {
      this.setSubscribed(false);
      if (this.resetOffset()) {
        this.options.onChange?.(this.offset);
      }
      return;
    }

    this.setSubscribed(true);
    if (this.refresh(true)) {
      this.options.onChange?.(this.offset);
    }
  }

  public dispose(): void {
    this.setSubscribed(false);
  }

  private handleCameraChange = (): void => {
    if (!this.enabled) {
      return;
    }

    if (this.refresh()) {
      this.options.onChange?.(this.offset);
    }
  };

  private resetOffset(): boolean {
    const epsilon = this.options.epsilon ?? DEFAULT_EPSILON;
    const changed =
      Math.abs(this.offset.x) > epsilon ||
      Math.abs(this.offset.y) > epsilon ||
      this.hasCameraState;

    this.offset = ZERO_OFFSET;
    this.hasCameraState = false;
    return changed;
  }

  private hasCameraStateChanged(epsilon: number): boolean {
    if (!this.hasCameraState) {
      return true;
    }

    return (
      hasVectorChanged(this.controller.camera.position, this.lastCameraPosition, epsilon) ||
      hasVectorChanged(this.controller.controls.target, this.lastControlsTarget, epsilon)
    );
  }

  private captureCameraState(): void {
    this.lastCameraPosition.copy(this.controller.camera.position);
    this.lastControlsTarget.copy(this.controller.controls.target);
    this.hasCameraState = true;
  }

  private refresh(force = false): boolean {
    if (!this.enabled) {
      return this.resetOffset();
    }

    const epsilon = this.options.epsilon ?? DEFAULT_EPSILON;
    if (!force && !this.hasCameraStateChanged(epsilon)) {
      return false;
    }

    const nextOffset = computeCameraRelativeGazeOffset(
      this.controller.getModel?.() ?? null,
      this.controller.camera.position,
      this.controller.controls.target,
      this.options
    );

    const changed =
      force ||
      Math.abs(nextOffset.x - this.offset.x) > epsilon ||
      Math.abs(nextOffset.y - this.offset.y) > epsilon;

    this.offset = nextOffset;
    this.captureCameraState();
    return changed;
  }

  private setSubscribed(subscribed: boolean): void {
    if (this.subscribed === subscribed) {
      return;
    }

    this.subscribed = subscribed;
    if (subscribed) {
      this.controller.controls.addEventListener?.('change', this.handleCameraChange);
    } else {
      this.controller.controls.removeEventListener?.('change', this.handleCameraChange);
    }
  }
}
