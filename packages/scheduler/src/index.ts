export {
  configPath,
  DEFAULT_CONFIG,
  DEFAULT_RESUME_PROMPT,
  DEFAULT_STATE_DIR,
  DEFAULT_WAIT_CONFIG,
  initConfig,
  loadConfig,
  loadResumePrompt,
  resolveStateDir,
  resumePromptPath,
  type InitResult,
  type LookoutConfig,
  type WaitConfig,
} from './config.js';

export {
  appendLog,
  ensureStateDir,
  newestMtimeUnder,
  readUsageFile,
  resurrectionMarkerKeys,
  statePaths,
  writeResurrectionMarker,
  writeSensorResult,
  type StatePaths,
  type UsageFileRead,
} from './state.js';

export {
  acquireLock,
  DEFAULT_LOCK_POLICY,
  lockLiveness,
  readLock,
  releaseLock,
  touchLock,
  type AcquireResult,
  type LockDeps,
  type LockLiveness,
  type LockPolicy,
  type MissionLock,
} from './lock.js';

export {
  runSensorLoop,
  runSensorOnce,
  type SensorLoopOptions,
  type SensorOptions,
  type SensorTickResult,
} from './sensor.js';

export {
  defaultLastCommitTime,
  defaultSpawnDetached,
  runGuardOnce,
  sensorRelaunchArgv,
  type GuardDeps,
  type GuardRunResult,
  type SpawnRequest,
} from './guard.js';

export { runWaitLoop, type WaitDeps, type WaitOutcome } from './wait.js';

export { main } from './cli.js';
