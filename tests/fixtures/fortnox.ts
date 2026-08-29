import { PDFDocument, StandardFonts } from "pdf-lib";

function eventMarkup(sourceId: string, date: string, type: string, description: string): string {
  return `
    <ul id="${sourceId}" class="cards d-md-none">
      <li><strong>Datum</strong><strong>${date}</strong></li>
      <li><strong>Typ</strong><strong>${type}</strong></li>
      <li><strong>Beskrivning</strong><strong>${description}</strong></li>
    </ul>
    <div id="${sourceId}" class="desktop-view-value d-none d-md-flex">
      <strong>${date}</strong><strong>${type}</strong><strong>${description}</strong>
    </div>`;
}

export const syntheticFortnoxImport = Object.freeze({
  detailedRegisterText: `
Aktiebok
Exempelimport AB
550000-0004
2026-08-28

Aktiepost 1
Aktienummer
1 - 2
Antal aktier
2 (A-aktie)
Antal röster
2
Infört i aktieboken
2024-01-01
Postens kapitalbelopp
20 kr
Kvotvärde
10 kr / aktie
Aktieägare
811218-2392
Testägare Individ
Testgatan 1
111 11 Teststad
Inlösenförbehåll
Nej
Inga tidigare ägare.

Aktiepost 2
Aktienummer
3 - 3
Antal aktier
1 (A-aktie)
Antal röster
1
Infört i aktieboken
2025-02-02
Postens kapitalbelopp
10 kr
Kvotvärde
10 kr / aktie
Aktieägare
850709-2388
Testägare Två
Bolagsvägen 2
222 22 Provort
Inlösenförbehåll
Nej
Inga tidigare ägare.
`,
  ownerOverviewText: `
Aktieägaröversikt för Exempelimport AB (550000-0004), 2026-08-28
Ägare A-aktier Ägarandel Röster
Testägare Individ (811218-2392) 2 66,67 % 2 (ca 67 %)
Testägare Två (850709-2388) 1 33,33 % 1 (ca 33 %)
Summa 3 3
`,
  eventsHtml: `<!doctype html><html><body>
    ${eventMarkup("10", "2024-01-01", "Uppläggning", "Aktieboken skapades")}
    ${eventMarkup("11", "2025-01-01", "Split", "Split genomfördes")}
  </body></html>`,
});

async function textPdf(name: string, source: string): Promise<File> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  let page = document.addPage();
  let y = page.getHeight() - 30;
  for (const line of source.trim().split("\n")) {
    if (y < 30) {
      page = document.addPage();
      y = page.getHeight() - 30;
    }
    if (line !== "") page.drawText(line, { x: 30, y, size: 8, font });
    y -= 10;
  }
  const bytes = await document.save();
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { type: "application/pdf" });
}

export async function syntheticFortnoxFiles() {
  return {
    detailedRegisterPdf: await textPdf("aktiebok.pdf", syntheticFortnoxImport.detailedRegisterText),
    ownerOverviewPdf: await textPdf("agaroversikt.pdf", syntheticFortnoxImport.ownerOverviewText),
    eventsHtml: new File([syntheticFortnoxImport.eventsHtml], "handelser.html", {
      type: "text/html",
    }),
  };
}
