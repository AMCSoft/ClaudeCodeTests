import re, glob, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer,
    PageBreak, Preformatted, Table, TableStyle, KeepTogether, NextPageTemplate)
from reportlab.platypus.tableofcontents import TableOfContents
from xml.sax.saxutils import escape

BLUE = colors.HexColor("#1f4e8c"); LIGHT = colors.HexColor("#eef3fa")
GREEN = colors.HexColor("#2e7d32"); AMBER = colors.HexColor("#fff4d6")
body = ParagraphStyle("b", fontName="Helvetica", fontSize=10, leading=14.5, spaceAfter=6)
bul = ParagraphStyle("bul", parent=body, leftIndent=16, bulletIndent=5, spaceAfter=2)
h1 = ParagraphStyle("h1", fontName="Helvetica-Bold", fontSize=26, leading=32, textColor=BLUE, spaceAfter=14)
h2 = ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=16, leading=20, textColor=BLUE, spaceBefore=14, spaceAfter=8)
h3 = ParagraphStyle("h3", fontName="Helvetica-Bold", fontSize=12.5, leading=16, textColor=colors.HexColor("#222222"), spaceBefore=12, spaceAfter=5)
codest = ParagraphStyle("c", fontName="Courier", fontSize=8.3, leading=10.4)
boxst = ParagraphStyle("box", parent=body, fontSize=9.3, leading=13, spaceAfter=2)

def inline(t):
    t = escape(t)
    t = re.sub(r"`([^`]+)`", r'<font name="Courier" color="#a31515">\1</font>', t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", t)
    return t

class Doc(BaseDocTemplate):
    def __init__(self, fn, **kw):
        super().__init__(fn, pagesize=A4, leftMargin=2*cm, rightMargin=2*cm, topMargin=2.2*cm, bottomMargin=2*cm,
                         title="Corso completo di C++ moderno", author="Claude")
        fr = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="f")
        self.addPageTemplates([PageTemplate("cover", [fr], onPage=lambda c,d: None),
                               PageTemplate("main", [fr], onPage=self.deco)])
    def deco(self, c, d):
        c.saveState(); c.setFont("Helvetica", 8); c.setFillColor(colors.grey)
        c.drawString(2*cm, A4[1]-1.4*cm, "Corso completo di C++ moderno")
        c.drawRightString(A4[0]-2*cm, 1.2*cm, f"{d.page}")
        c.setStrokeColor(colors.lightgrey); c.line(2*cm, A4[1]-1.6*cm, A4[0]-2*cm, A4[1]-1.6*cm); c.restoreState()
    def afterFlowable(self, f):
        if isinstance(f, Paragraph):
            lvl = {"h1":0,"h2":1,"h3":2}.get(f.style.name)
            if lvl is not None and lvl < 3:
                txt = f.getPlainText(); key = f"k{self.seq.nextf('toc')}"
                self.canv.bookmarkPage(key); self.canv.addOutlineEntry(txt, key, lvl, closed=lvl>0)
                if lvl < 2: self.notify("TOCEntry", (lvl, txt, self.page, key))

def box(items, title, bg, fg):
    rows = [[Paragraph(f'<b>{title}</b>', ParagraphStyle("bt", parent=boxst, textColor=fg))]]
    rows += [[Paragraph(i, boxst)] for i in items]
    t = Table(rows, colWidths=[17*cm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("LINEBEFORE",(0,0),(0,-1),3,fg),
        ("LEFTPADDING",(0,0),(-1,-1),10),("TOPPADDING",(0,0),(-1,-1),2),("BOTTOMPADDING",(0,0),(-1,-1),2)]))
    return [Spacer(1,4), t, Spacer(1,8)]

def code(lines):
    t = Table([[Preformatted("\n".join(lines), codest)]], colWidths=[17*cm])
    t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),colors.HexColor("#f5f5f5")),
        ("BOX",(0,0),(-1,-1),0.5,colors.HexColor("#cccccc")),("LEFTPADDING",(0,0),(-1,-1),8),
        ("TOPPADDING",(0,0),(-1,-1),6),("BOTTOMPADDING",(0,0),(-1,-1),6)]))
    return [t, Spacer(1,8)]

