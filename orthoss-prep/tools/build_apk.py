#!/usr/bin/env python3
"""Hand-built APK for OrthoSS Prep: WebView activity loading assets/index.html.
Writes classes.dex and binary AndroidManifest.xml directly, then signs with APK Signature Scheme v2."""
import struct, zlib, hashlib, zipfile, io, os, sys, datetime
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding

PKG = "com.salil.orthossprep"
CLS = "Lcom/salil/orthossprep/MainActivity;"
HTML, OUT, KEYDIR = sys.argv[1], sys.argv[2], sys.argv[3]
VERSION_CODE = int(sys.argv[4]) if len(sys.argv) > 4 else 1
VERSION_NAME = sys.argv[5] if len(sys.argv) > 5 else "1.0"

def uleb(n):
    out = bytearray()
    while True:
        b = n & 0x7f; n >>= 7
        if n: out.append(b | 0x80)
        else: out.append(b); return bytes(out)

# ---------------------------------------------------------------- DEX
def build_dex():
    ACT, CTX, BUN, VIEW = "Landroid/app/Activity;", "Landroid/content/Context;", "Landroid/os/Bundle;", "Landroid/view/View;"
    WS, WV, WVC, STR = "Landroid/webkit/WebSettings;", "Landroid/webkit/WebView;", "Landroid/webkit/WebViewClient;", "Ljava/lang/String;"
    URL = "file:///android_asset/index.html"
    # methods: (class, name, return, params)
    M = {
        "act_init": (ACT, "<init>", "V", ()),
        "act_onCreate": (ACT, "onCreate", "V", (BUN,)),
        "act_setContentView": (ACT, "setContentView", "V", (VIEW,)),
        "act_reqFeature": (ACT, "requestWindowFeature", "Z", ("I",)),
        "ws_js": (WS, "setJavaScriptEnabled", "V", ("Z",)),
        "ws_dom": (WS, "setDomStorageEnabled", "V", ("Z",)),
        "wv_init": (WV, "<init>", "V", (CTX,)),
        "wv_getSettings": (WV, "getSettings", WS, ()),
        "wv_loadUrl": (WV, "loadUrl", "V", (STR,)),
        "wv_setClient": (WV, "setWebViewClient", "V", (WVC,)),
        "wvc_init": (WVC, "<init>", "V", ()),
        "me_init": (CLS, "<init>", "V", ()),
        "me_onCreate": (CLS, "onCreate", "V", (BUN,)),
    }
    def shorty_ch(t): return t if len(t) == 1 else "L"
    def shorty(ret, params): return shorty_ch(ret) + "".join(shorty_ch(p) for p in params)
    types = {CLS, ACT, WV, WVC}
    strings = {URL}
    for c, n, r, ps in M.values():
        types.add(c); types.add(r); types.update(ps)
        strings.add(n); strings.add(shorty(r, ps))
    strings.update(types)
    # MUTF-8 == UTF-8 for ASCII; sort by UTF-16 code units == byte order for ASCII
    S = sorted(strings); sidx = {s: i for i, s in enumerate(S)}
    T = sorted(types, key=lambda t: sidx[t]); tidx = {t: i for i, t in enumerate(T)}
    protos = sorted({(r, ps) for _, _, r, ps in M.values()}, key=lambda p: (tidx[p[0]], [tidx[x] for x in p[1]]))
    pidx = {p: i for i, p in enumerate(protos)}
    mlist = sorted(M.items(), key=lambda kv: (tidx[kv[1][0]], sidx[kv[1][1]], pidx[(kv[1][2], kv[1][3])]))
    midx = {k: i for i, (k, _) in enumerate(mlist)}

    def inv(op, method, regs):  # format 35c
        a = len(regs); r = list(regs) + [0] * (5 - len(regs))
        return [op | (a << 12) | (r[4] << 8), midx[method], r[0] | (r[1] << 4) | (r[2] << 8) | (r[3] << 12)]
    INVOKE_VIRTUAL, INVOKE_SUPER, INVOKE_DIRECT = 0x6e, 0x6f, 0x70
    init_code = inv(INVOKE_DIRECT, "act_init", [0]) + [0x000e]
    # registers: v0 webview, v1 settings, v2 temp, v3 this, v4 bundle
    oc = []
    oc += inv(INVOKE_SUPER, "act_onCreate", [3, 4])
    oc += [0x1212]                                   # const/4 v2, #1 (FEATURE_NO_TITLE)
    oc += inv(INVOKE_VIRTUAL, "act_reqFeature", [3, 2])
    oc += [0x0022, tidx[WV]]                         # new-instance v0, WebView
    oc += inv(INVOKE_DIRECT, "wv_init", [0, 3])
    oc += inv(INVOKE_VIRTUAL, "wv_getSettings", [0])
    oc += [0x010c]                                   # move-result-object v1
    oc += inv(INVOKE_VIRTUAL, "ws_js", [1, 2])
    oc += inv(INVOKE_VIRTUAL, "ws_dom", [1, 2])
    oc += [0x0222, tidx[WVC]]                        # new-instance v2, WebViewClient
    oc += inv(INVOKE_DIRECT, "wvc_init", [2])
    oc += inv(INVOKE_VIRTUAL, "wv_setClient", [0, 2])
    oc += inv(INVOKE_VIRTUAL, "act_setContentView", [3, 0])
    oc += [0x021a, sidx[URL]]                        # const-string v2, URL
    oc += inv(INVOKE_VIRTUAL, "wv_loadUrl", [0, 2])
    oc += [0x000e]

    def code_item(regs, ins, outs, insns):
        b = struct.pack("<HHHHII", regs, ins, outs, 0, 0, len(insns)) + struct.pack("<%dH" % len(insns), *insns)
        return b
    codes = [("me_init", code_item(1, 1, 1, init_code)), ("me_onCreate", code_item(5, 2, 2, oc))]

    n_s, n_t, n_p, n_m = len(S), len(T), len(protos), len(mlist)
    off = 0x70
    string_ids_off = off; off += 4 * n_s
    type_ids_off = off; off += 4 * n_t
    proto_ids_off = off; off += 12 * n_p
    method_ids_off = off; off += 8 * n_m
    class_defs_off = off; off += 32
    data_off = off
    data = bytearray()
    def align4():
        while (data_off + len(data)) % 4: data.append(0)
    # code items
    align4(); code_start = data_off + len(data); code_offs = {}
    for k, c in codes:
        align4(); code_offs[k] = data_off + len(data); data.extend(c)
    # type lists for protos with params
    align4(); tl_start = data_off + len(data); tl_offs = {}; n_tl = 0
    for p in protos:
        if p[1]:
            align4(); tl_offs[p] = data_off + len(data); n_tl += 1
            data.extend(struct.pack("<I", len(p[1])) + b"".join(struct.pack("<H", tidx[x]) for x in p[1]))
    # string data
    sd_start = data_off + len(data); sd_offs = []
    for s in S:
        sd_offs.append(data_off + len(data)); data.extend(uleb(len(s)) + s.encode() + b"\0")
    # class data
    cd_off = data_off + len(data)
    dm = sorted([("me_init", 0x10001)], key=lambda x: midx[x[0]])
    vm = [("me_onCreate", 0x1)]
    cd = uleb(0) + uleb(0) + uleb(len(dm)) + uleb(len(vm))
    for group in (dm, vm):
        prev = 0
        for k, fl in group:
            cd += uleb(midx[k] - prev) + uleb(fl) + uleb(code_offs[k]); prev = midx[k]
    data.extend(cd)
    align4(); map_off = data_off + len(data)
    entries = [(0x0000, 1, 0), (0x0001, n_s, string_ids_off), (0x0002, n_t, type_ids_off), (0x0003, n_p, proto_ids_off),
               (0x0005, n_m, method_ids_off), (0x0006, 1, class_defs_off), (0x2001, len(codes), code_start)]
    if n_tl: entries.append((0x1001, n_tl, tl_start))
    entries += [(0x2002, n_s, sd_start), (0x2000, 1, cd_off), (0x1000, 1, map_off)]
    entries.sort(key=lambda e: e[2])
    data.extend(struct.pack("<I", len(entries)) + b"".join(struct.pack("<HHII", t, 0, n, o) for t, n, o in entries))
    file_size = data_off + len(data)

    body = bytearray()
    body += b"".join(struct.pack("<I", o) for o in sd_offs)
    body += b"".join(struct.pack("<I", sidx[t]) for t in T)
    for r, ps in protos:
        body += struct.pack("<III", sidx[shorty(r, ps)], tidx[r], tl_offs.get((r, ps), 0))
    for k, (c, n, r, ps) in mlist:
        body += struct.pack("<HHI", tidx[c], pidx[(r, ps)], sidx[n])
    body += struct.pack("<IIIIIIII", tidx[CLS], 0x1, tidx[ACT], 0, 0xffffffff, 0, cd_off, 0)
    assert 0x70 + len(body) == data_off
    hdr = bytearray(b"dex\n035\0" + b"\0" * 4 + b"\0" * 20)
    hdr += struct.pack("<IIIIIIII", file_size, 0x70, 0x12345678, 0, 0, map_off, n_s, string_ids_off)
    hdr += struct.pack("<IIIIIIIIIIII", n_t, type_ids_off, n_p, proto_ids_off, 0, 0, n_m, method_ids_off, 1, class_defs_off, file_size - data_off, data_off)
    assert len(hdr) == 0x70
    dex = bytearray(hdr + body + data)
    dex[12:32] = hashlib.sha1(dex[32:]).digest()
    dex[8:12] = struct.pack("<I", zlib.adler32(bytes(dex[12:])) & 0xffffffff)
    return bytes(dex)

