import fs from 'node:fs';

// CI uses the Chromium installed by Playwright. Local Windows can reuse Edge/Chrome.
export function browserOptions() {
  if (process.env.BROWSER_EXECUTABLE) {
    if (!fs.existsSync(process.env.BROWSER_EXECUTABLE)) throw new Error('BROWSER_EXECUTABLE does not exist.');
    return { headless: true, executablePath: process.env.BROWSER_EXECUTABLE };
  }
  if (process.platform === 'win32' && !process.env.CI) {
    const executablePath = [
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    ].find(file => fs.existsSync(file));
    if (executablePath) return { headless: true, executablePath };
  }
  return { headless: true };
}
