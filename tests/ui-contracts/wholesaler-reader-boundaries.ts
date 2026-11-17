// A fake of the private wholesaler-file reader for the component contracts:
// the bundler puts it in place of vendor/wholesaler-reader/src/index, so the
// dialog's browser path runs through lib/inventory/wholesaler-reader.ts. It
// reads nothing of the bytes and answers a made-up delivery of „Großhandel
// Nordrohr“: „Meter“ articles as many as the spec asks, five „Rolle 50m“,
// forty „Stück“, one article without a number, one refused line and three
// rebate groups.

type FakeArticle = ReturnType<typeof article>;

function article(file: string, line: number, articleNumber: string, unit: string) {
  return {
    file,
    line,
    articleNumber,
    change: 'new' as const,
    shortText1: `Kupferrohr ${line}`,
    shortText2: '',
    unit,
    priceQuantity: 100 as const,
    price: { kind: 'list' as const, amountCents: 61000 },
    rebateGroup: 'CU1',
    mainProductGroup: null,
    productGroup: null,
    ean: null,
    matchcode: null,
  };
}

export function readDelivery(files: { name: string; bytes: Uint8Array }[]) {
  const contract = window.uiContractWholesalerImport;
  contract.read.push(...files.map((file) => file.name));
  if (contract.readerFails) throw new Error('unreadable');
  const articleFile = files[0]?.name ?? '';
  const priceFile = files[1]?.name ?? articleFile;
  const articles: FakeArticle[] = [];
  const units: [string, number][] = [
    ['Meter', contract.meterArticles],
    ['Rolle 50m', 5],
    ['Stück', 40],
  ];
  for (const [unit, count] of units) {
    for (let index = 0; index < count; index += 1) {
      const line = articles.length + 20;
      articles.push(article(articleFile, line, `NR-${line}`, unit));
    }
  }
  articles.push(article(articleFile, 17, '', 'Meter'));
  return {
    header: {
      version: '4',
      supplierText: 'Großhandel Nordrohr GmbH, Bremen',
      date: '2037-11-02',
      currency: 'EUR',
    },
    articles,
    deletions: [],
    priceChanges: [],
    productGroups: [],
    rebateGroups: ['CU1', 'CU2', 'MS1'].map((rebateGroup) => ({
      rebateGroup,
      discount: { kind: 'percent' as const, hundredthsOfPercent: 1500 },
      text: `Rabattgruppe ${rebateGroup}`,
    })),
    skipped: [],
    rejected: [{ file: priceFile, line: 4, code: 'line_incomplete', reason: 'Der Zeile fehlen Angaben.' }],
  };
}