# ---------------------------------------------------------------- Binary XML (generic)
NSURI = "http://schemas.android.com/apk/res/android"
STR, INT, HEX, BOOL, REF = 0x03, 0x10, 0x11, 0x12, 0x01
def axml(tree, ATTRS):
    pool = [a for a, _ in ATTRS]
    def si(s):
        if s not in pool: pool.append(s)
        return pool.index(s)
    si("android"); si(NSURI)
    def collect(node):
        tag, attrs, kids = node; si(tag)
        for ns, n, t, v in attrs:
            si(n)
            if t == STR: si(v)
        for k in kids: collect(k)
    collect(tree)
    resid = dict(ATTRS); line = [1]
    def node_bytes(node):
        tag, attrs, kids = node
        attrs = sorted(attrs, key=lambda a: resid.get(a[1], 0xffffffff))
        ab = b""
        for ns, n, t, v in attrs:
            nsi = si(NSURI) if ns else 0xffffffff
            if t == STR: raw, data = si(v), si(v)
            elif t == BOOL: raw, data = 0xffffffff, 0xffffffff if v else 0
            else: raw, data = 0xffffffff, v
            ab += struct.pack("<IIIHBBI", nsi, si(n), raw, 8, 0, t, data)
        ext = struct.pack("<IIHHHHHH", 0xffffffff, si(tag), 20, 20, len(attrs), 0, 0, 0)
        body = struct.pack("<II", line[0], 0xffffffff) + ext + ab
        out = struct.pack("<HHI", 0x0102, 16, 8 + len(body)) + body; line[0] += 1
        for k in kids: out += node_bytes(k)
        out += struct.pack("<HHIIIII", 0x0103, 16, 24, line[0], 0xffffffff, 0xffffffff, si(tag)); line[0] += 1
        return out
    elems = node_bytes(tree)
    ns_start = struct.pack("<HHIIIII", 0x0100, 16, 24, 1, 0xffffffff, si("android"), si(NSURI))
    ns_end = struct.pack("<HHIIIII", 0x0101, 16, 24, line[0], 0xffffffff, si("android"), si(NSURI))
    sp = string_pool(pool)
    rm = struct.pack("<HHI", 0x0180, 8, 8 + 4 * len(ATTRS)) + b"".join(struct.pack("<I", r) for _, r in ATTRS)
    body = sp + rm + ns_start + elems + ns_end
    return struct.pack("<HHI", 0x0003, 8, 8 + len(body)) + body

