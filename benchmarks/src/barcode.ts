// Timestamp ⇄ video-frame codec — the latency probe.
//
// Each benchmark frame encodes its capture wall-clock (epoch ms) as a row of
// high-contrast cells: one white start cell, 48 data bits (MSB→LSB, white = 1),
// then one black stop cell. The reader center-samples each cell, so fat cells
// survive H.264 4:2:0 subsampling and compression ringing. Carrying the real
// wall-clock in the frame means the consumer recovers capture time directly —
// there is no encoder start-clock to calibrate.
//
// Self-check the roundtrip by running this file directly: `bun benchmarks/barcode.ts`.

const CELL_PX = 16;
// epoch-ms needs 41 bits; 48 leaves headroom and stays well inside a JS double.
const DATA_BITS = 48;
const TOTAL_CELLS = DATA_BITS + 2; // + start and stop markers
const LUMA_THRESHOLD = 127;

export const WIDTH = TOTAL_CELLS * CELL_PX;
export const HEIGHT = 64;
export const FRAME_BYTES = WIDTH * HEIGHT * 4;

function cellColors(valueMs: number): boolean[] {
  const cells = new Array<boolean>(TOTAL_CELLS).fill(false);
  cells[0] = true; // white start marker; stop marker stays black
  let remaining = valueMs;
  for (let bit = DATA_BITS - 1; bit >= 0; bit -= 1) {
    cells[1 + bit] = remaining % 2 === 1;
    remaining = Math.floor(remaining / 2);
  }
  return cells;
}

export function encodeFrame(valueMs: number): Uint8Array {
  const cells = cellColors(valueMs);
  const frame = new Uint8Array(FRAME_BYTES);
  for (let x = 0; x < WIDTH; x += 1) {
    const value = cells[Math.floor(x / CELL_PX)] ? 255 : 0;
    for (let y = 0; y < HEIGHT; y += 1) {
      const offset = (y * WIDTH + x) * 4;
      frame[offset] = value;
      frame[offset + 1] = value;
      frame[offset + 2] = value;
      frame[offset + 3] = 255;
    }
  }
  return frame;
}

// Returns NaN when the frame's sync markers don't match — i.e. it isn't a
// barcode frame we wrote (decode garbage, wrong frame).
export function decodeFrame(rgba: Uint8Array): number {
  const y = Math.floor(HEIGHT / 2);
  const bitAt = (cell: number): boolean => {
    const x = cell * CELL_PX + Math.floor(CELL_PX / 2);
    return (rgba[(y * WIDTH + x) * 4] ?? 0) > LUMA_THRESHOLD;
  };
  if (!bitAt(0) || bitAt(TOTAL_CELLS - 1)) {
    return Number.NaN;
  }
  let value = 0;
  for (let bit = 0; bit < DATA_BITS; bit += 1) {
    value = value * 2 + (bitAt(1 + bit) ? 1 : 0);
  }
  return value;
}

if (import.meta.main) {
  const sample = 1_750_000_000_123;
  if (decodeFrame(encodeFrame(sample)) !== sample) {
    throw new Error("barcode roundtrip failed");
  }
  console.log("barcode roundtrip ok");
}
