// Basic unit test for Pause/Resume events (no framework).
// Run with: npx ts-node tests/pauseResume.test.ts
 type PauseEvent = { start: number; end: number };
function accumulatePauses(events: PauseEvent[]): number {
  return events.reduce((acc, e)=> acc + Math.max(0, e.end - e.start), 0);
}
const events: PauseEvent[] = [
  { start: 12.0, end: 15.3 },
  { start: 47.1, end: 48.0 }
];
const total = accumulatePauses(events);
if (Math.abs(total - 4.2) < 1e-6) {
  console.log('✅ Pause/Resume accumulation OK');
} else {
  console.error('❌ Expected 4.2, got', total);
  process.exit(1);
}