def parse(path_list):
    st = []; lessons = 0
    for p in path_list:
        lines = open(p, encoding="utf-8").read().split("\n")
        i = 0; para = []; lc = []; notes = []
        def flush():
            nonlocal para
            if para: st.append(Paragraph(inline(" ".join(para)), body)); para = []
        def flushbox():
            nonlocal lc, notes
            if notes: st.extend(box([inline(n) for n in notes], "Nota", AMBER, colors.HexColor("#b8860b"))); notes = []
            if lc: st.extend(box([inline(x) for x in lc], "Esercizi consigliati su LeetCode", LIGHT, GREEN)); lc = []
        while i < len(lines):
            l = lines[i]
            if l.startswith("```"):
                flush(); i += 1; blk = []
                while not lines[i].startswith("```"): blk.append(lines[i]); i += 1
                # split very long blocks to allow page breaks
                for k in range(0, len(blk), 45): st.extend(code(blk[k:k+45]))
            elif l.startswith("# "):
                flush(); flushbox(); st.append(NextPageTemplate("main")); st.append(PageBreak()); st.append(Paragraph(inline(l[2:]), h1))
            elif l.startswith("## "):
                flush(); flushbox(); st.append(Paragraph(inline(l[3:]), h2))
            elif l.startswith("### "):
                flush(); flushbox(); lessons += 1; st.append(Paragraph(inline(l[4:]), h3))
            elif l.startswith("|"):
                flush(); rows = []
                while i < len(lines) and lines[i].startswith("|"):
                    if not set(lines[i]) <= set("|-: "): rows.append([c.strip() for c in lines[i].strip("|").split("|")])
                    i += 1
                i -= 1
                data = [[Paragraph(inline(c), boxst if r else ParagraphStyle("th", parent=boxst, fontName="Helvetica-Bold")) for c in row] for r, row in enumerate(rows)]
                t = Table(data, repeatRows=1)
                t.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),LIGHT),("GRID",(0,0),(-1,-1),0.4,colors.lightgrey)]))
                st.extend([t, Spacer(1,8)])
            elif l.startswith("- "):
                flush(); st.append(Paragraph(inline(l[2:]), bul, bulletText="•"))
            elif l.startswith("LC: "): flush(); lc.append(l[4:])
            elif l.startswith("NOTA: "): flush(); notes.append(l[6:])
            elif l.strip() == "": flush()
            else: para.append(l.strip())
            i += 1
        flush(); flushbox()
    return st, lessons

files = sorted(glob.glob("src/*.txt"))
story, nl = parse(files)
toc = TableOfContents(); toc.levelStyles = [
    ParagraphStyle("t0", fontName="Helvetica-Bold", fontSize=11, leading=16, spaceBefore=8, textColor=BLUE),
    ParagraphStyle("t1", fontName="Helvetica", fontSize=9.5, leading=13, leftIndent=14)]
cover = [Spacer(1,6*cm), Paragraph("Corso completo di<br/>C++ moderno", ParagraphStyle("ct", fontName="Helvetica-Bold", fontSize=38, leading=46, textColor=BLUE)),
    Spacer(1,1*cm), Paragraph("Dalle basi al C++20/23: strutture dati, algoritmi, web, mobile, videogiochi, embedded, sistemi operativi, reti e database", ParagraphStyle("cs", parent=body, fontSize=14, leading=20, textColor=colors.HexColor("#444444"))),
    Spacer(1,1.5*cm), Paragraph(f"Con esercizi consigliati da LeetCode per ogni sezione", ParagraphStyle("cs2", parent=body, fontSize=11, textColor=GREEN)),
    NextPageTemplate("main"), PageBreak(), Paragraph("Indice", ParagraphStyle("idx", parent=h1)), toc]
Doc("Corso_Cpp_Moderno.pdf").multiBuild(cover + story)
print("lezioni:", nl)
