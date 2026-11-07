#!/usr/bin/env python3
"""自动同步：导出桌面上的书 → 压缩 → 加密 → 有变化才上传到 shufang-data 仓库。

密钥和本地仓库都放在 ~/.shufang/，不进任何 git 仓库。
加密：PBKDF2-SHA256(密钥, 随机盐, 200000 次) → AES-256-GCM。
文件格式 lib.bin：b"SF1" + 盐(16) + iv(12) + 密文(含 16 字节校验)
"""
import gzip, hashlib, json, os, secrets, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util
spec = importlib.util.spec_from_file_location("exp", Path(__file__).resolve().parent / "导出我的书.py")
exp = importlib.util.module_from_spec(spec); spec.loader.exec_module(exp)

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

HOME = Path.home() / ".shufang"
KEYFILE = HOME / "密钥.txt"
REPO = HOME / "data"
REMOTE = "https://github.com/Bennytks456/shufang-data.git"
GIT = ["git", "-c", "user.name=Bennytks456", "-c", "user.email=bennytks456@users.noreply.github.com"]
ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # 去掉容易看错的 I L O 0 1


def get_key():
    HOME.mkdir(exist_ok=True)
    if not KEYFILE.exists():
        k = "-".join("".join(secrets.choice(ALPHA) for _ in range(4)) for _ in range(5))
        KEYFILE.write_text(k + "\n", "utf-8")
        os.chmod(KEYFILE, 0o600)
    return KEYFILE.read_text("utf-8").strip()


def norm(k):
    return "".join(c for c in k.upper() if c.isalnum())


def encrypt(data, key):
    salt, iv = secrets.token_bytes(16), secrets.token_bytes(12)
    dk = hashlib.pbkdf2_hmac("sha256", norm(key).encode(), salt, 200000, 32)
    return b"SF1" + salt + iv + AESGCM(dk).encrypt(iv, data, None)


def log(*a):
    print(time.strftime("%m-%d %H:%M"), *a, flush=True)


def main():
    key = get_key()
    lib = exp.collect()
    body = json.dumps(lib["books"], ensure_ascii=False, sort_keys=True).encode()
    digest = hashlib.sha256(body).hexdigest()[:16]
    stamp = HOME / "上次同步.txt"
    if stamp.exists() and stamp.read_text().strip() == digest and "--force" not in sys.argv:
        log("没有变化"); return
    if "--dry" in sys.argv:
        log(f"试跑：读到 {len(lib['books'])} 本"); return
    lib["exportedAt"] = int(time.time())
    blob = encrypt(gzip.compress(json.dumps(lib, ensure_ascii=False).encode(), 9), key)

    REPO.mkdir(parents=True, exist_ok=True)
    (REPO / "lib.bin").write_bytes(blob)
    (REPO / "ver.json").write_text(json.dumps({"v": digest, "at": lib["exportedAt"]}))
    (REPO / ".nojekyll").write_text("")
    run = lambda *c: subprocess.run([*GIT, *c], cwd=REPO, check=True, capture_output=True, text=True)
    if not (REPO / ".git").exists():
        run("init", "-q", "-b", "main"); run("remote", "add", "origin", REMOTE)
    # 每次都只留一个提交，旧版本不堆在网上
    run("checkout", "-q", "--orphan", "tmp"); run("add", "-A")
    run("commit", "-q", "-m", f"sync {digest}")
    subprocess.run([*GIT, "branch", "-D", "main"], cwd=REPO, capture_output=True)
    run("branch", "-m", "main"); run("push", "-q", "-f", "origin", "main")
    stamp.write_text(digest)
    n = sum(len(b["chapters"]) for b in lib["books"])
    log(f"已上传 {len(lib['books'])} 本 {n} 章，{len(blob) // 1024} KB")


if __name__ == "__main__":
    main()
