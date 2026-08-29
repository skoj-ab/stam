#let data = json("data.json")

// Mirrors the light application theme's "registry document" visual language.
#let paper = rgb("#fbfaf7")
#let surface = rgb("#fffefa")
#let surface-sunken = rgb("#f3f1ec")
#let surface-alternate = rgb("#f8f6f2")
#let ink = rgb("#302d29")
#let ink-muted = rgb("#706b65")
#let ink-subtle = rgb("#969089")
#let rule = rgb("#e2ded7")

#set document(
  title: "Aktiebok för " + data.company.legalName,
  author: "Stam",
  keywords: ("aktiebok", "aktieägare", "share register"),
)
#set page(
  paper: "a4",
  margin: (top: 17mm, right: 15mm, bottom: 17mm, left: 15mm),
  fill: paper,
  header: context {
    set text(font: "Liberation Sans", size: 7.5pt, fill: ink-muted)
    grid(
      columns: (1fr, auto),
      text(weight: "bold", data.company.legalName),
      [Aktiebok · #data.effectiveOn],
    )
    v(2.5pt)
    line(length: 100%, stroke: 0.35pt + rule)
  },
  footer: context {
    set text(font: "Liberation Sans", size: 6.8pt, fill: ink-muted)
    line(length: 100%, stroke: 0.35pt + rule)
    v(2.5pt)
    grid(
      columns: (1fr, auto),
      [Genererad #data.generatedAtLocal],
      [Senaste sekvens #data.lastAppliedSequence · Sida #counter(page).display("1 / 1", both: true)],
    )
  },
)
#set text(font: "Liberation Sans", size: 8.2pt, fill: ink, lang: "sv")
#set par(leading: 0.62em)
#set heading(numbering: none)
#show heading.where(level: 2): it => block(
  above: 13pt,
  below: 5pt,
  text(
    font: "Liberation Serif",
    size: 13pt,
    weight: "bold",
    tracking: -0.1pt,
    fill: ink,
    it.body,
  ),
)

#let header-cell(value) = table.cell(
  fill: surface-sunken,
  inset: (x: 4pt, y: 3.5pt),
  text(size: 6.4pt, weight: "bold", tracking: 0.25pt, fill: ink-subtle, upper(value)),
)

#let register-table(columns, alignments, headers, rows) = table(
  columns: columns,
  align: alignments,
  inset: (x: 4pt, y: 3.5pt),
  stroke: 0.35pt + rule,
  fill: (x, y) => if y > 0 and calc.even(y) { surface-alternate } else { surface },
  table.header(..headers.map(header-cell)),
  ..rows.flatten(),
)

#text(font: "Liberation Serif", size: 24pt, weight: "bold", tracking: -0.25pt)[Aktiebok]
#v(3pt)
#text(size: 9pt, weight: "bold")[#data.company.legalName]
#v(4pt)
#text(size: 7.7pt, fill: ink-muted)[
  #text(weight: "bold", fill: ink)[Organisationsnummer]
  #h(3pt)
  #data.company.registrationValue
  #linebreak()
  #text(weight: "bold", fill: ink)[Verkningsdag]
  #h(3pt)
  #data.effectiveOn
]

== Ägaröversikt

#if data.owners.len() == 0 {
  text(fill: ink-muted, style: "italic")[Inga aktieägare med innehav.]
} else {
  register-table(
    (1.2fr, 1.05fr, 1.35fr, 1.25fr, 0.7fr, 0.7fr),
    (left, left, left, left, right, right),
    ("Aktieägare", "Person-/organisationsnummer", "Postadress", "Kontakt", "Aktier", "Röster"),
    data.owners.map(owner => (
      owner.legalName,
      owner.identifier,
      owner.address,
      [
        #owner.emailAddress
        #linebreak()
        #text(size: 6.6pt, fill: ink-muted, owner.phoneNumber)
      ],
      [
        #owner.totalShares
        #linebreak()
        #text(size: 6.6pt, fill: ink-muted, owner.ownershipPercentage)
      ],
      [
        #owner.totalVotes
        #linebreak()
        #text(size: 6.6pt, fill: ink-muted, owner.votingPercentage)
      ],
    )) + ((
      text(weight: "bold", style: "italic", "Totalt"),
      "",
      "",
      "",
      text(weight: "bold", style: "italic", data.ownerTotal.totalShares),
      text(weight: "bold", style: "italic", data.ownerTotal.totalVotes),
    ),),
  )
}

== Aktieinnehav

#if data.holdings.len() == 0 {
  text(fill: ink-muted, style: "italic")[Inga aktieinnehav.]
} else {
  set text(size: 7.2pt)
  register-table(
    (0.9fr, 1.4fr, 1.25fr, 0.65fr),
    (left, left, left, left),
    ("Aktienummer", "Aktieägare", "Person-/organisationsnummer", "Aktieslag"),
    data.holdings.map(holding => (
      text(font: "Liberation Mono", size: 6.8pt, holding.range),
      [
        #holding.legalName
        #linebreak()
        #text(size: 6.6pt, fill: ink-muted, holding.kind)
      ],
      text(font: "Liberation Mono", size: 6.6pt, holding.identifier),
      holding.shareClass,
    )),
  )
}

== Aktieslag och totalt antal aktier

#if data.shareClasses.len() == 0 {
  text(fill: ink-muted, style: "italic")[Inga aktieslag med innehav.]
} else {
  register-table(
    (1.5fr, 1fr, 1fr),
    (left, right, right),
    ("Aktieslag", "Röster per aktie", "Antal aktier"),
    data.shareClasses.map(share-class => (
      strong(share-class.name),
      share-class.votesPerShare,
      share-class.totalShares,
    )),
  )
}
