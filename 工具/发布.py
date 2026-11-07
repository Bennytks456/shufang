#!/usr/bin/env python3
"""发布书房新版本：python3 工具/发布.py "这次改了什么"

1. 从 app.js 读出 VERSION（版本号只在 app.js 改这一处）
2. 写 version.json（手机上的「检查更新」看这个）
3. 把 index.html 里 app.js / style.css / zip.js 的网址加上 ?v=版本号，保证手机拿到的是新文件
4. git 提交并推送
"""
import json, re, subprocess, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GIT = ["git", "-c", "user.name=Bennytks456", "-c", "user.email=bennytks456@users.noreply.github.com"]


def main():
    note = sys.argv[1] if len(sys.argv) > 1 else ""
    m = re.search(r"const VERSION = '([\d.]+)'", (ROOT / "app.js").read_text("utf-8"))
    if not m:
        sys.exit("app.js 里找不到 VERSION")
    v = m.group(1)
    (ROOT / "version.json").write_text(json.dumps({"v": v, "note": note, "at": int(time.time())}, ensure_ascii=False) + "\n", "utf-8")
    html = (ROOT / "index.html").read_text("utf-8")
    for f in ("app.js", "style.css", "zip.js"):
        html = re.sub(rf'(["\']){re.escape(f)}(\?v=[\d.]+)?\1', rf'\g<1>{f}?v={v}\g<1>', html)
    (ROOT / "index.html").write_text(html, "utf-8")
    if "--no-push" in sys.argv:
        print(f"已准备 V{v}（没推送）"); return
    subprocess.run([*GIT, "add", "-A"], cwd=ROOT, check=True)
    msg = f"V{v}：{note}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
    subprocess.run([*GIT, "commit", "-q", "-m", msg], cwd=ROOT, check=True)
    subprocess.run([*GIT, "push", "-q"], cwd=ROOT, check=True)
    print(f"已发布 V{v}：{note}")


if __name__ == "__main__":
    main()
