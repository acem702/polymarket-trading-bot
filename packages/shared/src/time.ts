export function nowMs(): number {
  return Date.now();
}

export function nowSecs(): number {
  return Math.floor(Date.now() / 1000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