def string_pool(strings):
    sdata = bytearray(); offs = []
    for s in strings:
        offs.append(len(sdata)); sdata += struct.pack("<H", len(s)) + s.encode("utf-16-le") + b"\0\0"
    while len(sdata) % 4: sdata += b"\0"
    start = 28 + 4 * len(strings)
    return struct.pack("<HHIIIIII", 0x0001, 28, start + len(sdata), len(strings), 0, 0, start, 0) + b"".join(struct.pack("<I", o) for o in offs) + sdata

ICON_BG, ICON_FG, ICON = 0x7f010000, 0x7f010001, 0x7f010002
APP_LABEL = "Ortho preSSaleel"

def build_manifest():
    ATTRS = [("label", 0x01010001), ("icon", 0x01010002), ("name", 0x01010003), ("exported", 0x01010010), ("configChanges", 0x0101001f),
             ("minSdkVersion", 0x0101020c), ("versionCode", 0x0101021b), ("versionName", 0x0101021c), ("targetSdkVersion", 0x01010270)]
    tree = ("manifest", [(None, "package", STR, PKG), ("a", "versionCode", INT, VERSION_CODE), ("a", "versionName", STR, VERSION_NAME)], [
        ("uses-sdk", [("a", "minSdkVersion", INT, 24), ("a", "targetSdkVersion", INT, 34)], []),
        ("uses-permission", [("a", "name", STR, "android.permission.INTERNET")], []),
        ("application", [("a", "label", STR, APP_LABEL), ("a", "icon", REF, ICON)], [
            ("activity", [("a", "name", STR, PKG + ".MainActivity"), ("a", "exported", BOOL, True), ("a", "configChanges", HEX, 0x04a0)], [
                ("intent-filter", [], [
                    ("action", [("a", "name", STR, "android.intent.action.MAIN")], []),
                    ("category", [("a", "name", STR, "android.intent.category.LAUNCHER")], []),
                ])])])])
    return axml(tree, ATTRS)

