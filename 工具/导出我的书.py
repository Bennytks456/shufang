#!/usr/bin/env python3
"""把桌面上各本书的正文打包成 library.json，给「书房」APP 用。

规则：桌面上每个文件夹算一本书，书里的子文件夹算一卷，
卷里文件名以「第xx章」开头的 .md 算一章。以 . 开头的文件夹（如 .草稿）不读。
"""
import hashlib, json, re, sys, time
from pathlib import Path

DESKTOP = Path.home() / "Desktop"
OUT = Path(__file__).resolve().parent.parent / "library.json"
SKIP = {"Claude"}
CN = {c: i for i, c in enumerate("零一二三四五六七八九")}


def cn_num(s):
    """一二三…十几 转数字，取不到返回 99"""
    m = re.search(r"第([零一二三四五六七八九十百\d]+)[卷单部]", s)
    if not m:
        return 99
    t = m.group(1)
    if t.isdigit():
        return int(t)
    n, cur = 0, 0
    for ch in t:
        if ch == "百":
            n += (cur or 1) * 100; cur = 0
        elif ch == "十":
            n += (cur or 1) * 10; cur = 0
        else:
            cur = CN.get(ch, 0)
    return n + cur


def vol_key(d):
    name = d.name
    if name.startswith("前传") or name.startswith("序"):
        return (-1, name)
    return (cn_num(name), name)


def chap_no(p):
    m = re.match(r"第(\d+)章", p.name)
    return int(m.group(1)) if m else 0


def clean(text):
    lines = text.splitlines()
    # 去掉开头的 markdown 标题行（卷名、章名，APP 自己会显示）
    while lines and (not lines[0].strip() or lines[0].lstrip().startswith("#")
                     or re.match(r"^第\d+章", lines[0].strip())):
        lines.pop(0)
    return "\n".join(lines).strip()


def vol_title(d):
    return re.sub(r"[_\s]+", " ", d.name).strip()


def collect(verbose=False):
    books = []
    for book in sorted(DESKTOP.iterdir()):
        if not book.is_dir() or book.name.startswith(".") or book.name in SKIP:
            continue
        chapters = []
        vols = [d for d in book.iterdir() if d.is_dir() and not d.name.startswith(".")]
        for vol in sorted(vols, key=vol_key):
            files = [f for f in vol.glob("第*章*.md") if re.match(r"第\d+章", f.name)]
            for f in sorted(files, key=chap_no):
                title = re.sub(r"_", " ", f.stem, count=1).replace("_", " ")
                chapters.append({"t": title, "v": vol_title(vol), "x": clean(f.read_text("utf-8"))})
        if chapters:
            h = hashlib.sha256(json.dumps(chapters, ensure_ascii=False).encode()).hexdigest()[:16]
            books.append({"key": book.name, "title": book.name.replace("_", " "), "h": h, "chapters": chapters})
            if verbose:
                print(f"  《{book.name}》 {len(chapters)} 章")
    return {"format": "shufang", "exportedAt": int(time.time()), "books": books}


def main():
    lib = collect(True)
    books = lib["books"]
    OUT.write_text(json.dumps(lib, ensure_ascii=False), "utf-8")
    print(f"共 {len(books)} 本，已写到 {OUT}（{OUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    sys.exit(main())
