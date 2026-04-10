/**
 * Eye/Head Tracking Machine
 * Tracks current config, mode, and targets in a single XState actor so UI/debug tools
 * can subscribe to the latest desired gaze and settings.
 */
import { setup, assign } from 'xstate';
import { DEFAULT_EYE_HEAD_CONFIG, type EyeHeadTrackingConfig, type GazeTarget } from './types';

export type EyeHeadTrackingMode = 'manual' | 'mouse' | 'webcam';

export interface EyeHeadTrackingMachineContext {
  config: EyeHeadTrackingConfig;
  mode: EyeHeadTrackingMode;
  target: GazeTarget;
  lastApplied: GazeTarget;
  status: {
    eye: 'idle' | 'tracking' | 'lagging';
    head: 'idle' | 'tracking' | 'lagging';
  };
}

export type EyeHeadTrackingMachineEvent =
  | { type: 'UPDATE_CONFIG'; config: Partial<EyeHeadTrackingConfig> }
  | { type: 'SET_MODE'; mode: EyeHeadTrackingMode }
  | { type: 'SET_TARGET'; target: GazeTarget; lastApplied?: GazeTarget }
  | { type: 'SET_STATUS'; eye?: 'idle' | 'tracking' | 'lagging'; head?: 'idle' | 'tracking' | 'lagging'; lastApplied?: GazeTarget };

export const DEFAULT_EYE_HEAD_MACHINE_CONTEXT: EyeHeadTrackingMachineContext = {
  config: { ...DEFAULT_EYE_HEAD_CONFIG },
  mode: 'manual',
  target: { x: 0, y: 0, z: 0 },
  lastApplied: { x: 0, y: 0, z: 0 },
  status: {
    eye: 'idle',
    head: 'idle',
  },
};

export const eyeHeadTrackingMachine = setup({
  types: {
    context: {} as EyeHeadTrackingMachineContext,
    events: {} as EyeHeadTrackingMachineEvent,
  },
  actions: {
    updateConfig: assign({
      config: ({ context, event }) => {
        if (event.type !== 'UPDATE_CONFIG') return context.config;
        return { ...context.config, ...event.config };
      },
    }),
    setMode: assign({
      mode: ({ context, event }) => (event.type === 'SET_MODE' ? event.mode : context.mode),
    }),
    setTarget: assign({
      target: ({ context, event }) => (event.type === 'SET_TARGET' ? event.target : context.target),
      lastApplied: ({ context, event }) => {
        if (event.type === 'SET_TARGET' && event.lastApplied) return event.lastApplied;
        return context.lastApplied;
      },
    }),
    setStatus: assign({
      status: ({ context, event }) => {
        if (event.type !== 'SET_STATUS') return context.status;
        return {
          eye: event.eye ?? context.status.eye,
          head: event.head ?? context.status.head,
        };
      },
      lastApplied: ({ context, event }) => {
        if (event.type === 'SET_STATUS' && event.lastApplied) return event.lastApplied;
        return context.lastApplied;
      },
    }),
  },
  guards: {},
}).createMachine({
  id: 'eyeHeadTracking',
  initial: 'active',
  context: DEFAULT_EYE_HEAD_MACHINE_CONTEXT,
  states: {
    active: {
      on: {
        UPDATE_CONFIG: { actions: 'updateConfig' },
        SET_MODE: { actions: 'setMode' },
        SET_TARGET: { actions: 'setTarget' },
        SET_STATUS: { actions: 'setStatus' },
      },
    },
  },
});

export type EyeHeadTrackingMachine = typeof eyeHeadTrackingMachine;
