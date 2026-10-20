"""Uso: python3 verifica_esempi.py src/*.txt

Compila ed esegue i programmi completi (blocchi ```cpp con main) dei file indicati.
Se il blocco successivo e' ```text, confronta lo stdout. Direttive nel codice:
  // compila: <flag extra>     es. -std=c++23 -lsqlite3
  // non eseguire              solo compilazione
  // non compilare             blocco saltato (librerie esterne)
I frammenti delle lezioni originali che usano librerie esterne vengono segnalati come errori.
"""
import re, subprocess, sys, os, tempfile, hashlib

def blocks(path):
    lines = open(path, encoding="utf-8").read().split("\n")
    out, i = [], 0
    while i < len(lines):
        if lines[i].startswith("```"):
            lang = lines[i][3:].strip(); start = i + 1; i += 1; b = []
            while not lines[i].startswith("```"): b.append(lines[i]); i += 1
            out.append((lang, start, b))
        i += 1
    return out

fails = 0; ok = 0
tmp = tempfile.mkdtemp()
for path in sys.argv[1:]:
    bl = blocks(path)
    for k, (lang, ln, b) in enumerate(bl):
        for j, l in enumerate(b):
            if len(l) > 100: print(f"LARGA {path}:{ln+j+1} ({len(l)})")
        if lang != "cpp" or not any(re.search(r"\bint main\(", l) for l in b): continue
        src = "\n".join(b) + "\n"
        if "non compilare" in src: continue
        flags = []
        for l in b:
            m = re.search(r"// compila: (.*)", l)
            if m: flags = m.group(1).split()
        std = [f for f in flags if f.startswith("-std=")] or ["-std=c++20"]
        rest = [f for f in flags if not f.startswith("-std=")]
        name = os.path.join(tmp, hashlib.md5(src.encode()).hexdigest())
        open(name + ".cpp", "w").write(src)
        san = [] if "// no-asan" in src else ["-fsanitize=address,undefined"]
        cmd = ["g++", *std, "-Wall", "-Wextra", "-g", *san, name + ".cpp", "-o", name, *rest, "-pthread"]
        r = subprocess.run(cmd, capture_output=True, text=True)
        tag = f"{os.path.basename(path)}:{ln}"
        if r.returncode != 0 or "warning" in r.stderr:
            print(f"COMPILA {'ERR' if r.returncode else 'WARN'} {tag}\n{r.stderr[:3000]}")
            if r.returncode: fails += 1; continue
        if "non eseguire" in src: ok += 1; continue
        try:
            r = subprocess.run([name], capture_output=True, text=True, timeout=20, cwd=tmp)
        except subprocess.TimeoutExpired:
            print(f"TIMEOUT {tag}"); fails += 1; continue
        if r.returncode != 0 and k + 1 < len(bl) and bl[k + 1][0] == "console":
            exp = "\n".join(x.rstrip() for x in bl[k + 1][2]).rstrip()
            got = "\n".join(x.rstrip() for x in r.stdout.split("\n")).rstrip()
            if got == exp: ok += 1; continue
        if r.returncode != 0:
            print(f"EXIT {r.returncode} {tag}\n{r.stdout[:1000]}\n{r.stderr[:2000]}"); fails += 1; continue
        if k + 1 < len(bl) and bl[k + 1][0] == "text":
            exp = "\n".join(x.rstrip() for x in bl[k + 1][2]).rstrip()
            got = "\n".join(x.rstrip() for x in r.stdout.split("\n")).rstrip()
            if got != exp:
                print(f"OUTPUT DIVERSO {tag}\n--- atteso\n{exp}\n--- ottenuto\n{got}")
                fails += 1; continue
        ok += 1
print(f"ok={ok} errori={fails}")
sys.exit(1 if fails else 0)
