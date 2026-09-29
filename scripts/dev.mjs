#!/usr/bin/env node
// Runs the game server (tsx watch) and the Vite client together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const procs = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'src/server/main.ts'], { stdio: 'inherit', env: { ...process.env } }),
  spawn('npx', ['vite'], { stdio: 'inherit', env: { ...process.env } }),
];
const stop = () => {
  for (const p of procs) if (!p.killed) p.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) { console.error(`dev process exited with ${code}`); stop(); } });