def build_adaptive_icon():
    ATTRS = [("drawable", 0x01010199)]
    tree = ("adaptive-icon", [], [("background", [("a", "drawable", REF, ICON_BG)], []), ("foreground", [("a", "drawable", REF, ICON_FG)], [])])
    return axml(tree, ATTRS)

# ---------------------------------------------------------------- resources.arsc
PATHS = ["res/drawable-xxxhdpi-v4/ic_bg.png", "res/drawable-xxxhdpi-v4/ic_fg.png", "res/drawable-xxxhdpi-v4/ic_launcher.png", "res/drawable-anydpi-v26/ic_launcher.xml"]
def config(density, sdk):
    c = bytearray(64); struct.pack_into("<I", c, 0, 64); struct.pack_into("<H", c, 14, density); struct.pack_into("<H", c, 24, sdk); return bytes(c)
def type_chunk(cfg, entries):  # entries: list of global-string index or None
    n = len(entries); hdr = 84; start = hdr + 4 * n
    offs, ebytes = [], b""
    for k, v in enumerate(entries):
        if v is None: offs.append(0xffffffff); continue
        offs.append(len(ebytes)); ebytes += struct.pack("<HHI", 8, 0, k) + struct.pack("<HBBI", 8, 0, STR, v)
    body = struct.pack("<BBHII", 1, 0, 0, n, start) + cfg + b"".join(struct.pack("<I", o) for o in offs) + ebytes
    return struct.pack("<HHI", 0x0201, hdr, 8 + len(body)) + body
