#!/usr/bin/env python3
"""自动同步：导出桌面上的书 → 压缩 → 加密 → 有变化才上传到 shufang-data 仓库。

密钥和本地仓库都放在 ~/.shufang/，不进任何 git 仓库。
加密：PBKDF2-SHA256(密钥, 随机盐, 200000 次) → AES-256-GCM。
文件格式 lib.bin：b"SF1" + 盐(16) + iv(12) + 密文(含 16 字节校验)  ← 整包，给旧版手机用

按章同步（V15.5.0 起，手机只下载改过的章）：
  idx.bin      b"SF2" + 盐(16) + iv(12) + 密文：目录（每本书的章名、每章的文件编号、封面编号）
  c/<编号>.bin  iv(12) + 密文：一章（或一张封面），gzip 过的 JSON
  盐固定存在 ~/.shufang/盐2.bin，钥匙不变，没改的章文件就不用重写、不用重传。
  文件编号 = HMAC(钥匙, 章节内容) 前 24 位，看不出是哪一章。
"""
import gzip, hashlib, hmac, json, os, secrets, subprocess, sys, time
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


SALT2 = HOME / "盐2.bin"


def split_key(key, saltfile=SALT2):
    if not saltfile.exists():
        saltfile.write_bytes(secrets.token_bytes(16))
        os.chmod(saltfile, 0o600)
    salt = saltfile.read_bytes()
    return salt, hashlib.pbkdf2_hmac("sha256", norm(key).encode(), salt, 200000, 32)


def chapter_raw(ch):
    # 手机那边用 JSON.stringify({t, v, x}) 算同一个编号，格式要一模一样
    return json.dumps({"t": ch["t"], "v": ch["v"], "x": ch["x"]}, ensure_ascii=False, separators=(",", ":")).encode()


def write_split(lib, key, outdir, saltfile=SALT2):
    """按章写加密小文件 + 加密目录；没变的章不重写；用不到的旧文件删掉"""
    salt, dk = split_key(key, saltfile)
    aes = AESGCM(dk)
    enc = lambda data: (lambda iv: iv + aes.encrypt(iv, data, None))(secrets.token_bytes(12))
    fid = lambda raw: hmac.new(dk, raw, "sha256").hexdigest()[:24]
    cdir = outdir / "c"
    cdir.mkdir(parents=True, exist_ok=True)
    used, books, new_files = set(), [], 0
    for b in lib["books"]:
        chs = []
        for ch in b["chapters"]:
            raw = chapter_raw(ch)
            f = fid(raw)
            path = cdir / f"{f}.bin"
            if not path.exists():
                path.write_bytes(enc(gzip.compress(raw, 9))); new_files += 1
            used.add(path.name)
            chs.append({"t": ch["t"], "v": ch["v"], "f": f})
        entry = {"key": b["key"], "title": b["title"], "h": b["h"], "chapters": chs}
        if b.get("cover"):
            raw = b["cover"].encode()
            f = fid(raw)
            path = cdir / f"{f}.bin"
            if not path.exists():
                path.write_bytes(enc(gzip.compress(raw, 6))); new_files += 1
            used.add(path.name)
            entry["cover"] = f
        books.append(entry)
    idx = {"format": "shufang2", "exportedAt": lib["exportedAt"], "books": books, "excluded": lib.get("excluded", [])}
    (outdir / "idx.bin").write_bytes(b"SF2" + salt + enc(gzip.compress(json.dumps(idx, ensure_ascii=False).encode(), 9)))
    removed = 0
    for path in cdir.glob("*.bin"):
        if path.name not in used:
            path.unlink(); removed += 1
    return new_files, removed


def log(*a):
    print(time.strftime("%m-%d %H:%M"), *a, flush=True)


def main():
    key = get_key()
    scanned = exp.scan()
    # 先只看修改时间：都没变就不读文件、不上传
    digest = exp.signature(scanned)
    stamp = HOME / "上次同步.txt"
    if stamp.exists() and stamp.read_text().strip() == digest and "--force" not in sys.argv:
        log("没有变化"); return
    lib = exp.collect(scanned=scanned)
    if "--dry" in sys.argv:
        log(f"试跑：读到 {len(lib['books'])} 本"); return
    lib["exportedAt"] = int(time.time())
    blob = encrypt(gzip.compress(json.dumps(lib, ensure_ascii=False).encode(), 9), key)

    REPO.mkdir(parents=True, exist_ok=True)
    (REPO / "lib.bin").write_bytes(blob)
    new_files, removed = write_split(lib, key, REPO)
    (REPO / "ver.json").write_text(json.dumps({"v": digest, "at": lib["exportedAt"], "s": 2}))
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
    log(f"已上传 {len(lib['books'])} 本 {n} 章（整包 {len(blob) // 1024} KB；按章新写 {new_files} 个、删掉 {removed} 个）")


if __name__ == "__main__":
    main()
