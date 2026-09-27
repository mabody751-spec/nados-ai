# Nados v1.1 external CPU inference server (Kaggle kernel, no GPU required).
# Loads a GGUF base + the trained LoRA and serves an OpenAI-compatible API at
# /health and /v1/chat/completions over a public Cloudflare tunnel.
import os, sys, time, json, re, subprocess, threading, urllib.request

MODEL_SIZE = os.environ.get("NADOS_SERVE_MODEL", "mini")  # 'mini' (2B, fast CPU) or 'full' (9B)
PORT = int(os.environ.get("NADOS_SERVE_PORT", "8080"))

def run(cmd):
    return subprocess.run(cmd, shell=True, capture_output=True, text=True)

def log(*args):
    print(*args, flush=True)

# 1) Dependencies (prebuilt CPU wheel -> no long compile).
log("== installing llama-cpp-python (CPU wheel) ==")
run('pip -q install --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu "llama-cpp-python" fastapi "uvicorn[standard]"')

# 2) Models
if MODEL_SIZE == "full":
    base_url = "https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf"
    lora_url = "https://huggingface.co/noore7xd/nados-models/resolve/main/nados-v1-1-lora.gguf"
else:
    base_url = "https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf"
    lora_url = "https://huggingface.co/noore7xd/nados-models/resolve/main/nados-v1-1-mini-lora.gguf"

for path, url in (("base.gguf", base_url), ("nados-lora.gguf", lora_url)):
    if not os.path.exists(path):
        log(f"== downloading {path} ==")
        run(f'wget -q "{url}" -O {path}')
    size = os.path.getsize(path) if os.path.exists(path) else 0
    log(f"{path}: {round(size/1024**2,1)} MB")
    if size < 1024 * 1024:
        log(f"FATAL: {path} download failed")
        sys.exit(1)

# 3) Load model + LoRA
log("== loading model ==")
from llama_cpp import Llama
from fastapi import FastAPI, Request
import uvicorn

llm = Llama(model_path="base.gguf", lora_path="nados-lora.gguf", n_ctx=2048, n_threads=4, n_batch=256, verbose=False)
log("model loaded")

app = FastAPI()

@app.get("/health")
def health():
    return {"status": "ok", "model": f"Nados v1.1 ({MODEL_SIZE})"}

@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": "nados-v1-1", "object": "model"}]}

@app.post("/v1/chat/completions")
async def chat(request: Request):
    body = await request.json()
    messages = body.get("messages", []) or []
    # Gemma's chat template has no system role: fold any system message into the
    # first user turn so clients that send a system prompt still work.
    systems = [m for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    if systems:
        prefix = "\n\n".join(str(m.get("content", "")) for m in systems).strip()
        if rest:
            rest = [{**rest[0], "content": f"{prefix}\n\n{rest[0].get('content', '')}".strip()}, *rest[1:]]
        elif prefix:
            rest = [{"role": "user", "content": prefix}]
    try:
        out = llm.create_chat_completion(
            messages=rest,
            max_tokens=min(int(body.get("max_tokens", 512) or 512), 1024),
            temperature=float(body.get("temperature", 0.7) or 0.7),
        )
        return out
    except Exception as exc:
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": {"message": str(exc)[:300]}})

def serve():
    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="warning")

threading.Thread(target=serve, daemon=True).start()

log("== waiting for server ==")
url = None
for _ in range(40):
    time.sleep(3)
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=3) as r:
            if b"ok" in r.read():
                url = f"http://127.0.0.1:{PORT}"
                break
    except Exception:
        pass
log("server ready" if url else "server not responding yet")

# 4) Public tunnel
log("== starting cloudflared tunnel ==")
run('wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -O cloudflared')
run('chmod +x cloudflared')
tunnel = subprocess.Popen(['./cloudflared', 'tunnel', '--url', f'http://localhost:{PORT}', '--no-autoupdate'],
                          stdout=open('tunnel.log', 'w'), stderr=subprocess.STDOUT)

public = None
for _ in range(12):
    time.sleep(10)
    try:
        tlog = open('tunnel.log').read()
    except Exception:
        tlog = ''
    m = re.search(r'https://[a-z0-9-]+\.trycloudflare\.com', tlog)
    if m:
        public = m.group(0)
        break

log("=" * 60)
if public:
    log(f"NADOS_PUBLIC_URL={public}")
    log(f"شغّل محلياً: node scripts/connect-nados.mjs {public} --prefer")
    try:
        with open('/kaggle/working/url.txt', 'w') as f:
            f.write(public)
    except Exception:
        pass
    # Best-effort public announce (no account needed) so the local machine can
    # discover the tunnel URL without reading Kaggle output mid-run.
    topic = os.environ.get("NADOS_NTFY_TOPIC", "nados-d84a3c374bb9")
    if topic:
        run(f'curl -s -d "{public}" https://ntfy.sh/{topic} >/dev/null 2>&1')
else:
    log("NADOS_PUBLIC_URL=NOT_FOUND — see tunnel.log")
    try:
        log(open('tunnel.log').read()[:800])
    except Exception:
        pass
log("=" * 60)

# Keep the kernel alive so the tunnel stays up.
while True:
    time.sleep(60)
