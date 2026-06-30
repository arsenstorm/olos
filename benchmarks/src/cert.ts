// Self-signed loopback TLS for the local media origin. openssl is the lazy
// choice — already present on every dev box — vs hand-rolling X.509 in JS.

import { spawnSync } from "node:child_process";
import { join } from "node:path";

export function assertLoopback(mediaBaseUrl: string): void {
  const host = new URL(mediaBaseUrl).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(
      `benchmark is local-only; media origin must be loopback, got ${host}`
    );
  }
}

export function generateSelfSignedCert(dir: string): {
  certPath: string;
  keyPath: string;
} {
  const certPath = join(dir, "cert.pem");
  const keyPath = join(dir, "key.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { stdio: "ignore" }
  );
  if (result.status !== 0) {
    throw new Error("openssl failed to generate a self-signed cert");
  }
  return { certPath, keyPath };
}
