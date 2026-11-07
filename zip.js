// 极简 zip 读取（给 epub 用），靠浏览器自带的 DecompressionStream 解压
window.readZip = async function (buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是有效的 epub/zip 文件');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = {};
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    entries[name] = { method, csize, off };
    p += 46 + nlen + elen + clen;
  }
  async function data(name) {
    const e = entries[name];
    if (!e) return null;
    const ln = dv.getUint16(e.off + 26, true), le = dv.getUint16(e.off + 28, true);
    const start = e.off + 30 + ln + le;
    const raw = u8.slice(start, start + e.csize);
    if (e.method === 0) return raw;
    if (e.method !== 8) throw new Error('不支持的压缩方式');
    const ds = new DecompressionStream('deflate-raw');
    const out = new Blob([raw]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  return {
    names: Object.keys(entries),
    async text(name) { const d = await data(name); return d ? dec.decode(d) : null; },
  };
};
