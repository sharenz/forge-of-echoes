// Imported first by main.ts, before anything touches the libuv thread pool (it is sized once, on first
// use). scrypt logins and WebSocket compression share the pool; the default of 4 threads lets a burst of
// logins delay every player's frames. An explicit UV_THREADPOOL_SIZE in the environment wins.
if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = '8';