def build_arsc():
    gpool = string_pool(PATHS)
    tstr, kstr = string_pool(["drawable"]), string_pool(["ic_bg", "ic_fg", "ic_launcher"])
    spec = struct.pack("<HHIBBHI", 0x0202, 16, 16 + 12, 1, 0, 0, 3) + struct.pack("<III", 0x0100, 0x0100, 0x0500)
    tA = type_chunk(config(640, 4), [0, 1, 2])
    tB = type_chunk(config(0xfffe, 26), [None, None, 3])
    name = PKG.encode("utf-16-le").ljust(256, b"\0")
    hdr_size = 288
    type_off = hdr_size; key_off = type_off + len(tstr)
    pkg_body = struct.pack("<I", 0x7f) + name + struct.pack("<IIIII", type_off, 1, key_off, 3, 0)
    pkg = tstr + kstr + spec + tA + tB
    pkg_chunk = struct.pack("<HHI", 0x0200, hdr_size, hdr_size + len(pkg)) + pkg_body + pkg
    assert len(struct.pack("<HHI", 0, 0, 0) + pkg_body) == hdr_size
    body = struct.pack("<I", 1) + gpool + pkg_chunk
    return struct.pack("<HHI", 0x0002, 12, 8 + len(body)) + body

# ---------------------------------------------------------------- app page transform
REMOTE = "https://raw.githubusercontent.com/salilibrahimckl-ops/orthoquest/main/orthoss-prep/questions.json"
PRELUDE = r'''let RAWX = RAW;
try{let c=null;try{c=JSON.parse(localStorage.getItem("orthoss_remote_bank")||"null")}catch(e){}
  if(!c&&window.name&&window.name.charAt(0)==="{"){try{c=JSON.parse(window.name)}catch(e){}}
  if(c&&Array.isArray(c.raw)&&c.raw.length>RAW.length){RAWX=c.raw;window.__bankUpd=c.updated}}catch(e){}
const BANK = RAWX.map('''
UPDATER = r'''<script>
/* Pull new questions from the online question bank; progress (orthoss_prep_v1) is never touched. */
(function(){
  try{
    fetch("%s?t="+Date.now(),{cache:"no-store"}).then(function(r){return r.ok?r.json():null}).then(function(d){
      if(!d||!Array.isArray(d.raw)||d.raw.length<=BANK.length)return;
      var n=d.raw.length-BANK.length,s=JSON.stringify(d),stored=false;
      try{localStorage.setItem("orthoss_remote_bank",s);stored=true}catch(e){}
      var b=document.createElement("button");b.type="button";
      b.textContent=n+" new question"+(n===1?"":"s")+" downloaded. Tap to load them";
      b.style.cssText="position:fixed;left:16px;right:16px;bottom:calc(76px + env(safe-area-inset-bottom,0px));z-index:9;background:var(--accent);color:var(--accent-ink);border:0;border-radius:12px;padding:14px;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.25)";
      b.onclick=function(){if(!stored)window.name=s;location.reload()};
      document.body.appendChild(b);
    }).catch(function(){});
  }catch(e){}
})();
</script>''' % REMOTE
def transform_html(h):
    reps = [("<title>OrthoSS Prep</title>", "<title>%s</title>" % APP_LABEL),
            ('<div class="brand">Ortho<span>SS</span> Prep</div>', '<div class="brand">Ortho pre<span>SS</span>aleel</div>'),
            ("const BANK = RAW.map(", PRELUDE),
            ("Bank last updated ${BANK_UPDATED}", "Bank last updated ${window.__bankUpd||BANK_UPDATED}")]
    for a, b in reps:
        assert h.count(a) == 1, a
        h = h.replace(a, b)
    i = h.rindex("</script>") + len("</script>")
    return h[:i] + "\n" + UPDATER + h[i:]

