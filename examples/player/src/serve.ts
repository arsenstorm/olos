import { join } from "node:path";
import { file, serve } from "bun";

const PORT = Number(process.env.PORT ?? 8788);
const INDEX_PATH = join(import.meta.dir, "..", "index.html");

serve({
  port: PORT,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(file(INDEX_PATH), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response("not found", { status: 404 });
  },
});

console.log(`player at http://localhost:${PORT}/`);
