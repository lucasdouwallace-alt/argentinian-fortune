// Cola de requests para evitar saturar la API de IA
// Limita a 1 request simultáneo con timeout

const queue: Array<() => Promise<Response>> = [];
let running = false;

async function processQueue() {
  if (running || queue.length === 0) return;
  running = true;
  const task = queue.shift()!;
  try {
    await task();
  } finally {
    running = false;
    processQueue();
  }
}

export function queueGeminiCall(fn: () => Promise<Response>): Promise<Response> {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        const result = await fn();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    processQueue();
  });
}