# ---------------------------------------------------------------- signing key
def load_key():
    os.makedirs(KEYDIR, exist_ok=True)
    kp, cp = os.path.join(KEYDIR, "orthoss-signing-key.pem"), os.path.join(KEYDIR, "orthoss-signing-cert.der")
    if os.path.exists(kp):
        key = serialization.load_pem_private_key(open(kp, "rb").read(), None)
        cert = x509.load_der_x509_certificate(open(cp, "rb").read())
        return key, cert
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "OrthoSS Prep"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Salil")])
    now = datetime.datetime(2026, 1, 1)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
            .serial_number(x509.random_serial_number()).not_valid_before(now).not_valid_after(now + datetime.timedelta(days=365 * 30))
            .sign(key, hashes.SHA256()))
    open(kp, "wb").write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    open(cp, "wb").write(cert.public_bytes(serialization.Encoding.DER))
    return key, cert

# ---------------------------------------------------------------- APK v2 signature
def lp(b): return struct.pack("<I", len(b)) + b
def sign_v2(zipbytes, key, cert):
    eocd = zipbytes.rfind(b"PK\x05\x06")
    cd_off, = struct.unpack("<I", zipbytes[eocd + 16:eocd + 20])
    cd_size, = struct.unpack("<I", zipbytes[eocd + 12:eocd + 16])
    sec1, sec3, sec4 = zipbytes[:cd_off], zipbytes[cd_off:cd_off + cd_size], zipbytes[eocd:]
    chunks = []
    for sec in (sec1, sec3, sec4):
        for i in range(0, len(sec), 1 << 20):
            c = sec[i:i + (1 << 20)]
            chunks.append(hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest())
    digest = hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + b"".join(chunks)).digest()
    ALG = 0x0103
    cert_der = cert.public_bytes(serialization.Encoding.DER)
    signed_data = lp(lp(struct.pack("<I", ALG) + lp(digest))) + lp(lp(cert_der)) + lp(b"")
    sig = key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
    pub = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    signer = lp(signed_data) + lp(lp(struct.pack("<I", ALG) + lp(sig))) + lp(pub)
    v2 = lp(lp(signer))
    pair = struct.pack("<Q", 4 + len(v2)) + struct.pack("<I", 0x7109871a) + v2
    block_size = len(pair) + 8 + 16
    block = struct.pack("<Q", block_size) + pair + struct.pack("<Q", block_size) + b"APK Sig Block 42"
    new_eocd = bytearray(sec4); new_eocd[16:20] = struct.pack("<I", cd_off + len(block))
    return sec1 + block + sec3 + bytes(new_eocd)

def main():
    dex, man = build_dex(), build_manifest()
    html = transform_html(open(HTML, encoding="utf-8").read()).encode("utf-8")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        def add(name, data, comp=zipfile.ZIP_DEFLATED, align=0):
            zi = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0)); zi.compress_type = comp
            if align:
                pos = buf.tell() + 30 + len(name.encode())
                pad = (-pos) % align
                if pad: zi.extra = b"\0" * pad
            z.writestr(zi, data)
        add("AndroidManifest.xml", man)
        add("resources.arsc", build_arsc(), zipfile.ZIP_STORED, 4)
        add("classes.dex", dex)
        add(PATHS[0], open(ICONS + "_bg.png", "rb").read(), zipfile.ZIP_STORED)
        add(PATHS[1], open(ICONS + "_fg.png", "rb").read(), zipfile.ZIP_STORED)
        add(PATHS[2], open(ICONS + "_legacy.png", "rb").read(), zipfile.ZIP_STORED)
        add(PATHS[3], build_adaptive_icon())
        add("assets/index.html", html)
    key, cert = load_key()
    open(OUT, "wb").write(sign_v2(buf.getvalue(), key, cert))
    open(OUT + ".html", "wb").write(html)
    print("APK", OUT, os.path.getsize(OUT), "bytes")

ICONS = sys.argv[6] if len(sys.argv) > 6 else "icon"
main()
