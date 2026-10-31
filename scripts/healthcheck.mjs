try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/healthz`, { signal: AbortSignal.timeout(2000) });
  if (!response.ok || (await response.json()).status !== 'ok') process.exitCode = 1;
} catch { process.exitCode = 1; }
